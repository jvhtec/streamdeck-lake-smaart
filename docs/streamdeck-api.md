# Stream Deck SDK / API References

## Official documentation

- **Stream Deck SDK (Elgato docs)**: https://docs.elgato.com/sdk
  - Getting started guide, Stream Deck plugin structure, and SDK tools.
- **Stream Deck SDK article (Elgato help center)**: https://help.elgato.com/hc/en-us/articles/360028243711-Elgato-Stream-Deck-SDK-Software-Version-6-4-and-newer
  - High-level SDK overview, plugin packaging, and version compatibility.

## WebSocket API Architecture

The Stream Deck plugin system uses a WebSocket-based communication protocol. The plugin connects to the Stream Deck application via WebSocket for bidirectional communication.

### Connection Setup

The plugin must define a globally accessible `connectElgatoStreamDeckSocket` function that Stream Deck will invoke once the DOM has loaded. This function receives:
- **port**: The WebSocket port to connect to
- **pluginUUID**: Unique identifier for the plugin
- **registerEvent**: The event name to use for registration
- **info**: JSON string containing device and application information

### Registration

After establishing the WebSocket connection, the plugin must register itself by sending:

```json
{
  "event": "registerPlugin",
  "uuid": "<pluginUUID>"
}
```

## Events Received (From Stream Deck)

### Action Events

#### keyDown
Triggered when a user presses a key/button down.

**Event Structure:**
```json
{
  "action": "com.example.plugin.action",
  "event": "keyDown",
  "context": "unique-context-id",
  "device": "device-id",
  "payload": {
    "settings": {},
    "coordinates": {
      "column": 0,
      "row": 0
    },
    "state": 0,
    "userDesiredState": 0,
    "isInMultiAction": false
  }
}
```

#### keyUp
Triggered when a user releases a pressed key/button.

**Event Structure:** Same as keyDown

#### dialRotate
Triggered when a user rotates a dial/encoder.

**Event Structure:**
```json
{
  "event": "dialRotate",
  "action": "com.example.plugin.action",
  "context": "context-id",
  "device": "device-id",
  "payload": {
    "settings": {},
    "coordinates": {
      "column": 0,
      "row": 0
    },
    "ticks": 1,
    "pressed": false
  }
}
```

#### dialDown / dialUp
Triggered when a user presses or releases an encoder.

**Event Structure:**
```json
{
  "event": "dialDown",
  "action": "com.example.plugin.action",
  "context": "context-id",
  "device": "device-id",
  "payload": {
    "settings": {},
    "coordinates": {
      "column": 0,
      "row": 0
    },
    "controller": "Encoder"
  }
}
```

### Lifecycle Events

#### willAppear
Sent when an action instance becomes visible on Stream Deck (device plugged in, folder entered, etc.).

**Event Structure:**
```json
{
  "event": "willAppear",
  "action": "com.example.plugin.action",
  "context": "context-id",
  "device": "device-id",
  "payload": {
    "settings": {},
    "coordinates": {
      "column": 0,
      "row": 0
    },
    "state": 0,
    "isInMultiAction": false,
    "controller": "Keypad"
  }
}
```

#### willDisappear
Sent when an action instance is no longer visible.

**Event Structure:** Same as willAppear

### Settings Events

#### didReceiveSettings
Received after calling `getSettings` API or when settings are updated.

**Event Structure:**
```json
{
  "event": "didReceiveSettings",
  "action": "com.example.plugin.action",
  "context": "context-id",
  "device": "device-id",
  "payload": {
    "settings": {},
    "coordinates": {
      "column": 0,
      "row": 0
    },
    "isInMultiAction": false
  }
}
```

#### didReceiveGlobalSettings
Received when global plugin settings are updated.

**Event Structure:**
```json
{
  "event": "didReceiveGlobalSettings",
  "payload": {
    "settings": {}
  }
}
```

### System Events

#### applicationDidLaunch
Triggered when a monitored application is launched (configured in manifest).

#### applicationDidTerminate
Triggered when a monitored application terminates.

#### systemDidWakeUp
Triggered when the computer wakes from sleep.

#### deviceDidConnect / deviceDidDisconnect
Triggered when a Stream Deck device is connected or disconnected.

## Events Sent (To Stream Deck)

### setTitle
Updates the title displayed on a key.

```json
{
  "event": "setTitle",
  "context": "context-id",
  "payload": {
    "title": "New Title",
    "target": 0
  }
}
```

### setImage
Updates the image displayed on a key.

```json
{
  "event": "setImage",
  "context": "context-id",
  "payload": {
    "image": "data:image/png;base64,...",
    "target": 0
  }
}
```

### setState
Updates the state of a multi-state action.

```json
{
  "event": "setState",
  "context": "context-id",
  "payload": {
    "state": 1
  }
}
```

### setSettings
Saves persistent settings for an action instance.

```json
{
  "event": "setSettings",
  "context": "context-id",
  "payload": {
    "key": "value"
  }
}
```

### getSettings
Requests the current settings for an action instance.

```json
{
  "event": "getSettings",
  "context": "context-id"
}
```

### showAlert / showOk
Displays a temporary alert or success indicator on a key.

```json
{
  "event": "showAlert",
  "context": "context-id"
}
```

### logMessage
Sends a log message to the Stream Deck log file.

```json
{
  "event": "logMessage",
  "payload": {
    "message": "Debug information"
  }
}
```

## Manifest Structure

The `manifest.json` file defines plugin metadata and actions.

### Required Fields

```json
{
  "Name": "Plugin Name",
  "Version": "1.0.0",
  "Author": "Your Name",
  "Icon": "images/plugin-icon",
  "CodePath": "plugin/index.js",
  "UUID": "com.example.plugin",
  "Actions": [
    {
      "Name": "Action Name",
      "UUID": "com.example.plugin.action",
      "Icon": "images/action-icon",
      "States": [
        {
          "Image": "images/state-icon"
        }
      ]
    }
  ]
}
```

### Optional Properties

- **ApplicationsToMonitor**: Array of applications to monitor for launch/terminate events
- **SupportedInKeyLogicActions**: Whether action can be used in Key Logic (default: true)
- **PropertyInspectorPath**: Path to custom property inspector HTML
- **Software**: Minimum/maximum Stream Deck software version
- **OS**: Operating system requirements

## Recent Updates (2026)

- Added support for Node.js 24
- Added `SupportedInKeyLogicActions` property to actions
- Enhanced dial/encoder support with `dialRotate`, `dialDown`, `dialUp` events
- Improved application monitoring capabilities

## Source notes

- Retrieved via web search on 2025-01-14.
- These references are the primary sources for Stream Deck plugin APIs, manifest configuration, and Stream Deck WebSocket event handling.
- Implementation details verified from codebase in `plugin/sd/events.ts`
