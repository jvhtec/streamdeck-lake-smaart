# Smaart Suite API References

## Official documentation

- **Smaart Platform Documentation (Rational Acoustics Support)**: https://support.rationalacoustics.com/support/solutions/articles/150000070760-smaart-platform-documentation
  - Central hub for Smaart platform manuals and reference material.
- **Tips for Using Smaart's API (Rational Acoustics Support)**: https://support.rationalacoustics.com/support/solutions/articles/150000092223-tips-for-using-smaart-s-api-web-viewer-remote-client-third-party-integrations-etc-
  - Notes on API usage, web viewer, and third-party integrations.

## API Overview

The Smaart API (SAPI) provides programmatic access to measurement data and control parameters for Smaart Suite v9, Smaart v8, and Smaart RT. The API enables third-party applications and other Smaart instances to access and control measurements over a network connection.

### Key Features

- **Platform Independent**: Works with any programming language that supports WebSocket connections
- **JSON-based**: Uses simple JSON text command structure
- **Network Communication**: TCP/IP-based WebSocket protocol
- **Request/Response Paradigm**: No data is served unless explicitly requested by a client
- **Bandwidth Efficient**: Clients control update speed and data transmission
- **Free to Use**: API and SDK are available for free upon request

## Connection Details

### Network Configuration

- **Protocol**: WebSocket (ws://)
- **Default Port**: 26000
- **Connection String Format**: `ws://<ip-address>:26000`
- **Example**: `ws://192.168.0.1:26000`

### Establishing Connection

```javascript
const ws = new WebSocket('ws://192.168.0.1:26000');

ws.on('open', () => {
  console.log('Connected to Smaart');
  // Send handshake if required
});

ws.on('message', (data) => {
  const response = JSON.parse(data);
  // Handle response
});

ws.on('error', (error) => {
  console.error('Connection error:', error);
});
```

## Command Structure

All commands are sent as JSON objects over the WebSocket connection.

### General Command Format

```json
{
  "action": "command_name",
  "parameters": {
    "param1": "value1",
    "param2": "value2"
  }
}
```

## Common API Commands

### Signal Generator Control

#### Enable/Disable Generator

```json
{
  "action": "generator",
  "state": true
}
```

**Parameters:**
- `state` (boolean): `true` to enable, `false` to disable

### Measurement Data Retrieval

#### Get Spectrum Data

```json
{
  "action": "getData",
  "measurement": "spectrum",
  "channel": 1
}
```

**Parameters:**
- `measurement` (string): Type of measurement ("spectrum", "transfer", "impulse")
- `channel` (number): Channel number to retrieve data from

#### Get Transfer Function Data

```json
{
  "action": "getData",
  "measurement": "transfer",
  "channel": 1
}
```

### Measurement Control

#### Set Measurement Parameters

```json
{
  "action": "setParameter",
  "measurement": "spectrum",
  "parameter": "resolution",
  "value": 1024
}
```

#### Compute Delay

```json
{
  "action": "compute_delay"
}
```

#### Active Trace Visibility

```json
{
  "action": "active_trace",
  "visible": true
}
```

**Common Parameters:**
- `resolution`: FFT resolution (512, 1024, 2048, 4096, etc.)
- `averaging`: Averaging mode and speed
- `windowing`: Window function type

## Response Format

Responses from Smaart are returned as JSON objects.

### Success Response

```json
{
  "status": "success",
  "action": "getData",
  "data": {
    "frequencies": [...],
    "magnitudes": [...],
    "phases": [...]
  }
}
```

### Error Response

```json
{
  "status": "error",
  "action": "getData",
  "error": "Invalid measurement channel"
}
```

## Integration Examples

### Third-Party Integration Use Cases

1. **Waves TRACT**: Overlays live spectrum or transfer function measurements onto EQ screens
2. **Lake Controller**: Accesses measurement data for system optimization
3. **Custom Applications**: Remote monitoring and control of Smaart measurements

### Data Access Patterns

The API uses a request/response paradigm:
- No data is pushed automatically
- Clients must explicitly request data
- Clients control update frequency
- Reduces network bandwidth usage

## Supported Smaart Versions

- Smaart v8
- Smaart Suite v9
- Smaart RT

## SDK Access

The complete API documentation and Software Development Kit (SDK) with detailed command structures and examples is available upon request.

**To Request SDK:**
- Email: support@rationalacoustics.com
- Subject: Smaart API SDK Request
- Include: Your name, company, and intended use case

## API Terms and Conditions

Review the API terms and conditions at:
https://www.rationalacoustics.com/pages/smaart-api-sdk-terms-and-conditions

## Implementation Notes

### From Codebase (plugin/smaart/smaartClient.ts)

The plugin implements a basic Smaart client with:

```typescript
class SmaartClient {
  constructor(host: string, port: number)

  // Methods
  connect(): void
  send(command: object): void
  setGenerator(enable: boolean): void
}
```

**Example Usage:**
```typescript
const client = new SmaartClient('192.168.0.1', 26000);
client.connect();
client.setGenerator(true); // Enable generator
```

## Additional Resources

- **Integration Page**: https://www.rationalacoustics.com/pages/integration-with-3rd-party-products
- **Documentation Hub**: https://support.rationalacoustics.com/support/solutions/articles/150000069118-smaart-suite-documentation

## Source notes

- Retrieved via web search on 2025-01-14.
- These links cover Smaart's API usage guidance and platform documentation for integration details.
- WebSocket protocol details and command structure verified from web sources and codebase implementation.
