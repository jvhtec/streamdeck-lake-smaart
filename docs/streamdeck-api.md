# Stream Deck SDK / API References

## Official documentation

- **Stream Deck SDK (Elgato docs)**: https://docs.elgato.com/sdk
  - Getting started guide, Stream Deck plugin structure, and SDK tools.
- **Stream Deck SDK article (Elgato help center)**: https://help.elgato.com/hc/en-us/articles/360028243711-Elgato-Stream-Deck-SDK-Software-Version-6-4-and-newer
  - High-level SDK overview, plugin packaging, and version compatibility.

## Stream Deck Hardware Models and Layouts

### Elgato Stream Deck Models

#### Stream Deck Mini
- **Keys**: 6 LCD keys (2 columns × 3 rows)
- **Key Size**: 80×80 pixels per key
- **Controller Type**: Keypad only
- **Use Case**: Compact control surface for limited desk space

#### Stream Deck (Standard)
- **Keys**: 15 LCD keys (3 columns × 5 rows)
- **Key Size**: 72×72 pixels per key
- **Controller Type**: Keypad only
- **Use Case**: Standard control surface for most users

#### Stream Deck XL
- **Keys**: 32 LCD keys (8 columns × 4 rows)
- **Key Size**: 96×96 pixels per key
- **Controller Type**: Keypad only
- **Use Case**: Professional setups requiring extensive controls

#### Stream Deck +
- **Keys**: 8 LCD keys (4 columns × 2 rows)
- **Encoders**: 4 rotary encoders with LCD displays
- **Touch Strip**: Horizontal touch-sensitive strip
- **Controller Types**: Keypad + Encoder
- **Use Case**: Hybrid control with tactile feedback and rotation

#### Stream Deck Pedal
- **Pedals**: 3 foot pedals
- **Controller Type**: Pedal
- **Use Case**: Hands-free control for streamers and musicians

#### Stream Deck Mobile
- **Keys**: Variable (software-based layout on iOS/Android)
- **Controller Type**: Mobile
- **Use Case**: Mobile control via smartphone/tablet

### Third-Party Compatible Devices

#### Loupedeck Live / Live S
- **Keys**: 12 LCD keys + 8 touch buttons
- **Encoders**: 6 rotary encoders
- **Touch Strip**: Horizontal touch-sensitive area
- **Manufacturer**: Loupedeck (compatible via Stream Deck SDK)

#### Corsair Elgato Variants
- **Various Models**: Similar layouts to Elgato models
- **Manufacturer**: Corsair (parent company of Elgato)

### Device Detection and Layout Adaptation

Plugins receive device information in the `info` parameter during connection:

```json
{
  "devices": [
    {
      "id": "device-id",
      "name": "Stream Deck XL",
      "size": {
        "columns": 8,
        "rows": 4
      },
      "type": 0
    }
  ]
}
```

**Device Types:**
- `0`: Stream Deck (Standard)
- `1`: Stream Deck Mini
- `2`: Stream Deck XL
- `3`: Stream Deck Mobile
- `4`: Stream Deck Pedal
- `7`: Stream Deck +

### Layout Considerations for Multi-Device Support

When developing plugins that support multiple device types:

1. **Scalable Icons**: Provide icons at multiple resolutions (72×72, 80×80, 96×96, 144×144)
2. **Controller Type Detection**: Check the `controller` field in events ('Keypad', 'Encoder', 'Pedal')
3. **Responsive Text**: Adjust font sizes based on device type
4. **Feature Availability**: Check for encoder support before using dial events

```typescript
// Example: Detect device capabilities
if (event.payload.controller === 'Encoder') {
  // This action is on a dial/encoder
  // Enable rotation handling
} else if (event.payload.controller === 'Keypad') {
  // This action is on a standard key
  // Use keyDown/keyUp events
}
```

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

## Bidirectional Communication and State-Aware Keys

Stream Deck supports multi-state actions that maintain synchronized state between the plugin backend, the hardware display, and external systems. This is crucial for toggle buttons, status indicators, and controls that reflect external system states.

### State Management Architecture

```
External System (e.g., Lake/Smaart)
         ↕
   Plugin Backend
         ↕
  Stream Deck App
         ↕
  Hardware Display
```

### Multi-State Actions

Actions can have multiple states (e.g., ON/OFF, multiple modes) defined in the manifest:

