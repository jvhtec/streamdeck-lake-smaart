/**
 * Lake DLM Packet Implementation
 * Based on the requirement: packets have headers, message id, payload, footer.
 * Payload must be padded to 4-byte boundary.
 */

export const ACK_SUCCESS = 0;
export const ACK_NOTMASTER = 1;
// Add other ack codes as needed

export interface DlmPacket {
    msgId: number;
    payload: string;
    command: string; // The command string inside the payload
}

export function encodeDlmMsg(
    commandString: string,
    msgId: number,
    destId: string = '0', // Default or specific
    destClass: string = '0',
    requireAck: boolean = true
): Buffer {
    // NOTES:
    // This is a simplified implementation based on the user prompt's "padded to 4 bytes" hint
    // and standard binary protocol practices.
    // In a real scenario, we'd need the exact valid header bytes from the PDF.
    // For now, we will construct a buffer that includes:
    // [Header 4 bytes] [MsgId 4 bytes] [Length 4 bytes] [Payload (Padded)]

    // Padding payload
    let payloadBuffer = Buffer.from(commandString, 'ascii');
    const remainder = payloadBuffer.length % 4;
    if (remainder !== 0) {
        const padding = 4 - remainder;
        const padBuf = Buffer.alloc(padding, 0);
        payloadBuffer = Buffer.concat([payloadBuffer, padBuf]);
    }

    // NOTE: This header structure is hypothetically congruent with "header, packet type, msgId..."
    // User TODO: Verify exact header format from "Direct Lake Messaging v3.4"
    // Assuming a generic header for now to allow compilation and testing logic.

    const headerSize = 12; // Example: Type(2), Flags(2), Sequence/MsgId(4), Length(4)
    const buf = Buffer.alloc(headerSize + payloadBuffer.length);

    let offset = 0;
    // Type / Flags (Placeholder)
    buf.writeUInt16BE(0x0100, offset); offset += 2; // Version/Type
    buf.writeUInt16BE(requireAck ? 1 : 0, offset); offset += 2; // Flags

    // Message ID
    buf.writeUInt32BE(msgId, offset); offset += 4;

    // Length (Payload length)
    buf.writeUInt32BE(payloadBuffer.length, offset); offset += 4;

    // Copy payload
    payloadBuffer.copy(buf, offset);

    return buf;
}

export function decodeAck(packet: Buffer): { msgId: number; status: number } | null {
    // Trying to parse an ACK packet.
    // Assuming ACK packet mirrors the header structure.

    if (packet.length < 12) return null;

    let offset = 4; // Skip Type/Flags
    const msgId = packet.readUInt32BE(offset); offset += 4;
    const len = packet.readUInt32BE(offset); offset += 4;

    // Treat zero-length payload as ACK-only to avoid swallowing responses.
    if (len !== 0) return null;

    // Assuming status is in the first byte(s) of payload or specific flag
    // For this placeholder, let's assume successful ack returns the msgId
    // and we simulate success.

    return { msgId, status: ACK_SUCCESS };
}

export function parseResponse(packet: Buffer): DlmPacket | null {
    // Similar decoding logic
    if (packet.length < 12) return null;
    let offset = 4;
    const msgId = packet.readUInt32BE(offset); offset += 4;
    const len = packet.readUInt32BE(offset); offset += 4;

    if (packet.length < offset + len) return null;
    const payload = packet.subarray(offset, offset + len).toString('ascii').replace(/\0/g, ''); // Trim nulls

    // Command is usually the part before a value or the whole string
    return {
        msgId,
        payload,
        command: payload
    };
}
