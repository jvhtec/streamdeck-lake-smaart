# Lake + L-Acoustics + Smaart Stream Deck Plugin — User Manual

## Overview

This Stream Deck+ plugin provides control of Lake LM modules, Lake input router priorities, L-Acoustics P1 input controls, L-Acoustics LC16D configuration recall, and Smaart utility actions directly from Stream Deck keys and dials. It supports mute toggles, level control with encoder press-to-mute, input router priority forcing, preset/configuration recall, and Smaart workflow shortcuts.

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
- **Lake Adapter IP**: Pick the local adapter IP on the Lake network. On multi-NIC systems, use this to force Lake traffic onto the same NIC as Lake Controller or the dedicated Lake control network. Changing it refreshes the action target lists to the devices discovered on that NIC.
- **Lake Debug Log**: Enables verbose DLM logging in the Stream Deck log output while testing.
- **Same-PC Testing**: If Lake Controller is running on the same computer, keep the plugin on dynamic mode (`6016`) so it does not occupy local UDP port `6004`.
- **LA Adapter IP**: Local adapter IP for L-Acoustics HTTP traffic. On multi-NIC systems, pick the NIC connected to the L-Acoustics control network so discovery and commands use the correct route. Changing it refreshes the action target lists to the devices discovered on that NIC.
- **L-Acoustics Subnet**: Optional subnet override. Leave it blank to auto-derive a practical discovery subnet from the selected LA adapter.
- **L-Acoustics Hosts**: Optional comma-separated list of device IPs to probe directly.
- **HTTP User / Pass**: Credentials for Digest auth (defaults are `admin/admin` when enabled).
- **LA Debug Log**: Enables request/status logging for L-Acoustics discovery, polling, and writes during troubleshooting or hardware test sessions.
- **Smaart Host / Port**: API endpoint for Smaart (default `127.0.0.1:26000`).

Use the **Refresh Devices** button after changing discovery settings.
The inspector also auto-refreshes after adapter and other global discovery changes, but the manual refresh button remains useful during active troubleshooting.

## Actions

### Lake Level + Press-to-Mute (Encoder)

- **Rotate**: Adjusts the selected target’s level.
- **Press**: Toggles mute on the same target.
- **Touch strip**: Shows target name, level value, and mute status.

**Property inspector settings**

- Device: Auto-detected Lake device with at least one valid level target on the selected NIC.
- Target: Lake module/group target, including `All Modules`.
- Mode: Gain (dB) or Volume (only when the selected target supports it).
- Step Size: Increment per tick.
- Min/Max: Clamp values for safety.

### L-Acoustics Level + Press-to-Mute (Encoder)

- **Rotate**: Adjusts the selected target’s level.
- **Press**: Toggles mute on the same target.
- **Touch strip**: Shows target name, level value, and mute status.

**Property inspector settings**

- Device: Auto-detected L-Acoustics device with at least one valid level target on the selected NIC.
- Target: P1 input target, grouped P1 input bank such as `Analog Inputs 1-4`, `AES Inputs 1-4`, `AVB Inputs 1-4`, or `AVB Inputs 5-8`, or an amplified-controller output target.
- Mode: Gain (dB) or Volume (only when the selected target supports it).
- Step Size: Increment per tick. Fast continuous turns accumulate correctly even while the device state poll is catching up.
- Min/Max: Clamp values for safety.

### Lake Mute (Button)

- **Press**: Toggles mute on the selected target.
- **Momentary**: Optional press-and-hold mute behavior.

**Property inspector settings**

- Device: Auto-detected Lake device with at least one valid mute target on the selected NIC.
- Target: Lake module/group target, including `All Modules`.
- Momentary: Enable to mute while the key is held.

### L-Acoustics Mute (Button)

- **Press**: Toggles mute on the selected target.
- **Momentary**: Optional press-and-hold mute behavior.

**Property inspector settings**

- Device: Auto-detected L-Acoustics device with at least one valid mute target on the selected NIC.
- Target: P1 input target, grouped P1 input bank such as `Analog Inputs 1-4`, `AES Inputs 1-4`, `AVB Inputs 1-4`, or `AVB Inputs 5-8`, or an amplified-controller output target that exposes mute.
- Momentary: Enable to mute while the key is held.

### Lake Preset Recall (Button)

- **Press**: Recalls a preset/configuration.
- **Double Press**: Optional safety confirmation.

**Property inspector settings**

- Device: Auto-detected Lake device with at least one valid preset target on the selected NIC.
- Target: Lake preset slot.
- Double Press: Require a second press within ~1.2s.

### L-Acoustics Preset Recall (Button)

- **Press**: Recalls a preset/configuration.
- **Double Press**: Optional safety confirmation.

**Property inspector settings**

- Device: Auto-detected L-Acoustics device with at least one valid preset/configuration target on the selected NIC.
- Target: Used configuration slot on the selected P1 or LC16D device.
- Double Press: Require a second press within ~1.2s.

### Lake Input Priority (Button)

- **Press**: Forces the selected Lake input router, or `All Routers`, to the configured priority mode.
- **State**: The key lights its active state when the selected router target is already using that forced priority mode. For `All Routers`, the key lights only when every discovered router on that frame matches.

**Property inspector settings**

- Device: Auto-detected Lake device with at least one reachable input router on the selected NIC.
- Target: Lake input router target discovered on that frame, including `All Routers` when the frame exposes more than one router.
- Trigger: `Fixed Priority` or `Push Count`.
- Priority: Used in `Fixed Priority` mode for `Auto Select`, `Force Priority 1`, `Force Priority 2`, `Force Priority 3`, or `Force Priority 4`.
- Push Count mode: One quick press selects `Priority 1`, two quick presses selects `Priority 2`, three selects `Priority 3`, and four selects `Priority 4`.

### Smaart Generator (Button)

- **Press**: Toggles the Smaart generator state.

### Smaart Generator Gain (Dial)

- **Rotate**: Adjusts the Smaart signal generator gain in dB.
- **Press**: Toggles the Smaart signal generator on or off.

### Smaart File Transport (Dial)

- **Rotate clockwise**: Sends the configured `Next Macro`.
- **Rotate counterclockwise**: Sends the configured `Previous Macro`.
- **Press**: Sends the configured `Press Macro`, typically play/pause.
- Window Title: Visible Smaart window title text to focus before sending keys. Defaults to `Smaart`.
- Focus Window: When enabled, the plugin activates the matching Smaart window before sending the macro.
- Focus Delay: Wait time after focusing the Smaart window before the macro starts.
- Step Delay: Delay between macro steps.
- Macros: Each field accepts a hotkey like `Ctrl+Alt+P` or a short sequence like `Ctrl+1, Delay 100, Space`.
- This action is Windows-only because it uses Windows hotkey injection instead of the Smaart API.

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
