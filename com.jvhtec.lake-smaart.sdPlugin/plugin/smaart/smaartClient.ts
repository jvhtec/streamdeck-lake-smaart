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
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.isConnected = false;
        }
    }

    public connect() {
        try {
            this.ws = new WebSocket(`ws://${this.host}:${this.port}`);

            this.ws.on('open', () => {
                this.isConnected = true;
            });

            this.ws.on('close', () => {
                this.isConnected = false;
            });

            this.ws.on('error', () => {
                this.isConnected = false;
            });
        } catch (e) {
            this.isConnected = false;
        }
    }

    public send(command: object) {
        if (this.ws && this.isConnected) {
            this.ws.send(JSON.stringify(command));
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
