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
const { deriveDiscoverySubnet, prefixLengthFromNetmask } = require(path.join(distRoot, 'core', 'networkAdapters.js'));

test('deriveDiscoverySubnet keeps /24 networks intact', () => {
    assert.equal(deriveDiscoverySubnet('192.168.1.35', '255.255.255.0'), '192.168.1.0/24');
    assert.equal(prefixLengthFromNetmask('255.255.255.0'), 24);
});

test('deriveDiscoverySubnet narrows broad adapter masks to a practical /24 scan window', () => {
    assert.equal(deriveDiscoverySubnet('169.254.158.10', '255.255.0.0'), '169.254.158.0/24');
    assert.equal(prefixLengthFromNetmask('255.255.0.0'), 16);
});

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

test('LaHttpBackend discovers P1 input families and dedupes snapshot reads', async (t) => {
    const server = createMockLaServer({ profile: 'p1' });
    const address = await server.start();
    t.after(async () => server.stop());

    const backend = new LaHttpBackend({
        discoverySubnet: '192.168.1.0/24',
        discoveryHosts: [`${address.host}:${address.port}`],
    });

    const [device] = await backend.discover();
    assert.equal(device.model, 'P1');
    assert.equal(device.name, 'P1 Frontfill');

    const targets = await backend.getTargets(device);
    const inputTargets = targets.filter((target) => target.kind === 'input');
    const groupedMuteTargets = inputTargets.filter((target) => Array.isArray(target.memberIds) && target.memberIds.length > 0);
    const individualInputTargets = inputTargets.filter((target) => !Array.isArray(target.memberIds) || target.memberIds.length === 0);
    const presetTargets = targets.filter((target) => target.kind === 'preset');

    assert.equal(individualInputTargets.length, 19);
    assert.equal(groupedMuteTargets.length, 4);
    assert.ok(individualInputTargets.some((target) => target.id === 'ana:1'));
    assert.ok(individualInputTargets.some((target) => target.id === 'mic:2'));
    assert.ok(individualInputTargets.some((target) => target.id === 'mpl'));
    assert.deepEqual(
        groupedMuteTargets.map((target) => target.id).sort(),
        ['group:aes:1-4', 'group:ana:1-4', 'group:avb:1-4', 'group:avb:5-8']
    );
    assert.ok(groupedMuteTargets.every((target) => target.supports.includes('mute') && target.supports.includes('level')));
    assert.equal(presetTargets.length, 3);

    const before = countRequests(server.requests, 'GET', '/api/input/settings');
    const [stateA, stateB] = await Promise.all([
        backend.getState(individualInputTargets.find((target) => target.id === 'ana:1')),
        backend.getState(individualInputTargets.find((target) => target.id === 'mpl')),
    ]);
    const after = countRequests(server.requests, 'GET', '/api/input/settings');

    assert.equal(after - before, 1);
    assert.equal(typeof stateA.mute, 'boolean');
    assert.equal(typeof stateB.levelDb, 'number');
});

test('LaHttpBackend fans grouped P1 mute targets out to their member inputs', async (t) => {
    const server = createMockLaServer({ profile: 'p1' });
    const address = await server.start();
    t.after(async () => server.stop());

    const backend = new LaHttpBackend({
        discoverySubnet: '192.168.1.0/24',
        discoveryHosts: [`${address.host}:${address.port}`],
    });

    const [device] = await backend.discover();
    const targets = await backend.getTargets(device);
    const analogGroup = targets.find((target) => target.kind === 'input' && target.id === 'group:ana:1-4');

    assert.ok(analogGroup);
    assert.deepEqual(analogGroup.memberIds, ['ana:1', 'ana:2', 'ana:3', 'ana:4']);

    const initialState = await backend.getState(analogGroup);
    assert.equal(initialState.mute, false);

    await backend.setMute(analogGroup, true);
    const mutedState = await backend.getState(analogGroup);
    assert.equal(mutedState.mute, true);
    assert.equal(countRequestsMatching(server.requests, 'POST', /^\/api\/input\/settings\/ana\/[1-4]\/mute$/), 4);
    assert.equal(server.state.inputSettings.ana.every((input) => input.mute === true), true);

    await backend.setMute(analogGroup, false);
    const restoredState = await backend.getState(analogGroup);
    assert.equal(restoredState.mute, false);
    assert.equal(countRequestsMatching(server.requests, 'POST', /^\/api\/input\/settings\/ana\/[1-4]\/mute$/), 8);
    assert.equal(server.state.inputSettings.ana.every((input) => input.mute === false), true);
});

