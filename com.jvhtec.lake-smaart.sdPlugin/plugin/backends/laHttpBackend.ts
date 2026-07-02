import { Backend, DeviceDescriptor, LaHttpDeviceProfile, LevelMode, TargetDescriptor, TargetState } from '../core/types';
import { LaHttpClient } from './laHttpClient';
import {
    asAmplifiedOutputs,
    asLaConfigurationLibrary,
    asLaDeviceInfo,
    asP1InputFamily,
    asP1Inputs,
    asP1MplInput,
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
    laControlPropertyPath,
    laConfigurationLibraryPath,
    laConfigurationLoadPath,
    laInfoPath,
    LaConfigurationSlot,
    LaLogFn,
    LaP1IndexedInputFamily,
    LaResolvedControlTarget,
    laP1InputSettingsPath,
    laPresetNamePath,
    laPresetUsedPath,
    pickResolvedControlTarget,
} from './laApi';

type LaControlTargetDescriptor = Extract<TargetDescriptor, { backend: 'la_http'; kind: 'input' | 'output' }>;

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
    outputs: LaResolvedControlTarget[] | null;
    promise: Promise<LaResolvedControlTarget[]> | null;
}

const P1_INPUT_FAMILIES: LaP1IndexedInputFamily[] = ['ana', 'aes', 'avb', 'mic'];

interface P1InputGroupDefinition {
    id: string;
    name: string;
    family: LaP1IndexedInputFamily;
    memberIds: string[];
}

