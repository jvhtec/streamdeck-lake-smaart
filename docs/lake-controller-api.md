# Lake Controller Documentation References

## Reference materials

- **Lab Gruppen Downloads (Lake Controller manuals & software)**: https://www.labgruppen.com/downloads.html
  - Official source for Lake Controller software, firmware, and manuals.
- **Lake Controller Operation Manual (mirror)**: https://manualmachine.com/labgruppen/d404l/26971267-lake-controller-operation-manual/
  - Public mirror of the Lake Controller operation manual.
- **Adamson Lake Controller**: https://adamson.ai/support/downloads-directory/design-and-control/lake-controller
  - Alternative source for Lake Controller documentation and release notes.

## DLM (Direct Lake Messaging) Protocol

Lake Controller uses the DLM protocol for third-party integrations and programmatic control. The protocol enables external applications to control Lake DSP parameters and query device status.

### Protocol Overview

- **Protocol Version**: DLM v3.4 (current compatibility)
- **Transport**: TCP/IP binary protocol
- **Message Format**: Binary packets with headers, message ID, and padded payload
- **Data Alignment**: Payloads must be padded to 4-byte boundaries

## DLM Packet Structure

### Packet Format

```
[Header: 4 bytes]
[Message ID: 4 bytes]
[Length: 4 bytes]
[Payload: Variable (padded to 4-byte boundary)]
```

### Header Structure

- **Bytes 0-1**: Version/Type (0x0100)
- **Bytes 2-3**: Flags (0x0001 for ACK required, 0x0000 for no ACK)
- **Bytes 4-7**: Message ID (unique identifier for request/response matching)
- **Bytes 8-11**: Payload Length (in bytes, after padding)

### Payload Padding

All payloads must be padded to 4-byte boundaries with null bytes (0x00).

**Example:**
- Payload: "Mod.In.Mute?A" (13 bytes)
- Padded: "Mod.In.Mute?A\0\0\0" (16 bytes)

### Acknowledgment Codes

- **ACK_SUCCESS (0)**: Command executed successfully
- **ACK_NOTMASTER (1)**: Device is not in master mode

## DLM Command Syntax

Commands use a text-based syntax within the binary packet payload.

### Command Structure

```
<Object>.<Property>.<Operation><Identifier> [Value]
```

**Components:**
- `Object`: Target object (e.g., "Mod", "Dev")
- `Property`: Property to access (e.g., "In", "Out", "Preset")
- `Operation`: Operation type
  - `?` - Query/Get
  - `=` - Set
  - `!` - Execute/Trigger
- `Identifier`: Specific target (e.g., module name, channel)
- `Value`: Value for set operations (optional)

## Common DLM Commands

### Input Mute Control

#### Get Mute Status

```
Mod.In.Mute?<module>
```

**Example:**
```
Mod.In.Mute?A
```

**Response:**
```
Mod.In.Mute=A 1
```
- `0` = Unmuted
- `1` = Muted

#### Set Mute Status

```
Mod.In.Mute=<module> <state>
```

**Examples:**
```
Mod.In.Mute=A 1    # Mute module A
Mod.In.Mute=A 0    # Unmute module A
```

### Input Gain Control

#### Get Gain Level

```
Mod.In.Gain?<module>
```

**Example:**
```
Mod.In.Gain?A
```

**Response:**
```
Mod.In.Gain=A 0.00
```
- Value in dB (e.g., 0.00, -6.50, 12.00)

#### Set Gain Level

```
Mod.In.Gain=<module> <gain_db>
```

**Examples:**
```
Mod.In.Gain=A 0.00     # Set to 0 dB
Mod.In.Gain=A -6.50    # Set to -6.5 dB
Mod.In.Gain=A 12.00    # Set to +12 dB
```

### Preset Management

#### Recall Preset

```
Dev.Preset.Recall!<preset_number>
```

