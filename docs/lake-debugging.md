# Lake Debugging

Use the local mock server when you want to debug the plugin's Lake traffic without real hardware.

## Start the mock endpoint

```powershell
npm run build
npm run lake:mock
```

By default it listens on `127.0.0.1:6016`, which matches the plugin's dynamic DLM default.

## Configure the plugin

Set these global settings in the property inspector:

- **Lake Device Filter**: `127.0.0.1`
- **Lake Port**: `6016`
- **Lake Adapter IP**: `127.0.0.1`
- **Lake Debug Log**: optional, recommended while validating packet flow

## Run the automated self-test

```powershell
npm run build
npm run lake:selftest
```

The self-test verifies the Appendix D broadcast packet example plus end-to-end discovery, mute, gain, preset recall, and frame-label queries against the mock responder.

## What the mock supports

- Host heartbeat discovery and frame announcement
- `Mod.In.Mute?A` / `Mod.In.Mute=A 1`
- `Mod.In.Gain?A` / `Mod.In.Gain=A -3.00`
- `Dev.Preset.Recall!1`
- `Dev.FrameLabel?`
- `Dev.Power?` / `Dev.Power=0`

The mock keeps simple in-memory state for modules `A`-`D` and logs every UDP packet it receives.

## What it is for

- Verify that the plugin is sending protocol-correct DLM packets
- Inspect discovery, command strings, message IDs, and ACK behavior
- Exercise mute, level, and preset actions end-to-end before moving to hardware

## What it does not replace

- Real Lake hardware
- Lake Controller network emulation
