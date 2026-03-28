/**
 * Direct Lake Messaging (DLM) packet helpers.
 *
 * The implementation in this file follows the packet layout described in:
 * Direct Lake Messaging v3.4, sections 4-6 and appendices C-E.
 */

export const DLM_FIXED_DEVICE_PORT = 6015;
export const DLM_DYNAMIC_DEVICE_PORT = 6016;
export const DLM_FIXED_RESPONSE_PORT = 6004;

export const DLM_BROADCAST_IDHI = 0xfffffffe;
export const DLM_BROADCAST_IDLO = 0xfffffffd;

export const DLM_BROADCAST_CLASS_ID = 0;
export const DLM_DEVICE_CLASS_ID = 5;
export const DLM_HOST_CLASS_ID = 6;
export const DLM_ALL_CLASS_MASK = 0xe000;

export const DLM_MESSAGE_TYPE_ACK = 2;
export const DLM_MESSAGE_TYPE_BROADCAST_ID = 4;
export const DLM_MESSAGE_TYPE_MULTI_BROADCAST_ID = 5;
export const DLM_MESSAGE_TYPE_DLM = 701;

export const ACK_SUCCESS = -2;
export const ACK_NOTMASTER = -3;
export const ACK_INVALID_PACKET = -4;
export const ACK_DSP_ERROR = -5;
export const ACK_BAD_PARAM = -6;

export const DLM_HEADER_SIZE = 28;
export const DLM_FOOTER_SIZE = 4;
export const DLM_BROADCAST_PAYLOAD_SIZE = 68;
export const DLM_MAX_PACKET_SIZE = 560;

export interface DlmPacketHeader {
    srcIdHi: number;
    srcIdLo: number;
    destIdHi: number;
    destIdLo: number;
    srcClass: number;
    destClass: number;
    length: number;
    packetType: number;
    msgId: number;
}

export interface DlmPacketBase {
    kind: 'ack' | 'message' | 'broadcast' | 'multi_broadcast' | 'unknown';
    header: DlmPacketHeader;
    checksum: number;
    computedChecksum: number;
    checksumValid: boolean;
    raw: Buffer;
}

export interface DlmAckPacket extends DlmPacketBase {
    kind: 'ack';
    result: number;
}

export interface DlmMessagePacket extends DlmPacketBase {
    kind: 'message';
    msgId: number;
    payload: string;
    command: string;
    payloadBytes: Buffer;
}

export interface DlmBroadcastAnnouncement {
    header: DlmPacketHeader;
    flags: number[];
    productFlag: number;
}

export interface DlmBroadcastPacket extends DlmPacketBase {
    kind: 'broadcast';
    announcement: DlmBroadcastAnnouncement;
}

export interface DlmMultiBroadcastPacket extends DlmPacketBase {
    kind: 'multi_broadcast';
    announcements: DlmBroadcastAnnouncement[];
}

export interface DlmUnknownPacket extends DlmPacketBase {
    kind: 'unknown';
    payload: Buffer;
}

export type ParsedDlmPacket =
    | DlmAckPacket
    | DlmMessagePacket
    | DlmBroadcastPacket
    | DlmMultiBroadcastPacket
    | DlmUnknownPacket;

export interface DlmMessageEncodeOptions {
    srcIdHi: number;
    srcIdLo: number;
    destIdHi: number;
    destIdLo: number;
    msgId: number;
    srcClass?: number;
    destClass?: number;
    footerMode?: DlmFooterMode;
}

export interface DlmHeartbeatEncodeOptions {
    srcIdHi: number;
    srcIdLo: number;
    msgId: number;
}

export interface DlmAckEncodeOptions {
    srcIdHi: number;
    srcIdLo: number;
    destIdHi: number;
    destIdLo: number;
    msgId: number;
    result: number;
    srcClass?: number;
    destClass?: number;
    footerMode?: DlmFooterMode;
}

export interface DlmBroadcastAnnouncementEncodeOptions {
    srcIdHi: number;
    srcIdLo: number;
    msgId: number;
    productFlag: number;
    destIdHi?: number;
    destIdLo?: number;
    srcClass?: number;
    destClass?: number;
    flags?: number[];
    footerMode?: DlmFooterMode;
}

export type DlmFooterMode = 'zero' | 'checksum';

