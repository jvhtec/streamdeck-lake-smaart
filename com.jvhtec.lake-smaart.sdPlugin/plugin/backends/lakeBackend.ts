import os from 'node:os';

import { Backend, DeviceDescriptor, LevelMode, TargetDescriptor, TargetState } from '../core/types';
import { DlmClient } from '../lake/dlmClient';
import { buildGetGain, buildGetMute, buildRecallPreset, buildSetGain, buildSetMute } from '../lake/dlmCommands';
import { GROUPS, ModuleId } from '../lake/lakeModel';

export interface LakeSettings {
    /** If set, skip discovery and talk to this single host. */
    host?: string;
    port: number;

    /** Optional override discovery subnet. If omitted, auto-detect APIPA /24 from local interfaces. */
    discoverySubnet?: string;

    /** Optional explicit hosts list for discovery (comma-split in UI). */
    discoveryHosts?: string[];

    maxConcurrency?: number;

    /** Timeout for probe/state calls in ms. */
    requestTimeoutMs?: number;
}

type Limiter = { active: number; queue: Array<() => void> };

export class LakeBackend implements Backend {
    public readonly id = 'lake' as const;
    private client: DlmClient;
    private settings: LakeSettings;

    private maxConcurrency = 30;
    private requestTimeoutMs = 250;

    private limiters = new Map<string, Limiter>();
    private deviceAddresses = new Map<string, string>();

    constructor(client: DlmClient, settings: LakeSettings) {
        this.client = client;
        this.settings = settings;
        this.applyTuning(settings);
        // Keep backward compatibility: if host is provided, set as default target.
        if (settings.host) {
            this.client.setTarget(settings.host, settings.port);
        }
    }

    public updateSettings(settings: Partial<LakeSettings>) {
        this.settings = { ...this.settings, ...settings };
        this.applyTuning(settings);
        if (this.settings.host) {
            this.client.setTarget(this.settings.host, this.settings.port);
        }
    }

    private applyTuning(settings: Partial<LakeSettings>) {
        if (typeof settings.maxConcurrency === 'number' && settings.maxConcurrency > 0) {
            this.maxConcurrency = Math.max(1, Math.floor(settings.maxConcurrency));
        }
        if (typeof settings.requestTimeoutMs === 'number' && settings.requestTimeoutMs > 0) {
            this.requestTimeoutMs = Math.max(50, Math.floor(settings.requestTimeoutMs));
        }
    }

