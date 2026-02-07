import { EventEmitter } from 'events';
import { Backend, DeviceDescriptor, DeviceState, LevelMode, TargetDescriptor, TargetState } from './types';

export type ActionKind = 'mute' | 'preset' | 'level';

interface ActiveBinding {
    context: string;
    targetId: string;
    action: ActionKind;
}

type ContextBindings = ActiveBinding[];

export interface DeviceManagerConfig {
    pollIntervalMs: number;
    discoveryIntervalMs: number;
    presetPollIntervalMs: number;
}

const DEFAULT_CONFIG: DeviceManagerConfig = {
    pollIntervalMs: 500,
    discoveryIntervalMs: 60_000,
    presetPollIntervalMs: 1500,
};

export class DeviceManager extends EventEmitter {
    private backends: Backend[];
    private config: DeviceManagerConfig;
    private started = false;

    private devices = new Map<string, DeviceDescriptor>();
    private deviceStates = new Map<string, DeviceState>();
    private targets = new Map<string, TargetDescriptor>();
    private targetStates = new Map<string, TargetState>();
    private bindings = new Map<string, ContextBindings>();
    private pollTimer: NodeJS.Timeout | null = null;
    private discoveryTimer: NodeJS.Timeout | null = null;
    private refreshInFlight: Promise<void> | null = null;
    private lastPresetPoll = 0;

    constructor(backends: Backend[], config?: Partial<DeviceManagerConfig>) {
        super();
        this.backends = backends;
        this.config = { ...DEFAULT_CONFIG, ...(config || {}) };
    }

    public updateConfig(patch: Partial<DeviceManagerConfig>) {
        const next: DeviceManagerConfig = { ...this.config, ...patch };

        // Sanitize
        next.pollIntervalMs = Math.max(100, Math.floor(next.pollIntervalMs));
        next.presetPollIntervalMs = Math.max(100, Math.floor(next.presetPollIntervalMs));
        next.discoveryIntervalMs = Math.max(0, Math.floor(next.discoveryIntervalMs)); // allow 0 to disable

        this.config = next;
        if (!this.started) return;

        // Restart timers to apply new intervals.
        this.restartDiscovery();
        this.ensurePolling();
    }

    public start() {
        if (this.started) return;
        this.started = true;
        this.restartDiscovery();
        this.ensurePolling();
    }

    public stop() {
        this.started = false;
        this.stopPolling();
        this.stopDiscovery();
    }

    public async refreshCatalog() {
        if (this.refreshInFlight) return this.refreshInFlight;
        this.refreshInFlight = this.refreshCatalogInternal();
        await this.refreshInFlight;
        this.refreshInFlight = null;
    }

    private async refreshCatalogInternal() {
        const discoveredDevices: DeviceDescriptor[] = [];
        for (const backend of this.backends) {
            try {
                const devices = await backend.discover();
                discoveredDevices.push(...devices);
            } catch (error) {
                this.emit('log', `Discovery failed for ${backend.id}: ${String(error)}`);
            }
        }

        const nextDevices = new Map<string, DeviceDescriptor>();
        for (const device of discoveredDevices) {
            nextDevices.set(device.id, device);
        }
        this.devices = nextDevices;

        const nextTargets = new Map<string, TargetDescriptor>();
        for (const device of this.devices.values()) {
            const backend = this.backends.find((b) => b.id === device.backend);
            if (!backend) continue;
            try {
                const targets = await backend.getTargets(device);
                targets.forEach((target) => {
                    const targetId = this.getTargetId(target);
                    nextTargets.set(targetId, target);
                });
            } catch (error) {
                this.emit('log', `Target discovery failed for ${device.id}: ${String(error)}`);
            }
        }
        this.targets = nextTargets;
        this.emit('catalogUpdated');
    }

    private restartDiscovery() {
        this.stopDiscovery();
        const { discoveryIntervalMs } = this.config;
        if (discoveryIntervalMs <= 0) return;

        this.refreshCatalog().catch((err) => this.emit('log', `Catalog refresh failed: ${String(err)}`));
        this.discoveryTimer = setInterval(() => {
            this.refreshCatalog().catch((err) => this.emit('log', `Catalog refresh failed: ${String(err)}`));
        }, discoveryIntervalMs);
    }

    private stopDiscovery() {
        if (this.discoveryTimer) {
            clearInterval(this.discoveryTimer);
            this.discoveryTimer = null;
        }
    }

