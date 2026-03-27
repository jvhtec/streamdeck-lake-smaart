const WebSocket = require('ws');
const ws = new WebSocket('ws://172.25.160.1:26000');

console.log('Connecting to ws://172.25.160.1:26000');

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