```json
{
  "Actions": [
    {
      "Name": "Mute Toggle",
      "UUID": "com.example.plugin.mute",
      "States": [
        {
          "Image": "images/unmuted",
          "Name": "Unmuted"
        },
        {
          "Image": "images/muted",
          "Name": "Muted"
        }
      ]
    }
  ]
}
```

### State Synchronization Flow

#### 1. User Initiates Action (Hardware → Plugin)

```javascript
// Received from Stream Deck
{
  "event": "keyDown",
  "context": "unique-context-id",
  "payload": {
    "state": 0,  // Current state before press
    "userDesiredState": 1  // State user wants to switch to
  }
}

// Plugin sends command to external system
await externalSystem.setMute(true);

// Plugin updates Stream Deck state
ws.send(JSON.stringify({
  "event": "setState",
  "context": "unique-context-id",
  "payload": {
    "state": 1
  }
}));
```

#### 2. External System Changes State (System → Plugin → Hardware)

```javascript
// Plugin receives notification from external system
externalSystem.on('muteChanged', (isMuted) => {
  // Update Stream Deck to reflect new state
  ws.send(JSON.stringify({
    "event": "setState",
    "context": "unique-context-id",
    "payload": {
      "state": isMuted ? 1 : 0
    }
  }));

  // Optionally update title to show status
  ws.send(JSON.stringify({
    "event": "setTitle",
    "context": "unique-context-id",
    "payload": {
      "title": isMuted ? "MUTED" : "LIVE"
    }
  }));
});
```

#### 3. Multiple Users/Instances (Broadcast State)

When multiple Stream Deck devices or plugin instances need to stay synchronized:

```javascript
// Track all active contexts for this action
const muteActionContexts = new Set();

// On willAppear, register context
function handleWillAppear(event) {
  muteActionContexts.add(event.context);

  // Query current state from external system
  const currentMute = await externalSystem.getMute();

  // Initialize display state
  updateKeyState(event.context, currentMute);
}

// On willDisappear, unregister context
function handleWillDisappear(event) {
  muteActionContexts.delete(event.context);
}

// When state changes, update ALL instances
function onMuteChanged(isMuted) {
  for (const context of muteActionContexts) {
    updateKeyState(context, isMuted);
  }
}
```

### State Persistence with Settings

Settings are persisted and synchronized across plugin restarts:

```javascript
// Save state to settings
ws.send(JSON.stringify({
  "event": "setSettings",
  "context": "context-id",
  "payload": {
    "lastKnownState": 1,
    "deviceId": "speaker-a",
    "timestamp": Date.now()
  }
}));

// Retrieve on willAppear
function handleWillAppear(event) {
  const settings = event.payload.settings;

  if (settings.lastKnownState !== undefined) {
    // Verify with external system
    const actualState = await externalSystem.getState(settings.deviceId);

    if (actualState !== settings.lastKnownState) {
      // Correct drift
      updateKeyState(event.context, actualState);
      saveSettings(event.context, { lastKnownState: actualState });
    }
  }
}
```

### Real-Time State Updates

For systems requiring real-time feedback (like audio levels, connection status):

#### Polling Pattern

```javascript
// Poll external system periodically
const pollInterval = setInterval(async () => {
  for (const context of activeContexts) {
    const state = await externalSystem.getState();

    if (state !== lastKnownState) {
      updateKeyState(context, state);
      lastKnownState = state;
    }
  }
}, 1000); // Poll every second
```

#### Event-Driven Pattern (Preferred)

```javascript
// Subscribe to external system events
externalSystem.on('stateChanged', (newState) => {
  // Immediately update all Stream Deck instances
  for (const context of activeContexts) {
    updateKeyState(context, newState);
  }
});

// WebSocket connection for real-time updates
const smaartWs = new WebSocket('ws://192.168.0.1:26000');
smaartWs.on('message', (data) => {
  const response = JSON.parse(data);

  if (response.action === 'generatorState') {
    updateGeneratorKeys(response.state);
  }
});
```

### Visual State Indicators

#### Dynamic Icons

```javascript
// Generate icon based on state
function updateKeyWithState(context, level) {
  const canvas = createCanvas(144, 144);
  const ctx = canvas.getContext('2d');

  // Draw meter based on level
  drawMeter(ctx, level);

  const imageData = canvas.toDataURL();

  ws.send(JSON.stringify({
    "event": "setImage",
    "context": context,
    "payload": {
      "image": imageData
    }
  }));
}
```

