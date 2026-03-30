import { Backend, DeviceDescriptor, InputPriorityMode, LevelMode, TargetDescriptor, TargetState } from '../core/types';
import { DlmClient, DlmDiscoveredUnit } from '../lake/dlmClient';
import {
    buildGetForceInputPriority,
    buildGetGain,
    buildGetMute,
    buildGetOutputChannels,
    buildGetOutputMute,
    buildRecallPreset,
    buildSetForceInputPriority,
    buildSetGain,
    buildSetMute,
    buildSetOutputMute,
} from '../lake/dlmCommands';
import { GROUPS, ModuleId } from '../lake/lakeModel';

export interface LakeSettings {
    host: string;
    port: number;
    bindAddress?: string;
    bindNetmask?: string;
    debug?: boolean;
}

export class LakeBackend implements Backend {
    public readonly id = 'lake' as const;

    private static readonly KNOWN_UNIT_TTL_MS = 30000;
    private static readonly MAX_ROUTER_INDEX = 16;
    private static readonly ALL_ROUTERS_TARGET_ID = 'ALL';

    private client: DlmClient;
    private settings: LakeSettings;
    private unitsByDeviceId = new Map<string, DlmDiscoveredUnit>();
    private outputChannelCountsByDeviceId = new Map<string, Map<ModuleId, number>>();
    private routerIdsByDeviceId = new Map<string, number[]>();
    private routerProbeInFlight = new Map<string, Promise<number[]>>();

    constructor(client: DlmClient, settings: LakeSettings) {
        this.client = client;
        this.settings = settings;
        this.client.updateConfig({
            host: settings.host,
            port: settings.port,
            bindAddress: settings.bindAddress,
            bindNetmask: settings.bindNetmask,
            debug: settings.debug,
        });
    }

    public updateSettings(settings: Partial<LakeSettings>) {
        const previousHost = this.settings.host;
        const previousPort = this.settings.port;
        const previousBindAddress = this.settings.bindAddress;
        const previousBindNetmask = this.settings.bindNetmask;
        this.settings = { ...this.settings, ...settings };
        this.client.updateConfig({
            host: this.settings.host,
            port: this.settings.port,
            bindAddress: this.settings.bindAddress,
            bindNetmask: this.settings.bindNetmask,
            debug: this.settings.debug,
        });
        if (
            previousHost !== this.settings.host ||
            previousPort !== this.settings.port ||
            previousBindAddress !== this.settings.bindAddress ||
            previousBindNetmask !== this.settings.bindNetmask
        ) {
            this.unitsByDeviceId.clear();
            this.outputChannelCountsByDeviceId.clear();
            this.routerIdsByDeviceId.clear();
            this.routerProbeInFlight.clear();
        }
    }

    public async discover(): Promise<DeviceDescriptor[]> {
        const discovered = await this.client.discoverUnits();
        const units = discovered.length > 0
            ? discovered
            : this.client.getKnownUnits().filter((unit) => Date.now() - unit.lastSeenMs < LakeBackend.KNOWN_UNIT_TTL_MS);

        this.unitsByDeviceId.clear();
        const nextDeviceIds = new Set<string>();

        const devices = units.map((unit) => {
            const deviceId = `lake:${unit.frameId}`;
            nextDeviceIds.add(deviceId);
            this.unitsByDeviceId.set(deviceId, unit);

            return {
                id: deviceId,
                name: `${unit.model} (${unit.ip})`,
                backend: 'lake' as const,
                address: unit.ip,
                model: unit.model,
                online: true,
            };
        });

        for (const deviceId of Array.from(this.routerIdsByDeviceId.keys())) {
            if (!nextDeviceIds.has(deviceId)) {
                this.outputChannelCountsByDeviceId.delete(deviceId);
                this.routerIdsByDeviceId.delete(deviceId);
            }
        }
        for (const deviceId of Array.from(this.routerProbeInFlight.keys())) {
            if (!nextDeviceIds.has(deviceId)) {
                this.routerProbeInFlight.delete(deviceId);
            }
        }

        return devices;
    }

