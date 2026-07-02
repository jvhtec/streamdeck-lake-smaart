const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const distRoot = path.join(__dirname, '..', '..', 'com.jvhtec.lake-smaart.sdPlugin', 'dist');
const { DeviceManager } = require(path.join(distRoot, 'core', 'deviceManager.js'));

test('DeviceManager clears refreshInFlight when catalogUpdated listeners throw', async () => {
    const backend = new FakeBackend();
    const manager = new DeviceManager([backend]);

    manager.on('catalogUpdated', () => {
        throw new Error('listener failed');
    });

    await assert.rejects(() => manager.refreshCatalog(), /listener failed/);
    manager.removeAllListeners('catalogUpdated');

    await manager.refreshCatalog();

    assert.equal(backend.discoverCalls, 2);
    assert.equal(manager.getTargets().length, 1);
});

test('DeviceManager skips overlapping poll ticks while a poll is still running', async () => {
    const backend = new FakeBackend();
    const manager = new DeviceManager([backend]);
    await manager.refreshCatalog();
    manager.registerBinding('ctx', 'test:device-1:module:A', 'mute');

    let releaseStateRead;
    backend.statePromise = new Promise((resolve) => {
        releaseStateRead = () => resolve({
            online: true,
            mute: false,
            lastUpdatedMs: Date.now(),
        });
    });

    const firstPoll = manager.pollOnce();
    const secondPoll = manager.pollOnce();

    assert.equal(backend.getStateCalls, 1);

    releaseStateRead();
    await Promise.all([firstPoll, secondPoll]);

    await manager.pollOnce();
    assert.equal(backend.getStateCalls, 2);
});

test('DeviceManager emits offline target state after poll failures', async () => {
    const backend = new FakeBackend();
    backend.getStateError = new Error('offline');
    const manager = new DeviceManager([backend]);
    const states = [];
    manager.on('targetStateUpdated', (_target, state) => states.push(state));
    await manager.refreshCatalog();
    manager.registerBinding('ctx', 'test:device-1:module:A', 'mute');

    await manager.pollOnce();

    assert.equal(states.length, 1);
    assert.equal(states[0].online, false);
    assert.equal(manager.getTargetState('test:device-1:module:A').online, false);
});

class FakeBackend {
    constructor() {
        this.id = 'test';
        this.discoverCalls = 0;
        this.getStateCalls = 0;
        this.statePromise = null;
        this.getStateError = null;
    }

    async discover() {
        this.discoverCalls += 1;
        return [
            {
                id: 'device-1',
                name: 'Device 1',
                backend: 'test',
                online: true,
            },
        ];
    }

    async getTargets(device) {
        return [
            {
                backend: 'test',
                deviceId: device.id,
                kind: 'module',
                id: 'A',
                name: 'Module A',
                supports: ['mute'],
            },
        ];
    }

    async getState() {
        this.getStateCalls += 1;
        if (this.getStateError) {
            throw this.getStateError;
        }
        if (this.statePromise) {
            const state = await this.statePromise;
            this.statePromise = null;
            return state;
        }
        return {
            online: true,
            mute: false,
            lastUpdatedMs: Date.now(),
        };
    }

    async setMute() {}
    async setLevel() {}
    async recallPreset() {}
}