    public async discover(): Promise<DeviceDescriptor[]> {
        this.deviceAddresses.clear();

        // Legacy single-host mode.
        if (this.settings.host && String(this.settings.host).trim()) {
            const host = String(this.settings.host).trim();
            const id = `lake_${host}`;
            this.deviceAddresses.set(id, host);
            const online = await this.probeHost(host);
            return [
                {
                    id,
                    name: `Lake (${host})`,
                    backend: 'lake',
                    address: host,
                    online,
                },
            ];
        }

        const hosts = this.buildHostList();
        const results: DeviceDescriptor[] = [];

        const queue = hosts.slice();
        const workers = Array.from({ length: Math.min(this.maxConcurrency, queue.length || 1) }, () => this.worker(queue, results));
        await Promise.all(workers);

        // stable ordering
        results.sort((a, b) => (a.address || '').localeCompare(b.address || ''));

        for (const d of results) {
            if (d.address) this.deviceAddresses.set(d.id, d.address);
        }

        return results;
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

        const host = this.deviceAddresses.get(target.deviceId) || this.settings.host;
        if (!host) {
            return { online: false, lastUpdatedMs: Date.now() };
        }

        if (target.kind === 'module') {
            const mute = await this.readMute(host, target.id as ModuleId);
            const gain = await this.readGain(host, target.id as ModuleId);
            const online = mute !== null || gain !== null;
            return {
                online,
                mute: mute ?? undefined,
                levelDb: gain ?? undefined,
                lastUpdatedMs: Date.now(),
            };
        }

        if (target.kind === 'group') {
            const group = GROUPS[target.id];
            const mutes = await Promise.all(group.muteMembers.map((member) => this.readMute(host, member.module)));
            const gains = await Promise.all(group.gainMembers.map((member) => this.readGain(host, member.module)));

            const knownMutes = mutes.filter((m) => typeof m === 'boolean') as boolean[];
            const muteState = knownMutes.length > 0 ? knownMutes.every((m) => m === true) : undefined;

            const knownGains = gains.filter((g) => typeof g === 'number') as number[];
            const gainAvg = knownGains.length > 0 ? knownGains.reduce((sum, val) => sum + val, 0) / knownGains.length : undefined;

            const online = knownMutes.length > 0 || knownGains.length > 0;

            return {
                online,
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
        const host = this.deviceAddresses.get(target.deviceId) || this.settings.host;
        if (!host) return;

        if (target.kind === 'module') {
            await this.client.send(buildSetMute(target.id, mute), 1, this.requestTimeoutMs, { host, port: this.settings.port });
            return;
        }
        if (target.kind === 'group') {
            const group = GROUPS[target.id];
            const results = await Promise.allSettled(
                group.muteMembers.map((member) => this.client.send(buildSetMute(member.module, mute), 1, this.requestTimeoutMs, { host, port: this.settings.port }))
            );
            const failed = results.filter((r) => r.status === 'rejected');
            if (failed.length) {
                console.warn(`LakeBackend: ${failed.length}/${results.length} mute ops failed for group ${target.id}`);
            }
        }
    }

    public async setLevel(target: TargetDescriptor, value: number, _mode: LevelMode): Promise<void> {
        if (target.backend !== 'lake') return;
        const host = this.deviceAddresses.get(target.deviceId) || this.settings.host;
        if (!host) return;

        if (target.kind === 'module') {
            await this.client.send(buildSetGain(target.id, value), 1, this.requestTimeoutMs, { host, port: this.settings.port });
            return;
        }
        if (target.kind === 'group') {
            const group = GROUPS[target.id];
            const results = await Promise.allSettled(
                group.gainMembers.map((member) => this.client.send(buildSetGain(member.module, value), 1, this.requestTimeoutMs, { host, port: this.settings.port }))
            );
            const failed = results.filter((r) => r.status === 'rejected');
            if (failed.length) {
                console.warn(`LakeBackend: ${failed.length}/${results.length} gain ops failed for group ${target.id}`);
            }
        }
    }

    public async recallPreset(device: DeviceDescriptor, index: number): Promise<void> {
        const host = this.deviceAddresses.get(device.id) || device.address || this.settings.host;
        if (!host) return;
        await this.client.send(buildRecallPreset(index), 1, Math.max(500, this.requestTimeoutMs), { host, port: this.settings.port });
    }

    private async probeHost(host: string): Promise<boolean> {
        try {
            const resp = await this.client.send(buildGetMute('A'), 0, this.requestTimeoutMs, { host, port: this.settings.port });
            return Boolean(resp && resp.payload);
        } catch {
            return false;
        }
    }

    private async readMute(host: string, module: ModuleId): Promise<boolean | null> {
        try {
            const response = await this.client.send(buildGetMute(module), 0, this.requestTimeoutMs, { host, port: this.settings.port });
            if (!response) return null;
            return response.payload.includes(' 1');
        } catch {
            return null;
        }
    }

    private async readGain(host: string, module: ModuleId): Promise<number | null> {
        try {
            const response = await this.client.send(buildGetGain(module), 0, this.requestTimeoutMs, { host, port: this.settings.port });
            if (!response) return null;
            const parts = response.payload.split(' ');
            const value = parseFloat(parts[parts.length - 1]);
            return Number.isNaN(value) ? null : value;
        } catch {
            return null;
        }
    }

    private buildHostList(): string[] {
        const manual = (this.settings.discoveryHosts || []).map((h) => String(h).trim()).filter(Boolean);
        if (manual.length > 0) return manual;

        if (this.settings.discoverySubnet && this.settings.discoverySubnet.trim()) {
            return this.expandSubnet(this.settings.discoverySubnet.trim());
        }

        const autoSubnets = this.autoDetectSubnets();
        for (const subnet of autoSubnets) {
            const hosts = this.expandSubnet(subnet);
            if (hosts.length > 0) return hosts;
        }

        return [];
    }

    private autoDetectSubnets(): string[] {
        const ifs = os.networkInterfaces();
        const apipa: string[] = [];
        const candidates: Array<{ subnet: string; score: number; address: string }> = [];

        for (const name of Object.keys(ifs)) {
            for (const info of ifs[name] || []) {
                if (info.family !== 'IPv4') continue;
                if (info.internal) continue;
                const addr = info.address;
                if (!addr || addr === '0.0.0.0' || addr.startsWith('127.')) continue;

                // Prefer link-local Lake networks when present.
                if (addr.startsWith('169.254.')) {
                    const parts = addr.split('.');
                    if (parts.length === 4) apipa.push(`${parts[0]}.${parts[1]}.${parts[2]}.0/24`);
                    continue;
                }

                // Avoid scanning the dedicated L-Acoustics network by default.
                if (addr.startsWith('192.168.1.')) continue;

                const parts = addr.split('.').map((x) => parseInt(x, 10));
                if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) continue;

                const subnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;

                // Heuristic scoring: prefer private /24s most likely used for control networks.
                let score = 0;
                if (parts[0] === 192 && parts[1] === 168) score = 3;
                else if (parts[0] === 10) score = 2;
                else if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) score = 1;

                if (score > 0) {
                    candidates.push({ subnet, score, address: addr });
                }
            }
        }

        const uniq = (xs: string[]) => Array.from(new Set(xs));

        if (apipa.length > 0) {
            return uniq(apipa);
        }

        if (candidates.length === 0) return [];

        candidates.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));

        // Only scan the top candidate subnet by default to avoid scanning random office/home networks.
        return [candidates[0].subnet];
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
            const online = await this.withLimiter(host, () => this.probeHost(host));
            if (online) {
                results.push({
                    id: `lake_${host}`,
                    name: `Lake (${host})`,
                    backend: 'lake',
                    address: host,
                    online: true,
                });
            }
        }
    }

    private async withLimiter<T>(key: string, task: () => Promise<T>): Promise<T> {
        const limiter = this.getLimiter(key);
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

    private getLimiter(key: string): Limiter {
        const existing = this.limiters.get(key);
        if (existing) return existing;
        const limiter: Limiter = { active: 0, queue: [] };
        this.limiters.set(key, limiter);
        return limiter;
    }
}
