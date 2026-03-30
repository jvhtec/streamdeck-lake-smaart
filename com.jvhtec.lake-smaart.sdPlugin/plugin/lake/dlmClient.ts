import { randomBytes } from 'crypto';
import dgram from 'dgram';
import { EventEmitter } from 'events';
import { deriveBroadcastAddress } from '../core/networkAdapters';
import {
    ACK_SUCCESS,
    DLM_ALL_CLASS_MASK,
    DLM_BROADCAST_IDHI,
    DLM_BROADCAST_IDLO,
    DLM_DEVICE_CLASS_ID,
    DLM_DYNAMIC_DEVICE_PORT,
    DLM_FIXED_DEVICE_PORT,
    DLM_FIXED_RESPONSE_PORT,
    DLM_HOST_CLASS_ID,
    DlmMessagePacket,
    DlmBroadcastAnnouncement,
    describePacket,
    encodeDlmMsg,
    encodeHeartbeat,
    formatFrameId,
    getProductName,
    parseDlmPacket,
    parseFrameId,
} from './dlmPacket';

export interface DlmClientConfig {
    host: string;
    port: number;
    bindAddress?: string;
    bindNetmask?: string;
    debug?: boolean;
}

export interface DlmTarget {
    ip: string;
    idHi: number;
    idLo: number;
    classId?: number;
}

export interface DlmDiscoveredUnit extends DlmTarget {
    frameId: string;
    model: string;
    productFlag: number;
    lastSeenMs: number;
}

interface PendingRequest {
    msgId: number;
    resolve: (value: DlmMessagePacket | null) => void;
    reject: (reason: Error) => void;
    timer: NodeJS.Timeout;
    retriesLeft: number;
    command: string;
    expectsData: boolean;
    packet: Buffer;
    target: DlmTarget;
}

export class DlmClient extends EventEmitter {
    private socket: dgram.Socket;
    private socketReady: Promise<void>;
    private pendingRequests = new Map<number, PendingRequest>();
    private knownUnits = new Map<string, DlmDiscoveredUnit>();
    private msgIdCounter = 1;

    private readonly hostIdHi: number;
    private readonly hostIdLo: number;

    private hostFilter: string;
    private port: number;
    private bindAddress: string;
    private bindNetmask: string;
    private debug: boolean;
    private isOnline = false;

    constructor(configOrHost: DlmClientConfig | string, port?: number) {
        super();

        const config = typeof configOrHost === 'string'
            ? { host: configOrHost, port: port ?? DLM_DYNAMIC_DEVICE_PORT }
            : configOrHost;

        const hostId = DlmClient.generateHostId();
        this.hostIdHi = hostId.idHi;
        this.hostIdLo = hostId.idLo;

        this.hostFilter = config.host ?? '';
        this.port = config.port ?? DLM_DYNAMIC_DEVICE_PORT;
        this.bindAddress = config.bindAddress?.trim() || '';
        this.bindNetmask = config.bindNetmask?.trim() || '';
        this.debug = Boolean(config.debug);

        this.socket = this.createSocket();
        this.socketReady = this.bind();
        this.socketReady.catch(() => undefined);
    }

    public updateConfig(config: Partial<DlmClientConfig>) {
        const previousMode = this.getResponseMode();
        const previousHostFilter = this.hostFilter;
        const previousBindAddress = this.bindAddress;
        const previousBindNetmask = this.bindNetmask;

        if (config.host !== undefined) {
            this.hostFilter = config.host;
        }
        if (config.port !== undefined) {
            this.port = config.port;
        }
        if (config.bindAddress !== undefined) {
            this.bindAddress = config.bindAddress.trim();
        }
        if (config.bindNetmask !== undefined) {
            this.bindNetmask = config.bindNetmask.trim();
        }
        if (config.debug !== undefined) {
            this.debug = Boolean(config.debug);
        }

        if (previousMode !== this.getResponseMode() || previousBindAddress !== this.bindAddress) {
            this.recreateSocket();
        }

        if (
            previousHostFilter !== this.hostFilter ||
            previousBindAddress !== this.bindAddress ||
            previousBindNetmask !== this.bindNetmask
        ) {
            this.knownUnits.clear();
        }
    }