    public async getTargets(device: DeviceDescriptor): Promise<TargetDescriptor[]> {
        const modules: ModuleId[] = ['A', 'B', 'C', 'D'];
        const targets: TargetDescriptor[] = modules.map((module) => ({
            backend: 'lake',
            deviceId: device.id,
            kind: 'module',
            id: module,
            name: `Module ${module}`,
            supports: ['mute', 'level'],
        }));

        Object.values(GROUPS).forEach((group) => {
            const name = group.name === 'ALL'
                ? 'All Modules'
                : group.name === 'LR'
                    ? 'Modules A+B'
                    : `Group ${group.name}`;
            targets.push({
                backend: 'lake',
                deviceId: device.id,
                kind: 'group',
                id: group.name,
                name,
                supports: ['mute', 'level'],
            });
        });

        for (let i = 1; i <= 10; i++) {
            targets.push({
                backend: 'lake',
                deviceId: device.id,
                kind: 'preset',
                id: String(i),
                name: `Preset ${i}`,
            });
        }

        const unit = this.unitsByDeviceId.get(device.id) || this.client.getKnownUnits().find((knownUnit) => `lake:${knownUnit.frameId}` === device.id);
        if (unit) {
            const routerIds = await this.getRouterIds(device.id, unit);
            if (routerIds.length > 1) {
                targets.push({
                    backend: 'lake',
                    deviceId: device.id,
                    kind: 'router',
                    id: LakeBackend.ALL_ROUTERS_TARGET_ID,
                    name: 'All Routers',
                    supports: ['priority'],
                });
            }
            routerIds.forEach((routerIndex) => {
                targets.push({
                    backend: 'lake',
                    deviceId: device.id,
                    kind: 'router',
                    id: String(routerIndex),
                    routerIndex,
                    name: `Router ${routerIndex}`,
                    supports: ['priority'],
                });
            });
        }

        return targets;
    }

    public async getState(target: TargetDescriptor): Promise<TargetState> {
        if (target.backend !== 'lake') {
            throw new Error('Invalid backend');
        }

        const unit = this.getUnitForTarget(target);
        if (!unit) {
            throw new Error(`Lake unit not found for ${target.deviceId}`);
        }

        if (target.kind === 'module') {
            const mute = await this.readOutputMute(unit, target.deviceId, target.id as ModuleId);
            const gain = await this.readGain(unit, target.id as ModuleId);
            return {
                online: true,
                mute: mute ?? undefined,
                levelDb: gain ?? undefined,
                lastUpdatedMs: Date.now(),
            };
        }

        if (target.kind === 'group') {
            const group = GROUPS[target.id];
            const mutes = await Promise.all(
                group.muteMembers.map((member) => this.readOutputMute(unit, target.deviceId, member.module))
            );
            const gains = await Promise.all(group.gainMembers.map((member) => this.readGain(unit, member.module)));
            const muteState = mutes.every((mute) => mute === true);
            const validGains = gains.filter((gain): gain is number => gain != null);
            const gainAverage = validGains.length > 0
                ? validGains.reduce((sum, value) => sum + value, 0) / validGains.length
                : undefined;

            return {
                online: true,
                mute: muteState,
                levelDb: gainAverage,
                lastUpdatedMs: Date.now(),
            };
        }

        if (target.kind === 'router') {
            const priorityMode = await this.readTargetPriorityMode(unit, target);
            return {
                online: true,
                priorityMode: priorityMode ?? undefined,
                lastUpdatedMs: Date.now(),
            };
        }

        return {
            online: true,
            lastUpdatedMs: Date.now(),
        };
    }

    public async setMute(target: TargetDescriptor, mute: boolean): Promise<void> {
        if (target.backend !== 'lake') {
            return;
        }

        const unit = this.getUnitForTarget(target);
        if (!unit) {
            throw new Error(`Lake unit not found for ${target.deviceId}`);
        }

        if (target.kind === 'module') {
            await this.setOutputMute(unit, target.deviceId, target.id as ModuleId, mute);
            return;
        }

        if (target.kind === 'group') {
            const group = GROUPS[target.id];
            await Promise.all(
                group.muteMembers.map((member) => this.setOutputMute(unit, target.deviceId, member.module, mute))
            );
        }
    }

    public async setLevel(target: TargetDescriptor, value: number, _mode: LevelMode): Promise<void> {
        if (target.backend !== 'lake') {
            return;
        }

        const unit = this.getUnitForTarget(target);
        if (!unit) {
            throw new Error(`Lake unit not found for ${target.deviceId}`);
        }

        if (target.kind === 'module') {
            await this.client.send(buildSetGain(target.id, value), unit);
            return;
        }

        if (target.kind === 'group') {
            const group = GROUPS[target.id];
            await Promise.all(group.gainMembers.map((member) => this.client.send(buildSetGain(member.module, value), unit)));
        }
    }