const PRODUCT_NAMES: Record<number, string> = {
    0x04: 'PLM 10000Q',
    0x06: 'PLM 14000',
    0x09: 'PLM 20000Q',
    0x0a: 'LM 26',
    0x0b: 'LM 26 Mesa',
    0x0c: 'LM 44',
    0x0d: 'LM 44 Mesa',
    0x13: 'PLM+ 12K44',
    0x14: 'PLM+ 20K44',
    0x15: 'D Series 8K44',
    0x16: 'D Series 12K44',
    0x17: 'D Series 20K44',
};

export function encodeDlmMsg(commandString: string, options: DlmMessageEncodeOptions): Buffer {
    const payload = encodeCString(commandString);
    return encodePacket({
        srcIdHi: options.srcIdHi,
        srcIdLo: options.srcIdLo,
        destIdHi: options.destIdHi,
        destIdLo: options.destIdLo,
        srcClass: options.srcClass ?? DLM_HOST_CLASS_ID,
        destClass: options.destClass ?? DLM_DEVICE_CLASS_ID,
        packetType: DLM_MESSAGE_TYPE_DLM,
        msgId: options.msgId,
        payload,
        footerMode: options.footerMode ?? 'zero',
    });
}

export function encodeHeartbeat(options: DlmHeartbeatEncodeOptions): Buffer {
    return encodePacket({
        srcIdHi: options.srcIdHi,
        srcIdLo: options.srcIdLo,
        destIdHi: DLM_BROADCAST_IDHI,
        destIdLo: DLM_BROADCAST_IDLO,
        srcClass: DLM_HOST_CLASS_ID,
        destClass: DLM_BROADCAST_CLASS_ID,
        packetType: DLM_MESSAGE_TYPE_BROADCAST_ID,
        msgId: options.msgId,
        payload: Buffer.alloc(DLM_BROADCAST_PAYLOAD_SIZE, 0),
        footerMode: 'checksum',
    });
}

export function encodeAck(options: DlmAckEncodeOptions): Buffer {
    const payload = Buffer.alloc(4, 0);
    payload.writeInt32LE(options.result, 0);

    return encodePacket({
        srcIdHi: options.srcIdHi,
        srcIdLo: options.srcIdLo,
        destIdHi: options.destIdHi,
        destIdLo: options.destIdLo,
        srcClass: options.srcClass ?? DLM_DEVICE_CLASS_ID,
        destClass: options.destClass ?? DLM_HOST_CLASS_ID,
        packetType: DLM_MESSAGE_TYPE_ACK,
        msgId: options.msgId,
        payload,
        footerMode: options.footerMode ?? 'checksum',
    });
}

export function encodeBroadcastAnnouncement(options: DlmBroadcastAnnouncementEncodeOptions): Buffer {
    const payload = Buffer.alloc(DLM_BROADCAST_PAYLOAD_SIZE, 0);
    const flags = [0, 0, 0, 0];
    options.flags?.slice(0, 4).forEach((value, index) => {
        flags[index] = toUint32(value);
    });
    flags[2] = toUint32(options.productFlag);

    const flagsOffset = 9 * 4;
    flags.forEach((value, index) => {
        payload.writeUInt32LE(value, flagsOffset + (index * 4));
    });

    return encodePacket({
        srcIdHi: options.srcIdHi,
        srcIdLo: options.srcIdLo,
        destIdHi: options.destIdHi ?? DLM_BROADCAST_IDHI,
        destIdLo: options.destIdLo ?? DLM_BROADCAST_IDLO,
        srcClass: options.srcClass ?? DLM_DEVICE_CLASS_ID,
        destClass: options.destClass ?? DLM_BROADCAST_CLASS_ID,
        packetType: DLM_MESSAGE_TYPE_BROADCAST_ID,
        msgId: options.msgId,
        payload,
        footerMode: options.footerMode ?? 'checksum',
    });
}

