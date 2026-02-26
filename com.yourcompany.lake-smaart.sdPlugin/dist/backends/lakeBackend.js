"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LakeBackend = void 0;
const dlmCommands_1 = require("../lake/dlmCommands");
const lakeModel_1 = require("../lake/lakeModel");
class LakeBackend {
    id = 'lake';
    client;
    settings;
    constructor(client, settings) {
        this.client = client;
        this.settings = settings;
        this.client.setTarget(settings.host, settings.port);
    }
    updateSettings(settings) {
        this.settings = { ...this.settings, ...settings };
        this.client.setTarget(this.settings.host, this.settings.port);
    }
    async discover() {
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
    async getTargets(device) {
        const modules = ['A', 'B', 'C', 'D'];
        const targets = modules.map((module) => ({
            backend: 'lake',
            deviceId: device.id,
            kind: 'module',
            id: module,
            name: `Module ${module}`,
            supports: ['mute', 'level'],
        }));
        Object.values(lakeModel_1.GROUPS).forEach((group) => {
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
    async getState(target) {
        if (target.backend !== 'lake') {
            throw new Error('Invalid backend');
        }
        if (target.kind === 'module') {
            const mute = await this.readMute(target.id);
            const gain = await this.readGain(target.id);
            return {
                online: true,
                mute: mute ?? undefined,
                levelDb: gain ?? undefined,
                lastUpdatedMs: Date.now(),
            };
        }
        if (target.kind === 'group') {
            const group = lakeModel_1.GROUPS[target.id];
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
    async setMute(target, mute) {
        if (target.backend !== 'lake')
            return;
        if (target.kind === 'module') {
            await this.client.send((0, dlmCommands_1.buildSetMute)(target.id, mute));
            return;
        }
        if (target.kind === 'group') {
            const group = lakeModel_1.GROUPS[target.id];
            await Promise.all(group.muteMembers.map((member) => this.client.send((0, dlmCommands_1.buildSetMute)(member.module, mute))));
        }
    }
    async setLevel(target, value, _mode) {
        if (target.backend !== 'lake')
            return;
        if (target.kind === 'module') {
            await this.client.send((0, dlmCommands_1.buildSetGain)(target.id, value));
            return;
        }
        if (target.kind === 'group') {
            const group = lakeModel_1.GROUPS[target.id];
            await Promise.all(group.gainMembers.map((member) => this.client.send((0, dlmCommands_1.buildSetGain)(member.module, value))));
        }
    }
    async recallPreset(device, index) {
        await this.client.send((0, dlmCommands_1.buildRecallPreset)(index));
    }
    async readMute(module) {
        try {
            const response = await this.client.send((0, dlmCommands_1.buildGetMute)(module), 0);
            if (!response)
                return null;
            return response.payload.includes(' 1');
        }
        catch (error) {
            return null;
        }
    }
    async readGain(module) {
        try {
            const response = await this.client.send((0, dlmCommands_1.buildGetGain)(module), 0);
            if (!response)
                return null;
            const parts = response.payload.split(' ');
            const value = parseFloat(parts[parts.length - 1]);
            return Number.isNaN(value) ? null : value;
        }
        catch (error) {
            return null;
        }
    }
}
exports.LakeBackend = LakeBackend;
