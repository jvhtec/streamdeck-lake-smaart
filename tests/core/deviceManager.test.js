const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const distRoot = path.join(__dirname, '..', '..', 'com.jvhtec.lake-smaart.sdPlugin', 'dist');
const { DeviceManager } = require(path.join(distRoot, 'core', 'deviceManager.js'));

const MODULE_TARGET = {
    backend: 'lake',
    deviceId: 'lake:unit-1',
    kind: 'module',
    id: 'A',
    name: 'Module A',
};

function createBackend(overrides = {}) {
    return {
        id: 'lake',
        discover: async () => [{ id: 'lake:unit-1', name: 'Unit', backend: 'lake', online: true }],
        getTargets: async () => [MODULE_TARGET],
        getState: async () => ({ online: true, lastUpdatedMs: Date.now() }),
        setMute: async () => undefined,
        setLevel: async () => undefined,
        recallPreset: async () => undefined,
        ...overrides,
    };
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

test('refreshCatalog recovers after a refresh that rejects', async () => {
    const manager = new DeviceManager([createBackend()]);
    manager.on('log', () => undefined);

    const throwingListener = () => {
        throw new Error('listener boom');
    };
    manager.on('catalogUpdated', throwingListener);
    await assert.rejects(manager.refreshCatalog(), /listener boom/);
    manager.off('catalogUpdated', throwingListener);

    // Before the fix the rejected promise stayed cached and every later
    // refresh returned it, leaving the catalog frozen forever.
    await manager.refreshCatalog();
    assert.equal(manager.getDevices().length, 1);
    assert.equal(manager.getTargets().length, 1);
});

test('state polls do not overlap when getState is slower than the poll interval', async () => {
    let active = 0;
    let maxActive = 0;
    const backend = createBackend({
        getState: async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await delay(700);
            active -= 1;
            return { online: true, lastUpdatedMs: Date.now() };
        },
    });

    const manager = new DeviceManager([backend]);
    manager.on('log', () => undefined);
    await manager.refreshCatalog();
    manager.registerBinding('ctx', manager.getTargetId(MODULE_TARGET), 'mute');

    manager.start();
    await delay(1500);
    manager.stop();
    await delay(750);

    assert.ok(maxActive >= 1, 'poller should have run');
    assert.equal(maxActive, 1, `polls overlapped (max concurrent getState: ${maxActive})`);
});

test('failed state polls notify listeners with an offline state', async () => {
    const backend = createBackend({
        getState: async () => {
            throw new Error('device unreachable');
        },
    });

    const manager = new DeviceManager([backend]);
    manager.on('log', () => undefined);
    const updates = [];
    manager.on('targetStateUpdated', (_target, state) => updates.push(state));

    await manager.refreshCatalog();
    manager.registerBinding('ctx', manager.getTargetId(MODULE_TARGET), 'mute');
    manager.start();
    await delay(700);
    manager.stop();

    assert.ok(updates.length > 0, 'listeners should hear about failed polls');
    assert.equal(updates[0].online, false);
});
