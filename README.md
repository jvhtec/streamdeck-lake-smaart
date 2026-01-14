# Lake + Smaart Stream Deck Plugin

A Stream Deck plugin that connects to Lake LM modules and the Smaart API to provide fast control of gain, mute, presets, and generator/capture actions from Stream Deck keys and dials.

![Lake + Smaart plugin icon](com.yourcompany.lake-smaart.sdPlugin/images/pluginIcon.png)

## Screenshots

The plugin ships with a set of action icons that appear on Stream Deck keys and dials:

| Action | Icon |
| --- | --- |
| Lake Module Control (Dial) | ![Dial icon](com.yourcompany.lake-smaart.sdPlugin/images/icon_dial.png) |
| Lake Preset | ![Preset icon](com.yourcompany.lake-smaart.sdPlugin/images/icon_preset.png) |
| Group Mute | ![Group mute icon](com.yourcompany.lake-smaart.sdPlugin/images/icon_mute.png) |
| Smaart Generator | ![Smaart generator icon](com.yourcompany.lake-smaart.sdPlugin/images/icon_smaart_gen.png) |
| Smaart Capture | ![Smaart capture icon](com.yourcompany.lake-smaart.sdPlugin/images/icon_smaart_capture.png) |

## Features

- Control Lake module gain via Stream Deck dials.
- Toggle mutes or reset gain to 0 dB by pressing a dial.
- Trigger Lake preset recalls and group mute actions from keys.
- Start/stop Smaart generator and trigger Smaart capture actions.

## Configuration

Default connection targets (overridable in Stream Deck global settings):

- Lake Controller host: `192.168.0.10` on port `1024`
- Smaart API host: `127.0.0.1` on port `8000`

## Repository layout

```
.
├── com.yourcompany.lake-smaart.sdPlugin
│   ├── images            # Stream Deck icons and indicators
│   ├── layouts           # Dial layouts
│   ├── plugin            # TypeScript runtime
│   └── ui                # Property inspector HTML/JS
├── docs                  # Documentation and external references
└── package.json          # Build scripts
```

## Documentation

- [User manual](docs/USER_MANUAL.md)
- [Stream Deck SDK reference](docs/streamdeck-api.md)
- [Lake Controller reference](docs/lake-controller-api.md)
- [Smaart suite reference](docs/smaart-suite-api.md)

## Build & install

1. Install dependencies: `npm install`
2. Build the plugin: `npm run build`
3. Copy `com.yourcompany.lake-smaart.sdPlugin` into your Stream Deck plugins folder.

