import { EventEmitter } from 'events';
import { Backend, DeviceDescriptor, DeviceState, InputPriorityMode, LevelMode, TargetDescriptor, TargetState } from './types';
import { formatError } from './errorUtils';

export type ActionKind = 'mute' | 'preset' | 'level' | 'priority';

interface ActiveBinding {
    context: string;
    targetId: string;
    action: ActionKind;
}

export class DeviceManager extends EventEmitter {
    private backends: Backend[];
    private devices = new Map<string, DeviceDescriptor>();
    private deviceStates = new Map<string, DeviceState>();
    private targets = new Map<string, TargetDescriptor>();
    private targetStates = new Map<string, TargetState>();
    private bindings = new Map<string, ActiveBinding>();
    private pollTimer: NodeJS.Timeout | null = null;
    private discoveryTimer: NodeJS.Timeout | null = null;
    private refreshInFlight: Promise<void> | null = null;
    private pollInFlight = false;
    private lastPresetPoll = 0;

    constructor(backends: Backend[]) {
        super();
        this.backends = backends;
    }

    public start() {
        this.startPolling();
        this.startDiscovery();
    }

    public stop() {
        if (this.pollTimer) clearInterval(this.pollTimer);
        if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    }

    public refreshCatalog(): Promise<void> {
        if (this.refreshInFlight) return this.refreshInFlight;
        const refresh = this.refreshCatalogInternal().finally(() => {
            if (this.refreshInFlight === refresh) {
                this.refreshInFlight = null;
            }
        });
        this.refreshInFlight = refresh;
        return refresh;
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

    private startDiscovery() {
        this.refreshCatalog().catch(() => undefined);
        this.discoveryTimer = setInterval(() => {
            this.refreshCatalog().catch(() => undefined);
        }, 15000);
    }

    private startPolling() {
        this.pollTimer = setInterval(() => {
            // Never let polls overlap: a slow or offline device would otherwise
            // accumulate concurrent polls (and duplicate UDP/HTTP traffic)
            // faster than they can time out.
            if (this.pollInFlight) return;
            this.pollInFlight = true;
            this.pollOnce()
                .catch(() => undefined)
                .finally(() => {
                    this.pollInFlight = false;
                });
        }, 300);
    }

    private async pollOnce() {
        const activeTargetIds = new Set<string>();
        const activePresetDevices = new Set<string>();
        for (const binding of this.bindings.values()) {
            activeTargetIds.add(binding.targetId);
            if (binding.action === 'preset') {
                const target = this.targets.get(binding.targetId);
                if (target) {
                    activePresetDevices.add(target.deviceId);
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
                    this.emit('log', `State poll failed for ${this.getTargetId(target)}: ${formatError(error)}`);
                    const offlineState: TargetState = {
                        online: false,
                        lastUpdatedMs: Date.now(),
                    };
                    this.targetStates.set(this.getTargetId(target), offlineState);
                    this.emit('targetStateUpdated', target, offlineState);
                }
            })
        );

        const now = Date.now();
        if (now - this.lastPresetPoll > 1000) {
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
                        this.emit('log', `Preset poll failed for ${deviceId}: ${formatError(error)}`);
                        const offlineState: DeviceState = {
                            online: false,
                            lastUpdatedMs: Date.now(),
                        };
                        this.deviceStates.set(deviceId, offlineState);
                        this.emit('deviceStateUpdated', device, offlineState);
                    }
                })
            );
        }
    }

    public registerBinding(context: string, targetId: string, action: ActionKind) {
        this.bindings.set(context, { context, targetId, action });
    }

    public unregisterBinding(context: string) {
        this.bindings.delete(context);
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
        if (!target) {
            const error = new Error(`Target ${targetId} is not available.`);
            this.emit('log', formatError(error));
            throw error;
        }
        const backend = this.backends.find((b) => b.id === target.backend);
        if (!backend) {
            const error = new Error(`Backend ${target.backend} is not registered for ${targetId}.`);
            this.emit('log', formatError(error));
            throw error;
        }
        try {
            await backend.setMute(target, mute);
        } catch (error) {
            this.emit('log', `Set mute failed for ${targetId}: ${formatError(error)}`);
            throw error;
        }
    }

    public async setLevel(targetId: string, value: number, mode: LevelMode) {
        const target = this.targets.get(targetId);
        if (!target) {
            const error = new Error(`Target ${targetId} is not available.`);
            this.emit('log', formatError(error));
            throw error;
        }
        const backend = this.backends.find((b) => b.id === target.backend);
        if (!backend) {
            const error = new Error(`Backend ${target.backend} is not registered for ${targetId}.`);
            this.emit('log', formatError(error));
            throw error;
        }
        try {
            await backend.setLevel(target, value, mode);
        } catch (error) {
            this.emit('log', `Set level failed for ${targetId}: ${formatError(error)}`);
            throw error;
        }
    }

    public async setPriority(targetId: string, value: InputPriorityMode) {
        const target = this.targets.get(targetId);
        if (!target) {
            const error = new Error(`Target ${targetId} is not available.`);
            this.emit('log', formatError(error));
            throw error;
        }
        const backend = this.backends.find((b) => b.id === target.backend);
        if (!backend) {
            const error = new Error(`Backend ${target.backend} is not registered for ${targetId}.`);
            this.emit('log', formatError(error));
            throw error;
        }
        if (!backend.setPriority) {
            const error = new Error(`Backend ${target.backend} does not support priority control for ${targetId}.`);
            this.emit('log', formatError(error));
            throw error;
        }
        try {
            await backend.setPriority(target, value);
        } catch (error) {
            this.emit('log', `Set priority failed for ${targetId}: ${formatError(error)}`);
            throw error;
        }
    }

    public async recallPreset(targetId: string) {
        const target = this.targets.get(targetId);
        if (!target) {
            const error = new Error(`Target ${targetId} is not available.`);
            this.emit('log', formatError(error));
            throw error;
        }
        if (target.kind !== 'preset') {
            const error = new Error(`Target ${targetId} is not a preset.`);
            this.emit('log', formatError(error));
            throw error;
        }
        const device = this.devices.get(target.deviceId);
        if (!device) {
            const error = new Error(`Device ${target.deviceId} is not available for ${targetId}.`);
            this.emit('log', formatError(error));
            throw error;
        }
        const backend = this.backends.find((b) => b.id === target.backend);
        if (!backend) {
            const error = new Error(`Backend ${target.backend} is not registered for ${targetId}.`);
            this.emit('log', formatError(error));
            throw error;
        }
        const index = target.backend === 'lake' ? parseInt(target.id, 10) : target.index;
        try {
            await backend.recallPreset(device, index);
        } catch (error) {
            this.emit('log', `Preset recall failed for ${targetId}: ${formatError(error)}`);
            throw error;
        }
    }

    public getTargetId(target: TargetDescriptor): string {
        if (target.backend === 'lake') {
            return `${target.backend}:${target.deviceId}:${target.kind}:${target.id}`;
        }
        const targetKey = target.kind === 'preset' ? String(target.index) : target.id;
        return `${target.backend}:${target.deviceId}:${target.kind}:${targetKey}`;
    }
}