export function parseDlmPacket(packet: Buffer): ParsedDlmPacket | null {
    if (packet.length < DLM_HEADER_SIZE + DLM_FOOTER_SIZE) {
        return null;
    }

    const header = readHeader(packet);
    if (header.length < DLM_HEADER_SIZE + DLM_FOOTER_SIZE || header.length > packet.length) {
        return null;
    }

    const raw = packet.subarray(0, header.length);
    const checksum = raw.readUInt32LE(header.length - DLM_FOOTER_SIZE);
    const computedChecksum = generateChecksum(raw);
    const checksumValid = checksum === 0 || checksum === computedChecksum;
    const payload = raw.subarray(DLM_HEADER_SIZE, header.length - DLM_FOOTER_SIZE);

    if (header.packetType === DLM_MESSAGE_TYPE_ACK && payload.length >= 4) {
        return {
            kind: 'ack',
            header,
            checksum,
            computedChecksum,
            checksumValid,
            raw,
            result: payload.readInt32LE(0),
        };
    }

    if (header.packetType === DLM_MESSAGE_TYPE_DLM) {
        const payloadText = decodeCString(payload);
        return {
            kind: 'message',
            header,
            checksum,
            computedChecksum,
            checksumValid,
            raw,
            msgId: header.msgId,
            payload: payloadText,
            command: payloadText,
            payloadBytes: payload,
        };
    }

    if (header.packetType === DLM_MESSAGE_TYPE_BROADCAST_ID) {
        return {
            kind: 'broadcast',
            header,
            checksum,
            computedChecksum,
            checksumValid,
            raw,
            announcement: parseBroadcastAnnouncement(header, payload),
        };
    }

    if (header.packetType === DLM_MESSAGE_TYPE_MULTI_BROADCAST_ID) {
        return {
            kind: 'multi_broadcast',
            header,
            checksum,
            computedChecksum,
            checksumValid,
            raw,
            announcements: parseMultiBroadcastAnnouncements(payload),
        };
    }

    return {
        kind: 'unknown',
        header,
        checksum,
        computedChecksum,
        checksumValid,
        raw,
        payload,
    };
}

export function generateChecksum(packet: Buffer): number {
    const length = packet.readUInt16LE(20);
    let checksum = 0 >>> 0;
    const wordCount = (length >> 1) - 2;

    for (let i = 0; i < wordCount; i++) {
        checksum = ((checksum << 1) | ((((checksum >>> 31) & 1) ^ ((checksum >>> 18) & 1)) & 1)) >>> 0;
        checksum ^= packet.readUInt16LE(i * 2);
    }

    return checksum >>> 0;
}

export function formatFrameId(idHi: number, idLo: number): string {
    return `${toUint32(idHi).toString(16).padStart(8, '0')}:${toUint32(idLo).toString(16).padStart(8, '0')}`;
}

export function parseFrameId(value: string): { idHi: number; idLo: number } | null {
    const trimmed = value.trim().toLowerCase();
    const match = trimmed.match(/^([0-9a-f]{1,8}):([0-9a-f]{1,8})$/);
    if (!match) {
        return null;
    }

    return {
        idHi: parseInt(match[1], 16) >>> 0,
        idLo: parseInt(match[2], 16) >>> 0,
    };
}

export function getProductName(productFlag: number): string {
    return PRODUCT_NAMES[toUint32(productFlag)] || `Product 0x${toUint32(productFlag).toString(16)}`;
}

export function describePacket(packet: ParsedDlmPacket): string {
    const checksumState = packet.checksum === 0 ? 'zero' : packet.checksumValid ? 'ok' : 'bad';
    const base = `${packet.kind} type=${packet.header.packetType} msgId=${toUint32(packet.header.msgId)} checksum=${checksumState}`;
    if (packet.kind === 'ack') {
        return `${base} result=${packet.result}`;
    }
    if (packet.kind === 'message') {
        return `${base} payload="${packet.payload}"`;
    }
    if (packet.kind === 'broadcast') {
        return `${base} frame=${formatFrameId(packet.announcement.header.srcIdHi, packet.announcement.header.srcIdLo)} product=${getProductName(packet.announcement.productFlag)}`;
    }
    if (packet.kind === 'multi_broadcast') {
        return `${base} broadcasts=${packet.announcements.length}`;
    }
    return base;
}