    public async setPriority(target: TargetDescriptor, value: InputPriorityMode): Promise<void> {
        if (target.backend !== 'lake' || target.kind !== 'router') {
            return;
        }

        const unit = this.getUnitForTarget(target);
        if (!unit) {
            throw new Error(`Lake unit not found for ${target.deviceId}`);
        }

        const routerIds = await this.getTargetRouterIds(target, unit);
        if (routerIds.length === 0) {
            throw new Error(`Invalid Lake router target ${target.id}`);
        }

        await Promise.all(
            routerIds.map((routerIndex) => this.client.send(buildSetForceInputPriority(routerIndex, value), unit))
        );
    }

    public async recallPreset(device: DeviceDescriptor, index: number): Promise<void> {
        const unit = this.unitsByDeviceId.get(device.id);
        if (!unit) {
            throw new Error(`Lake unit not found for ${device.id}`);
        }

        await this.client.send(buildRecallPreset(index), unit, 2, 1500);
    }

    private async readMute(unit: DlmDiscoveredUnit, module: ModuleId): Promise<boolean | null> {
        try {
            const response = await this.client.send(buildGetMute(module), unit, 1, 1000);
            if (!response) {
                return null;
            }
            return parseMutePayload(response.payload);
        } catch {
            return null;
        }
    }

    private async readOutputMute(unit: DlmDiscoveredUnit, deviceId: string, module: ModuleId): Promise<boolean | null> {
        const channels = await this.getOutputChannels(deviceId, unit, module);
        if (channels.length === 0) {
            return this.readMute(unit, module);
        }

        const mutes = await Promise.all(
            channels.map(async (channel) => {
                try {
                    const response = await this.client.send(buildGetOutputMute(module, channel), unit, 1, 1000);
                    return response ? parseMutePayload(response.payload) : null;
                } catch {
                    return null;
                }
            })
        );

        const validMutes = mutes.filter((value): value is boolean => value !== null);
        if (validMutes.length === 0) {
            return this.readMute(unit, module);
        }

        return validMutes.every((value) => value === true);
    }

    private async readGain(unit: DlmDiscoveredUnit, module: ModuleId): Promise<number | null> {
        try {
            const response = await this.client.send(buildGetGain(module), unit, 1, 1000);
            if (!response) {
                return null;
            }
            return parseGainPayload(response.payload);
        } catch {
            return null;
        }
    }

    private async readForceInputPriority(unit: DlmDiscoveredUnit, routerIndex: number): Promise<InputPriorityMode | null> {
        try {
            const response = await this.client.send(buildGetForceInputPriority(routerIndex), unit, 1, 1000);
            if (!response) {
                return null;
            }
            return parsePriorityPayload(response.payload);
        } catch {
            return null;
        }
    }

    private async setOutputMute(unit: DlmDiscoveredUnit, deviceId: string, module: ModuleId, mute: boolean) {
        const channels = await this.getOutputChannels(deviceId, unit, module);
        if (channels.length === 0) {
            await this.client.send(buildSetMute(module, mute), unit);
            return;
        }

        await Promise.all(
            channels.map((channel) => this.client.send(buildSetOutputMute(module, channel, mute), unit))
        );
    }

    private async getOutputChannels(deviceId: string, unit: DlmDiscoveredUnit, module: ModuleId): Promise<number[]> {
        const cachedDeviceChannels = this.outputChannelCountsByDeviceId.get(deviceId);
        const cachedCount = cachedDeviceChannels?.get(module);
        if (cachedCount !== undefined) {
            return buildChannelIndexList(cachedCount);
        }

        try {
            const response = await this.client.send(buildGetOutputChannels(module), unit, 1, 1000);
            const count = parseChannelCountPayload(response?.payload || '');
            if (count <= 0) {
                return [];
            }

            const nextCache = cachedDeviceChannels || new Map<ModuleId, number>();
            nextCache.set(module, count);
            this.outputChannelCountsByDeviceId.set(deviceId, nextCache);
            return buildChannelIndexList(count);
        } catch {
            return [];
        }
    }

