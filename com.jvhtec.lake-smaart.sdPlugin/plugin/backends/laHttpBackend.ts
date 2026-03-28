import { Backend, DeviceDescriptor, LaHttpDeviceProfile, LevelMode, TargetDescriptor, TargetState } from '../core/types';
import { LaHttpClient } from './laHttpClient';
import {
    asAmplifiedOutputs,
    asLaConfigurationLibrary,
    asLaDeviceInfo,
    asP1OutputFamily,
    asP1Outputs,
    buildLaConfigurationLoadBody,
    coerceBoolean,
    coerceNumber,
    coerceString,
    createInvalidPayloadError,
    createUnexpectedStatusError,
    formatError,
    getLaPresetSlotFallbackCount,
    inferLaDeviceProfile,
    isPropertyWriteSuccessStatus,
    isReadSuccessStatus,
    isRecallSuccessStatus,
    laActivePresetIndexPath,
    laAmplifiedOutputsPath,
    laConfigurationLibraryPath,
    laConfigurationLoadPath,
    laInfoPath,
    LaConfigurationSlot,
    LaLogFn,
    LaP1OutputFamily,
    LaResolvedOutput,
    laOutputPropertyPath,
    laP1OutputSettingsPath,
    laPresetNamePath,
    laPresetUsedPath,
    pickResolvedOutput,
} from './laApi';

export interface LaHttpSettings {
    discoverySubnet: string;
    discoveryHosts: string[];
    bindAddress?: string;
    username?: string;
    password?: string;
    debugLogging?: boolean;
}

interface OutputSnapshotCacheEntry {
    timestamp: number;
    outputs: LaResolvedOutput[] | null;
    promise: Promise<LaResolvedOutput[]> | null;
}

