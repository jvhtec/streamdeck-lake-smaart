# L-Acoustics Drive System HTTP API Notes

Reference summary for this plugin, based on the local vendor PDF:

- Source: `docs/L-Acoustics-HTTP-API-Guide-v1.7.pdf`
- Document header inside the PDF: `TECHNICAL BULLETIN V1.8`
- Source URL: offline client-provided PDF (no public URL in repo)
- Retrieved from repo on: 2026-03-28

## Common rules

- Transport: HTTP only
- Port: `80`
- Base URL: `http://<device-ip>/api/<endpoint>`
- Max concurrent requests per device: `10`
- Recommended minimum polling interval: `50 ms`
- Auth: HTTP Digest
- When auth is enabled, unauthenticated requests receive `403`

The API is hierarchical JSON:

- `GET` on an object or array returns all children
- `GET` on a property returns the property value
- `POST` updates writable properties
- Invalid or read-only fields in a `POST` body are ignored

That means object and array reads are valid optimization points for discovery and polling.

## Discovery

Use:

- `GET /api/info`

Important fields:

- `/info/name`
  - device model, for example `P1`, `LC16D`, `LA4X`
- `/info/unit_name`
  - operator-facing unit name
- `/info/firmware_version`
- `/info/serial`
- `/info/mac`

For this plugin:

- use `name` to classify the device family
- use `unit_name` as the preferred display label when present

## P1 endpoints relevant to this plugin

### Writable output control

P1 does **not** use `/api/control/dsp/output` for the main line outputs.

The writable output families are:

- `/api/output/settings/ana/<i>/mute`
- `/api/output/settings/ana/<i>/gain`
- `/api/output/settings/aes/<i>/mute`
- `/api/output/settings/aes/<i>/gain`
- `/api/output/settings/avb/<i>/mute`
- `/api/output/settings/avb/<i>/gain`
- `/api/output/settings/mon/<i>/mute`
- `/api/output/settings/mon/<i>/gain`

Because object reads are supported, these aggregate reads are also valid:

- `GET /api/output/settings`
- `GET /api/output/settings/ana`
- `GET /api/output/settings/aes`
- `GET /api/output/settings/avb`
- `GET /api/output/settings/mon`

Observed plugin assumptions now aligned to the PDF:

- P1 output control is `mute` + `gain`
- no P1 `volume` path is documented in the P1 section

### Presets / configurations

- `GET /api/configuration/library`
- `POST /api/configuration/load`
- `GET /api/configuration/active/index`

Ranges from the PDF:

- library slots: `1..30`
- active index: `0..30`

### Metering

Documented P1 level families include:

- `/api/level/dsp/output/<i>/peak`
- `/api/level/ana/output/<i>/peak`
- `/api/level/aes/output/<i>/peak`
- `/api/level/avb/output/<i>/peak`
- `/api/level/mon/output/<i>/peak`

The current plugin only needs mute/gain state for the Stream Deck actions, so metering stays optional.

## LC16D endpoints relevant to this plugin

### Configuration control

LC16D clearly documents configuration management:

- `GET /api/configuration/library`
- `POST /api/configuration/load`
- `GET /api/configuration/active/index`

Ranges from the PDF:

- library slots: `1..10`
- active index: `0..10`

### Levels and routing

LC16D documents level monitoring and routing/status families such as:

- `/api/level/aes/output/<i>/peak`
- `/api/level/madi/output/<i>/peak`
- AVB / AES67 / MADI stream mapping and status paths

### Important limitation

The LC16D section in the vendor PDF does **not** document the same writable output mute/gain family used by the old repo summary.

For this plugin, that means:

- LC16D is currently treated as configuration-recall capable
- LC16D mute/level action targets are not exposed until a real writable control path is confirmed

## Amplified controller note

The `/api/control/dsp/output` family is documented for amplified controllers, not for P1 main outputs.

Relevant paths include:

- `GET /api/control/dsp/output`
- `GET /api/control/dsp/output/<i>`
- `/api/control/dsp/output/<i>/mute`
- `/api/control/dsp/output/<i>/gain`
- `/api/control/dsp/output/<i>/volume`

The plugin still supports that family for amplified controllers, but it is no longer treated as the P1/LC16D baseline.

## Configuration recall behavior

- `POST /api/configuration/load`
- action endpoint
- expected response: HTTP `204`

The plugin treats any other status as a failure.

## Implementation summary

Current plugin behavior should be built around these assumptions:

- P1
  - discover with `/api/info`
  - enumerate line outputs from `/api/output/settings`
  - expose mute + gain targets across `ana`, `aes`, `avb`, and `mon`
  - enumerate presets from `/api/configuration/library`
- LC16D
  - discover with `/api/info`
  - enumerate presets from `/api/configuration/library`
  - do not invent mute/level targets without a documented writable path
- Amplified controllers
  - continue using `/api/control/dsp/output`
