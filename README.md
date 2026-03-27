# Lake + L-Acoustics + Smaart Stream Deck Plugin

A Stream Deck+ plugin that connects to Lake LM modules, L-Acoustics P1/LC16D devices, and the Smaart API to provide fast control of mute, level, preset recall, and measurement utilities from Stream Deck keys and dials.

![Lake + L-Acoustics plugin icon](com.jvhtec.lake-smaart.sdPlugin/images/pluginIcon.png)

## Screenshots

The plugin ships with a set of action icons that appear on Stream Deck keys and dials:

| Action | Icon |
| --- | --- |
| Level + Press-to-Mute (Dial) | ![Dial icon](com.jvhtec.lake-smaart.sdPlugin/images/icon_dial.png) |
| Preset Recall | ![Preset icon](com.jvhtec.lake-smaart.sdPlugin/images/icon_preset.png) |
| Mute | ![Mute icon](com.jvhtec.lake-smaart.sdPlugin/images/icon_mute.png) |
| Smaart Generator Gain (Dial) | ![Smaart generator icon](com.jvhtec.lake-smaart.sdPlugin/images/icon_smaart_gen.png) |
| Smaart Generator | ![Smaart generator icon](com.jvhtec.lake-smaart.sdPlugin/images/icon_smaart_gen.png) |
| Smaart Capture | ![Smaart capture icon](com.jvhtec.lake-smaart.sdPlugin/images/icon_smaart_capture.png) |
| Smaart Compute Delay | ![Smaart compute delay icon](com.jvhtec.lake-smaart.sdPlugin/images/icon_smaart_capture.png) |
| Smaart Toggle Trace | ![Smaart toggle trace icon](com.jvhtec.lake-smaart.sdPlugin/images/icon_smaart_capture.png) |

## Features

- Control Lake LM module/group gain and mute with Stream Deck+ encoders.
- Toggle mute on Lake LM modules/groups and L-Acoustics outputs.
- Recall Lake and L-Acoustics presets/configurations from keys.
- Adjust Smaart generator gain from a dial and press the dial to toggle the generator on or off.
- Trigger Smaart generator and measurement-focused actions for the currently active Smaart measurement.

## Configuration

Default discovery settings (overridable in Stream Deck global settings):

- Lake Controller host: *(must be configured; Lake uses APIPA addressing, e.g. `169.254.x.x`)* on port `1024`
- L-Acoustics discovery subnet: `192.168.0.0/24`
- Optional explicit L-Acoustics hosts: `192.168.0.20,192.168.0.21`
- Smaart host: `127.0.0.1` on port `26000`

## Repository layout

```
.
├── com.jvhtec.lake-smaart.sdPlugin
│   ├── images            # Stream Deck icons and indicators
│   ├── layouts           # Dial layouts
│   ├── plugin            # TypeScript runtime
│   └── ui                # Property inspector HTML/JS
├── docs                  # Documentation and external references
└── package.json          # Build scripts
```


## Property inspector compatibility

- Action inspector pages (`ui/key.html` and `ui/dial.html`) are intentionally self-contained (inline script and styles) to avoid load failures on systems where the Stream Deck plugin install path includes special characters such as `#` (for example, user profiles like `FoH #1`).
- **Fallback web inspector**: When the plugin detects `#` or `?` in its installation path (which breaks `file://` URL loading in Stream Deck's embedded browser), it automatically starts a local HTTP server and opens a web-based Property Inspector in the user's default browser. This fallback provides the same configuration UI and communicates with Stream Deck through the plugin backend's WebSocket relay.

## Documentation

- [User manual](docs/USER_MANUAL.md)
- [L-Acoustics HTTP API notes](docs/lacoustics-http-api.md)
- [Multi-device Stream Deck+ specification](docs/streamdeck-multi-device-spec.md)
- [Stream Deck SDK reference](docs/streamdeck-api.md)
- [Lake Controller reference](docs/lake-controller-api.md)
- [Smaart suite reference](docs/smaart-suite-api.md)

## Build & install

1. Install dependencies: `npm install`
2. Build the plugin: `npm run build`
3. Copy `com.jvhtec.lake-smaart.sdPlugin` into your Stream Deck plugins folder.

`npm run build` also stages the runtime `ws` dependency inside `com.jvhtec.lake-smaart.sdPlugin/node_modules` so the copied plugin bundle can start outside the repo.