function encodePacket(options: {
    srcIdHi: number;
    srcIdLo: number;
    destIdHi: number;
    destIdLo: number;
    srcClass: number;
    destClass: number;
    packetType: number;
    msgId: number;
    payload: Buffer;
    footerMode?: DlmFooterMode;
}): Buffer {
    const payload = alignPayload(options.payload);
    const totalLength = DLM_HEADER_SIZE + payload.length + DLM_FOOTER_SIZE;
    if (totalLength > DLM_MAX_PACKET_SIZE) {
        throw new Error(`DLM packet too large: ${totalLength} bytes`);
    }

    const packet = Buffer.alloc(totalLength, 0);
    let offset = 0;
    packet.writeUInt32LE(toUint32(options.srcIdHi), offset); offset += 4;
    packet.writeUInt32LE(toUint32(options.srcIdLo), offset); offset += 4;
    packet.writeUInt32LE(toUint32(options.destIdHi), offset); offset += 4;
    packet.writeUInt32LE(toUint32(options.destIdLo), offset); offset += 4;
    packet.writeUInt16LE(options.srcClass & 0xffff, offset); offset += 2;
    packet.writeUInt16LE(options.destClass & 0xffff, offset); offset += 2;
    packet.writeUInt16LE(totalLength & 0xffff, offset); offset += 2;
    packet.writeUInt16LE(options.packetType & 0xffff, offset); offset += 2;
    packet.writeUInt32LE(toUint32(options.msgId), offset); offset += 4;
    payload.copy(packet, offset);

    const checksum = options.footerMode === 'checksum' ? generateChecksum(packet) : 0;
    packet.writeUInt32LE(checksum >>> 0, totalLength - DLM_FOOTER_SIZE);
    return packet;
}

function readHeader(packet: Buffer): DlmPacketHeader {
    return {
        srcIdHi: packet.readUInt32LE(0),
        srcIdLo: packet.readUInt32LE(4),
        destIdHi: packet.readUInt32LE(8),
        destIdLo: packet.readUInt32LE(12),
        srcClass: packet.readUInt16LE(16),
        destClass: packet.readUInt16LE(18),
        length: packet.readUInt16LE(20),
        packetType: packet.readUInt16LE(22),
        msgId: packet.readUInt32LE(24),
    };
}

function parseBroadcastAnnouncement(header: DlmPacketHeader, payload: Buffer): DlmBroadcastAnnouncement {
    const flagsOffset = 9 * 4;
    const flags: number[] = [];
    for (let i = 0; i < 4; i++) {
        const offset = flagsOffset + (i * 4);
        flags.push(offset + 4 <= payload.length ? payload.readUInt32LE(offset) : 0);
    }

    return {
        header,
        flags,
        productFlag: flags[2] ?? 0,
    };
}

function parseMultiBroadcastAnnouncements(payload: Buffer): DlmBroadcastAnnouncement[] {
    if (payload.length < 2) {
        return [];
    }

    const count = payload.readUInt16LE(0);
    let offset = 2;
    const entrySize = DLM_HEADER_SIZE + DLM_BROADCAST_PAYLOAD_SIZE + DLM_FOOTER_SIZE;

    if ((payload.length - offset) % entrySize !== 0 && (payload.length - (offset + 2)) % entrySize === 0) {
        offset += 2;
    }

    const announcements: DlmBroadcastAnnouncement[] = [];
    const maxEntries = Math.min(count, Math.floor((payload.length - offset) / entrySize));

    for (let i = 0; i < maxEntries; i++) {
        const entry = payload.subarray(offset + (i * entrySize), offset + ((i + 1) * entrySize));
        if (entry.length < entrySize) {
            continue;
        }

        const header = readHeader(entry);
        const innerPayload = entry.subarray(DLM_HEADER_SIZE, entrySize - DLM_FOOTER_SIZE);
        announcements.push(parseBroadcastAnnouncement(header, innerPayload));
    }

    return announcements;
}

function encodeCString(value: string): Buffer {
    return Buffer.from(`${value}\0`, 'ascii');
}

function decodeCString(value: Buffer): string {
    const terminator = value.indexOf(0);
    const end = terminator >= 0 ? terminator : value.length;
    return value.subarray(0, end).toString('ascii');
}

function alignPayload(payload: Buffer): Buffer {
    const remainder = payload.length % 4;
    if (remainder === 0) {
        return payload;
    }

    return Buffer.concat([payload, Buffer.alloc(4 - remainder, 0)]);
}

function toUint32(value: number): number {
    return value >>> 0;
}
