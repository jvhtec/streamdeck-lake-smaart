const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { EventEmitter } = require('events');

const { createMockLaServer } = require('../../scripts/lib/mock-la-server');

const distRoot = path.join(__dirname, '..', '..', 'com.jvhtec.lake-smaart.sdPlugin', 'dist');
const { LaHttpClient } = require(path.join(distRoot, 'backends', 'laHttpClient.js'));
const { LaHttpBackend } = require(path.join(distRoot, 'backends', 'laHttpBackend.js'));
const { MuteAction } = require(path.join(distRoot, 'actions', 'muteAction.js'));
const { LevelEncoderAction } = require(path.join(distRoot, 'actions', 'levelEncoderAction.js'));
const { PresetRecallAction } = require(path.join(distRoot, 'actions', 'presetRecallAction.js'));

test('LaHttpClient retries digest auth on HTTP 401 without leaking credentials', async (t) => {
    const server = createMockLaServer({
        auth: {
            enabled: true,
            password: 'supersecret',
            challengeStatus: 401,
        },
    });
    const address = await server.start();
    t.after(async () => server.stop());

    const logs = [];
    const client = new LaHttpClient(`${address.host}:${address.port}`, 'admin', 'supersecret', {
        debug: true,
        logger: (message) => logs.push(message),
    });

    const response = await client.get('/api/info');

    assert.equal(response.status, 200);
    assert.equal(server.requests.length, 2);
    assert.equal(server.requests[0].authorized, false);
    assert.equal(server.requests[1].authorized, true);
    assert.equal(logs.some((message) => message.includes('supersecret')), false);
});

test('LaHttpClient retries digest auth on HTTP 403', async (t) => {
    const server = createMockLaServer({
        auth: {
            enabled: true,
            challengeStatus: 403,
        },
    });
    const address = await server.start();
    t.after(async () => server.stop());

    const client = new LaHttpClient(`${address.host}:${address.port}`, 'admin', 'admin');
    const response = await client.get('/api/info');

    assert.equal(response.status, 200);
    assert.equal(server.requests.length, 2);
    assert.equal(server.requests[1].authorized, true);
});

test('LaHttpBackend dedupes output snapshot requests across concurrent state polls', async (t) => {
    const server = createMockLaServer();
    const address = await server.start();
    t.after(async () => server.stop());

    const backend = new LaHttpBackend({
        discoverySubnet: '192.168.1.0/24',
        discoveryHosts: [`${address.host}:${address.port}`],
    });

    const [device] = await backend.discover();
    const targets = await backend.getTargets(device);
    const outputTargets = targets.filter((target) => target.kind === 'output');

    const before = countRequests(server.requests, 'GET', '/api/control/dsp/output');
    const [stateA, stateB] = await Promise.all([
        backend.getState(outputTargets[0]),
        backend.getState(outputTargets[1]),
    ]);
    const after = countRequests(server.requests, 'GET', '/api/control/dsp/output');

    assert.equal(after - before, 1);
    assert.equal(typeof stateA.mute, 'boolean');
    assert.equal(typeof stateB.levelDb, 'number');
});

test('LaHttpBackend recalls presets via HTTP 204 and reports active preset index', async (t) => {
    const server = createMockLaServer();
    const address = await server.start();
    t.after(async () => server.stop());

    const backend = new LaHttpBackend({
        discoverySubnet: '192.168.1.0/24',
        discoveryHosts: [`${address.host}:${address.port}`],
    });

    const [device] = await backend.discover();
    await backend.recallPreset(device, 2);
    const activePresetIndex = await backend.getActivePresetIndex(device);

    assert.equal(activePresetIndex, 2);
});

test('LaHttpBackend rejects failed property writes', async (t) => {
    const server = createMockLaServer({
        faults: {
            'POST /api/control/dsp/output/1/mute': { status: 500, body: { error: 'nope' } },
        },
    });
    const address = await server.start();
    t.after(async () => server.stop());

    const backend = new LaHttpBackend({
        discoverySubnet: '192.168.1.0/24',
        discoveryHosts: [`${address.host}:${address.port}`],
    });

    const [device] = await backend.discover();
    const targets = await backend.getTargets(device);
    const outputTarget = targets.find((target) => target.kind === 'output');

    await assert.rejects(() => backend.setMute(outputTarget, true), /HTTP 500/);
});