**Example:**
```
Dev.Preset.Recall!1    # Recall preset 1
Dev.Preset.Recall!5    # Recall preset 5
```

### Output Control

#### Get Output Level

```
Mod.Out.Gain?<module>
```

#### Set Output Level

```
Mod.Out.Gain=<module> <gain_db>
```

## Message ID Management

Each request should have a unique message ID to match requests with responses. Message IDs are 32-bit unsigned integers.

**Best Practice:**
- Start at 1
- Increment for each request
- Wrap around at maximum value
- Use for request/response correlation

## Connection and Communication Flow

### 1. Establish TCP Connection

Connect to the Lake Controller device on its configured IP address and port (typically port 1100 or device-specific).

### 2. Send Command

1. Format command string
2. Pad to 4-byte boundary
3. Encode into DLM packet with message ID
4. Send binary packet over TCP

### 3. Receive Response

1. Read binary packet from TCP stream
2. Decode packet header
3. Extract message ID and payload
4. Match response to request using message ID
5. Parse payload for command result

### 4. Handle Acknowledgments

If ACK is required:
1. Wait for ACK packet with matching message ID
2. Check ACK status code
3. Process response data

## Implementation Examples

### From Codebase

The plugin implements DLM protocol handling in multiple files:

#### Packet Encoding (dlmPacket.ts)

```typescript
function encodeDlmMsg(
  commandString: string,
  msgId: number,
  destId: string = '0',
  destClass: string = '0',
  requireAck: boolean = true
): Buffer
```

#### Command Builders (dlmCommands.ts)

```typescript
// Mute Control
buildGetMute(module: string): string
buildSetMute(module: string, mute: boolean): string

// Gain Control
buildGetGain(module: string): string
buildSetGain(module: string, gain: number): string

// Preset Management
buildRecallPreset(presetNumber: number): string
```

**Example Usage:**
```typescript
const muteCommand = buildSetMute('A', true);
const packet = encodeDlmMsg(muteCommand, 1);
socket.write(packet);
```

## Integration Features

### Smaart Integration

Lake Controller features analyzer integration with Smaart v9.1 and later, allowing:
- Overlay of live spectrum measurements onto EQ screens
- Transfer function visualization
- Real-time system optimization feedback

### Third-Party Control

The DLM protocol enables:
- Remote parameter adjustment
- Preset recall and management
- Status monitoring
- Automated system control

## Error Handling

### Invalid Commands

Sending invalid DLM messages can lead to:
- Device reset
- Connection termination
- Error responses

**Best Practices:**
- Validate command syntax before sending
- Implement proper error handling
- Monitor connection status
- Handle timeouts gracefully

### Timeout Recommendations

- Command Response: 500-1000ms
- Preset Recall: 2-5 seconds (device-dependent)
- Connection Establishment: 5 seconds

## Version Compatibility

- **Current Version**: Lake Controller v8.1.6 (recommended)
- **DLM Protocol**: v3.4
- **Firmware Compatibility**: Check device firmware compatibility with Lake Controller version

## Additional Resources

- **Lake Controller Release Notes**: https://adamson.ai/support/downloads-directory/design-and-control/lake-controller/817-lake-controller-v8-1-2-release-notes
- **TWAudio Lake Controller**: https://www.twaudio.de/en/product/amplifiers-software/lake-controller-software-control-and-monitoring-of-plm-functions/

## Notes on API availability

Lake does not publicly advertise a standalone, modern REST API. Most integrations rely on the DLM (Direct Lake Messaging) protocol as described above. For detailed protocol specifications, consult:
- Lab Gruppen/Lake official documentation
- DLM Protocol documentation (available from vendor)
- Latest operation manuals from the downloads portal

## Source notes

- Retrieved via web search on 2025-01-14.
- DLM protocol structure and commands verified from codebase implementation in `plugin/lake/` directory.
- Binary packet format based on implementation in `dlmPacket.ts` and operational requirements.