    public async discoverUnits(timeoutMs = 1500): Promise<DlmDiscoveredUnit[]> {
        await this.socketReady;

        const discovered = new Map<string, DlmDiscoveredUnit>();
        const onUnit = (unit: DlmDiscoveredUnit) => {
            if (!this.matchesHostFilter(unit)) {
                return;
            }
            discovered.set(unit.frameId, unit);
        };

        this.on('unitDiscovered', onUnit);

        try {
            const packet = encodeHeartbeat({
                srcIdHi: this.hostIdHi,
                srcIdLo: this.hostIdLo,
                msgId: this.nextMsgId(),
            });

            for (const address of this.getDiscoveryDestinations()) {
                await this.sendBuffer(packet, this.port, address);
                this.trace(`TX heartbeat -> ${address}:${this.port}`);
            }

            await delay(timeoutMs);
        } finally {
            this.off('unitDiscovered', onUnit);
        }

        return Array.from(discovered.values()).sort((left, right) => left.frameId.localeCompare(right.frameId));
    }

    public async send(command: string, target: DlmTarget, retries = 2, timeoutMs = 750): Promise<DlmMessagePacket | null> {
        await this.socketReady;

        const msgId = this.nextMsgId();
        const packet = encodeDlmMsg(command, {
            srcIdHi: this.hostIdHi,
            srcIdLo: this.hostIdLo,
            destIdHi: target.idHi,
            destIdLo: target.idLo,
            destClass: target.classId ?? DLM_DEVICE_CLASS_ID,
            msgId,
        });
        const expectsData = command.includes('?');

        return new Promise((resolve, reject) => {
            const pending: PendingRequest = {
                msgId,
                resolve,
                reject,
                retriesLeft: retries,
                command,
                expectsData,
                packet,
                target,
                timer: setTimeout(() => undefined, 0),
            };

            const sendAttempt = () => {
                this.sendBuffer(packet, this.port, target.ip).catch((error) => {
                    this.emitLog(`Lake send failed for ${command}: ${String(error)}`);
                });
            };

            const scheduleTimeout = () => setTimeout(() => {
                const current = this.pendingRequests.get(msgId);
                if (!current) {
                    return;
                }

                if (current.retriesLeft > 0) {
                    current.retriesLeft--;
                    this.trace(`Retrying ${command} to ${target.ip} (msgId=${msgId})`);
                    sendAttempt();
                    clearTimeout(current.timer);
                    current.timer = scheduleTimeout();
                    return;
                }

                this.pendingRequests.delete(msgId);
                this.setOnline(false);
                reject(new Error(`Timeout waiting for DLM response to ${command}`));
            }, timeoutMs);

            pending.timer = scheduleTimeout();
            this.pendingRequests.set(msgId, pending);
            sendAttempt();
        });
    }

    public getKnownUnits(): DlmDiscoveredUnit[] {
        return Array.from(this.knownUnits.values()).sort((left, right) => left.frameId.localeCompare(right.frameId));
    }

    public clearKnownUnits() {
        this.knownUnits.clear();
    }

    public close() {
        this.rejectPending(new Error('DLM client closed'));
        try {
            this.socket.close();
        } catch {
            // Ignore close races during shutdown.
        }
    }

    private createSocket() {
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

        socket.on('message', (msg, rinfo) => {
            this.handleMessage(msg, rinfo);
        });

        socket.on('error', (err) => {
            this.emitLog(`Lake UDP socket error: ${String(err)}`);
            this.setOnline(false);
        });

        return socket;
    }

    private getResponseMode() {
        return this.port === DLM_FIXED_DEVICE_PORT ? 'fixed' : 'dynamic';
    }

