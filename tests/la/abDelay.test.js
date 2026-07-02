const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');

const distRoot = path.join(__dirname, '..', '..', 'com.jvhtec.lake-smaart.sdPlugin', 'dist');
const {
    applyAbDelayPreset,
    delayMsToSamples,
    parseAbDelaySettings,
    validateAbDelayConfig,
} = require(path.join(distRoot, 'backends', 'laAbDelayClient.js'));
const { LaAbDelayAction } = require(path.join(distRoot, 'actions', 'laAbDelayAction.js'));

function startDelayServer({ status = 200 } = {}) {
    const requests = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            requests.push({
                method: req.method,
                path: req.url,
                body: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'),
            });
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(status === 200 ? '{}' : '{"error":"boom"}');
        });
    });
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            resolve({
                host: `127.0.0.1:${server.address().port}`,
                requests,
                stop: () => new Promise((done) => server.close(done)),
            });
        });
    });
}

function createFakeSdClient() {
    const calls = [];
    return {
        calls,
        setTitle: (context, title) => calls.push({ type: 'setTitle', context, title }),
        setSettings: (context, settings) => calls.push({ type: 'setSettings', context, settings }),
        showOk: (context) => calls.push({ type: 'showOk', context }),
        showAlert: (context) => calls.push({ type: 'showAlert', context }),
        logMessage: (message) => calls.push({ type: 'logMessage', message }),
    };
}

function buildSettings(hostA, hostB, overrides = {}) {
    return {
        configA: {
            name: 'Cardioid Preset A',
            delayUnit: 'ms',
            targets: [{ host: hostA, delayMs: 5.8 }],
        },
        configB: {
            name: 'Cardioid Preset B',
            delayUnit: 'ms',
            targets: [{ host: hostB, delayMs: 0 }],
        },
        ...overrides,
    };
}

test('delayMsToSamples rounds ms to samples at the configured rate', () => {
    assert.equal(delayMsToSamples(5.8, 96000), 557);
    assert.equal(delayMsToSamples(0, 96000), 0);
    assert.equal(delayMsToSamples(5.8, 48000), 278);
});

test('validateAbDelayConfig rejects malformed presets with clear errors', () => {
    assert.equal(validateAbDelayConfig(null, 'Config A').ok, false);
    assert.equal(validateAbDelayConfig({ targets: [] }, 'Config A').ok, false);
    assert.equal(validateAbDelayConfig({ targets: [{ delayMs: 1 }] }, 'Config A').ok, false);
    assert.equal(validateAbDelayConfig({ targets: [{ host: '10.0.0.1', delayMs: 'x' }] }, 'Config A').ok, false);
    assert.equal(validateAbDelayConfig({ delayUnit: 's', targets: [{ host: '10.0.0.1', delayMs: 1 }] }, 'Config A').ok, false);

    const valid = validateAbDelayConfig({
        name: 'Cardioid Preset A',
        delayUnit: 'ms',
        targets: [{ host: ' 192.168.1.133 ', delayMs: 5.8 }],
    }, 'Config A');
    assert.equal(valid.ok, true);
    assert.deepEqual(valid.config.targets, [{ host: '192.168.1.133', delayMs: 5.8 }]);
});

test('parseAbDelaySettings applies defaults and requires both configs', () => {
    const missing = parseAbDelaySettings({ configA: { targets: [{ host: 'h', delayMs: 1 }] } });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /Config B/);

    const parsed = parseAbDelaySettings(buildSettings('10.0.0.1', '10.0.0.2'));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.settings.sampleRate, 96000);
    assert.equal(parsed.settings.outputCount, 4);
    assert.equal(parsed.settings.authEnabled, false);
    assert.equal(parsed.settings.username, 'admin');
    assert.equal(parsed.settings.password, 'rest');
    assert.equal(parsed.settings.activePreset, undefined);
});

test('repo cardioid A/B preset files contain the expected twelve amp targets', () => {
    const presetA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'lacoustics-cardioid-preset-a.json'), 'utf8'));
    const presetB = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'lacoustics-cardioid-preset-b.json'), 'utf8'));

    const parsedA = validateAbDelayConfig(presetA, 'Config A');
    const parsedB = validateAbDelayConfig(presetB, 'Config B');

    assert.equal(parsedA.ok, true);
    assert.equal(parsedB.ok, true);
    assert.equal(parsedA.config.targets.length, 12);
    assert.equal(parsedB.config.targets.length, 12);
    assert.deepEqual(parsedA.config.targets[0], { host: '192.168.1.133', delayMs: 5.8 });
    assert.deepEqual(parsedA.config.targets[11], { host: '192.168.1.36', delayMs: 5.8 });
    assert.deepEqual(parsedB.config.targets[0], { host: '192.168.1.133', delayMs: 21.3 });
    assert.deepEqual(parsedB.config.targets[11], { host: '192.168.1.36', delayMs: 21.3 });
});

