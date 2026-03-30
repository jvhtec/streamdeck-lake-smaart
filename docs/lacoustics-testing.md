# L-Acoustics Testing Guide

Repeatable local and hardware validation steps for the L-Acoustics transport, backend, and operator workflow.

## Local tooling

- Start the mock server:

```powershell
npm run la:mock -- --port 18080 --profile p1
```

- Run the read-only smoke pass:

```powershell
npm run la:smoke -- --host 127.0.0.1:18080
```

- Run write checks against the mock:

```powershell
npm run la:smoke -- --host 127.0.0.1:18080 --write-checks --verbose
```

- Run the automated regression suite:

```powershell
npm run test:la
```

The smoke runner accepts `host:port`, optional `--user` / `--pass`, `--verbose`, and `--write-checks`. Read-only mode is the default so accidental audio changes are avoided unless you opt in.
Add `--bind <local-ip>` when you need to force a specific NIC during hardware tests on a multi-homed machine.
It also accepts `--subnet <cidr>` for hardware-first scans, plus `--scan-only` when you want to list reachable devices before choosing one for deeper checks.

If you want only the smoke runner's verbose output without npm's own verbose logging, run `node scripts/la-smoke.js --host <host> --verbose` after `npm run build`.

## What the mock covers

- `GET /api/info`
- P1 profile:
  - `GET /api/input/settings`
  - `GET /api/input/settings/<family>`
  - `GET` / `POST` for input `mute` and `gain`
  - `GET` / `POST` for `mpl` `mute` and `gain`
- Amplified profile:
  - `GET /api/control/dsp/output`
  - `GET /api/control/dsp/output/<i>`
  - `GET` / `POST` for output `mute`, `gain`, and `volume`
- Configuration library array reads plus `used` / `name` item reads
- Active preset index
- Configuration recall with HTTP `204`
- Optional Digest auth challenge mode via `--auth`

Use `--profile p1`, `--profile lc16d`, or `--profile amplified` when you want the mock to emulate a specific device family.

## Monday hardware workflow

1. Build the plugin with `npm run build`.
2. In the property inspector, enable **LA Debug Log**.
3. Select the correct **LA Adapter IP** for the target system NIC.
4. Point the plugin to the target device using manual hosts or the auto-derived subnet.
5. Run the read-only smoke pass first:

```powershell
npm run la:smoke -- --host <device-ip> --user <user> --pass <pass> --verbose
```

Or scan the entire NIC first and then re-run against the discovered device:

```powershell
node scripts/la-smoke.js --subnet 192.168.1.0/24 --bind 192.168.1.254 --scan-only --verbose
```

6. Confirm:
   - device discovery succeeds
   - P1 input-target enumeration is correct, or LC16D exposes only preset targets as expected
   - preset library entries are listed correctly
   - active preset index reads correctly
   - Stream Deck logs show request path, HTTP status, and timing
7. If read-only checks pass, run the explicit write pass:

```powershell
npm run la:smoke -- --host <device-ip> --user <user> --pass <pass> --verbose --write-checks
```

8. Confirm:
   - on P1, one mute toggle succeeds and restores
   - on P1, one gain change succeeds and restores
   - one preset recall succeeds and restores when possible
   - failed commands trigger Stream Deck alerts instead of silent success

## Failure interpretation

- Discovery fails: verify routing, port `80`, credentials, and whether Digest auth is enabled.
- Read-only smoke fails on `/api/info`: treat this as a basic connectivity or auth problem before checking deeper endpoints.
- Control-target snapshot or preset reads fail: compare the failing path in the smoke output with Stream Deck logs from **LA Debug Log**.
- Write checks fail but reads succeed: capture the exact path/status pair from the logs; the plugin now treats those as hard failures instead of optimistic success.
- Auth loops with `401` or `403`: confirm username/password and whether the device is sending a Digest challenge header.
