import { Backend, DeviceDescriptor, LevelMode, TargetDescriptor, TargetState } from '../core/types';
import { LaHttpClient } from './laHttpClient';

interface LaInfoResponse {
    name?: string;
    firmware_version?: string;
}

export interface LaHttpSettings {
    discoverySubnet: string;
    discoveryHosts: string[];
    username?: string;
    password?: string;
}

export class LaHttpBackend implements Backend {
    public readonly id = 'la_http' as const;
    private settings: LaHttpSettings;
    private maxConcurrency = 10;
    private limiters = new Map<string, { active: number; queue: Array<() => void> }>();

    constructor(settings: LaHttpSettings) {
        this.settings = settings;
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
        const client = new LaHttpClient(device.address || '', this.settings.username, this.settings.password);
        const outputsResp = await this.withLimiter(device.id, () => client.get<any[]>('/api/control/dsp/output'));
        const outputsCount = outputsResp.data ? outputsResp.data.length : 0;
        const supports = await this.detectOutputSupport(device.id, client);

        const targets: TargetDescriptor[] = [];
        for (let i = 1; i <= outputsCount; i++) {
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
            const used = await this.withLimiter(device.id, () => client.get<boolean>(`/api/configuration/library/${i}/used`));
            if (!used.data) continue;
            const nameResp = await this.withLimiter(device.id, () => client.get<string>(`/api/configuration/library/${i}/name`));
            const name = nameResp.data ? String(nameResp.data) : `Preset ${i}`;
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
        const client = new LaHttpClient(this.getDeviceAddress(target.deviceId), this.settings.username, this.settings.password);
        if (target.kind === 'output') {
            const muteResp = await this.withLimiter(target.deviceId, () => client.get<boolean>(`/api/control/dsp/output/${target.index}/mute`));
            const gainResp = await this.withLimiter(target.deviceId, () => client.get<number>(`/api/control/dsp/output/${target.index}/gain`));
            const volumeResp = await this.withLimiter(target.deviceId, () => client.get<number>(`/api/control/dsp/output/${target.index}/volume`));
            return {
                online: muteResp.status === 200 || gainResp.status === 200 || volumeResp.status === 200,
                mute: muteResp.data ?? undefined,
                levelDb: gainResp.data ?? undefined,
                volume: volumeResp.data ?? undefined,
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
        const client = new LaHttpClient(this.getDeviceAddress(target.deviceId), this.settings.username, this.settings.password);
        await this.withLimiter(target.deviceId, () => client.post(`/api/control/dsp/output/${target.index}/mute`, mute));
    }

    public async setLevel(target: TargetDescriptor, value: number, mode: LevelMode): Promise<void> {
        if (target.backend !== 'la_http') return;
        if (target.kind !== 'output') return;
        const client = new LaHttpClient(this.getDeviceAddress(target.deviceId), this.settings.username, this.settings.password);
        if (mode === 'volume') {
            await this.withLimiter(target.deviceId, () => client.post(`/api/control/dsp/output/${target.index}/volume`, Math.round(value)));
        } else {
            await this.withLimiter(target.deviceId, () => client.post(`/api/control/dsp/output/${target.index}/gain`, value));
        }
    }

    public async recallPreset(device: DeviceDescriptor, index: number): Promise<void> {
        const client = new LaHttpClient(device.address || '', this.settings.username, this.settings.password);
        await this.withLimiter(device.id, () => client.post('/api/configuration/load', { index }));
    }

    public async getActivePresetIndex(device: DeviceDescriptor): Promise<number | null> {
        const client = new LaHttpClient(device.address || '', this.settings.username, this.settings.password);
        const resp = await this.withLimiter(device.id, () => client.get<number>('/api/configuration/active/index'));
        if (resp.status !== 200 || resp.data === null) return null;
        return Number(resp.data);
    }

    private async detectOutputSupport(deviceId: string, client: LaHttpClient): Promise<Array<'mute' | 'level' | 'volume'>> {
        const supports: Array<'mute' | 'level' | 'volume'> = ['mute'];
        const gainResp = await this.withLimiter(deviceId, () => client.get<number>('/api/control/dsp/output/1/gain'));
        if (gainResp.status === 200) {
            supports.push('level');
        }
        const volumeResp = await this.withLimiter(deviceId, () => client.get<number>('/api/control/dsp/output/1/volume'));
        if (volumeResp.status === 200) {
            supports.push('volume');
        }
        return supports;
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
                const client = new LaHttpClient(host, this.settings.username, this.settings.password);
                const resp = await this.withLimiter(host, () => client.get<LaInfoResponse>('/api/info'));
                if (resp.status === 200 && resp.data) {
                    const name = resp.data.name || host;
                    results.push({
                        id: `la_${host}`,
                        name,
                        backend: 'la_http',
                        address: host,
                        model: resp.data.firmware_version,
                        online: true,
                    });
                }
            } catch (error) {
                // Ignore discovery errors for this host
            }
        }
    }

    private getDeviceAddress(deviceId: string): string {
        const match = deviceId.replace('la_', '');
        return match;
    }

    private async withLimiter<T>(deviceId: string, task: () => Promise<T>): Promise<T> {
        const limiter = this.getLimiter(deviceId);
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

    private getLimiter(deviceId: string) {
        const existing = this.limiters.get(deviceId);
        if (existing) return existing;
        const limiter = { active: 0, queue: [] as Array<() => void> };
        this.limiters.set(deviceId, limiter);
        return limiter;
    }
}