#### Title Updates

```javascript
// Update title to show numeric value
ws.send(JSON.stringify({
  "event": "setTitle",
  "context": context,
  "payload": {
    "title": `${gainValue.toFixed(1)} dB`
  }
}));
```

### Error Handling and Connection Loss

Handle scenarios where external system becomes unavailable:

```javascript
externalSystem.on('disconnected', () => {
  // Update all keys to show disconnected state
  for (const context of activeContexts) {
    ws.send(JSON.stringify({
      "event": "showAlert",
      "context": context
    }));

    ws.send(JSON.stringify({
      "event": "setTitle",
      "context": context,
      "payload": {
        "title": "OFFLINE"
      }
    }));
  }
});

externalSystem.on('reconnected', () => {
  // Restore normal operation
  for (const context of activeContexts) {
    ws.send(JSON.stringify({
      "event": "showOk",
      "context": context
    }));

    // Refresh state from system
    refreshKeyState(context);
  }
});
```

### Best Practices for State-Aware Keys

1. **Initialize on willAppear**: Always query actual state when key appears
2. **Subscribe to Changes**: Use event-driven updates rather than polling when possible
3. **Handle Stale State**: Verify state after connection loss or app restart
4. **Debounce Updates**: Avoid flooding Stream Deck with rapid state changes
5. **Provide Feedback**: Use `showAlert` for errors, `showOk` for success
6. **Persist Critical Settings**: Save device IDs and configuration in settings
7. **Graceful Degradation**: Handle offline states clearly to the user

### Context Management

Properly track and clean up contexts:

```javascript
class ContextManager {
  constructor() {
    this.contexts = new Map(); // context -> { action, settings, state }
  }

  register(event) {
    this.contexts.set(event.context, {
      action: event.action,
      settings: event.payload.settings,
      state: event.payload.state,
      device: event.device
    });
  }

  unregister(event) {
    this.contexts.delete(event.context);
  }

  updateState(context, newState) {
    const ctx = this.contexts.get(context);
    if (ctx) {
      ctx.state = newState;
      this.sendStateUpdate(context, newState);
    }
  }

  broadcastToAction(actionUUID, callback) {
    for (const [context, data] of this.contexts.entries()) {
      if (data.action === actionUUID) {
        callback(context, data);
      }
    }
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

## Device-Specific Considerations

### Coordinate System

All devices use a zero-based coordinate system:

```json
{
  "coordinates": {
    "column": 0,  // 0 to (columns - 1)
    "row": 0      // 0 to (rows - 1)
  }
}
```

**Examples:**
- **Stream Deck Mini (2×3)**: columns 0-1, rows 0-2
- **Stream Deck Standard (3×5)**: columns 0-2, rows 0-4
- **Stream Deck XL (8×4)**: columns 0-7, rows 0-3
- **Stream Deck + (4×2 keys)**: columns 0-3, rows 0-1

### Encoder-Specific Events (Stream Deck +)

Encoders have unique event handling:

```javascript
// Rotation event
{
  "event": "dialRotate",
  "payload": {
    "ticks": 2,        // Positive = clockwise, negative = counter-clockwise
    "pressed": false   // Whether dial was pressed while rotating
  }
}

// Combined rotation + press allows for fine/coarse adjustment
function handleDialRotate(event) {
  const increment = event.payload.pressed ? 0.1 : 1.0; // Fine vs coarse
  const change = event.payload.ticks * increment;

  adjustParameter(change);
}
```

### State-Aware Encoders

Encoders on Stream Deck + have LCD displays that can show dynamic content, making them ideal for state-aware continuous controls (volume, gain, pan, etc.).

#### Encoder State Management

Unlike binary keys, encoders represent continuous values that need bidirectional synchronization:

```
External System Value (e.g., -12.5 dB)
            ↕
  Plugin Tracks Current Value
            ↕
   Encoder Display Shows Value
            ↕
     User Rotates Encoder
            ↕
  Plugin Updates External System
            ↕
     Display Updates to Confirm
