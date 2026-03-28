const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { EventEmitter } = require('node:events');

const { startMockLakeServer } = require('../../scripts/mock-lake-dlm');

const distRoot = path.join(__dirname, '..', '..', 'com.jvhtec.lake-smaart.sdPlugin', 'dist');
const { buildInspectorDevices } = require(path.join(distRoot, 'core', 'inspectorCatalog.js'));
const { LakeBackend } = require(path.join(distRoot, 'backends', 'lakeBackend.js'));
const { PriorityAction } = require(path.join(distRoot, 'actions', 'priorityAction.js'));
const { DlmClient } = require(path.join(distRoot, 'lake', 'dlmClient.js'));

test('buildInspectorDevices keeps only devices with targets and records supported actions', () => {
    const devices = [
        { id: 'lake:frame-a', name: 'LM 44', backend: 'lake', online: true, model: 'LM 44' },
        { id: 'la_192.168.1.2', name: 'P1 A', backend: 'la_http', online: true, model: 'P1' },
        { id: 'la_192.168.1.3', name: 'LC16D A', backend: 'la_http', online: true, model: 'LC16D' },
        { id: 'lake:orphan', name: 'Orphan', backend: 'lake', online: true, model: 'LM 26' },
    ];
    const targets = [
        {
            backend: 'lake',
            deviceId: 'lake:frame-a',
            kind: 'module',
            id: 'A',
            name: 'Module A',
            supports: ['mute', 'level'],
        },
        {
            backend: 'lake',
            deviceId: 'lake:frame-a',
            kind: 'preset',
            id: '1',
            name: 'Preset 1',
        },
        {
            backend: 'lake',
            deviceId: 'lake:frame-a',
            kind: 'router',
            id: '1',
            routerIndex: 1,
            name: 'Router 1',
            supports: ['priority'],
        },
        {
            backend: 'la_http',
            deviceId: 'la_192.168.1.2',
            kind: 'input',
            id: 'ana:1',
            index: 1,
            name: 'Analog Input 1',
            supports: ['mute', 'level'],
            path: '/api/input/settings/ana/1',
            profile: 'p1',
        },
        {
            backend: 'la_http',
            deviceId: 'la_192.168.1.2',
            kind: 'preset',
            index: 2,
            name: 'Show A',
            profile: 'p1',
        },
        {
            backend: 'la_http',
            deviceId: 'la_192.168.1.3',
            kind: 'preset',
            index: 3,
            name: 'Matrix B',
            profile: 'lc16d',
        },
    ];

    const inspectorDevices = buildInspectorDevices(devices, targets);

    assert.deepEqual(
        inspectorDevices.map((device) => [device.id, device.supportedActions]),
        [
            ['lake:frame-a', ['mute', 'level', 'priority', 'preset']],
            ['la_192.168.1.2', ['mute', 'level', 'preset']],
            ['la_192.168.1.3', ['preset']],
        ]
    );
});

test('LakeBackend exposes router targets and reads/writes forced input priority', async (t) => {
    const server = await startMockLakeServer({
        port: 0,
        bindAddress: '127.0.0.1',
        verbose: false,
        banner: false,
        routerCount: 4,
    });
    t.after(async () => server.close());

    const client = new DlmClient({
        host: '127.0.0.1',
        port: server.port,
        bindAddress: '127.0.0.1',
    });
    t.after(() => client.close());

    const backend = new LakeBackend(client, {
        host: '127.0.0.1',
        port: server.port,
        bindAddress: '127.0.0.1',
        debug: false,
    });

    const devices = await backend.discover();
    assert.equal(devices.length, 1);

    const targets = await backend.getTargets(devices[0]);
    const routerTargets = targets.filter((target) => target.kind === 'router');
    assert.equal(routerTargets.length, 4);
    assert.deepEqual(routerTargets.map((target) => target.id), ['1', '2', '3', '4']);

    const router1 = routerTargets[0];
    const initialState = await backend.getState(router1);
    assert.equal(initialState.priorityMode, 'auto');

    await backend.setPriority(router1, '3');

    const updatedState = await backend.getState(router1);
    assert.equal(updatedState.priorityMode, '3');
});

