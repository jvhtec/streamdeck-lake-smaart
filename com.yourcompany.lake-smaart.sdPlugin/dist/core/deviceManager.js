"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceManager = void 0;
const events_1 = require("events");
class DeviceManager extends events_1.EventEmitter {
    backends;
    devices = new Map();
    deviceStates = new Map();
    targets = new Map();
    targetStates = new Map();
    bindings = new Map();
    pollTimer = null;
    discoveryTimer = null;
    refreshInFlight = null;
    lastPresetPoll = 0;
    constructor(backends) {
        super();
        this.backends = backends;
    }
    start() {
        this.startPolling();
        this.startDiscovery();
    }
    stop() {
        if (this.pollTimer)
            clearInterval(this.pollTimer);
        if (this.discoveryTimer)
            clearInterval(this.discoveryTimer);
    }
    async refreshCatalog() {
        if (this.refreshInFlight)
            return this.refreshInFlight;
        this.refreshInFlight = this.refreshCatalogInternal();
        await this.refreshInFlight;
        this.refreshInFlight = null;
    }
    async refreshCatalogInternal() {
        const discoveredDevices = [];
        for (const backend of this.backends) {
            try {
                const devices = await backend.discover();
                discoveredDevices.push(...devices);
            }
            catch (error) {
                this.emit('log', `Discovery failed for ${backend.id}: ${String(error)}`);
            }
        }
        const nextDevices = new Map();
        for (const device of discoveredDevices) {
            nextDevices.set(device.id, device);
        }
        this.devices = nextDevices;
        const nextTargets = new Map();
        for (const device of this.devices.values()) {
            const backend = this.backends.find((b) => b.id === device.backend);
            if (!backend)
                continue;
            try {
                const targets = await backend.getTargets(device);
                targets.forEach((target) => {
                    const targetId = this.getTargetId(target);
                    nextTargets.set(targetId, target);
                });
            }
            catch (error) {
                this.emit('log', `Target discovery failed for ${device.id}: ${String(error)}`);
            }
        }
        this.targets = nextTargets;
        this.emit('catalogUpdated');
    }
    startDiscovery() {
        this.refreshCatalog().catch(() => undefined);
        this.discoveryTimer = setInterval(() => {
            this.refreshCatalog().catch(() => undefined);
        }, 15000);
    }
    startPolling() {
        this.pollTimer = setInterval(() => {
            this.pollOnce().catch(() => undefined);
        }, 300);
    }
    async pollOnce() {
        const activeTargetIds = new Set();
        const activePresetDevices = new Set();
        for (const binding of this.bindings.values()) {
            activeTargetIds.add(binding.targetId);
            if (binding.action === 'preset') {
                const target = this.targets.get(binding.targetId);
                if (target) {
                    activePresetDevices.add(target.deviceId);
                }
            }
        }
        const pollTargets = Array.from(activeTargetIds).map((id) => this.targets.get(id)).filter(Boolean);
        await Promise.all(pollTargets.map(async (target) => {
            const backend = this.backends.find((b) => b.id === target.backend);
            if (!backend)
                return;
            try {
                const state = await backend.getState(target);
                this.targetStates.set(this.getTargetId(target), state);
                this.emit('targetStateUpdated', target, state);
            }
            catch (error) {
                this.targetStates.set(this.getTargetId(target), {
                    online: false,
                    lastUpdatedMs: Date.now(),
                });
            }
        }));
        const now = Date.now();
        if (now - this.lastPresetPoll > 1000) {
            this.lastPresetPoll = now;
            await Promise.all(Array.from(activePresetDevices).map(async (deviceId) => {
                const device = this.devices.get(deviceId);
                if (!device)
                    return;
                const backend = this.backends.find((b) => b.id === device.backend);
                if (!backend || !backend.getActivePresetIndex)
                    return;
                try {
                    const index = await backend.getActivePresetIndex(device);
                    this.deviceStates.set(deviceId, {
                        online: true,
                        activePresetIndex: index ?? undefined,
                        lastUpdatedMs: Date.now(),
                    });
                    this.emit('deviceStateUpdated', device, this.deviceStates.get(deviceId));
                }
                catch (error) {
                    this.deviceStates.set(deviceId, {
                        online: false,
                        lastUpdatedMs: Date.now(),
                    });
                }
            }));
        }
    }
    registerBinding(context, targetId, action) {
        this.bindings.set(context, { context, targetId, action });
    }
    unregisterBinding(context) {
        this.bindings.delete(context);
    }
    getDevices() {
        return Array.from(this.devices.values());
    }
    getTargets() {
        return Array.from(this.targets.values());
    }
    getTarget(targetId) {
        return this.targets.get(targetId);
    }
    getTargetState(targetId) {
        return this.targetStates.get(targetId);
    }
    getDeviceState(deviceId) {
        return this.deviceStates.get(deviceId);
    }
    async setMute(targetId, mute) {
        const target = this.targets.get(targetId);
        if (!target)
            return;
        const backend = this.backends.find((b) => b.id === target.backend);
        if (!backend)
            return;
        await backend.setMute(target, mute);
    }
    async setLevel(targetId, value, mode) {
        const target = this.targets.get(targetId);
        if (!target)
            return;
        const backend = this.backends.find((b) => b.id === target.backend);
        if (!backend)
            return;
        await backend.setLevel(target, value, mode);
    }
    async recallPreset(targetId) {
        const target = this.targets.get(targetId);
        if (!target)
            return;
        if (target.kind !== 'preset')
            return;
        const device = this.devices.get(target.deviceId);
        if (!device)
            return;
        const backend = this.backends.find((b) => b.id === target.backend);
        if (!backend)
            return;
        const index = target.backend === 'lake' ? parseInt(target.id, 10) : target.index;
        await backend.recallPreset(device, index);
    }
    getTargetId(target) {
        if (target.backend === 'lake') {
            return `${target.backend}:${target.deviceId}:${target.kind}:${target.id}`;
        }
        return `${target.backend}:${target.deviceId}:${target.kind}:${target.index}`;
    }
}
exports.DeviceManager = DeviceManager;