```

#### Setting Encoder Feedback

**setFeedback Event** (Stream Deck +)

Update encoder display with value, icon, and visual feedback:

```javascript
// Update encoder display with current value
ws.send(JSON.stringify({
  "event": "setFeedback",
  "context": "encoder-context-id",
  "payload": {
    "title": "-6.5 dB",
    "value": 35,        // 0-100 for indicator bar
    "icon": "data:image/png;base64,...",
    "indicator": {
      "value": 35,
      "enabled": true,
      "opacity": 100
    }
  }
}));
```

#### Encoder State Patterns

##### Pattern 1: Volume/Gain Control

```javascript
class GainEncoder {
  constructor(context, externalSystem, channelId) {
    this.context = context;
    this.system = externalSystem;
    this.channelId = channelId;
    this.currentGain = 0;
    this.minGain = -60;
    this.maxGain = 12;

    // Subscribe to external changes
    this.system.on('gainChanged', (channel, gain) => {
      if (channel === this.channelId) {
        this.updateFromSystem(gain);
      }
    });
  }

  async initialize() {
    // Query current value from system
    this.currentGain = await this.system.getGain(this.channelId);
    this.updateDisplay();
  }

  handleRotate(event) {
    // Calculate new value
    const increment = event.payload.pressed ? 0.1 : 1.0;
    const change = event.payload.ticks * increment;

    this.currentGain = Math.max(
      this.minGain,
      Math.min(this.maxGain, this.currentGain + change)
    );

    // Send to external system
    this.system.setGain(this.channelId, this.currentGain);

    // Update display immediately for responsiveness
    this.updateDisplay();
  }

  handlePress(event) {
    // Encoder press could reset to 0 dB
    this.currentGain = 0;
    this.system.setGain(this.channelId, 0);
    this.updateDisplay();
  }

  updateFromSystem(gain) {
    // External system changed the value
    this.currentGain = gain;
    this.updateDisplay();
  }

  updateDisplay() {
    // Calculate percentage for indicator (0-100)
    const percentage = ((this.currentGain - this.minGain) /
                       (this.maxGain - this.minGain)) * 100;

    ws.send(JSON.stringify({
      "event": "setFeedback",
      "context": this.context,
      "payload": {
        "title": `${this.currentGain.toFixed(1)} dB`,
        "value": percentage,
        "icon": this.generateGainIcon(this.currentGain),
        "indicator": {
          "value": percentage,
          "enabled": true
        }
      }
    }));
  }

  generateGainIcon(gain) {
    // Generate visual representation
    // Show speaker icon with gain indication
    const canvas = createCanvas(200, 100);
    const ctx = canvas.getContext('2d');

    // Draw speaker icon
    drawSpeaker(ctx);

    // Draw gain meter
    const meterWidth = (gain + 60) / 72 * 180;
    ctx.fillStyle = gain > 0 ? '#ff6b6b' : '#51cf66';
    ctx.fillRect(10, 80, meterWidth, 10);

    return canvas.toDataURL();
  }
}
```

##### Pattern 2: Parameter Selection (Discrete States)

```javascript
class PresetEncoder {
  constructor(context, externalSystem) {
    this.context = context;
    this.system = externalSystem;
    this.presets = ['Preset 1', 'Preset 2', 'Preset 3', 'Preset 4'];
    this.currentIndex = 0;

    this.system.on('presetChanged', (index) => {
      this.updateFromSystem(index);
    });
  }

  handleRotate(event) {
    // Move through discrete states
    this.currentIndex += event.payload.ticks;

    // Wrap around
    if (this.currentIndex < 0) {
      this.currentIndex = this.presets.length - 1;
    } else if (this.currentIndex >= this.presets.length) {
      this.currentIndex = 0;
    }

    this.updateDisplay();
  }

  handlePress(event) {
    // Press to apply/load preset
    this.system.recallPreset(this.currentIndex + 1);
    this.showConfirmation();
  }

  updateDisplay() {
    const percentage = (this.currentIndex / (this.presets.length - 1)) * 100;

    ws.send(JSON.stringify({
      "event": "setFeedback",
      "context": this.context,
      "payload": {
        "title": this.presets[this.currentIndex],
        "value": percentage,
        "indicator": {
          "value": percentage,
          "enabled": true
        }
      }
    }));
  }

  showConfirmation() {
    ws.send(JSON.stringify({
      "event": "setFeedback",
      "context": this.context,
      "payload": {
        "title": "LOADED",
        "icon": "data:image/png;base64,..." // Checkmark icon
      }
    }));

    // Restore normal display after 1 second
    setTimeout(() => this.updateDisplay(), 1000);
  }
}
```

##### Pattern 3: Bidirectional Sync with Polling

```javascript
class SyncedEncoder {
  constructor(context, externalSystem, parameterId) {
    this.context = context;
    this.system = externalSystem;
    this.parameterId = parameterId;
    this.currentValue = 0;
    this.pendingUpdate = false;

    // Poll for external changes periodically
    this.pollInterval = setInterval(() => this.syncFromSystem(), 1000);
  }

