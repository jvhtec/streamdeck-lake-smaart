# Codebase Audit — 2026-07-02

Scope: full read of `com.jvhtec.lake-smaart.sdPlugin/plugin/**` (~8.6k lines of TypeScript),
`ui/*.html`, `ui/inspector.js`, `manifest.json`, build scripts, and tests.

Verification performed in a Linux container:

- `tsc --noEmit` (project TypeScript 5.x): clean.
- `node --test tests/lake/lake.test.js`: 10/10 pass.
- `node --test tests/la/la.test.js`: 18/18 pass.
- `npm run build`: **fails with exit 127** (see H3).

Findings are ordered by severity. File references are `path:line` against the current
`main`/audit branch tree.

---

## High severity

### H1. Smaart response/request off-by-one when a command is queued before the API handshake completes

`plugin/smaart/smaartClient.ts:112-123`

In the WebSocket `message` handler, when the handshake response arrives
(`authenticationRequired === false` or `applicationName`), the client marks the API ready and
immediately dispatches the next queued command — and then falls through to
`resolveActiveRequest(response)` **with the handshake response**:

```ts
if (!this.apiReady && (response.authenticationRequired === false || response.applicationName)) {
    this.isConnected = true;
    this.apiReady = true;
    this.dispatchNextCommand();   // sets this.activeRequest and sends the queued command
}
...
this.resolveActiveRequest(response);  // resolves that just-sent request with the HANDSHAKE payload
```

Any request queued while the socket was still connecting (very common: `connect()` is followed
immediately by `getActiveCalibratedInputs()` / generator status reads, and `applyDiscoverySettings`
reconnects the socket) is resolved with the wrong payload. Every later response then resolves the
*next* queued command, shifting the whole queue off by one. Concretely, an SPL-catalog request
resolved with the handshake body has no `devices` array, so the PI reports "No active calibrated
inputs" even when Smaart has them — the same symptom PR #25 was chasing.

**Fix:** `return` after the handshake branch (an `activeRequest` cannot exist before `apiReady`
is set, so nothing is lost), or resolve the active request before dispatching the next command.

### H2. `DeviceManager.refreshCatalog` never clears `refreshInFlight` on rejection — discovery can die permanently

`plugin/core/deviceManager.ts:40-45`

```ts
public async refreshCatalog() {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.refreshCatalogInternal();
    await this.refreshInFlight;
    this.refreshInFlight = null;   // skipped if the await throws
}
```

If `refreshCatalogInternal()` rejects (e.g. a `catalogUpdated` listener throws — listeners run
synchronously inside the `emit`), `refreshInFlight` stays set to a rejected promise forever.
Every subsequent call — including the 15-second discovery timer and all PI "Refresh Devices"
requests — returns that same rejected promise, and the device catalog never updates again until
the plugin restarts.

**Fix:** use `try { await ... } finally { this.refreshInFlight = null; }` (or `.finally()` on the
stored promise).

### H3. `npm run build` fails on macOS/Linux — `postbuild` unconditionally invokes PowerShell

`package.json` (`postbuild`), `scripts/copy-runtime-deps.ps1`

```
> powershell -NoProfile -ExecutionPolicy Bypass -File scripts/copy-runtime-deps.ps1
sh: 1: powershell: not found        → npm exits 127
```

The manifest declares macOS support (`"Platform": "mac"`, `CodePathMac`), and CLAUDE.md documents
`npm run build` as the standard build command, but the build only completes on Windows. The `tsc`
output is produced, then npm reports failure, which also breaks `npm run test:la` / `test:lake`
(both are `npm run build && ...`) and any CI on a non-Windows runner.

**Fix:** replace the copy step with a small cross-platform Node script (`node scripts/copy-runtime-deps.mjs`),
or gate it: `node -e "process.platform==='win32'&&process.exit(1)" || powershell ...` style guard.

### H4. State polling has no overlap guard — UDP/HTTP storms against slow or offline devices

`plugin/core/deviceManager.ts:89-93`

`pollOnce()` is fired from `setInterval(..., 300)` with no re-entrancy check. A Lake module read
is multiple DLM round trips (`Mod.Out.Chans?`, per-channel `Mod.Out.Mute?`, `Mod.In.Gain?`) each
with a 1000 ms timeout and one retry; when a unit is slow or offline a single poll can take
seconds, while new polls keep starting every 300 ms. The result is unbounded concurrent polls per
target: growing `pendingRequests`, duplicated UDP traffic, log spam, and needless load on the
console network. The same applies to L-Acoustics HTTP polls (1.2 s timeout > 300 ms interval);
the per-host limiter caps concurrency at 10 but the queue itself grows without bound.

