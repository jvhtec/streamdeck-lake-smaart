const test = require('node:test');
const assert = require('node:assert/strict');

// Tests run after `npm run build` in CI, so import compiled JS.
const {
  encodeDlmMsg,
  decodeAck,
  parseResponse,
} = require('../com.jvhtec.lake-smaart.sdPlugin/dist/lake/dlmPacket');

test('encodeDlmMsg pads payload to 4 bytes and writes header fields', () => {
  const buf = encodeDlmMsg('ABC', 42);
  assert.equal(buf.readUInt16BE(0), 0x0100);
  assert.equal(buf.readUInt16BE(2), 1);
  assert.equal(buf.readUInt32BE(4), 42);
  assert.equal(buf.readUInt32BE(8), 4); // padded length
  const payload = buf.subarray(12);
  assert.equal(payload.length, 4);
  assert.equal(payload.subarray(0, 3).toString('ascii'), 'ABC');
  assert.equal(payload[3], 0);
});

test('decodeAck parses msgId when payload length is 0', () => {
  const ack = Buffer.alloc(12);
  ack.writeUInt16BE(0x0100, 0);
  ack.writeUInt16BE(1, 2);
  ack.writeUInt32BE(99, 4);
  ack.writeUInt32BE(0, 8);

  const parsed = decodeAck(ack);
  assert.deepEqual(parsed, { msgId: 99, status: 0 });
});

test('parseResponse reads payload and trims null padding', () => {
  const buf = encodeDlmMsg('Mod.In.Mute=A 1', 7);
  const pkt = parseResponse(buf);
  assert.ok(pkt);
  assert.equal(pkt.msgId, 7);
  assert.equal(pkt.command, 'Mod.In.Mute=A 1');
  assert.equal(pkt.payload, 'Mod.In.Mute=A 1');
});
