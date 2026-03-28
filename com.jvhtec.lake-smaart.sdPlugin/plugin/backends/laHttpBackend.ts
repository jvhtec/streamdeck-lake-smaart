import { Backend, DeviceDescriptor, LevelMode, TargetDescriptor, TargetState } from '../core/types';
import { LaHttpClient } from './laHttpClient';
import {
    asLaDeviceInfo,
    asLaOutputs,
    buildLaConfigurationLoadBody,
    coerceBoolean,
    coerceNumber,
    coerceString,
    createInvalidPayloadError,
    createUnexpectedStatusError,
    detectLaOutputSupports,
    formatError,
    isPropertyWriteSuccessStatus,
    isReadSuccessStatus,
    isRecallSuccessStatus,
    laActivePresetIndexPath,
    laConfigurationLoadPath,
    laInfoPath,
    LaLogFn,
    LaOutputObject,
    laOutputsPath,
    laOutputGainPath,
    laOutputMutePath,
    laOutputVolumePath,
    laPresetNamePath,
    laPresetUsedPath,
    pickLaOutput,
} from './laApi';

export interface LaHttpSettings {
    discoverySubnet: string;
    discoveryHosts: string[];
    username?: string;
    password?: string;
    debugLogging?: boolean;
}

interface OutputSnapshotCacheEntry {
    timestamp: number;
    outputs: LaOutputObject[] | null;
    promise: Promise<LaOutputObject[]> | null;
}

export class LaHttpBackend implements Backend {
    public readonly id = 'la_http' as const;
    private settings: LaHttpSettings;
    private maxConcurrency = 10;
    private limiters = new Map<string, { active: number; queue: Array<() => void> }>();
    private outputSnapshotTtlMs = 200;
    private outputSnapshots = new Map<string, OutputSnapshotCacheEntry>();
    private logger?: LaLogFn;

    constructor(settings: LaHttpSettings, logger?: LaLogFn) {
        this.settings = settings;
        this.logger = logger;
    }

    public updateSettings(settings: Partial<LaHttpSettings>) {
        this.settings = { ...this.settings, ...settings };
    }

    public async discover(): Promise<DeviceDescriptor[]> {
        const hosts = this.buildHostList();
        const results: DeviceDescriptor[] = [];
        const queue = hosts.slice();
        const workers = Array.from({ length: Math.min(this.maxConcurrency, queue.length) }, () => this.worker(queue, results));
        await Promise.all(workers);
        return results;
    }

    public async getTargets(device: DeviceDescriptor): Promise<TargetDescriptor[]> {
        const host = this.getDeviceHost(device);
        const client = this.createClient(host);
        const outputs = await this.readOutputs(client, host);
        const supports = detectLaOutputSupports(outputs[0] || null);

        const targets: TargetDescriptor[] = [];
        for (let i = 1; i <= outputs.length; i++) {
            targets.push({
                backend: 'la_http',
                deviceId: device.id,
                kind: 'output',
                index: i,
                name: `Output ${i}`,
                supports,
            });
        }

        for (let i = 1; i <= 10; i++) {
            const usedResp = await this.withLimiter(host, () => client.get<boolean>(laPresetUsedPath(i)));
            if (!isReadSuccessStatus(usedResp.status)) {
                throw createUnexpectedStatusError(usedResp, 200);
            }
            const used = coerceBoolean(usedResp.data);
            if (used === null) {
                throw createInvalidPayloadError(usedResp, `Expected a boolean for preset slot ${i}.`);
            }
            if (!used) continue;

            const nameResp = await this.withLimiter(host, () => client.get<string>(laPresetNamePath(i)));
            if (!isReadSuccessStatus(nameResp.status)) {
                throw createUnexpectedStatusError(nameResp, 200);
            }
            const name = coerceString(nameResp.data) || `Preset ${i}`;
            targets.push({
                backend: 'la_http',
                deviceId: device.id,
                kind: 'preset',
                index: i,
                name,
            });
        }

        return targets;
    }

