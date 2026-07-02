const WebSocket = require('ws');
const host = process.env.SMAART_HOST || '127.0.0.1';
const port = process.env.SMAART_PORT || '26000';
const url = `ws://${host}:${port}/api/v4/`;
const ws = new WebSocket(url);

console.log(`Connecting to ${url}`);

ws.on('open', () => {
  console.log('✓ Connected, waiting for messages...');
});

ws.on('message', (data) => {
  console.log('Got message:', data.toString());
});

ws.on('error', (err) => {
  console.log('Error:', err.message);
});

ws.on('close', () => {
  console.log('Connection closed');
});

setTimeout(() => {
  console.log('Timeout - closing connection');
  ws.close();
}, 5000);
