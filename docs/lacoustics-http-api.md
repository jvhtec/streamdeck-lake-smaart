# L-Acoustics Drive System HTTP API (v1.7)

Relevant specification for Stream Deck control.

Source: L-Acoustics Drive System HTTP API Guide – Technical Bulletin v1.7.
Source URL: Provided offline by the client (no public URL). Retrieved 2025-09-27.

## Supported devices (scope)

The HTTP API is exposed by the following L-Acoustics devices (firmware ≥ 2.13.0):

- P1
- LC16D
- LA7.16 / LA7.16i
- LA12X
- LA4X
- LA2Xi
- LA4 / LA8
- LS10

This plugin explicitly supports P1 and LC16D, but the API model is consistent across the family.

## Connectivity

- Protocol: HTTP (no HTTPS)
- Transport: TCP
- Port: 80
- Base URL: `http://<device-ip-address>/api/<endpoint>`
- In redundancy mode, API is available on both NICs, but only the primary interface is reachable via routing.

## Performance constraints (do not ignore)

- Maximum concurrent HTTP requests: 10
- Requests beyond this limit fail
- Recommended minimum polling interval: 50 ms

The plugin must throttle requests and batch updates where possible.

## Authentication

- Method: HTTP Digest Authentication
- Can be enabled or disabled per device
- Defaults:

| Device | Auth default | Username | Password |
| --- | --- | --- | --- |
| P1 | Disabled | admin | admin |
| LC16D | Disabled | admin | admin |

If auth is enabled and Digest is not implemented, requests receive HTTP 403.

## Data model rules (critical for auto-detection)

- The entire API is a hierarchical JSON model
- GET on an object or array returns all children
- GET on a property returns its value
- POST updates writable properties
- Invalid or read-only fields in POST bodies are silently ignored

This enables auto-target discovery.

## Device identification (discovery)

**Get device info**

`GET /api/info`

Returns:

- `name`
- `firmware_version`
- `serial`
- `mac`
- `avdecc_entity_id`

Used for:

- device discovery
- labeling in inspector
- capability gating

## Output control (mute + level)

**Output index**

`GET /api/control/dsp/output`

Returns an array of output objects. The number of items determines available outputs:

- P1: typically 1–4
- LC16D: typically 1–16

**Output mute**

- `GET  /api/control/dsp/output/<i>/mute`
- `POST /api/control/dsp/output/<i>/mute`
- Body: `true` | `false`

Type: boolean. Read/write.

**Output gain (recommended)**

- `GET  /api/control/dsp/output/<i>/gain`
- `POST /api/control/dsp/output/<i>/gain`
- Body: `<dB>`

Range: -60.0 … +15.0 dB. Type: dB (float). Read/write.

**Output volume (optional mode)**

- `GET  /api/control/dsp/output/<i>/volume`
- `POST /api/control/dsp/output/<i>/volume`
- Body: `<integer>`

Range: 0 … 750. Type: uint. Read/write.

**Batch control (important for groups)**

`POST /api/control/dsp/gain`

Body:

```json
[
  { "mute": false, "gain": -6.0 },
  { "gain": -9.0 },
  {},
  ...
]
```

Applies per-index. Empty objects = no change. Strongly recommended for multi-output targets.

## Preset / configuration control

**List configuration library**

- `GET /api/configuration/library/<i>/name`
- `GET /api/configuration/library/<i>/used`

Index range: 1..10. Used to populate preset dropdowns.

**Recall configuration (preset)**

`POST /api/configuration/load`

Body: `{ "index": <1..10> }`

Action endpoint. Response: HTTP 204 (no content).

**Active configuration**

`GET /api/configuration/active/index`

Range: 0..10. Used for button state feedback.

## Level and health feedback (optional UI)

**Output peak level**

`GET /api/level/dsp/output/<i>/peak`

Returns peak level in dB. Read-only.

**Output health**

- `GET /api/monitor/output/<i>/state`
- `GET /api/monitor/output/<i>/clip`
- `GET /api/monitor/output/<i>/limit`

State values:

- `ok`
- `protected`
- `disabled`
- `retry`

## Critical behavioral rule (do not break this)

**Active enclosures propagation rule**

When multiple outputs drive a single active enclosure:

- Gain, delay, polarity must not diverge
- Device automatically propagates values across linked outputs
- Last received value wins

Implication for plugin:

- Do not set all linked outputs manually
- UI must tolerate multiple outputs changing from one command

## What the plugin intentionally ignores

Out of scope for Stream Deck control:

- VLAN / RSTP config
- AVB / AES67 stream routing
- GPIO programming
- EN54 monitoring
- Network/IP configuration

## Summary for implementation

Use these endpoints only:

- `/api/info`
- `/api/control/dsp/output/*`
- `/api/control/dsp/gain`
- `/api/configuration/*`
- `/api/level/dsp/output/*`
- `/api/monitor/output/*`