    public async getState(target: TargetDescriptor): Promise<TargetState> {
        if (target.backend !== 'la_http') {
            throw new Error('Invalid backend');
        }
        const host = this.getDeviceHost(target.deviceId);
        if (target.kind === 'output') {
            const outputs = await this.getOutputsSnapshot(host);
            const output = pickLaOutput(outputs, target.index);
            if (!output) {
                throw new Error(`Output ${target.index} is missing from device snapshot.`);
            }
            return {
                online: true,
                mute: coerceBoolean(output.mute) ?? undefined,
                levelDb: coerceNumber(output.gain) ?? undefined,
                volume: coerceNumber(output.volume) ?? undefined,
                lastUpdatedMs: Date.now(),
            };
        }
        return {
            online: true,
            lastUpdatedMs: Date.now(),
        };
    }

    public async setMute(target: TargetDescriptor, mute: boolean): Promise<void> {
        if (target.backend !== 'la_http') return;
        if (target.kind !== 'output') return;
        const host = this.getDeviceHost(target.deviceId);
        const client = this.createClient(host);
        const response = await this.withLimiter(host, () => client.post(laOutputMutePath(target.index), mute));
        if (!isPropertyWriteSuccessStatus(response.status)) {
            throw createUnexpectedStatusError(response, [200, 204]);
        }
        this.clearOutputSnapshot(host);
    }

    public async setLevel(target: TargetDescriptor, value: number, mode: LevelMode): Promise<void> {
        if (target.backend !== 'la_http') return;
        if (target.kind !== 'output') return;
        const host = this.getDeviceHost(target.deviceId);
        const client = this.createClient(host);
        if (mode === 'volume') {
            const response = await this.withLimiter(host, () => client.post(laOutputVolumePath(target.index), Math.round(value)));
            if (!isPropertyWriteSuccessStatus(response.status)) {
                throw createUnexpectedStatusError(response, [200, 204]);
            }
        } else {
            const response = await this.withLimiter(host, () => client.post(laOutputGainPath(target.index), value));
            if (!isPropertyWriteSuccessStatus(response.status)) {
                throw createUnexpectedStatusError(response, [200, 204]);
            }
        }
        this.clearOutputSnapshot(host);
    }

    public async recallPreset(device: DeviceDescriptor, index: number): Promise<void> {
        const host = this.getDeviceHost(device);
        const client = this.createClient(host);
        const response = await this.withLimiter(host, () => client.post(laConfigurationLoadPath(), buildLaConfigurationLoadBody(index)));
        if (!isRecallSuccessStatus(response.status)) {
            throw createUnexpectedStatusError(response, 204);
        }
        this.clearOutputSnapshot(host);
    }

    public async getActivePresetIndex(device: DeviceDescriptor): Promise<number | null> {
        const host = this.getDeviceHost(device);
        const client = this.createClient(host);
        const response = await this.withLimiter(host, () => client.get<number>(laActivePresetIndexPath()));
        if (!isReadSuccessStatus(response.status)) {
            throw createUnexpectedStatusError(response, 200);
        }
        const index = coerceNumber(response.data);
        if (index === null) {
            throw createInvalidPayloadError(response, 'Expected a numeric active preset index.');
        }
        return index;
    }

    private buildHostList(): string[] {
        const manualHosts = this.settings.discoveryHosts.map((host) => host.trim()).filter(Boolean);
        if (manualHosts.length > 0) {
            return manualHosts;
        }
        return this.expandSubnet(this.settings.discoverySubnet);
    }

