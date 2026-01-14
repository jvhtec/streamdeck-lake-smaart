import dgram from 'dgram';
import { EventEmitter } from 'events';
import { encodeDlmMsg, decodeAck, parseResponse, DlmPacket, ACK_SUCCESS } from './dlmPacket';

interface PendingRequest {
    msgId: number;
    resolve: (value: DlmPacket | null) => void;
    reject: (reason: any) => void;
    timer: NodeJS.Timeout;
    retriesLeft: number;
    command: string;
}

export class DlmClient extends EventEmitter {
    private socket: dgram.Socket;
    private msgIdCounter = 1;
    private pendingRequests = new Map<number, PendingRequest>();
    private host: string;
    private port: number; // Destination port (e.g. 1024 or whatever device listens on)
    private listenPort = 6004; // Fixed response port per spec

    private isOnline = false;
    private backoffMs = 1000;

    constructor(host: string, port: number) {
        super();
        this.host = host;
        this.port = port;
        this.socket = dgram.createSocket('udp4');

        this.socket.on('message', (msg, rinfo) => {
            this.handleMessage(msg);
        });

        this.socket.on('error', (err) => {
            console.error('UDP Socket error:', err);
            this.setOnline(false);
        });

        this.bind();
    }

    public setTarget(host: string, port?: number) {
        this.host = host;
        if (port !== undefined) {
            this.port = port;
        }
    }

    private bind() {
        try {
            this.socket.bind(this.listenPort, () => {
                console.log(`DLM Client listening on port ${this.listenPort}`);
            });
        } catch (e) {
            console.error('Failed to bind UDP port', e);
        }
    }

    private setOnline(online: boolean) {
        if (this.isOnline !== online) {
            this.isOnline = online;
            this.emit('onlineStatus', online);
            if (!online) {
                // Reset backoff or start reconnection logic if connection-oriented (UDP is connectionless, but "logical" online)
            }
        }
    }

    public async send(command: string, retries = 2, timeoutMs = 250): Promise<DlmPacket | null> {
        return new Promise((resolve, reject) => {
            const msgId = this.msgIdCounter++;
            const packet = encodeDlmMsg(command, msgId);

            const sendAttempt = () => {
                this.socket.send(packet, this.port, this.host, (err) => {
                    if (err) {
                        // Socket send error logic
                        console.error('UDP Send error', err);
                    }
                });
            };

            const scheduleTimeout = () => {
                const timer = setTimeout(() => {
                    const pending = this.pendingRequests.get(msgId);
                    if (!pending) return;
                    if (pending.retriesLeft > 0) {
                        pending.retriesLeft--;
                        console.warn(`Retrying DLM command ${command} (MsgId: ${msgId})`);
                        sendAttempt();
                        clearTimeout(pending.timer);
                        pending.timer = scheduleTimeout();
                    } else {
                        this.pendingRequests.delete(msgId);
                        this.setOnline(false); // Assume offline if timeout
                        reject(new Error('Timeout'));
                    }
                }, timeoutMs);
                return timer;
            };

            this.pendingRequests.set(msgId, {
                msgId,
                resolve,
                reject,
                timer: scheduleTimeout(),
                retriesLeft: retries,
                command
            });

            sendAttempt();
        });
    }

    private handleMessage(msg: Buffer) {
        // Check if it's an ACK or a Response
        // Simplified: Try parse as ACK first
        const ack = decodeAck(msg);
        if (ack) {
            const pending = this.pendingRequests.get(ack.msgId);
            if (pending) {
                if (ack.status === ACK_SUCCESS) {
                    this.setOnline(true);
                    // If this was a query, keep waiting for a response packet.
                    if (!pending.command.includes('?')) {
                        clearTimeout(pending.timer);
                        this.pendingRequests.delete(ack.msgId);
                        pending.resolve(null);
                    }
                } else {
                    clearTimeout(pending.timer);
                    this.pendingRequests.delete(ack.msgId);
                    pending.reject(new Error(`ACK Error: ${ack.status}`));
                }
            }
            // Note: If it's a query response, it might come separately or instead of ACK?
            // The spec says "ACKs... responses...". 
            // If we expect a value back, we might wait for a second packet?
            // For now, let's assume `parseResponse` handles data packets.
        }

        const response = parseResponse(msg);
        if (response) {
            // If we had a pending request for this MsgID that expected data
            const pending = this.pendingRequests.get(response.msgId);
            if (pending) {
                clearTimeout(pending.timer);
                this.pendingRequests.delete(response.msgId);
                this.setOnline(true);
                pending.resolve(response);
            } else {
                // Unsolicited or late response
            }
        }
    }

    public close() {
        this.socket.close();
    }
}