test('MuteAction shows an alert instead of optimistic state on failure', async () => {
    const sdClient = new FakeSDClient();
    const deviceManager = new FakeDeviceManager({
        setMuteError: new Error('mute write failed'),
    });
    const action = new MuteAction(sdClient, deviceManager);

    await action.onKeyDown({
        event: 'keyDown',
        context: 'ctx',
        payload: {
            settings: {
                targetId: 'la:1',
                momentary: false,
            },
        },
    });

    assert.equal(sdClient.alerts.length, 1);
    assert.equal(sdClient.states.length, 0);
    assert.match(sdClient.logs[0], /\[Mute\] Failed/);
});

test('LevelEncoderAction shows an alert instead of optimistic feedback on failure', async () => {
    const sdClient = new FakeSDClient();
    const deviceManager = new FakeDeviceManager({
        setLevelError: new Error('level write failed'),
        targetState: { online: true, mute: false, levelDb: -3, lastUpdatedMs: Date.now() },
    });
    const action = new LevelEncoderAction(sdClient, deviceManager);

    await action.onDialRotate({
        event: 'dialRotate',
        context: 'ctx',
        payload: {
            ticks: 1,
            settings: {
                targetId: 'la:1',
                levelMode: 'gain',
                stepSize: 1,
                minLevel: -60,
                maxLevel: 15,
            },
        },
    });

    assert.equal(sdClient.alerts.length, 1);
    assert.equal(sdClient.feedback.length, 0);
    assert.match(sdClient.logs[0], /\[Level\] Failed/);
});

test('PresetRecallAction shows an alert instead of OK on failure', async () => {
    const sdClient = new FakeSDClient();
    const deviceManager = new FakeDeviceManager({
        recallPresetError: new Error('preset recall failed'),
    });
    const action = new PresetRecallAction(sdClient, deviceManager);

    await action.onKeyDown({
        event: 'keyDown',
        context: 'ctx',
        payload: {
            settings: {
                targetId: 'la:preset:1',
                requireDoublePress: false,
            },
        },
    });

    assert.equal(sdClient.alerts.length, 1);
    assert.equal(sdClient.oks.length, 0);
    assert.match(sdClient.logs[0], /\[Preset\] Failed/);
});

function countRequests(requests, method, path) {
    return requests.filter((request) => request.method === method && request.path === path).length;
}

class FakeSDClient {
    constructor() {
        this.alerts = [];
        this.oks = [];
        this.states = [];
        this.feedback = [];
        this.logs = [];
    }

    setState(context, state) {
        this.states.push({ context, state });
    }

    setFeedback(context, payload) {
        this.feedback.push({ context, payload });
    }

    setFeedbackLayout() {}

    setTitle() {}

    showAlert(context) {
        this.alerts.push(context);
    }

    showOk(context) {
        this.oks.push(context);
    }

    logMessage(message) {
        this.logs.push(message);
    }
}

class FakeDeviceManager extends EventEmitter {
    constructor(options = {}) {
        super();
        this.options = options;
        this.target = { name: 'Output 1', backend: 'la_http', deviceId: 'la_device', kind: 'output', index: 1 };
        this.targetState = options.targetState || {
            online: true,
            mute: false,
            levelDb: 0,
            lastUpdatedMs: Date.now(),
        };
    }

    registerBinding() {}

    unregisterBinding() {}

    getTarget() {
        return this.target;
    }

    getTargetState() {
        return this.targetState;
    }

    getTargetId() {
        return 'la_http:la_device:output:1';
    }

    async setMute() {
        if (this.options.setMuteError) {
            throw this.options.setMuteError;
        }
    }

    async setLevel() {
        if (this.options.setLevelError) {
            throw this.options.setLevelError;
        }
    }

    async recallPreset() {
        if (this.options.recallPresetError) {
            throw this.options.recallPresetError;
        }
    }
}