test('LakeBackend probes higher-count router targets for LMX-style frames', async (t) => {
    const server = await startMockLakeServer({
        port: 0,
        bindAddress: '127.0.0.1',
        verbose: false,
        banner: false,
        routerCount: 16,
    });
    t.after(async () => server.close());

    const client = new DlmClient({
        host: '127.0.0.1',
        port: server.port,
        bindAddress: '127.0.0.1',
    });
    t.after(() => client.close());

    const backend = new LakeBackend(client, {
        host: '127.0.0.1',
        port: server.port,
        bindAddress: '127.0.0.1',
        debug: false,
    });

    const [device] = await backend.discover();
    const targets = await backend.getTargets(device);
    const routerTargets = targets.filter((target) => target.kind === 'router');

    assert.equal(routerTargets.length, 16);
    assert.equal(routerTargets[15].id, '16');
});

test('PriorityAction maps push-count mode to the expected Lake priority', async () => {
    class FakeDeviceManager extends EventEmitter {
        constructor() {
            super();
            this.targets = new Map();
            this.priorityCalls = [];
        }

        registerBinding() {}
        unregisterBinding() {}
        getTarget(targetId) {
            return this.targets.get(targetId);
        }
        getTargetState() {
            return undefined;
        }
        getTargetId(target) {
            return `${target.backend}:${target.deviceId}:${target.kind}:${target.id}`;
        }
        async setPriority(targetId, value) {
            this.priorityCalls.push({ targetId, value });
        }
    }

    class FakeSdClient {
        constructor() {
            this.titles = [];
            this.states = [];
            this.oks = [];
            this.alerts = [];
            this.logs = [];
        }

        setTitle(context, title) {
            this.titles.push({ context, title });
        }
        setState(context, state) {
            this.states.push({ context, state });
        }
        showOk(context) {
            this.oks.push(context);
        }
        showAlert(context) {
            this.alerts.push(context);
        }
        logMessage(message) {
            this.logs.push(message);
        }
    }

    const deviceManager = new FakeDeviceManager();
    const sdClient = new FakeSdClient();
    const action = new PriorityAction(sdClient, deviceManager);
    const targetId = 'lake:lake:frame-a:router:1';
    deviceManager.targets.set(targetId, {
        backend: 'lake',
        deviceId: 'lake:frame-a',
        kind: 'router',
        id: '1',
        routerIndex: 1,
        name: 'Router 1',
        supports: ['priority'],
    });

    action.onWillAppear({
        context: 'ctx-priority',
        action: 'com.jvhtec.lake-smaart.priority',
        device: 'device',
        payload: {
            controller: 'Keypad',
            coordinates: { column: 0, row: 0 },
            isInMultiAction: false,
            settings: {
                targetId,
                priorityTriggerMode: 'push_count',
            },
            state: 0,
        },
    });

    await action.onKeyDown({
        context: 'ctx-priority',
        action: 'com.jvhtec.lake-smaart.priority',
        device: 'device',
        event: 'keyDown',
        payload: {
            controller: 'Keypad',
            coordinates: { column: 0, row: 0 },
            isInMultiAction: false,
            settings: {
                targetId,
                priorityTriggerMode: 'push_count',
            },
            state: 0,
            userDesiredState: 0,
        },
    });
    await action.onKeyDown({
        context: 'ctx-priority',
        action: 'com.jvhtec.lake-smaart.priority',
        device: 'device',
        event: 'keyDown',
        payload: {
            controller: 'Keypad',
            coordinates: { column: 0, row: 0 },
            isInMultiAction: false,
            settings: {
                targetId,
                priorityTriggerMode: 'push_count',
            },
            state: 0,
            userDesiredState: 0,
        },
    });

    await new Promise((resolve) => setTimeout(resolve, 1100));

    assert.deepEqual(deviceManager.priorityCalls, [{ targetId, value: '2' }]);
    assert.equal(sdClient.alerts.length, 0);
    assert.equal(sdClient.oks.length, 1);
});

test('DlmClient clears cached discoveries when the Lake routing filter changes', async (t) => {
    const server = await startMockLakeServer({
        port: 0,
        bindAddress: '127.0.0.1',
        verbose: false,
        banner: false,
    });
    t.after(async () => server.close());

    const client = new DlmClient({
        host: '127.0.0.1',
        port: server.port,
        bindAddress: '127.0.0.1',
    });
    t.after(() => client.close());

    const discovered = await client.discoverUnits(300);
    assert.equal(discovered.length, 1);
    assert.equal(client.getKnownUnits().length, 1);

    client.updateConfig({ host: '10.255.255.10' });

    assert.equal(client.getKnownUnits().length, 0);
});