    private recreateSocket() {
        this.rejectPending(new Error('DLM socket reconfigured'));

        try {
            this.socket.removeAllListeners();
            this.socket.close();
        } catch {
            // Ignore close races.
        }

        this.socket = this.createSocket();
        this.socketReady = this.bind();
        this.socketReady.catch(() => undefined);
    }

    private bind() {
        const bindPort = this.getResponseMode() === 'fixed' ? DLM_FIXED_RESPONSE_PORT : 0;
        const bindAddress = this.bindAddress || '0.0.0.0';

        return new Promise<void>((resolve, reject) => {
            const handleListening = () => {
                this.socket.off('error', handleBindError);
                try {
                    this.socket.setBroadcast(true);
                } catch {
                    // Broadcast isn't required for unicast-only scenarios.
                }
                const address = this.socket.address();
                const localPort = typeof address === 'string' ? bindPort : address.port;
                this.emitLog(`Lake DLM listening on ${bindAddress}:${localPort} (${this.getResponseMode()} mode -> ${this.port})`);
                resolve();
            };

            const handleBindError = (err: Error) => {
                this.socket.off('listening', handleListening);
                this.emitLog(`Lake DLM bind failed on ${bindAddress}:${bindPort || 0}: ${String(err)}`);
                reject(err);
            };

            this.socket.once('listening', handleListening);
            this.socket.once('error', handleBindError);

            try {
                this.socket.bind({ port: bindPort, address: bindAddress, exclusive: false });
            } catch (error) {
                this.socket.off('listening', handleListening);
                this.socket.off('error', handleBindError);
                reject(error as Error);
            }
        });
    }

