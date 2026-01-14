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

    public connect() {
        try {
            this.ws = new WebSocket(`ws://${this.host}:${this.port}`);

            this.ws.on('open', () => {
                console.log('Connected to Smaart');
                this.isConnected = true;
                // Handshake if needed
            });

            this.ws.on('close', () => {
                this.isConnected = false;
            });

            this.ws.on('error', (e) => {
                console.error('Smaart WS Error', e);
            });

        } catch (e) {
            console.error('Smaart Connection Failed', e);
        }
    }

    public send(command: object) {
        if (this.ws && this.isConnected) {
            this.ws.send(JSON.stringify(command));
        }
    }

    public setGenerator(enable: boolean) {
        // Helper
        this.send({ action: 'generator', state: enable });
    }
}
