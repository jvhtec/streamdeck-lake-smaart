# Lake + Smaart Stream Deck Plugin — User Manual

## Overview

This Stream Deck plugin provides control of Lake LM modules and Smaart functions directly from Stream Deck keys and dials. It supports module gain adjustments, mutes, preset recalls, group mutes, and Smaart generator/capture actions.

## Requirements

- Stream Deck software 6.0 or newer.
- A Lake Controller network path to the target Lake device(s).
- Smaart installed with its API service enabled (default port 26000).

## Installation

1. Build the plugin (`npm run build`) or obtain the built plugin bundle.
2. Copy the folder `com.yourcompany.lake-smaart.sdPlugin` into your Stream Deck plugins directory.
3. Restart Stream Deck so the plugin loads.

## Global settings

Open the property inspector for any action and set:

- **Lake IP**: IP address of the Lake Controller host (default in code: `192.168.0.10`).
- **Lake Port**: Currently fixed to `1024` in the plugin runtime; if you need a different port, update the source and rebuild.

Smaart defaults to `127.0.0.1:26000` in the runtime. If Smaart is running on another machine or port, update the plugin runtime and rebuild.

## Actions

### Lake Module Control (Dial)

- **Rotate**: Adjusts the selected module’s gain in 0.5 dB steps.
- **Press**: Performs the configured press action.
  - **Toggle Mute** (default)
  - **Reset Gain** (sets gain to 0 dB)
- **Press + Rotate**: Applies gain adjustments to a group (LR or ALL) if configured in the property inspector.

**Property inspector settings**
- Module: A/B/C/D
- Press Action: Toggle Mute or Reset Gain
- Modifier (Press + Rotate): None / LR / ALL

### Lake Preset

- **Press**: Recalls a preset number on the Lake device.
- **Note**: Recalls stop the Smaart generator (if running) for safety.

**Property inspector settings**
- Type: Recall Preset
- Preset #: Numeric preset index

### Group Mute

- **Press**: Applies a mute action to a predefined group.
- **Note**: Mute actions stop the Smaart generator (if running) for safety.

**Property inspector settings**
- Type: Group Mute
- Group: LR or ALL
- Mode: Toggle, Mute (Panic), or Unmute (Recover)

### Smaart Generator

- **Press**: Toggles Smaart generator state.

### Smaart Capture

- **Press**: Triggers a Smaart capture action.

## Troubleshooting

- **No Lake response**: Verify the Lake Controller IP address and confirm the device is reachable on port 1024.
- **No Smaart response**: Confirm Smaart’s API is enabled and listening on port 26000.
- **Dial feedback shows Offline**: The plugin has not yet received module state; check network connectivity and ensure the scheduler polling is running.

## Support references

See the external documentation summaries in `docs/` for Stream Deck SDK, Lake Controller manuals, and Smaart API links.
