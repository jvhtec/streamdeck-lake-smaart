"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LaHttpBackend = void 0;
const laHttpClient_1 = require("./laHttpClient");
class LaHttpBackend {
    id = 'la_http';
    settings;
    maxConcurrency = 10;
    limiters = new Map();
    constructor(settings) {
        this.settings = settings;
    }
    updateSettings(settings) {
        this.settings = { ...this.settings, ...settings };
    }
    async discover() {
        const hosts = this.buildHostList();
        const results = [];
        const queue = hosts.slice();
        const workers = Array.from({ length: Math.min(this.maxConcurrency, queue.length) }, () => this.worker(queue, results));
        await Promise.all(workers);
        return results;
    }
    async getTargets(device) {
        const client = new laHttpClient_1.LaHttpClient(device.address || '', this.settings.username, this.settings.password);
        const outputsResp = await this.withLimiter(device.id, () => client.get('/api/control/dsp/output'));
        const outputsCount = outputsResp.data ? outputsResp.data.length : 0;
        const supports = await this.detectOutputSupport(device.id, client);
        const targets = [];
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
            const used = await this.withLimiter(device.id, () => client.get(`/api/configuration/library/${i}/used`));
            if (!used.data)
                continue;
            const nameResp = await this.withLimiter(device.id, () => client.get(`/api/configuration/library/${i}/name`));
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
    async getState(target) {
        if (target.backend !== 'la_http') {
            throw new Error('Invalid backend');
        }
        const client = new laHttpClient_1.LaHttpClient(this.getDeviceAddress(target.deviceId), this.settings.username, this.settings.password);
        if (target.kind === 'output') {
            const muteResp = await this.withLimiter(target.deviceId, () => client.get(`/api/control/dsp/output/${target.index}/mute`));
            const gainResp = await this.withLimiter(target.deviceId, () => client.get(`/api/control/dsp/output/${target.index}/gain`));
            const volumeResp = await this.withLimiter(target.deviceId, () => client.get(`/api/control/dsp/output/${target.index}/volume`));
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
    async setMute(target, mute) {
        if (target.backend !== 'la_http')
            return;
        if (target.kind !== 'output')
            return;
        const client = new laHttpClient_1.LaHttpClient(this.getDeviceAddress(target.deviceId), this.settings.username, this.settings.password);
        await this.withLimiter(target.deviceId, () => client.post(`/api/control/dsp/output/${target.index}/mute`, mute));
    }
    async setLevel(target, value, mode) {
        if (target.backend !== 'la_http')
            return;
        if (target.kind !== 'output')
            return;
        const client = new laHttpClient_1.LaHttpClient(this.getDeviceAddress(target.deviceId), this.settings.username, this.settings.password);
        if (mode === 'volume') {
            await this.withLimiter(target.deviceId, () => client.post(`/api/control/dsp/output/${target.index}/volume`, Math.round(value)));
        }
        else {
            await this.withLimiter(target.deviceId, () => client.post(`/api/control/dsp/output/${target.index}/gain`, value));
        }
    }
    async recallPreset(device, index) {
        const client = new laHttpClient_1.LaHttpClient(device.address || '', this.settings.username, this.settings.password);
        await this.withLimiter(device.id, () => client.post('/api/configuration/load', { index }));
    }
    async getActivePresetIndex(device) {
        const client = new laHttpClient_1.LaHttpClient(device.address || '', this.settings.username, this.settings.password);
        const resp = await this.withLimiter(device.id, () => client.get('/api/configuration/active/index'));
        if (resp.status !== 200 || resp.data === null)
            return null;
        return Number(resp.data);
    }
    async detectOutputSupport(deviceId, client) {
        const supports = ['mute'];
        const gainResp = await this.withLimiter(deviceId, () => client.get('/api/control/dsp/output/1/gain'));
        if (gainResp.status === 200) {
            supports.push('level');
        }
        const volumeResp = await this.withLimiter(deviceId, () => client.get('/api/control/dsp/output/1/volume'));
        if (volumeResp.status === 200) {
            supports.push('volume');
        }
        return supports;
    }
    buildHostList() {
        const manualHosts = this.settings.discoveryHosts.map((host) => host.trim()).filter(Boolean);
        if (manualHosts.length > 0) {
            return manualHosts;
        }
        return this.expandSubnet(this.settings.discoverySubnet);
    }
    expandSubnet(subnet) {
        const match = subnet.match(/^(\d+\.\d+\.\d+)\.(\d+)-(\d+)$/);
        if (match) {
            const base = match[1];
            const start = parseInt(match[2], 10);
            const end = parseInt(match[3], 10);
            const hosts = [];
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
    async worker(queue, results) {
        while (queue.length > 0) {
            const host = queue.shift();
            if (!host)
                return;
            try {
                const client = new laHttpClient_1.LaHttpClient(host, this.settings.username, this.settings.password);
                const resp = await this.withLimiter(host, () => client.get('/api/info'));
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
            }
            catch (error) {
                // Ignore discovery errors for this host
            }
        }
    }
    getDeviceAddress(deviceId) {
        const match = deviceId.replace('la_', '');
        return match;
    }
    async withLimiter(deviceId, task) {
        const limiter = this.getLimiter(deviceId);
        return new Promise((resolve, reject) => {
            const run = () => {
                limiter.active += 1;
                task()
                    .then(resolve)
                    .catch(reject)
                    .finally(() => {
                    limiter.active -= 1;
                    const next = limiter.queue.shift();
                    if (next)
                        next();
                });
            };
            if (limiter.active < this.maxConcurrency) {
                run();
            }
            else {
                limiter.queue.push(run);
            }
        });
    }
    getLimiter(deviceId) {
        const existing = this.limiters.get(deviceId);
        if (existing)
            return existing;
        const limiter = { active: 0, queue: [] };
        this.limiters.set(deviceId, limiter);
        return limiter;
    }
}
exports.LaHttpBackend = LaHttpBackend;
