const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { WebSocketServer } = require('ws');

const distRoot = path.join(__dirname, '..', '..', 'com.jvhtec.lake-smaart.sdPlugin', 'dist');
const { SmaartClient } = require(path.join(distRoot, 'smaart', 'smaartClient.js'));

function startMockSmaart() {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    wss.on('connection', (ws) => {
        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.action === 'get' && msg.target === undefined) {
                // Handshake probe.
                ws.send(JSON.stringify({
                    response: { authenticationRequired: false, applicationName: 'Smaart Suite' },
                }));
                return;
            }
            if (msg.action === 'get' && msg.target === 'signalGenerator') {
                ws.send(JSON.stringify({ response: { active: true, gain: -12 } }));
                return;
            }
            ws.send(JSON.stringify({ response: { error: 'unknown command' } }));
        });
    });
    return new Promise((resolve) => {
        wss.once('listening', () => {
            resolve({
                port: wss.address().port,
                clients: wss.clients,
                stop: () => new Promise((done) => {
                    // wss.close() only stops listening; open connections would
                    // keep it (and the test process) alive forever.
                    for (const ws of wss.clients) {
                        ws.terminate();
                    }
                    wss.close(done);
                }),
            });
        });
    });
}

test('requests queued before the handshake resolve with their own responses', async (t) => {
    const server = await startMockSmaart();
    t.after(() => server.stop());

    const client = new SmaartClient('127.0.0.1', server.port, 100);
    t.after(() => client.close());
    client.connect();

    // Queued while the socket is still CONNECTING; before the fix this
    // resolved with the handshake payload instead of the generator status.
    const result = await client.getSignalGeneratorStatus();

    assert.equal(result.ok, true);
    assert.equal(result.response.active, true);
    assert.equal(result.response.gain, -12);
    assert.equal(result.response.applicationName, undefined);
});

test('setTarget with an unchanged target keeps the existing connection', async (t) => {
    const server = await startMockSmaart();
    t.after(() => server.stop());

    const client = new SmaartClient('127.0.0.1', server.port, 100);
    t.after(() => client.close());
    client.connect();
    await client.waitForReady(2000);
    assert.equal(client.isReady(), true);

    client.setTarget('127.0.0.1', server.port);
    client.connect();
    assert.equal(client.isReady(), true, 'unchanged target must not drop the connection');

    const result = await client.getSignalGeneratorStatus();
    assert.equal(result.ok, true);
});

test('client reconnects automatically after the connection drops', async (t) => {
    const server = await startMockSmaart();
    t.after(() => server.stop());

    const client = new SmaartClient('127.0.0.1', server.port, 100);
    t.after(() => client.close());
    client.connect();
    await client.waitForReady(2000);

    for (const ws of server.clients) {
        ws.terminate();
    }

    // Wait for the client to actually observe the dropped connection before
    // asking it to become ready again.
    const dropDeadline = Date.now() + 2000;
    while (client.isReady() && Date.now() < dropDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(client.isReady(), false, 'client should notice the dropped connection');

    const readyAgain = await client.waitForReady(3000);
    assert.equal(readyAgain, true, 'client should re-establish the connection on its own');

    const result = await client.getSignalGeneratorStatus();
    assert.equal(result.ok, true);
});
