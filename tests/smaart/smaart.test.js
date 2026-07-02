const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const WebSocket = require('ws');

const distRoot = path.join(__dirname, '..', '..', 'com.jvhtec.lake-smaart.sdPlugin', 'dist');
const { SmaartClient } = require(path.join(distRoot, 'smaart', 'smaartClient.js'));

test('SmaartClient does not resolve a queued request with the API handshake response', async () => {
    const server = new WebSocket.Server({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');

    const port = server.address().port;
    const client = new SmaartClient('127.0.0.1', port);

    server.on('connection', (ws) => {
        let messageCount = 0;
        ws.on('message', (data) => {
            messageCount += 1;
            const message = JSON.parse(data.toString());
            if (messageCount === 1) {
                assert.equal(message.action, 'get');
                ws.send(JSON.stringify({
                    response: {
                        authenticationRequired: false,
                        applicationName: 'Smaart Suite',
                    },
                }));
                return;
            }

            assert.equal(message.target, 'activeCalibratedInputs');
            ws.send(JSON.stringify({
                response: {
                    devices: [
                        {
                            deviceName: 'Interface',
                            activeCalibratedChannels: [
                                {
                                    channelName: 'Mic 1',
                                    streamEndpoint: '/stream/1',
                                },
                            ],
                        },
                    ],
                    metrics: ['SPL Fast'],
                },
            }));
        });
    });

    try {
        client.connect();
        const result = await client.getActiveCalibratedInputs();

        assert.equal(result.ok, true);
        assert.equal(result.response.devices[0].deviceName, 'Interface');
        assert.deepEqual(result.response.metrics, ['SPL Fast']);
    } finally {
        client.close();
        await new Promise((resolve) => server.close(resolve));
    }
});

function once(emitter, eventName) {
    return new Promise((resolve) => emitter.once(eventName, resolve));
}