test('applyAbDelayPreset posts one delay object per output to /api/control/dsp/output', async (t) => {
    const server = await startDelayServer();
    t.after(() => server.stop());

    await applyAbDelayPreset(
        { targets: [{ host: server.host, delayMs: 5.8 }] },
        { sampleRate: 96000, outputCount: 4, authEnabled: false }
    );

    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0].method, 'POST');
    assert.equal(server.requests[0].path, '/api/control/dsp/output');
    assert.deepEqual(server.requests[0].body, [
        { delay: 557 },
        { delay: 557 },
        { delay: 557 },
        { delay: 557 },
    ]);
});

test('applyAbDelayPreset clamps direct output counts to the supported maximum', async (t) => {
    const server = await startDelayServer();
    t.after(() => server.stop());

    await applyAbDelayPreset(
        { targets: [{ host: server.host, delayMs: 1 }] },
        { sampleRate: 96000, outputCount: 100, authEnabled: false }
    );

    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0].body.length, 64);
    assert.deepEqual(server.requests[0].body[0], { delay: 96 });
});

test('applyAbDelayPreset rejects out-of-range delays before sending any request', async (t) => {
    const server = await startDelayServer();
    t.after(() => server.stop());

    await assert.rejects(
        applyAbDelayPreset(
            { targets: [{ host: server.host, delayMs: 2000 }] },
            { sampleRate: 96000, outputCount: 4, authEnabled: false }
        ),
        /allowed range is 0\.\.96000/
    );
    assert.equal(server.requests.length, 0);
});

test('key press applies the opposite preset and flips activePreset on success', async (t) => {
    const server = await startDelayServer();
    t.after(() => server.stop());

    const sdClient = createFakeSdClient();
    const action = new LaAbDelayAction(sdClient);
    const settings = buildSettings(server.host, server.host, { activePreset: 'A' });

    await action.onKeyDown({ event: 'keyDown', context: 'ctx1', payload: { settings } });

    // Active preset was A, so the key applies B (delayMs 0).
    assert.equal(server.requests.length, 1);
    assert.deepEqual(server.requests[0].body, [
        { delay: 0 },
        { delay: 0 },
        { delay: 0 },
        { delay: 0 },
    ]);

    const setSettingsCall = sdClient.calls.find((call) => call.type === 'setSettings');
    assert.equal(setSettingsCall.settings.activePreset, 'B');
    assert.equal(sdClient.calls.some((call) => call.type === 'showOk'), true);
    assert.equal(sdClient.calls.some((call) => call.type === 'showAlert'), false);
    const setTitleCall = sdClient.calls.find((call) => call.type === 'setTitle');
    assert.equal(setTitleCall.title, 'B');
});

test('key press does not flip activePreset when any amp request fails', async (t) => {
    const okServer = await startDelayServer();
    const failServer = await startDelayServer({ status: 500 });
    t.after(() => okServer.stop());
    t.after(() => failServer.stop());

    const sdClient = createFakeSdClient();
    const action = new LaAbDelayAction(sdClient);
    const settings = buildSettings(okServer.host, okServer.host, { activePreset: 'B' });
    // Applying A hits two hosts; one of them fails.
    settings.configA.targets = [
        { host: okServer.host, delayMs: 5.8 },
        { host: failServer.host, delayMs: 5.8 },
    ];

    await action.onKeyDown({ event: 'keyDown', context: 'ctx1', payload: { settings } });

    assert.equal(sdClient.calls.some((call) => call.type === 'setSettings'), false);
    assert.equal(sdClient.calls.some((call) => call.type === 'showOk'), false);
    assert.equal(sdClient.calls.some((call) => call.type === 'showAlert'), true);
});

test('key press with missing config alerts instead of sending requests', async () => {
    const sdClient = createFakeSdClient();
    const action = new LaAbDelayAction(sdClient);

    await action.onKeyDown({ event: 'keyDown', context: 'ctx1', payload: { settings: {} } });

    assert.equal(sdClient.calls.some((call) => call.type === 'showAlert'), true);
    assert.equal(sdClient.calls.some((call) => call.type === 'setSettings'), false);
});

test('willAppear shows the active preset on the key title', () => {
    const sdClient = createFakeSdClient();
    const action = new LaAbDelayAction(sdClient);

    action.onWillAppear({ event: 'willAppear', context: 'ctx1', payload: { settings: { activePreset: 'B' } } });
    assert.deepEqual(sdClient.calls[0], { type: 'setTitle', context: 'ctx1', title: 'B' });

    action.onWillAppear({ event: 'willAppear', context: 'ctx2', payload: { settings: {} } });
    assert.deepEqual(sdClient.calls[1], { type: 'setTitle', context: 'ctx2', title: 'A/B' });
});