    private ensurePolling() {
        if (!this.started) return;

        // Polling is only useful when we have active bindings.
        if (this.bindings.size === 0) {
            this.stopPolling();
            return;
        }

        if (this.pollTimer) return;
        this.pollTimer = setInterval(() => {
            this.pollOnce().catch(() => undefined);
        }, this.config.pollIntervalMs);
    }

    private stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    private async pollOnce() {
        const activeTargetIds = new Set<string>();
        const activePresetDevices = new Set<string>();
        for (const bindings of this.bindings.values()) {
            for (const binding of bindings) {
                activeTargetIds.add(binding.targetId);
                if (binding.action === 'preset') {
                    const target = this.targets.get(binding.targetId);
                    if (target) {
                        activePresetDevices.add(target.deviceId);
                    }
                }
            }
        }

        const pollTargets = Array.from(activeTargetIds).map((id) => this.targets.get(id)).filter(Boolean) as TargetDescriptor[];
        await Promise.all(
            pollTargets.map(async (target) => {
                const backend = this.backends.find((b) => b.id === target.backend);
                if (!backend) return;
                try {
                    const state = await backend.getState(target);
                    this.targetStates.set(this.getTargetId(target), state);
                    this.emit('targetStateUpdated', target, state);
                } catch (error) {
                    this.targetStates.set(this.getTargetId(target), {
                        online: false,
                        lastUpdatedMs: Date.now(),
                    });
                }
            })
        );

        const now = Date.now();
        if (now - this.lastPresetPoll > this.config.presetPollIntervalMs) {
            this.lastPresetPoll = now;
            await Promise.all(
                Array.from(activePresetDevices).map(async (deviceId) => {
                    const device = this.devices.get(deviceId);
                    if (!device) return;
                    const backend = this.backends.find((b) => b.id === device.backend);
                    if (!backend || !backend.getActivePresetIndex) return;
                    try {
                        const index = await backend.getActivePresetIndex(device);
                        this.deviceStates.set(deviceId, {
                            online: true,
                            activePresetIndex: index ?? undefined,
                            lastUpdatedMs: Date.now(),
                        });
                        this.emit('deviceStateUpdated', device, this.deviceStates.get(deviceId));
                    } catch (error) {
                        this.deviceStates.set(deviceId, {
                            online: false,
                            lastUpdatedMs: Date.now(),
                        });
                    }
                })
            );
        }
    }

    public registerBinding(context: string, targetId: string, action: ActionKind) {
        this.registerBindings(context, [targetId], action);
    }

    public registerBindings(context: string, targetIds: string[], action: ActionKind) {
        const cleaned = targetIds.map((t) => String(t || '').trim()).filter(Boolean);
        if (cleaned.length === 0) return;

        this.bindings.set(
            context,
            cleaned.map((targetId) => ({ context, targetId, action }))
        );
        this.ensurePolling();
    }

    public unregisterBinding(context: string) {
        this.bindings.delete(context);
        this.ensurePolling();
    }

    public getDevices(): DeviceDescriptor[] {
        return Array.from(this.devices.values());
    }

    public getTargets(): TargetDescriptor[] {
        return Array.from(this.targets.values());
    }

    public getTarget(targetId: string): TargetDescriptor | undefined {
        return this.targets.get(targetId);
    }

    public getTargetState(targetId: string): TargetState | undefined {
        return this.targetStates.get(targetId);
    }

    public getDeviceState(deviceId: string): DeviceState | undefined {
        return this.deviceStates.get(deviceId);
    }

    public async setMute(targetId: string, mute: boolean) {
        const target = this.targets.get(targetId);
        if (!target) return;
        const backend = this.backends.find((b) => b.id === target.backend);
        if (!backend) return;
        await backend.setMute(target, mute);
    }

    public async setLevel(targetId: string, value: number, mode: LevelMode) {
        const target = this.targets.get(targetId);
        if (!target) return;
        const backend = this.backends.find((b) => b.id === target.backend);
        if (!backend) return;
        await backend.setLevel(target, value, mode);
    }

    public async recallPreset(targetId: string) {
        const target = this.targets.get(targetId);
        if (!target) return;
        if (target.kind !== 'preset') return;
        const device = this.devices.get(target.deviceId);
        if (!device) return;
        const backend = this.backends.find((b) => b.id === target.backend);
        if (!backend) return;
        const index = target.backend === 'lake' ? parseInt(target.id, 10) : target.index;
        await backend.recallPreset(device, index);
    }

    public getTargetId(target: TargetDescriptor): string {
        if (target.backend === 'lake') {
            return `${target.backend}:${target.deviceId}:${target.kind}:${target.id}`;
        }
        return `${target.backend}:${target.deviceId}:${target.kind}:${target.index}`;
    }
}