const P1_INPUT_GROUPS: P1InputGroupDefinition[] = [
    {
        id: 'group:ana:1-4',
        name: 'Analog Inputs 1-4',
        family: 'ana',
        memberIds: buildIndexedMemberIds('ana', 1, 4),
    },
    {
        id: 'group:aes:1-4',
        name: 'AES Inputs 1-4',
        family: 'aes',
        memberIds: buildIndexedMemberIds('aes', 1, 4),
    },
    {
        id: 'group:avb:1-4',
        name: 'AVB Inputs 1-4',
        family: 'avb',
        memberIds: buildIndexedMemberIds('avb', 1, 4),
    },
    {
        id: 'group:avb:5-8',
        name: 'AVB Inputs 5-8',
        family: 'avb',
        memberIds: buildIndexedMemberIds('avb', 5, 8),
    },
];

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
                    kind: output.kind,
                    id: output.id,
                    index: output.index,
                    name: output.name,
                    supports: output.supports,
                    path: output.path,
                    profile,
                    family: output.family,
                });
            });
            this.buildP1GroupedInputTargets(device.id, outputs, profile).forEach((target) => {
                targets.push(target);
            });
        } else {
            this.logDebug(`${host} is LC16D; exposing configuration slots and skipping unsupported mute/level control targets.`);
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
        if (target.kind !== 'preset') {
            const outputs = await this.getOutputsSnapshot(host, target.profile);
            if (Array.isArray(target.memberIds) && target.memberIds.length > 0) {
                const groupedMembers = this.resolveGroupedMembers(outputs, target);
                if (!groupedMembers) {
                    throw new Error(`Grouped control target ${target.id} is missing one or more member inputs from the device snapshot.`);
                }
                const muteStates = groupedMembers.map((member) => coerceBoolean(member.state.mute));
                const gainValues = groupedMembers
                    .map((member) => coerceNumber(member.state.gain))
                    .filter((value): value is number => value !== null);
                return {
                    online: true,
                    mute: muteStates.every((state) => state !== null) ? muteStates.every((state) => state === true) : undefined,
                    levelDb: gainValues.length > 0
                        ? gainValues.reduce((sum, value) => sum + value, 0) / gainValues.length
                        : undefined,
                    lastUpdatedMs: Date.now(),
                };
            }
            const output = pickResolvedControlTarget(outputs, target.id);
            if (!output) {
                throw new Error(`Control target ${target.id} is missing from the device snapshot.`);
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
        if (target.backend !== 'la_http' || target.kind === 'preset') return;
        if (!target.supports.includes('mute')) {
            throw new Error(`Target ${target.name} does not support mute control.`);
        }
        const host = this.getDeviceHost(target.deviceId);
        const client = this.createClient(host);
        if (Array.isArray(target.memberIds) && target.memberIds.length > 0) {
            const outputs = await this.getOutputsSnapshot(host, target.profile);
            const groupedMembers = this.resolveGroupedMembers(outputs, target);
            if (!groupedMembers) {
                throw new Error(`Grouped control target ${target.id} is missing one or more member inputs from the device snapshot.`);
            }
            await Promise.all(
                groupedMembers.map(async (member) => {
                    const response = await this.withLimiter(host, () => client.post(laControlPropertyPath(member.path, 'mute'), mute));
                    if (!isPropertyWriteSuccessStatus(response.status)) {
                        throw createUnexpectedStatusError(response, [200, 204]);
                    }
                })
            );
            this.clearOutputSnapshot(host);
            return;
        }
        const response = await this.withLimiter(host, () => client.post(laControlPropertyPath(target.path, 'mute'), mute));
        if (!isPropertyWriteSuccessStatus(response.status)) {
            throw createUnexpectedStatusError(response, [200, 204]);
        }
        this.clearOutputSnapshot(host);
    }

    public async setLevel(target: TargetDescriptor, value: number, mode: LevelMode): Promise<void> {
        if (target.backend !== 'la_http' || target.kind === 'preset') return;
        const host = this.getDeviceHost(target.deviceId);
        const client = this.createClient(host);
        const property = mode === 'volume' ? 'volume' : 'gain';

        if (Array.isArray(target.memberIds) && target.memberIds.length > 0) {
            const outputs = await this.getOutputsSnapshot(host, target.profile);
            const groupedMembers = this.resolveGroupedMembers(outputs, target);
            if (!groupedMembers) {
                throw new Error(`Grouped control target ${target.id} is missing one or more member inputs from the device snapshot.`);
            }

            await Promise.all(
                groupedMembers.map(async (member) => {
                    const payload = mode === 'volume' ? Math.round(value) : value;
                    const response = await this.withLimiter(host, () => client.post(laControlPropertyPath(member.path, property), payload));
                    if (!isPropertyWriteSuccessStatus(response.status)) {
                        throw createUnexpectedStatusError(response, [200, 204]);
                    }
                })
            );

            this.clearOutputSnapshot(host);
            return;
        }

        if (mode === 'volume') {
            if (!target.supports.includes('volume')) {
                throw new Error(`Target ${target.name} does not support volume control.`);
            }
            const response = await this.withLimiter(host, () => client.post(laControlPropertyPath(target.path, 'volume'), Math.round(value)));
            if (!isPropertyWriteSuccessStatus(response.status)) {
                throw createUnexpectedStatusError(response, [200, 204]);
            }
        } else {
            if (!target.supports.includes('level')) {
                throw new Error(`Target ${target.name} does not support gain control.`);
            }
            const response = await this.withLimiter(host, () => client.post(laControlPropertyPath(target.path, 'gain'), value));
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
        const hosts = expandLaDiscoverySubnet(subnet);
        if (!hosts) {
            this.logDebug(
                `Unsupported LA discovery subnet "${subnet}"; use CIDR /24../32 (e.g. 192.168.1.0/24) or a range (e.g. 192.168.1.20-40).`
            );
            return [];
        }
        return hosts;
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

    private async readOutputs(client: LaHttpClient, host: string, profile: LaHttpDeviceProfile): Promise<LaResolvedControlTarget[]> {
        if (profile === 'p1') {
            return this.readP1Inputs(client, host);
        }
        if (profile === 'lc16d') {
            return [];
        }
        if (profile === 'unknown') {
            try {
                return await this.readP1Inputs(client, host);
            } catch (error) {
                this.logDebug(`Unknown LA profile on ${host}; P1 input probe failed (${formatError(error)}), trying amplified outputs.`);
            }
        }
        return this.readAmplifiedOutputs(client, host);
    }

    private async readAmplifiedOutputs(client: LaHttpClient, host: string): Promise<LaResolvedControlTarget[]> {
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

    private async readP1Inputs(client: LaHttpClient, host: string): Promise<LaResolvedControlTarget[]> {
        const response = await this.withLimiter(host, () => client.get(laP1InputSettingsPath()));
        if (isReadSuccessStatus(response.status)) {
            const outputs = asP1Inputs(response.data);
            if (outputs) {
                return outputs;
            }
            this.logDebug(`${host} returned an unexpected /api/input/settings payload; falling back to per-family reads.`);
        } else if (response.status !== 404) {
            throw createUnexpectedStatusError(response, 200);
        } else {
            this.logDebug(`${host} returned 404 for /api/input/settings; falling back to per-family reads.`);
        }

        const outputs: LaResolvedControlTarget[] = [];
        for (const family of P1_INPUT_FAMILIES) {
            const familyPath = laP1InputSettingsPath(family);
            const familyResponse = await this.withLimiter(host, () => client.get(familyPath));
            if (familyResponse.status === 404) {
                continue;
            }
            if (!isReadSuccessStatus(familyResponse.status)) {
                throw createUnexpectedStatusError(familyResponse, 200);
            }
            const familyOutputs = asP1InputFamily(family, familyResponse.data);
            if (!familyOutputs) {
                throw createInvalidPayloadError(familyResponse, `Expected an array of ${family.toUpperCase()} input objects.`);
            }
            outputs.push(...familyOutputs);
        }

        const mplResponse = await this.withLimiter(host, () => client.get(laP1InputSettingsPath('mpl')));
        if (mplResponse.status !== 404) {
            if (!isReadSuccessStatus(mplResponse.status)) {
                throw createUnexpectedStatusError(mplResponse, 200);
            }
            const mplInput = asP1MplInput(mplResponse.data);
            if (!mplInput) {
                throw createInvalidPayloadError(mplResponse, 'Expected an MPL input control object.');
            }
            outputs.push(mplInput);
        }

        if (outputs.length === 0) {
            throw new Error('No P1 input settings were returned by /api/input/settings.');
        }

        return outputs;
    }

    private buildP1GroupedInputTargets(
        deviceId: string,
        outputs: LaResolvedControlTarget[],
        profile: LaHttpDeviceProfile
    ): LaControlTargetDescriptor[] {
        const isP1LikeProfile =
            profile === 'p1' ||
            outputs.some((output) => output.kind === 'input' && typeof output.family === 'string' && P1_INPUT_FAMILIES.includes(output.family as LaP1IndexedInputFamily));

        if (!isP1LikeProfile) {
            return [];
        }

        return P1_INPUT_GROUPS
            .map((group) => {
                const members = group.memberIds.map((memberId) => pickResolvedControlTarget(outputs, memberId));
                if (members.some((member) => !member)) {
                    return null;
                }

                return {
                    backend: 'la_http' as const,
                    deviceId,
                    kind: 'input' as const,
                    id: group.id,
                    name: group.name,
                    supports: ['mute', 'level'] as Array<'mute' | 'level'>,
                    path: members[0]?.path || laP1InputSettingsPath(group.family, 1),
                    profile,
                    family: group.family,
                    memberIds: group.memberIds.slice(),
                };
            })
            .filter(Boolean) as LaControlTargetDescriptor[];
    }

    private resolveGroupedMembers(outputs: LaResolvedControlTarget[], target: LaControlTargetDescriptor): LaResolvedControlTarget[] | null {
        if (!Array.isArray(target.memberIds) || target.memberIds.length === 0) {
            return null;
        }

        const members = target.memberIds.map((memberId) => pickResolvedControlTarget(outputs, memberId));
        if (members.some((member) => !member)) {
            return null;
        }

        return members as LaResolvedControlTarget[];
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

    private async getOutputsSnapshot(host: string, profile: LaHttpDeviceProfile): Promise<LaResolvedControlTarget[]> {
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

/**
 * Expands an LA discovery subnet into scan hosts. Supports last-octet ranges
 * ("192.168.1.20-40") and CIDR prefixes /24../32. Returns null when the format
 * is unsupported (prefixes below /24 are refused to avoid huge scans).
 */
export function expandLaDiscoverySubnet(subnet: string): string[] | null {
    const trimmed = subnet.trim();

    const rangeMatch = trimmed.match(/^(\d+\.\d+\.\d+)\.(\d+)-(\d+)$/);
    if (rangeMatch) {
        const base = rangeMatch[1];
        const start = parseInt(rangeMatch[2], 10);
        const end = parseInt(rangeMatch[3], 10);
        if (start > end || end > 255) {
            return null;
        }
        const hosts: string[] = [];
        for (let i = start; i <= end; i++) {
            hosts.push(`${base}.${i}`);
        }
        return hosts;
    }

    const cidrMatch = trimmed.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
    if (!cidrMatch) {
        return null;
    }
    const baseInt = ipv4ToUint(cidrMatch[1]);
    const prefixLength = parseInt(cidrMatch[2], 10);
    if (baseInt === null || prefixLength < 24 || prefixLength > 32) {
        return null;
    }
    if (prefixLength === 32) {
        return [uintToIpv4(baseInt)];
    }

    const mask = (0xffffffff << (32 - prefixLength)) >>> 0;
    const network = (baseInt & mask) >>> 0;
    const broadcast = (network | (~mask >>> 0)) >>> 0;
    if (prefixLength === 31) {
        return [uintToIpv4(network), uintToIpv4(broadcast)];
    }

    const hosts: string[] = [];
    for (let address = network + 1; address < broadcast; address++) {
        hosts.push(uintToIpv4(address));
    }
    return hosts;
}

function ipv4ToUint(address: string): number | null {
    const octets = address.split('.');
    if (octets.length !== 4) {
        return null;
    }
    let value = 0;
    for (const octet of octets) {
        const numeric = Number(octet);
        if (!Number.isInteger(numeric) || numeric < 0 || numeric > 255) {
            return null;
        }
        value = ((value << 8) | numeric) >>> 0;
    }
    return value >>> 0;
}

function uintToIpv4(value: number): string {
    return [
        (value >>> 24) & 255,
        (value >>> 16) & 255,
        (value >>> 8) & 255,
        value & 255,
    ].join('.');
}

function safeParseConfigurationLibrary(value: unknown): LaConfigurationSlot[] | null {
    try {
        return asLaConfigurationLibrary(value);
    } catch {
        return null;
    }
}

function buildIndexedMemberIds(family: LaP1IndexedInputFamily, start: number, end: number): string[] {
    return Array.from({ length: end - start + 1 }, (_, offset) => `${family}:${start + offset}`);
}