**Fix:** skip the tick while the previous `pollOnce()` is still running (same `inFlight` pattern
as `refreshCatalog`, with the H2 `finally` fix).

### H5. Every settings event tears down and reopens the Smaart connection

`plugin/index.ts:273-277`, `plugin/smaart/smaartClient.ts:56-67`

`applyDiscoverySettings()` unconditionally calls `smaartClient.setTarget(...)` followed by
`connect()`. `setTarget` always closes the current socket and rejects all pending commands — even
when host/port did not change. Because the property inspectors merge the discovery fields into
every action's per-context settings (`ui/key.html` `saveSettings`), nearly every `willAppear` /
`didReceiveSettings` event carries discovery settings and triggers this path. Switching Stream
Deck pages therefore drops the Smaart connection and any in-flight requests, producing transient
"Not connected" failures and re-triggering the H1 race on every reconnect.

**Fix:** make `setTarget` a no-op when host/port are unchanged, and make `connect()` idempotent
when the socket is already OPEN/CONNECTING to the same target.

---

## Medium severity

### M1. Smaart client never reconnects on its own

`plugin/smaart/smaartClient.ts:126-141`

On `close`/`error` the socket is discarded and nothing schedules a retry; `waitForReady()` only
polls, it never dials. If Smaart restarts, all Smaart keys fail until some settings/appearance
event happens to call `applyDiscoverySettings` again. A small backoff reconnect timer (or a
`connect()` attempt inside `request()` when the socket is gone) would make the actions self-healing.

### M2. L-Acoustics subnet scan silently supports only `/24` (and `a-b` ranges)

`plugin/backends/laHttpBackend.ts:333-351`, `plugin/core/networkAdapters.ts:67-82`

`deriveDiscoverySubnet` clamps prefixes *below* 24 up to `/24`, but passes `/25`–`/30` through
unchanged — and `expandSubnet` only matches `x.y.z.0/24` or `x.y.z.a-b`, returning `[]` for
anything else with no log. An operator on a `/25` show network gets zero LA discovery and no
explanation (the only debug message covers the *empty* subnet case). Either expand arbitrary CIDR
prefixes ≥ 24, or log "unsupported subnet format" when the pattern match fails.

### M3. Failed target polls don't notify actions, so keys/dials keep showing stale state

`plugin/core/deviceManager.ts:117-123`

The success path emits `targetStateUpdated`; the failure path only stores
`{ online: false }` and emits a log line. `LevelEncoderAction`/`MuteAction`/`PriorityAction`
update their displays exclusively from `targetStateUpdated`, so a dial keeps showing the last
level/mute state instead of OFFLINE when a device drops. Emit the event in the catch branch too.

### M4. Preset double-press guard re-arms incorrectly after a recall

`plugin/actions/presetRecallAction.ts:77-90`

`lastPress` is set on the *first* press and never cleared. After a successful double-press recall,
a third press arriving within the 1200 ms window (`now - last <= 1200`) recalls again with no
"Press Again" confirmation. Clear `this.lastPress.delete(e.context)` once the recall fires.

### M5. Singleton Smaart toggles hold plugin-local state that can drift from reality

`plugin/actions/keySmaartGen.ts:9`, `plugin/actions/keySmaartTraceToggle.ts:9`

Both actions keep a single `private state` boolean per action class (shared by all key instances)
that starts hard-coded (`false` / `true`) and is never seeded from Smaart. If the generator is
already on when the plugin starts (or is toggled from Smaart itself), the first key press sends
the wrong direction and the key image shows the wrong state. `SmaartGeneratorGainDialAction`
already shows the right pattern (`getSignalGeneratorStatus()` on appear) — reuse it here.

### M6. `GROUPS[target.id]` is unchecked in the Lake backend

`plugin/backends/lakeBackend.ts:204,254,277`

`getState`/`setMute`/`setLevel` do `const group = GROUPS[target.id]` and immediately dereference.
Today only `LR`/`ALL` group targets are generated, but any future/stale group id crashes with a
`TypeError` instead of the clean "target not available" error every other path produces. Guard and
throw a descriptive error.