    private async getRouterIds(deviceId: string, unit: DlmDiscoveredUnit): Promise<number[]> {
        const cached = this.routerIdsByDeviceId.get(deviceId);
        if (cached) {
            return cached;
        }

        const pending = this.routerProbeInFlight.get(deviceId);
        if (pending) {
            return pending;
        }

        const probe = this.probeRouterIds(unit).finally(() => {
            this.routerProbeInFlight.delete(deviceId);
        });
        this.routerProbeInFlight.set(deviceId, probe);

        const routerIds = await probe;
        this.routerIdsByDeviceId.set(deviceId, routerIds);
        return routerIds;
    }

    private async probeRouterIds(unit: DlmDiscoveredUnit): Promise<number[]> {
        const routerIds: number[] = [];
        let consecutiveMisses = 0;

        for (let routerIndex = 1; routerIndex <= LakeBackend.MAX_ROUTER_INDEX; routerIndex++) {
            const priorityMode = await this.probeForceInputPriority(unit, routerIndex);
            if (priorityMode) {
                routerIds.push(routerIndex);
                consecutiveMisses = 0;
                continue;
            }

            consecutiveMisses++;
            if (routerIds.length > 0 && consecutiveMisses >= 2) {
                break;
            }
        }

        return routerIds;
    }

    private async probeForceInputPriority(unit: DlmDiscoveredUnit, routerIndex: number): Promise<InputPriorityMode | null> {
        try {
            const response = await this.client.send(buildGetForceInputPriority(routerIndex), unit, 0, 250);
            if (!response) {
                return null;
            }
            return parsePriorityPayload(response.payload);
        } catch {
            return null;
        }
    }

    private async readTargetPriorityMode(unit: DlmDiscoveredUnit, target: TargetDescriptor): Promise<InputPriorityMode | null> {
        const routerIds = await this.getTargetRouterIds(target, unit);
        if (routerIds.length === 0) {
            return null;
        }

        const modes = await Promise.all(
            routerIds.map((routerIndex) => this.readForceInputPriority(unit, routerIndex))
        );
        const validModes = modes.filter((mode): mode is InputPriorityMode => mode !== null);
        if (validModes.length !== routerIds.length) {
            return null;
        }

        return validModes.every((mode) => mode === validModes[0]) ? validModes[0] : null;
    }

    private async getTargetRouterIds(target: TargetDescriptor, unit: DlmDiscoveredUnit): Promise<number[]> {
        if (target.kind !== 'router') {
            return [];
        }

        if (target.id === LakeBackend.ALL_ROUTERS_TARGET_ID) {
            return this.getRouterIds(target.deviceId, unit);
        }

        const routerIndex = target.routerIndex ?? parseInt(target.id, 10);
        if (Number.isNaN(routerIndex) || routerIndex < 1) {
            return [];
        }

        return [routerIndex];
    }

    private getUnitForTarget(target: TargetDescriptor) {
        return this.unitsByDeviceId.get(target.deviceId) || this.client.getKnownUnits().find((unit) => `lake:${unit.frameId}` === target.deviceId);
    }
}

function parseMutePayload(payload: string): boolean | null {
    const matches = Array.from(payload.matchAll(/\b([01])\b/g)).map((match) => match[1]);
    if (matches.length === 0) {
        return null;
    }

    return matches[matches.length - 1] === '1';
}

function parseGainPayload(payload: string): number | null {
    const match = payload.match(/[-+]?\d+(?:\.\d+)?/);
    if (!match) {
        return null;
    }

    const value = parseFloat(match[0]);
    return Number.isNaN(value) ? null : value;
}

function parsePriorityPayload(payload: string): InputPriorityMode | null {
    const normalized = payload.trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    if (normalized.includes('auto')) {
        return 'auto';
    }

    const match = normalized.match(/(-?\d+)(?!.*-?\d)/);
    if (match) {
        switch (match[1]) {
            case '0':
                return 'auto';
            case '1':
            case '2':
            case '3':
            case '4':
                return match[1];
            default:
                break;
        }
    }

    if (normalized.includes('force')) {
        if (normalized.includes('4')) return '4';
        if (normalized.includes('3')) return '3';
        if (normalized.includes('2')) return '2';
        if (normalized.includes('1')) return '1';
    }

    return null;
}

function parseChannelCountPayload(payload: string): number {
    const match = payload.match(/(\d+)(?!.*\d)/);
    if (!match) {
        return 0;
    }

    const count = parseInt(match[1], 10);
    return Number.isNaN(count) ? 0 : count;
}

function buildChannelIndexList(count: number): number[] {
    return Array.from({ length: count }, (_, index) => index + 1);
}