  async syncFromSystem() {
    if (this.pendingUpdate) {
      // Skip sync if we just sent an update
      this.pendingUpdate = false;
      return;
    }

    try {
      const systemValue = await this.system.getValue(this.parameterId);

      if (Math.abs(systemValue - this.currentValue) > 0.01) {
        // Value changed externally
        this.currentValue = systemValue;
        this.updateDisplay();
      }
    } catch (error) {
      this.showError();
    }
  }

  handleRotate(event) {
    const change = event.payload.ticks * (event.payload.pressed ? 0.1 : 1);
    this.currentValue = Math.max(0, Math.min(100, this.currentValue + change));

    // Debounce system updates
    this.pendingUpdate = true;
    this.scheduleSystemUpdate();
    this.updateDisplay();
  }

  scheduleSystemUpdate() {
    clearTimeout(this.updateTimeout);
    this.updateTimeout = setTimeout(() => {
      this.system.setValue(this.parameterId, this.currentValue);
    }, 50); // Wait 50ms after last rotation
  }

  cleanup() {
    clearInterval(this.pollInterval);
    clearTimeout(this.updateTimeout);
  }
}
```

#### Encoder Layout Manager

For plugins that use multiple encoders:

```javascript
class EncoderLayoutManager {
  constructor() {
    this.encoders = new Map();
  }

  registerEncoder(context, settings) {
    const type = settings.encoderType;

    switch (type) {
      case 'gain':
        this.encoders.set(context, new GainEncoder(
          context,
          externalSystem,
          settings.channelId
        ));
        break;

      case 'preset':
        this.encoders.set(context, new PresetEncoder(
          context,
          externalSystem
        ));
        break;

      case 'parameter':
        this.encoders.set(context, new SyncedEncoder(
          context,
          externalSystem,
          settings.parameterId
        ));
        break;
    }

    this.encoders.get(context).initialize();
  }

  unregisterEncoder(context) {
    const encoder = this.encoders.get(context);
    if (encoder && encoder.cleanup) {
      encoder.cleanup();
    }
    this.encoders.delete(context);
  }

  handleDialRotate(event) {
    const encoder = this.encoders.get(event.context);
    if (encoder) {
      encoder.handleRotate(event);
    }
  }

  handleDialPress(event) {
    const encoder = this.encoders.get(event.context);
    if (encoder && encoder.handlePress) {
      encoder.handlePress(event);
    }
  }
}
```

#### Encoder State Persistence

Save encoder state across plugin restarts:

```javascript
function handleWillAppear(event) {
  const settings = event.payload.settings;

  if (event.payload.controller === 'Encoder') {
    // Restore last known value
    const lastValue = settings.lastValue || 0;

    // Initialize encoder with saved state
    const encoder = new GainEncoder(event.context, externalSystem, settings.channelId);

    // Verify against actual system state
    externalSystem.getGain(settings.channelId).then(actualValue => {
      if (Math.abs(actualValue - lastValue) > 0.5) {
        // State drift detected, resync
        encoder.updateFromSystem(actualValue);
      }
    });
  }
}