### M7. `DlmClient` bind failures are permanent until settings change

`plugin/lake/dlmClient.ts:94-97,277-311`

If the initial UDP bind fails (adapter briefly missing at startup, EADDRINUSE in fixed-port mode),
`socketReady` stays rejected and every subsequent `send()`/`discoverUnits()` throws the same
stale error. `recreateSocket()` only runs when bind address or port mode changes. Consider retrying
the bind with backoff, or recreating the socket when `socketReady` is rejected.

---

## Low severity / polish

- **`ui/inspector.js` is dead code** — neither `key.html` nor `dial.html` references it (both have
  inline scripts). It has also drifted: its target filter would show level targets for the priority
  action (`updateSelectors` has no `priority` branch). Delete it before someone "fixes" the wrong file.
- **Duplicate `getRequiredBackend()` in `ui/dial.html:229-249`** — two identical declarations back
  to back; the second silently wins.
- **Duplicate `openInspectorContexts.add(event.context)`** — `plugin/index.ts:418,433` runs in two
  separate `propertyInspectorDidAppear` blocks; harmless but confusing. Merge the blocks.
- **`mapSmaartSplCatalog` exists three times** — `plugin/index.ts:291`, `ui/key.html:644`, and the
  generated fallback in `plugin/piHtml.ts`. Consider a single shared source (the PI copies must be
  inlined, but they could be generated from one template).
- **`smaartSplCatalog` request can go unanswered** — `plugin/index.ts:462-478`: when
  `waitForReady` times out the handler logs and returns without sending anything to the PI, leaving
  the embedded PI showing a stale list (the browser-PI path does send the error). Send
  `smaartSplError` in that branch too.
- **Repo hygiene** — `debug.log` and `WhatsApp Image 2026-03-27 at 22.04.09.jpeg` are committed at
  the repo root; `.gitignore` still references the old `com.yourcompany.lake-smaart.sdPlugin/dist/`;
  `test-smaart.js` hard-codes a private IP (`172.25.160.1`). The `images/` folder carries many
  timestamp-suffixed duplicates of the same icons.
- **`isLoopbackAddress` only matches `127.0.0.1`** (`plugin/lake/dlmClient.ts:524`) — other
  loopback literals (`127.0.0.2`, used by some mock setups) fall into the broadcast branch.
- **Group mute state defaults to "unmuted" when unreadable** — `lakeBackend.getState` group branch:
  `mutes.every(m => m === true)` returns `false` when every read failed (`null`), so a fully
  unreachable module set renders as unmuted rather than unknown.

---

## Design / security suggestions

1. **Stop mirroring global discovery settings (including `laAuthPass`) into every action's
   settings.** `ui/key.html`/`dial.html` `saveSettings()` merges all discovery fields — HTTP
   password included — into per-action settings, which are persisted per key in Stream Deck
   profiles (and travel with exported profiles). It also makes every `willAppear` look like a
   discovery-settings change (root cause of H5). Keep secrets in global settings only, and have
   actions store just their own fields (`targetId`, `levelMode`, …).

2. **Verify `"Controllers": ["Knob"]` in `manifest.json`.** The official Elgato SDK expects
   `"Encoder"`; `"Knob"` appears to target Mirabox/Soomfon "Stream Dock" software (consistent with
   the `STREAMDOCK_HOTKEY_PAYLOAD` env var and the Soomfon doc in `docs/`). If the plugin is ever
   meant to load in genuine Stream Deck software, the dial actions won't be listed for encoders.
   Worth a comment in the manifest or docs stating which host software is targeted.

3. **Poll cadence.** 300 ms polling of every bound target (multiplied by per-channel Lake reads)
   is aggressive for show networks. Consider per-backend cadences (Lake UDP is cheap-ish; LA HTTP
   full-snapshot reads every 300 ms per device are not) and pausing polling when no action for the
   target is visible.

4. **`nextMsgId` collision window** (`plugin/lake/dlmClient.ts:467-474`): responses are matched by
   `msgId` alone, not `(msgId, unit)`. With multiple frames in flight this is fine at current
   volumes, but worth noting if request rates rise.

5. **Tests are good where they exist** (packet codec, discovery filtering, LA payload parsing).
   The biggest untested seams are exactly where the high-severity bugs live: `SmaartClient`
   queueing, `DeviceManager` refresh/poll lifecycle. Both are dependency-injectable and cheap to
   cover with the existing `node --test` setup.