test('LaHttpBackend fans grouped P1 level targets out to their member inputs', async (t) => {
    const server = createMockLaServer({ profile: 'p1' });
    const address = await server.start();
    t.after(async () => server.stop());

    const backend = new LaHttpBackend({
        discoverySubnet: '192.168.1.0/24',
        discoveryHosts: [`${address.host}:${address.port}`],
    });

    const [device] = await backend.discover();
    const targets = await backend.getTargets(device);
    const analogGroup = targets.find((target) => target.kind === 'input' && target.id === 'group:ana:1-4');

    assert.ok(analogGroup);

    const initialState = await backend.getState(analogGroup);
    assert.equal(initialState.levelDb, -5);

    await backend.setLevel(analogGroup, -10, 'gain');
    const updatedState = await backend.getState(analogGroup);
    assert.equal(updatedState.levelDb, -10);
    assert.equal(countRequestsMatching(server.requests, 'POST', /^\/api\/input\/settings\/ana\/[1-4]\/gain$/), 4);
    assert.equal(server.state.inputSettings.ana.every((input) => input.gain === -10), true);
});

test('LaHttpBackend uses one configuration library read for P1 target discovery', async (t) => {
    const server = createMockLaServer({ profile: 'p1' });
    const address = await server.start();
    t.after(async () => server.stop());

    const backend = new LaHttpBackend({
        discoverySubnet: '192.168.1.0/24',
        discoveryHosts: [`${address.host}:${address.port}`],
    });

    const [device] = await backend.discover();
    await backend.getTargets(device);

    assert.equal(countRequests(server.requests, 'GET', '/api/configuration/library'), 1);
    assert.equal(countRequestsMatching(server.requests, 'GET', /^\/api\/configuration\/library\/\d+\/used$/), 0);
});

test('LaHttpBackend exposes LC16D preset targets without unsupported mute/level controls', async (t) => {
    const server = createMockLaServer({ profile: 'lc16d' });
    const address = await server.start();
    t.after(async () => server.stop());

    const backend = new LaHttpBackend({
        discoverySubnet: '192.168.1.0/24',
        discoveryHosts: [`${address.host}:${address.port}`],
    });

    const [device] = await backend.discover();
    const targets = await backend.getTargets(device);

    assert.equal(device.model, 'LC16D');
    assert.equal(targets.filter((target) => target.kind !== 'preset').length, 0);
    assert.equal(targets.filter((target) => target.kind === 'preset').length, 3);

    await backend.recallPreset(device, 2);
    const activePresetIndex = await backend.getActivePresetIndex(device);
    assert.equal(activePresetIndex, 2);
});

test('LaHttpBackend still supports amplified-controller output paths', async (t) => {
    const server = createMockLaServer({ profile: 'amplified' });
    const address = await server.start();
    t.after(async () => server.stop());

    const backend = new LaHttpBackend({
        discoverySubnet: '192.168.1.0/24',
        discoveryHosts: [`${address.host}:${address.port}`],
    });

    const [device] = await backend.discover();
    const targets = await backend.getTargets(device);
    const outputTarget = targets.find((target) => target.kind === 'output');
    const state = await backend.getState(outputTarget);

    assert.equal(device.model, 'LA4X');
    assert.equal(typeof state.volume, 'number');
});

