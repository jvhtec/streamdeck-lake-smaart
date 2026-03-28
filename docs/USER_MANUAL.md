# Lake + L-Acoustics + Smaart Stream Deck Plugin — User Manual

## Overview

This Stream Deck+ plugin provides control of Lake LM modules, L-Acoustics P1 output controls, L-Acoustics LC16D configuration recall, and Smaart utility actions directly from Stream Deck keys and dials. It supports mute toggles, level control with encoder press-to-mute, preset/configuration recall, and Smaart workflow shortcuts.

## Requirements

- Stream Deck software 6.0 or newer.
- Network access to Lake LM hardware over UDP (default DLM port 6016).
- Network access to L-Acoustics devices over HTTP (port 80).
- Smaart installed with its API service enabled (default port 26000).

## Installation

1. Build the plugin (`npm run build`) or obtain the built plugin bundle.
2. Copy the folder `com.jvhtec.lake-smaart.sdPlugin` into your Stream Deck plugins directory.
3. Restart Stream Deck so the plugin loads.

## Global settings

Open the property inspector for any action and set:

- **Lake Device Filter**: Optional device IP or frame ID. Leave it blank to discover all visible Lake frames, or set it to something like `169.254.x.x` or `3d000011:d6ed9201` to focus on one frame.
- **Lake Port**: UDP port for Lake DLM control (default `6016`). Setting it to `6015` switches to fixed response mode and reserves local UDP port `6004`.
- **Lake Adapter IP**: Pick the local adapter IP on the Lake network. On multi-NIC systems, use this to force Lake traffic onto the same NIC as Lake Controller or the dedicated Lake control network.
- **Lake Debug Log**: Enables verbose DLM logging in the Stream Deck log output while testing.
- **Same-PC Testing**: If Lake Controller is running on the same computer, keep the plugin on dynamic mode (`6016`) so it does not occupy local UDP port `6004`.
- **LA Adapter IP**: Local adapter IP for L-Acoustics HTTP traffic. On multi-NIC systems, pick the NIC connected to the L-Acoustics control network so discovery and commands use the correct route.
- **L-Acoustics Subnet**: Optional subnet override. Leave it blank to auto-derive a practical discovery subnet from the selected LA adapter.
- **L-Acoustics Hosts**: Optional comma-separated list of device IPs to probe directly.
- **HTTP User / Pass**: Credentials for Digest auth (defaults are `admin/admin` when enabled).
- **LA Debug Log**: Enables request/status logging for L-Acoustics discovery, polling, and writes during troubleshooting or hardware test sessions.
- **Smaart Host / Port**: API endpoint for Smaart (default `127.0.0.1:26000`).

Use the **Refresh Devices** button after changing discovery settings.

## Actions

### Level + Press-to-Mute (Encoder)

- **Rotate**: Adjusts the selected target’s level.
- **Press**: Toggles mute on the same target.
- **Touch strip**: Shows target name, level value, and mute status.

**Property inspector settings**

- Device: Auto-detected Lake or L-Acoustics device.
- Target: Module/group (Lake) or output (L-Acoustics P1 / amplified controllers with documented output control).
- Mode: Gain (dB) or Volume (only when the selected target supports it).
- Step Size: Increment per tick.
- Min/Max: Clamp values for safety.

### Mute (Button)

- **Press**: Toggles mute on the selected target.
- **Momentary**: Optional press-and-hold mute behavior.

**Property inspector settings**

- Device: Auto-detected Lake or L-Acoustics device.
- Target: Module/group (Lake) or output (L-Acoustics targets that expose mute).
- Momentary: Enable to mute while the key is held.

### Preset Recall (Button)

- **Press**: Recalls a preset/configuration.
- **Double Press**: Optional safety confirmation.

**Property inspector settings**

- Device: Auto-detected Lake or L-Acoustics device.
- Target: Preset slot (used slots are listed for L-Acoustics; P1 and LC16D configuration ranges differ by device).
- Double Press: Require a second press within ~1.2s.

### Smaart Generator (Button)

- **Press**: Toggles the Smaart generator state.

### Smaart Generator Gain (Dial)

- **Rotate**: Adjusts the Smaart signal generator gain in dB.
- **Press**: Toggles the Smaart signal generator on or off.

### Smaart SPL Meter (Button)

- **Display**: Shows the selected live SPL metric directly on the key.
- **Press**: Forces the meter stream to reconnect if you want to refresh it manually.

**Property inspector settings**

- Input: Active calibrated Smaart input/channel stream.
- Metric: SPL metric to display on the key, such as `SPL Fast`, `SPL A Slow`, or `Leq 10`.

### Smaart Capture (Button)

- **Press**: Triggers capture for the currently active Smaart measurement.

### Smaart Compute Delay (Button)

- **Press**: Requests Auto Find Delay for the currently active transfer function measurement.

### Smaart Toggle Trace (Button)

- **Press**: Toggles visibility for the currently active Smaart trace.

## Troubleshooting

- **No devices found**: Verify network connectivity and check discovery subnet/hosts.
- **HTTP 403 errors**: L-Acoustics Digest authentication may be enabled. Enter credentials in global settings.
- **Need deeper L-Acoustics traces**: Enable **LA Debug Log** and review the Stream Deck plugin logs for request path, HTTP status, and timing details.
- **No Lake response**: Confirm the Lake device filter/port, set the correct Lake adapter IP for the active NIC, and verify that the frame is reachable on the network.
- **No Smaart response**: Confirm Smaart is running and the API host/port are correct.
- **SPL meter shows no selectable inputs**: Smaart must have at least one active calibrated input available in the SPL/Logging workflow before the plugin can subscribe to a live SPL stream.
- **Capture/Delay/Trace do nothing**: Make sure a live Smaart measurement is active or selected. Smaart only accepts capture, Auto Find Delay, and trace-visibility commands when it reports an active measurement context.

## Support references

See the external documentation summaries in `docs/` for Stream Deck SDK, Lake Controller manuals, L-Acoustics HTTP API notes, and Smaart API notes.
