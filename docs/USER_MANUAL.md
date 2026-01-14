# Lake + L-Acoustics + Smaart Stream Deck Plugin — User Manual

## Overview

This Stream Deck+ plugin provides control of Lake LM modules, L-Acoustics P1/LC16D outputs, and Smaart utility actions directly from Stream Deck keys and dials. It supports mute toggles, level control with encoder press-to-mute, preset/configuration recall, and Smaart workflow shortcuts.

## Requirements

- Stream Deck software 6.0 or newer.
- Network access to Lake LM hardware over UDP (default port 1024).
- Network access to L-Acoustics devices over HTTP (port 80).
- Smaart installed with its API service enabled (default port 26000).

## Installation

1. Build the plugin (`npm run build`) or obtain the built plugin bundle.
2. Copy the folder `com.jvhtec.lake-smaart.sdPlugin` into your Stream Deck plugins directory.
3. Restart Stream Deck so the plugin loads.

## Global settings

Open the property inspector for any action and set:

- **Lake Host**: IP address of the Lake Controller host (default `192.168.0.10`).
- **Lake Port**: UDP port for Lake Control (default `1024`).
- **L-Acoustics Subnet**: Subnet to scan for devices (default `192.168.0.0/24`).
- **L-Acoustics Hosts**: Optional comma-separated list of device IPs to probe directly.
- **HTTP User / Pass**: Credentials for Digest auth (defaults are `admin/admin` when enabled).
- **Smaart Host / Port**: API endpoint for Smaart (default `127.0.0.1:26000`).

Use the **Refresh Devices** button after changing discovery settings.

## Actions

### Level + Press-to-Mute (Encoder)

- **Rotate**: Adjusts the selected target’s level.
- **Press**: Toggles mute on the same target.
- **Touch strip**: Shows target name, level value, and mute status.

**Property inspector settings**

- Device: Auto-detected Lake or L-Acoustics device.
- Target: Module/group (Lake) or output (L-Acoustics).
- Mode: Gain (dB) or Volume (when supported).
- Step Size: Increment per tick.
- Min/Max: Clamp values for safety.

### Mute (Button)

- **Press**: Toggles mute on the selected target.
- **Momentary**: Optional press-and-hold mute behavior.

**Property inspector settings**

- Device: Auto-detected Lake or L-Acoustics device.
- Target: Module/group (Lake) or output (L-Acoustics).
- Momentary: Enable to mute while the key is held.

### Preset Recall (Button)

- **Press**: Recalls a preset/configuration.
- **Double Press**: Optional safety confirmation.

**Property inspector settings**

- Device: Auto-detected Lake or L-Acoustics device.
- Target: Preset slot (used slots are listed for L-Acoustics).
- Double Press: Require a second press within ~1.2s.

### Smaart Generator (Button)

- **Press**: Toggles the Smaart generator state.

### Smaart Capture (Button)

- **Press**: Triggers a Smaart capture action.

### Smaart Compute Delay (Button)

- **Press**: Requests delay computation in Smaart for the active measurement.

### Smaart Toggle Trace (Button)

- **Press**: Toggles visibility for the active trace in Smaart.

## Troubleshooting

- **No devices found**: Verify network connectivity and check discovery subnet/hosts.
- **HTTP 403 errors**: L-Acoustics Digest authentication may be enabled. Enter credentials in global settings.
- **No Lake response**: Confirm the Lake Controller host/port and network path to the device.
- **No Smaart response**: Confirm Smaart is running and the API host/port are correct.

## Support references

See the external documentation summaries in `docs/` for Stream Deck SDK, Lake Controller manuals, L-Acoustics HTTP API notes, and Smaart API notes.