    private async sendBuffer(packet: Buffer, port: number, address: string) {
        await new Promise<void>((resolve, reject) => {
            this.socket.send(packet, port, address, (err) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            });
        });
        this.trace(`TX ${address}:${port} ${packet.toString('hex')}`);
    }

    private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo) {
        const packet = parseDlmPacket(msg);
        if (!packet) {
            this.trace(`RX ${rinfo.address}:${rinfo.port} undecodable ${msg.toString('hex')}`);
            return;
        }

        if (packet.header.srcIdHi === this.hostIdHi && packet.header.srcIdLo === this.hostIdLo) {
            this.trace(`RX ${rinfo.address}:${rinfo.port} ignored self-originated packet`);
            return;
        }

        if (!this.isPacketForHost(packet.header.destIdHi, packet.header.destIdLo)) {
            this.trace(`RX ${rinfo.address}:${rinfo.port} ignored packet not addressed to host`);
            return;
        }

        this.trace(`RX ${rinfo.address}:${rinfo.port} ${describePacket(packet)}`);

        if (packet.kind === 'broadcast') {
            this.handleDiscoveryAnnouncement(packet.announcement, rinfo.address);
            return;
        }

        if (packet.kind === 'multi_broadcast') {
            packet.announcements.forEach((announcement) => this.handleDiscoveryAnnouncement(announcement, rinfo.address));
            return;
        }

        if (packet.kind === 'ack') {
            const pending = this.pendingRequests.get(packet.header.msgId);
            if (!pending) {
                return;
            }

            if (packet.result === ACK_SUCCESS) {
                this.setOnline(true);
                if (!pending.expectsData) {
                    clearTimeout(pending.timer);
                    this.pendingRequests.delete(packet.header.msgId);
                    pending.resolve(null);
                }
                return;
            }

            clearTimeout(pending.timer);
            this.pendingRequests.delete(packet.header.msgId);
            pending.reject(new Error(`Lake ACK error ${packet.result} for ${pending.command}`));
            return;
        }

        if (packet.kind === 'message') {
            const pending = this.pendingRequests.get(packet.header.msgId);
            if (!pending) {
                return;
            }

            clearTimeout(pending.timer);
            this.pendingRequests.delete(packet.header.msgId);
            this.setOnline(true);
            pending.resolve(packet);
        }
    }

    private handleDiscoveryAnnouncement(announcement: DlmBroadcastAnnouncement, ip: string) {
        const baseClass = announcement.header.srcClass & ~DLM_ALL_CLASS_MASK;
        if (baseClass === 0 || baseClass === DLM_HOST_CLASS_ID) {
            this.trace(`Ignored discovery announcement from class ${baseClass || announcement.header.srcClass}`);
            return;
        }

        const frameId = formatFrameId(announcement.header.srcIdHi, announcement.header.srcIdLo);
        const productFlag = announcement.productFlag >>> 0;
        const unit: DlmDiscoveredUnit = {
            frameId,
            ip,
            idHi: announcement.header.srcIdHi,
            idLo: announcement.header.srcIdLo,
            classId: baseClass,
            model: getProductName(productFlag),
            productFlag,
            lastSeenMs: Date.now(),
        };

        this.knownUnits.set(frameId, unit);
        this.emit('unitDiscovered', unit);
        this.trace(`Discovered ${unit.model} ${frameId} @ ${ip}`);
    }

    private matchesHostFilter(unit: DlmDiscoveredUnit) {
        const filter = this.hostFilter.trim();
        if (!filter) {
            return true;
        }

        const frameId = parseFrameId(filter);
        if (frameId) {
            return unit.idHi === frameId.idHi && unit.idLo === frameId.idLo;
        }

        return unit.ip === filter;
    }

    private getDiscoveryDestinations() {
        const destinations = new Set<string>();
        const host = this.hostFilter.trim();

        if (isIpv4Address(host)) {
            destinations.add(host);
        }

        if (isLoopbackAddress(this.bindAddress)) {
            destinations.add(this.bindAddress);
        }

        const directedBroadcast =
            this.bindAddress &&
            this.bindNetmask &&
            !isLoopbackAddress(this.bindAddress)
                ? deriveBroadcastAddress(this.bindAddress, this.bindNetmask)
                : null;
        if (directedBroadcast && directedBroadcast !== this.bindAddress) {
            destinations.add(directedBroadcast);
        }

        const allLoopback = Array.from(destinations).every((address) => isLoopbackAddress(address));
        if (destinations.size === 0 || !allLoopback) {
            destinations.add('255.255.255.255');
        }

        return Array.from(destinations);
    }

    private isPacketForHost(destIdHi: number, destIdLo: number) {
        return (
            (destIdHi === DLM_BROADCAST_IDHI && destIdLo === DLM_BROADCAST_IDLO) ||
            (destIdHi === this.hostIdHi && destIdLo === this.hostIdLo)
        );
    }

    private nextMsgId() {
        const next = this.msgIdCounter >>> 0;
        this.msgIdCounter = (this.msgIdCounter + 1) >>> 0;
        if (this.msgIdCounter === 0xffffffff) {
            this.msgIdCounter = 1;
        }
        return next === 0xffffffff ? 1 : next;
    }

    private rejectPending(error: Error) {
        for (const pending of this.pendingRequests.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pendingRequests.clear();
    }

    private setOnline(online: boolean) {
        if (this.isOnline === online) {
            return;
        }

        this.isOnline = online;
        this.emit('onlineStatus', online);
    }

    private emitLog(message: string) {
        this.emit('log', message);
    }

    private trace(message: string) {
        if (!this.debug) {
            return;
        }

        this.emit('log', `[Lake DLM] ${message}`);
    }

    private static generateHostId() {
        const bytes = randomBytes(8);
        return {
            idHi: bytes.readUInt32LE(0),
            idLo: bytes.readUInt32LE(4),
        };
    }
}

function delay(ms: number) {
    return new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
}

function isIpv4Address(value: string) {
    return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}

function isLoopbackAddress(value: string) {
    return value === '127.0.0.1';
}