test('LaHttpBackend rejects failed P1 property writes', async (t) => {
    const server = createMockLaServer({
        profile: 'p1',
        faults: {
            'POST /api/input/settings/ana/1/mute': { status: 500, body: { error: 'nope' } },
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
    const outputTarget = targets.find((target) => target.kind === 'input' && target.id === 'ana:1');

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
                targetId: 'la_http:la_device:input:ana:1',
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
                targetId: 'la_http:la_device:input:ana:1',
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

test('LevelEncoderAction accumulates rapid dial turns against optimistic state', async () => {
    const sdClient = new FakeSDClient();
    const deviceManager = new FakeDeviceManager({
        targetState: { online: true, mute: false, levelDb: 0, lastUpdatedMs: Date.now() },
    });
    const action = new LevelEncoderAction(sdClient, deviceManager);

    await Promise.all([
        action.onDialRotate({
            event: 'dialRotate',
            context: 'ctx',
            payload: {
                ticks: 1,
                settings: {
                    targetId: 'la_http:la_device:input:ana:1',
                    levelMode: 'gain',
                    stepSize: 1,
                    minLevel: -60,
                    maxLevel: 15,
                },
            },
        }),
        action.onDialRotate({
            event: 'dialRotate',
            context: 'ctx',
            payload: {
                ticks: 1,
                settings: {
                    targetId: 'la_http:la_device:input:ana:1',
                    levelMode: 'gain',
                    stepSize: 1,
                    minLevel: -60,
                    maxLevel: 15,
                },
            },
        }),
    ]);

    assert.equal(deviceManager.levelCalls, 2);
    assert.deepEqual(deviceManager.levelValues, [1, 2]);
    assert.equal(sdClient.feedback[sdClient.feedback.length - 1].payload.value, '2.0 dB');
});

test('Backend-scoped Lake mute action rejects L-Acoustics targets', async () => {
    const sdClient = new FakeSDClient();
    const deviceManager = new FakeDeviceManager();
    const action = new MuteAction(sdClient, deviceManager, {
        allowedBackend: 'lake',
        logPrefix: 'Lake Mute',
    });

    await action.onKeyDown({
        event: 'keyDown',
        context: 'ctx',
        payload: {
            settings: {
                targetId: 'la_http:la_device:input:ana:1',
                momentary: false,
            },
        },
    });

    assert.equal(sdClient.alerts.length, 1);
    assert.equal(deviceManager.muteCalls, 0);
    assert.match(sdClient.logs[0], /not a Lake target/);
});

test('Backend-scoped L-Acoustics level action rejects Lake targets', async () => {
    const sdClient = new FakeSDClient();
    const deviceManager = new FakeDeviceManager({
        target: {
            name: 'Module A',
            backend: 'lake',
            deviceId: 'lake_device',
            kind: 'module',
            id: 'A',
            supports: ['mute', 'level'],
        },
    });
    const action = new LevelEncoderAction(sdClient, deviceManager, {
        allowedBackend: 'la_http',
        logPrefix: 'L-Acoustics Level',
    });

    await action.onDialRotate({
        event: 'dialRotate',
        context: 'ctx',
        payload: {
            ticks: 1,
            settings: {
                targetId: 'lake:lake_device:module:A',
                levelMode: 'gain',
                stepSize: 1,
                minLevel: -60,
                maxLevel: 15,
            },
        },
    });

    assert.equal(sdClient.alerts.length, 1);
    assert.equal(deviceManager.levelCalls, 0);
    assert.match(sdClient.logs[0], /not a L-Acoustics target/);
});

test('Backend-scoped L-Acoustics preset action rejects Lake targets', async () => {
    const sdClient = new FakeSDClient();
    const deviceManager = new FakeDeviceManager({
        target: {
            name: 'Frame Preset 2',
            backend: 'lake',
            deviceId: 'lake_device',
            kind: 'preset',
            id: '2',
            supports: [],
        },
    });
    const action = new PresetRecallAction(sdClient, deviceManager, {
        allowedBackend: 'la_http',
        logPrefix: 'L-Acoustics Preset',
    });

    await action.onKeyDown({
        event: 'keyDown',
        context: 'ctx',
        payload: {
            settings: {
                targetId: 'lake:lake_device:preset:2',
                requireDoublePress: false,
            },
        },
    });

    assert.equal(sdClient.alerts.length, 1);
    assert.equal(deviceManager.recallCalls, 0);
    assert.match(sdClient.logs[0], /not a L-Acoustics target/);
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
                targetId: 'la_http:la_device:preset:1',
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

function countRequestsMatching(requests, method, pattern) {
    return requests.filter((request) => request.method === method && pattern.test(request.path)).length;
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
        this.target = options.target || {
            name: 'Analog 1',
            backend: 'la_http',
            deviceId: 'la_device',
            kind: 'input',
            id: 'ana:1',
            index: 1,
            supports: ['mute', 'level'],
            path: '/api/input/settings/ana/1',
            profile: 'p1',
        };
        this.targetState = options.targetState || {
            online: true,
            mute: false,
            levelDb: 0,
            lastUpdatedMs: Date.now(),
        };
        this.muteCalls = 0;
        this.levelCalls = 0;
        this.levelValues = [];
        this.recallCalls = 0;
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
        return 'la_http:la_device:input:ana:1';
    }

    async setMute() {
        this.muteCalls += 1;
        if (this.options.setMuteError) {
            throw this.options.setMuteError;
        }
    }

    async setLevel(_targetId, value) {
        this.levelCalls += 1;
        this.levelValues.push(value);
        if (this.options.setLevelError) {
            throw this.options.setLevelError;
        }
    }

    async recallPreset() {
        this.recallCalls += 1;
        if (this.options.recallPresetError) {
            throw this.options.recallPresetError;
        }
    }
}
