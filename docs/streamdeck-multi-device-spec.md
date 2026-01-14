# Stream Deck+ Multi-Device Audio Control Plugin Specification

## Purpose and scope

A single Stream Deck+ plugin that provides consistent control semantics across heterogeneous professional audio devices:

- Lake LM (Lake Processing, UDP/DLM)
- L-Acoustics P1 (HTTP API)
- L-Acoustics LC16D (HTTP API)

The plugin must:

- Auto-detect connected devices
- Auto-detect suitable control targets
- Expose exactly three action types
- Be state-aware
- Degrade gracefully when devices are missing
- Avoid per-rig reconfiguration wherever possible

This is a control surface, not a system manager.

## Action model (frozen)

There are exactly three Stream Deck action types.

### Button action: MUTE

**Purpose**

Toggle mute on a selected target.

**User interaction**

- Press: toggle mute
- Button state reflects actual device state

**Supported targets**

- Lake LM: module or group mute
- P1: DSP output mute (1–4)
- LC16D: DSP output mute (1–16)

### Button action: PRESET RECALL

**Purpose**

Recall a predefined configuration/preset on the target device.

**User interaction**

- Press: recall selected preset
- Optional double-press safety (configurable)

**Supported targets**

- Lake LM: Lake preset/module recall
- P1 / LC16D: configuration slot recall (1–10)

### Encoder action: LEVEL + PRESS-TO-MUTE

**Purpose**

Primary continuous control.

**User interaction**

- Rotate: adjust level
- Press: toggle mute for same target
- Touch strip shows level + mute state

**Supported targets**

- Lake LM: module/group gain + mute
- P1 / LC16D:
  - Gain in dB (-60 … +15)
  - Optional volume integer (0 … 750)

**Design rule**

Internally normalize everything to dB. Volume integers are an optional mode.

## Device backends

Each device family is implemented as a backend, but all backends expose the same logical operations.

### Common backend interface (conceptual)

```ts
interface Backend {
  discover(): Promise<Device[]>;
  getTargets(device): Promise<Target[]>;
  getState(target): Promise<State>;
  setMute(target, boolean): Promise<void>;
  setLevel(target, value): Promise<void>;
  recallPreset(device, index): Promise<void>;
}
```

The Stream Deck actions never talk to devices directly. They talk to targets.

## Target model (core abstraction)

Everything controllable is represented as a Target Descriptor.

```ts
type Target =
  | {
      backend: "lake";
      deviceId: string;
      kind: "module" | "group";
      id: string;
      supports: ["mute", "level"];
    }
  | {
      backend: "la_http";
      deviceId: string;
      kind: "output";
      index: number;
      supports: ["mute", "level"];
    }
  | {
      backend: "la_http";
      deviceId: string;
      kind: "preset";
      index: number;
    };
```

This allows:

- auto-population of inspector dropdowns
- consistent state polling
- backend-agnostic actions

## Auto-detection and discovery

### Device discovery

**L-Acoustics (P1 / LC16D)**

- HTTP probe on port 80
- Endpoint: `GET /api/info`
- Valid JSON response = supported device
- Read `/api/info/name` and firmware to identify device

**Constraints from API**

- Max 10 concurrent HTTP requests
- Must throttle aggressively

**Lake LM**

- Existing Lake discovery mechanism (outside this PDF)
- Enumerate frames/modules via DLM

### Target auto-detection

Once a device is known, build a Target Catalog.

**P1 / LC16D targets**

Outputs

- `GET /api/control/dsp/output`
- Result length determines output count
- P1: typically 1–4
- LC16D: typically 1–16
- Each output becomes a `kind: "output"` target

Capabilities

- Probe one output:
  - `/mute`
  - `/gain`
  - `/volume`
- Mark supported parameters accordingly

Presets

- Iterate slots 1–10:
  - `/api/configuration/library/<i>/used`
  - `/api/configuration/library/<i>/name`
- Only include used slots
- Each becomes a `kind: "preset"` target

**Lake LM targets**

- Enumerate modules and presets via Lake object model
- Each module/group with gain+mute becomes a target
- Presets become preset targets

## Property inspector behavior

The inspector is data-driven by the Target Catalog.

### Common inspector fields

- Device selector (auto-detected)
- Target selector (filtered by action type)

### Mute button inspector

- Device
- Target (only targets with supports: mute)
- Optional: momentary vs toggle (toggle default)

### Preset recall inspector

- Device
- Preset slot (name + index)
- Optional: double-press confirmation

### Encoder inspector

- Device
- Target (only targets with supports: level)
- Level mode:
  - Gain (dB)
  - Volume (if supported)
- Step size (coarse/fine)
- Min/max clamp
- Press action: mute toggle (fixed)

## State awareness and polling

### Polling rules

- Poll only targets bound to active Stream Deck contexts
- Poll intervals:
  - Levels/mutes: ~250–500 ms
  - Preset index: ~1 s
- Back off exponentially when device offline

### State sources

**P1 / LC16D**

- Mute: `/api/control/dsp/output/<i>/mute`
- Level: `/gain` or `/volume`
- Active preset: `/api/configuration/active/index`
- Optional feedback:
  - `/api/level/dsp/output/<i>/peak`
  - `/api/monitor/output/<i>/state`

**Lake LM**

- Existing DLM state reads/subscriptions

## Stream Deck+ UI behavior

**Buttons**

- State reflects mute or preset active
- OFFLINE state when backend unavailable

**Encoders**

- Rotate = level
- Press = mute toggle
- Touch strip shows:
  - Target name
  - Level value
  - Mute indicator
  - Optional warning badge (clip/limit)

## Failure modes and fallback logic

- If only P1 is present:
  - Encoders map to P1 outputs
  - Presets map to P1 configs
- If only LC16D is present:
  - Encoders map to LC16D outputs
- If both are present:
  - Presets default to P1
  - Outputs default to LC16D
  - User can override per action
- If no devices reachable:
  - Inspector shows “No devices found”
  - Actions show OFFLINE

## Performance and safety constraints

- HTTP concurrency ≤ 10 per device
- Batch requests where supported
- Clamp gain to prevent accidental extremes
- Never auto-enable generators or audio after mute
- Never assume a preset recall is idempotent

## Non-goals (explicitly out of scope)

- Network configuration
- Audio stream routing
- Meter bridges
- Full system management
- Writing configs

This is fast control, not system design.

## Resulting benefits

- One plugin
- Three actions
- Works on:
  - LM-only rigs
  - P1-only rigs
  - LC16D-only rigs
  - Mixed rigs
- Minimal per-gig setup
- Predictable behavior under pressure

## Appendix: Smaart utility actions

This repository also retains Stream Deck key actions for Smaart utility workflows (generator, capture, compute delay, and active trace visibility). These actions are outside the Lake/L-Acoustics control-surface specification but remain supported for operators who rely on them alongside the audio device controls.