    private expandSubnet(subnet: string): string[] {
        const match = subnet.match(/^(\d+\.\d+\.\d+)\.(\d+)-(\d+)$/);
        if (match) {
            const base = match[1];
            const start = parseInt(match[2], 10);
            const end = parseInt(match[3], 10);
            const hosts: string[] = [];
            for (let i = start; i <= end; i++) {
                hosts.push(`${base}.${i}`);
            }
            return hosts;
        }
        const cidrMatch = subnet.match(/^(\d+\.\d+\.\d+)\.0\/24$/);
        if (cidrMatch) {
            const base = cidrMatch[1];
            return Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`);
        }
        return [];
    }

    private async worker(queue: string[], results: DeviceDescriptor[]) {
        while (queue.length > 0) {
            const host = queue.shift();
            if (!host) return;
            try {
                const client = this.createClient(host);
                const response = await this.withLimiter(host, () => client.get(laInfoPath()));
                if (!isReadSuccessStatus(response.status)) {
                    continue;
                }
                const info = asLaDeviceInfo(response.data);
                if (info) {
                    const name = info.name || host;
                    results.push({
                        id: `la_${host}`,
                        name,
                        backend: 'la_http',
                        address: host,
                        model: info.firmware_version,
                        online: true,
                    });
                } else {
                    this.logDebug(`Ignoring ${host} because /api/info returned an unexpected payload.`);
                }
            } catch (error) {
                this.logDebug(`Ignoring ${host} during discovery: ${formatError(error)}`);
            }
        }
    }

    private createClient(host: string): LaHttpClient {
        return new LaHttpClient(host, this.settings.username, this.settings.password, {
            debug: Boolean(this.settings.debugLogging),
            logger: this.logger,
        });
    }

    private async readOutputs(client: LaHttpClient, host: string): Promise<LaOutputObject[]> {
        const response = await this.withLimiter(host, () => client.get(laOutputsPath()));
        if (!isReadSuccessStatus(response.status)) {
            throw createUnexpectedStatusError(response, 200);
        }
        const outputs = asLaOutputs(response.data);
        if (!outputs) {
            throw createInvalidPayloadError(response, 'Expected an array of output objects.');
        }
        return outputs;
    }

    private async getOutputsSnapshot(host: string): Promise<LaOutputObject[]> {
        const existing = this.outputSnapshots.get(host);
        const now = Date.now();
        if (existing?.outputs && now - existing.timestamp < this.outputSnapshotTtlMs) {
            return existing.outputs;
        }
        if (existing?.promise) {
            return existing.promise;
        }

        const snapshotPromise = this.readOutputs(this.createClient(host), host)
            .then((outputs) => {
                this.outputSnapshots.set(host, {
                    timestamp: Date.now(),
                    outputs,
                    promise: null,
                });
                return outputs;
            })
            .catch((error) => {
                this.outputSnapshots.delete(host);
                throw error;
            });

        this.outputSnapshots.set(host, {
            timestamp: now,
            outputs: existing?.outputs || null,
            promise: snapshotPromise,
        });

        return snapshotPromise;
    }

    private clearOutputSnapshot(host: string) {
        this.outputSnapshots.delete(host);
    }

    private getDeviceHost(device: DeviceDescriptor | string): string {
        if (typeof device === 'string') {
            return device.replace(/^la_/, '');
        }
        return device.address || device.id.replace(/^la_/, '');
    }

    private async withLimiter<T>(limiterKey: string, task: () => Promise<T>): Promise<T> {
        const limiter = this.getLimiter(limiterKey);
        return new Promise<T>((resolve, reject) => {
            const run = () => {
                limiter.active += 1;
                task()
                    .then(resolve)
                    .catch(reject)
                    .finally(() => {
                        limiter.active -= 1;
                        const next = limiter.queue.shift();
                        if (next) next();
                    });
            };
            if (limiter.active < this.maxConcurrency) {
                run();
            } else {
                limiter.queue.push(run);
            }
        });
    }

    private getLimiter(deviceKey: string) {
        const existing = this.limiters.get(deviceKey);
        if (existing) return existing;
        const limiter = { active: 0, queue: [] as Array<() => void> };
        this.limiters.set(deviceKey, limiter);
        return limiter;
    }

    private logDebug(message: string) {
        if (this.settings.debugLogging && this.logger) {
            this.logger(`[LA] ${message}`);
        }
    }
}