const P1_OUTPUT_FAMILIES: LaP1OutputFamily[] = ['ana', 'aes', 'avb', 'mon'];

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
        const previousBindAddress = this.settings.bindAddress;
        const previousDiscoverySubnet = this.settings.discoverySubnet;
        const previousDiscoveryHosts = this.settings.discoveryHosts.join(',');
        this.settings = { ...this.settings, ...settings };
        const nextDiscoveryHosts = this.settings.discoveryHosts.join(',');
        if (
            previousBindAddress !== this.settings.bindAddress ||
            previousDiscoverySubnet !== this.settings.discoverySubnet ||
            previousDiscoveryHosts !== nextDiscoveryHosts
        ) {
            this.outputSnapshots.clear();
        }
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
        const profile = this.getProfileForDevice(device);
        const targets: TargetDescriptor[] = [];

        if (profile !== 'lc16d') {
            const outputs = await this.readOutputs(client, host, profile);
            outputs.forEach((output) => {
                targets.push({
                    backend: 'la_http',
                    deviceId: device.id,
                    kind: 'output',
                    id: output.id,
                    index: output.index,
                    name: output.name,
                    supports: output.supports,
                    path: output.path,
                    profile,
                });
            });
        } else {
            this.logDebug(`${host} is LC16D; exposing configuration slots and skipping unsupported mute/level output targets.`);
        }

        const configurationLibrary = await this.readConfigurationLibrary(client, host, profile);
        configurationLibrary
            .filter((slot) => slot.used)
            .forEach((slot) => {
                targets.push({
                    backend: 'la_http',
                    deviceId: device.id,
                    kind: 'preset',
                    index: slot.index,
                    name: slot.name || `Preset ${slot.index}`,
                    profile,
                });
            });

        return targets;
    }

    public async getState(target: TargetDescriptor): Promise<TargetState> {
        if (target.backend !== 'la_http') {
            throw new Error('Invalid backend');
        }
        const host = this.getDeviceHost(target.deviceId);
        if (target.kind === 'output') {
            const outputs = await this.getOutputsSnapshot(host, target.profile);
            const output = pickResolvedOutput(outputs, target.id);
            if (!output) {
                throw new Error(`Output ${target.id} is missing from the device snapshot.`);
            }
            return {
                online: true,
                mute: coerceBoolean(output.state.mute) ?? undefined,
                levelDb: coerceNumber(output.state.gain) ?? undefined,
                volume: coerceNumber(output.state.volume) ?? undefined,
                lastUpdatedMs: Date.now(),
            };
        }
        return {
            online: true,
            lastUpdatedMs: Date.now(),
        };
    }

    public async setMute(target: TargetDescriptor, mute: boolean): Promise<void> {
        if (target.backend !== 'la_http' || target.kind !== 'output') return;
        if (!target.supports.includes('mute')) {
            throw new Error(`Target ${target.name} does not support mute control.`);
        }
        const host = this.getDeviceHost(target.deviceId);
        const client = this.createClient(host);
        const response = await this.withLimiter(host, () => client.post(laOutputPropertyPath(target.path, 'mute'), mute));
        if (!isPropertyWriteSuccessStatus(response.status)) {
            throw createUnexpectedStatusError(response, [200, 204]);
        }
        this.clearOutputSnapshot(host);
    }

    public async setLevel(target: TargetDescriptor, value: number, mode: LevelMode): Promise<void> {
        if (target.backend !== 'la_http' || target.kind !== 'output') return;
        const host = this.getDeviceHost(target.deviceId);
        const client = this.createClient(host);

        if (mode === 'volume') {
            if (!target.supports.includes('volume')) {
                throw new Error(`Target ${target.name} does not support volume control.`);
            }
            const response = await this.withLimiter(host, () => client.post(laOutputPropertyPath(target.path, 'volume'), Math.round(value)));
            if (!isPropertyWriteSuccessStatus(response.status)) {
                throw createUnexpectedStatusError(response, [200, 204]);
            }
        } else {
            if (!target.supports.includes('level')) {
                throw new Error(`Target ${target.name} does not support gain control.`);
            }
            const response = await this.withLimiter(host, () => client.post(laOutputPropertyPath(target.path, 'gain'), value));
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
        if (!this.settings.discoverySubnet) {
            this.logDebug('No LA discovery subnet resolved; skipping subnet scan.');
            return [];
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
                    const displayName = info.unit_name || info.name || host;
                    const model = info.name || info.firmware_version || undefined;
                    const profile = inferLaDeviceProfile(info.name);
                    results.push({
                        id: `la_${host}`,
                        name: displayName,
                        backend: 'la_http',
                        address: host,
                        model,
                        online: true,
                    });
                    this.logDebug(`Discovered ${host} as ${displayName}${model ? ` [${model}]` : ''} (${profile}).`);
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
            localAddress: this.settings.bindAddress,
        });
    }

    private getProfileForDevice(device: DeviceDescriptor): LaHttpDeviceProfile {
        return inferLaDeviceProfile(device.model || device.name);
    }

    private async readOutputs(client: LaHttpClient, host: string, profile: LaHttpDeviceProfile): Promise<LaResolvedOutput[]> {
        if (profile === 'p1') {
            return this.readP1Outputs(client, host);
        }
        if (profile === 'lc16d') {
            return [];
        }
        if (profile === 'unknown') {
            try {
                return await this.readP1Outputs(client, host);
            } catch (error) {
                this.logDebug(`Unknown LA profile on ${host}; P1 output probe failed (${formatError(error)}), trying amplified outputs.`);
            }
        }
        return this.readAmplifiedOutputs(client, host);
    }

    private async readAmplifiedOutputs(client: LaHttpClient, host: string): Promise<LaResolvedOutput[]> {
        const response = await this.withLimiter(host, () => client.get(laAmplifiedOutputsPath()));
        if (!isReadSuccessStatus(response.status)) {
            throw createUnexpectedStatusError(response, 200);
        }
        const outputs = asAmplifiedOutputs(response.data);
        if (!outputs) {
            throw createInvalidPayloadError(response, 'Expected an array of amplified-controller output objects.');
        }
        return outputs;
    }

    private async readP1Outputs(client: LaHttpClient, host: string): Promise<LaResolvedOutput[]> {
        const response = await this.withLimiter(host, () => client.get(laP1OutputSettingsPath()));
        if (isReadSuccessStatus(response.status)) {
            const outputs = asP1Outputs(response.data);
            if (outputs) {
                return outputs;
            }
            this.logDebug(`${host} returned an unexpected /api/output/settings payload; falling back to per-family reads.`);
        } else if (response.status !== 404) {
            throw createUnexpectedStatusError(response, 200);
        } else {
            this.logDebug(`${host} returned 404 for /api/output/settings; falling back to per-family reads.`);
        }

        const outputs: LaResolvedOutput[] = [];
        for (const family of P1_OUTPUT_FAMILIES) {
            const familyPath = laP1OutputSettingsPath(family);
            const familyResponse = await this.withLimiter(host, () => client.get(familyPath));
            if (familyResponse.status === 404) {
                continue;
            }
            if (!isReadSuccessStatus(familyResponse.status)) {
                throw createUnexpectedStatusError(familyResponse, 200);
            }
            const familyOutputs = asP1OutputFamily(family, familyResponse.data);
            if (!familyOutputs) {
                throw createInvalidPayloadError(familyResponse, `Expected an array of ${family.toUpperCase()} output objects.`);
            }
            outputs.push(...familyOutputs);
        }

        if (outputs.length === 0) {
            throw new Error('No P1 output settings were returned by /api/output/settings.');
        }

        return outputs;
    }

    private async readConfigurationLibrary(
        client: LaHttpClient,
        host: string,
        profile: LaHttpDeviceProfile
    ): Promise<LaConfigurationSlot[]> {
        const response = await this.withLimiter(host, () => client.get(laConfigurationLibraryPath()));
        if (isReadSuccessStatus(response.status)) {
            const library = safeParseConfigurationLibrary(response.data);
            if (library) {
                return library;
            }
            this.logDebug(`${host} returned an unexpected configuration library payload; falling back to per-slot reads.`);
        } else if (response.status !== 404) {
            throw createUnexpectedStatusError(response, 200);
        } else {
            this.logDebug(`${host} returned 404 for /api/configuration/library; falling back to per-slot reads.`);
        }

        return this.readConfigurationLibraryIndividually(client, host, profile);
    }

    private async readConfigurationLibraryIndividually(
        client: LaHttpClient,
        host: string,
        profile: LaHttpDeviceProfile
    ): Promise<LaConfigurationSlot[]> {
        const slots: LaConfigurationSlot[] = [];
        const maxSlots = getLaPresetSlotFallbackCount(profile);
        for (let i = 1; i <= maxSlots; i++) {
            const usedResp = await this.withLimiter(host, () => client.get<boolean>(laPresetUsedPath(i)));
            if (!isReadSuccessStatus(usedResp.status)) {
                throw createUnexpectedStatusError(usedResp, 200);
            }
            const used = coerceBoolean(usedResp.data);
            if (used === null) {
                throw createInvalidPayloadError(usedResp, `Expected a boolean for preset slot ${i}.`);
            }

            let name: string | undefined;
            if (used) {
                const nameResp = await this.withLimiter(host, () => client.get<string>(laPresetNamePath(i)));
                if (!isReadSuccessStatus(nameResp.status)) {
                    throw createUnexpectedStatusError(nameResp, 200);
                }
                name = coerceString(nameResp.data) || `Preset ${i}`;
            }

            slots.push({
                index: i,
                used,
                name,
            });
        }
        return slots;
    }

    private async getOutputsSnapshot(host: string, profile: LaHttpDeviceProfile): Promise<LaResolvedOutput[]> {
        const existing = this.outputSnapshots.get(host);
        const now = Date.now();
        if (existing?.outputs && now - existing.timestamp < this.outputSnapshotTtlMs) {
            return existing.outputs;
        }
        if (existing?.promise) {
            return existing.promise;
        }

        const snapshotPromise = this.readOutputs(this.createClient(host), host, profile)
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

function safeParseConfigurationLibrary(value: unknown): LaConfigurationSlot[] | null {
    try {
        return asLaConfigurationLibrary(value);
    } catch {
        return null;
    }
}
