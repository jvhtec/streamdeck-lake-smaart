# L-Acoustics Testing Guide

Repeatable local and hardware validation steps for the L-Acoustics transport, backend, and operator workflow.

## Local tooling

- Start the mock server:

```powershell
npm run la:mock -- --port 18080
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

If you want only the smoke runner's verbose output without npm's own verbose logging, run `node scripts/la-smoke.js --host <host> --verbose` after `npm run build`.

## What the mock covers

- `GET /api/info`
- `GET /api/control/dsp/output`
- `GET /api/control/dsp/output/<i>`
- `GET` / `POST` for output `mute`, `gain`, and `volume`
- Configuration library `used` and `name`
- Active preset index
- Configuration recall with HTTP `204`
- Optional Digest auth challenge mode via `--auth`

## Monday hardware workflow

1. Build the plugin with `npm run build`.
2. In the property inspector, enable **LA Debug Log**.
3. Point the plugin to the target device using the normal subnet/host settings.
4. Run the read-only smoke pass first:

```powershell
npm run la:smoke -- --host <device-ip> --user <user> --pass <pass> --verbose
```

5. Confirm:
   - device discovery succeeds
   - output enumeration count is correct
   - preset library entries are listed correctly
   - active preset index reads correctly
   - Stream Deck logs show request path, HTTP status, and timing
6. If read-only checks pass, run the explicit write pass:

```powershell
npm run la:smoke -- --host <device-ip> --user <user> --pass <pass> --verbose --write-checks
```

7. Confirm:
   - one mute toggle succeeds and restores
   - one gain change succeeds and restores
   - one preset recall succeeds and restores when possible
   - failed commands trigger Stream Deck alerts instead of silent success

## Failure interpretation

- Discovery fails: verify routing, port `80`, credentials, and whether Digest auth is enabled.
- Read-only smoke fails on `/api/info`: treat this as a basic connectivity or auth problem before checking deeper endpoints.
- Output snapshot or preset reads fail: compare the failing path in the smoke output with Stream Deck logs from **LA Debug Log**.
- Write checks fail but reads succeed: capture the exact path/status pair from the logs; the plugin now treats those as hard failures instead of optimistic success.
- Auth loops with `401` or `403`: confirm username/password and whether the device is sending a Digest challenge header.
