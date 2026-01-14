import { Backend, DeviceDescriptor, LevelMode, TargetDescriptor, TargetState } from '../core/types';
import { DlmClient } from '../lake/dlmClient';
import { buildGetGain, buildGetMute, buildRecallPreset, buildSetGain, buildSetMute } from '../lake/dlmCommands';
import { GROUPS, ModuleId } from '../lake/lakeModel';

export interface LakeSettings {
    host: string;
    port: number;
}

export class LakeBackend implements Backend {
    public readonly id = 'lake' as const;
    private client: DlmClient;
    private settings: LakeSettings;

    constructor(client: DlmClient, settings: LakeSettings) {
        this.client = client;
        this.settings = settings;
        this.client.setTarget(settings.host, settings.port);
    }

    public updateSettings(settings: Partial<LakeSettings>) {
        this.settings = { ...this.settings, ...settings };
        this.client.setTarget(this.settings.host, this.settings.port);
    }

    public async discover(): Promise<DeviceDescriptor[]> {
        return [
            {
                id: 'lake_default',
                name: `Lake LM (${this.settings.host})`,
                backend: 'lake',
                address: this.settings.host,
                online: true,
            },
        ];
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

        if (target.kind === 'module') {
            const mute = await this.readMute(target.id as ModuleId);
            const gain = await this.readGain(target.id as ModuleId);
            return {
                online: true,
                mute: mute ?? undefined,
                levelDb: gain ?? undefined,
                lastUpdatedMs: Date.now(),
            };
        }

        if (target.kind === 'group') {
            const group = GROUPS[target.id];
            const mutes = await Promise.all(group.muteMembers.map((member) => this.readMute(member.module)));
            const gains = await Promise.all(group.gainMembers.map((member) => this.readGain(member.module)));
            const muteState = mutes.every((m) => m === true);
            const gainAvg = gains.length > 0 ? gains.reduce((sum, val) => sum + (val ?? 0), 0) / gains.length : undefined;
            return {
                online: true,
                mute: muteState,
                levelDb: gainAvg,
                lastUpdatedMs: Date.now(),
            };
        }

        return {
            online: true,
            lastUpdatedMs: Date.now(),
        };
    }

    public async setMute(target: TargetDescriptor, mute: boolean): Promise<void> {
        if (target.backend !== 'lake') return;
        if (target.kind === 'module') {
            await this.client.send(buildSetMute(target.id, mute));
            return;
        }
        if (target.kind === 'group') {
            const group = GROUPS[target.id];
            await Promise.all(group.muteMembers.map((member) => this.client.send(buildSetMute(member.module, mute))));
        }
    }

    public async setLevel(target: TargetDescriptor, value: number, _mode: LevelMode): Promise<void> {
        if (target.backend !== 'lake') return;
        if (target.kind === 'module') {
            await this.client.send(buildSetGain(target.id, value));
            return;
        }
        if (target.kind === 'group') {
            const group = GROUPS[target.id];
            await Promise.all(group.gainMembers.map((member) => this.client.send(buildSetGain(member.module, value))));
        }
    }

    public async recallPreset(device: DeviceDescriptor, index: number): Promise<void> {
        await this.client.send(buildRecallPreset(index));
    }

    private async readMute(module: ModuleId): Promise<boolean | null> {
        try {
            const response = await this.client.send(buildGetMute(module), 0);
            if (!response) return null;
            return response.payload.includes(' 1');
        } catch (error) {
            return null;
        }
    }

    private async readGain(module: ModuleId): Promise<number | null> {
        try {
            const response = await this.client.send(buildGetGain(module), 0);
            if (!response) return null;
            const parts = response.payload.split(' ');
            const value = parseFloat(parts[parts.length - 1]);
            return Number.isNaN(value) ? null : value;
        } catch (error) {
            return null;
        }
    }
}