function saveEncoderState(context, value) {
  ws.send(JSON.stringify({
    "event": "setSettings",
    "context": context,
    "payload": {
      "lastValue": value,
      "lastUpdate": Date.now()
    }
  }));
}
```

#### Visual Feedback for Encoder State

##### Animated Indicators

```javascript
function updateEncoderWithAnimation(context, fromValue, toValue) {
  const steps = 10;
  const duration = 200; // ms
  let currentStep = 0;

  const interval = setInterval(() => {
    currentStep++;
    const progress = currentStep / steps;
    const currentValue = fromValue + (toValue - fromValue) * progress;

    updateEncoderDisplay(context, currentValue);

    if (currentStep >= steps) {
      clearInterval(interval);
    }
  }, duration / steps);
}
```

##### Color-Coded Feedback

```javascript
function getIndicatorColor(value, min, max, nominal) {
  if (value < nominal) {
    return { r: 81, g: 207, b: 102 };  // Green (safe)
  } else if (value < max * 0.9) {
    return { r: 255, g: 187, b: 51 }; // Yellow (caution)
  } else {
    return { r: 255, g: 107, b: 107 }; // Red (danger)
  }
}
```

#### Error Handling for Encoders

```javascript
function showEncoderError(context, message) {
  ws.send(JSON.stringify({
    "event": "setFeedback",
    "context": context,
    "payload": {
      "title": "ERROR",
      "value": 0,
      "icon": errorIconBase64,
      "indicator": {
        "enabled": false
      }
    }
  }));

  // Log for debugging
  ws.send(JSON.stringify({
    "event": "logMessage",
    "payload": {
      "message": `Encoder error [${context}]: ${message}`
    }
  }));
}
```

### Touch Strip (Stream Deck +)

Handle touch strip events for sliding controls:

```javascript
{
  "event": "touchTap",
  "payload": {
    "coordinates": {
      "column": 2,  // Position along strip (0-7)
      "row": 0
    },
    "tapPos": [50, 25]  // [x, y] position of tap
  }
}
```

### Image Resolution Guidelines

Provide multiple resolution images for optimal display across devices:

**manifest.json:**
```json
{
  "Icon": "images/action-icon",
  "States": [
    {
      "Image": "images/state",
      "MultiActionImage": "images/state-small"
    }
  ]
}
```

**File naming convention:**
- `action-icon.png` - 144×144 (2x resolution)
- `action-icon@2x.png` - 288×288 (4x resolution for hi-DPI)

**Device-specific rendering:**
- Stream Deck scales images to fit key size
- Provide 144×144 source images for best quality
- Use SVG-to-PNG pipeline for scalable icons

### Testing Across Device Types

**Simulator Testing:**

The Stream Deck SDK includes a simulator for testing without physical hardware:

```bash
# Launch with specific device type
streamdeck --device "Stream Deck XL"
streamdeck --device "Stream Deck +"
```

**Multi-Device Scenarios:**

```javascript
// Track device types
const deviceInfo = new Map();

function handleDeviceDidConnect(event) {
  deviceInfo.set(event.device, {
    type: event.deviceInfo.type,
    size: event.deviceInfo.size
  });

  // Adjust behavior based on device
  if (event.deviceInfo.type === 7) { // Stream Deck +
    enableEncoderFeatures(event.device);
  }
}
```

### Platform-Specific Behavior

#### Windows vs macOS

- **File Paths**: Use platform-agnostic paths in manifest
- **Image Formats**: PNG with transparency preferred on both platforms
- **Node.js Modules**: Test native modules on both platforms

#### Plugin Folder Locations

- **macOS**: `~/Library/Application Support/com.elgato.StreamDeck/Plugins/`
- **Windows**: `%APPDATA%\Elgato\StreamDeck\Plugins\`

### Performance Optimization

#### Throttling Updates

Avoid overwhelming the Stream Deck app with rapid updates:

```javascript
class ThrottledUpdater {
  constructor(minInterval = 100) {
    this.minInterval = minInterval;
    this.lastUpdate = new Map();
  }

  canUpdate(context) {
    const last = this.lastUpdate.get(context) || 0;
    const now = Date.now();

    if (now - last >= this.minInterval) {
      this.lastUpdate.set(context, now);
      return true;
    }
    return false;
  }
}

// Usage
const updater = new ThrottledUpdater(50); // Max 20 updates/second

function updateMeter(context, level) {
  if (updater.canUpdate(context)) {
    sendImageUpdate(context, level);
  }
}
```

#### Caching Generated Images

```javascript
const imageCache = new Map();

function getOrCreateImage(state, value) {
  const cacheKey = `${state}-${value}`;

  if (!imageCache.has(cacheKey)) {
    imageCache.set(cacheKey, generateImage(state, value));
  }

  return imageCache.get(cacheKey);
}
```

## Recent Updates (2026)

- Added support for Node.js 24
- Added `SupportedInKeyLogicActions` property to actions
- Enhanced dial/encoder support with `dialRotate`, `dialDown`, `dialUp` events
- Improved application monitoring capabilities
- Expanded multi-device support with device type detection
- Touch strip support for Stream Deck +

## Source notes

- Retrieved via web search on 2025-01-14.
- These references are the primary sources for Stream Deck plugin APIs, manifest configuration, and Stream Deck WebSocket event handling.
- Implementation details verified from codebase in `plugin/sd/events.ts`
