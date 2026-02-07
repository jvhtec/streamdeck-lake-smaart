import WebSocket from 'ws';

export class SmaartClient {
    private ws: WebSocket | null = null;
    private host: string;
    private port: number;
    private isConnected = false;

    constructor(host: string, port: number) {
        this.host = host;
        this.port = port;
    }

    public setTarget(host: string, port: number) {
        this.host = host;
        this.port = port;
        this.disconnect();
    }

    private disconnect() {
        if (!this.ws) return;
        try {
            this.ws.close();
        } catch {
            // ignore
        }
        this.ws = null;
        this.isConnected = false;
    }

    public connect() {
        // Defensive: if connect() is called multiple times, avoid leaking sockets.
        this.disconnect();

        try {
            this.ws = new WebSocket(`ws://${this.host}:${this.port}`);

            this.ws.on('open', () => {
                this.isConnected = true;
            });

            this.ws.on('close', () => {
                this.isConnected = false;
            });

            this.ws.on('error', (err) => {
                this.isConnected = false;
                // Avoid throwing; connection can legitimately fail if Smaart is not running.
                console.warn('Smaart websocket error:', err);
            });
        } catch (e) {
            this.isConnected = false;
            console.warn('Failed to connect to Smaart websocket:', e);
        }
    }

    public send(command: object) {
        if (this.ws && this.isConnected) {
            try {
                this.ws.send(JSON.stringify(command));
            } catch (e) {
                console.warn('Failed to send Smaart command:', e);
            }
        }
    }

    public setGenerator(enable: boolean) {
        this.send({ action: 'generator', state: enable });
    }

    public computeDelay() {
        this.send({ action: 'compute_delay' });
    }

    public setActiveTraceVisible(visible: boolean) {
        this.send({ action: 'active_trace', visible });
    }
}
