import { Backend, DeviceDescriptor, LevelMode, TargetDescriptor, TargetState } from '../core/types';
import { DlmClient, DlmDiscoveredUnit } from '../lake/dlmClient';
import { buildGetGain, buildGetMute, buildRecallPreset, buildSetGain, buildSetMute } from '../lake/dlmCommands';
import { GROUPS, ModuleId } from '../lake/lakeModel';

export interface LakeSettings {
    host: string;
    port: number;
    bindAddress?: string;
    debug?: boolean;
}

export class LakeBackend implements Backend {
    public readonly id = 'lake' as const;

    private static readonly KNOWN_UNIT_TTL_MS = 30000;

    private client: DlmClient;
    private settings: LakeSettings;
    private unitsByDeviceId = new Map<string, DlmDiscoveredUnit>();

    constructor(client: DlmClient, settings: LakeSettings) {
        this.client = client;
        this.settings = settings;
        this.client.updateConfig({
            host: settings.host,
            port: settings.port,
            bindAddress: settings.bindAddress,
            debug: settings.debug,
        });
    }

    public updateSettings(settings: Partial<LakeSettings>) {
        this.settings = { ...this.settings, ...settings };
        this.client.updateConfig({
            host: this.settings.host,
            port: this.settings.port,
            bindAddress: this.settings.bindAddress,
            debug: this.settings.debug,
        });
    }

    public async discover(): Promise<DeviceDescriptor[]> {
        const discovered = await this.client.discoverUnits();
        const units = discovered.length > 0
            ? discovered
            : this.client.getKnownUnits().filter((unit) => Date.now() - unit.lastSeenMs < LakeBackend.KNOWN_UNIT_TTL_MS);

        this.unitsByDeviceId.clear();

        return units.map((unit) => {
            const deviceId = `lake:${unit.frameId}`;
            this.unitsByDeviceId.set(deviceId, unit);

            return {
                id: deviceId,
                name: `${unit.model} (${unit.ip})`,
                backend: 'lake',
                address: unit.ip,
                model: unit.model,
                online: true,
            };
        });
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
            targets.push({
                backend: 'lake',
                deviceId: device.id,
                kind: 'group',
                id: group.name,
                name: `Group ${group.name}`,
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
            const mute = await this.readMute(unit, target.id as ModuleId);
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
            const mutes = await Promise.all(group.muteMembers.map((member) => this.readMute(unit, member.module)));
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
            await this.client.send(buildSetMute(target.id, mute), unit);
            return;
        }

        if (target.kind === 'group') {
            const group = GROUPS[target.id];
            await Promise.all(group.muteMembers.map((member) => this.client.send(buildSetMute(member.module, mute), unit)));
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
