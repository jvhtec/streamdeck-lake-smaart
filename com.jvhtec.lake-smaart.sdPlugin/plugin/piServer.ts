import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { KEY_HTML, DIAL_HTML } from './piHtml';

interface PiClient {
    ws: WebSocket;
    action: string;
    context: string;
}

export interface PiServerCallbacks {
    onGetSettings: (context: string) => void;
    onSetSettings: (context: string, settings: any) => void;
    onGetGlobalSettings: () => void;
    onSetGlobalSettings: (settings: any) => void;
    onGetCatalog: (respond: (devices: any[], targets: any[]) => void) => void;
}

export class PiServer {
    private httpServer: http.Server;
    private wss: WebSocketServer;
    private clients = new Set<PiClient>();
    private callbacks: PiServerCallbacks;
    private assignedPort = 0;

    constructor(callbacks: PiServerCallbacks) {
        this.callbacks = callbacks;

        this.httpServer = http.createServer((req, res) => {
            this.handleHttp(req, res);
        });

        this.wss = new WebSocketServer({ server: this.httpServer });
        this.wss.on('connection', (ws) => {
            this.handleWsConnection(ws);
        });
    }

    public start(): Promise<number> {
        return new Promise((resolve, reject) => {
            this.httpServer.listen(0, '127.0.0.1', () => {
                const addr = this.httpServer.address();
                if (addr && typeof addr === 'object') {
                    this.assignedPort = addr.port;
                    resolve(this.assignedPort);
                } else {
                    reject(new Error('Failed to get server address'));
                }
            });
            this.httpServer.on('error', reject);
        });
    }

    public getPort(): number {
        return this.assignedPort;
    }

    /** Forward settings received from Stream Deck to any matching browser PI. */
    public sendSettings(context: string, settings: any) {
        for (const client of this.clients) {
            if (client.context === context && client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({ type: 'settings', settings }));
            }
        }
    }

    /** Forward global settings to all connected browser PIs. */
    public sendGlobalSettings(settings: any) {
        for (const client of this.clients) {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({ type: 'globalSettings', settings }));
            }
        }
    }

    /** Forward catalog to all connected browser PIs. */
    public sendCatalog(devices: any[], targets: any[]) {
        for (const client of this.clients) {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({ type: 'catalog', devices, targets }));
            }
        }
    }

    private handleHttp(req: http.IncomingMessage, res: http.ServerResponse) {
        const url = new URL(req.url || '/', `http://127.0.0.1`);
        const path = url.pathname;

        let html: string;
        if (path === '/dial') {
            html = DIAL_HTML;
        } else {
            // Default to key.html (covers /key, /, and any other path)
            html = KEY_HTML;
        }

        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
        });
        res.end(html);
    }

    private handleWsConnection(ws: WebSocket) {
        const client: PiClient = { ws, action: '', context: '' };
        this.clients.add(client);

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                this.handleWsMessage(client, msg);
            } catch {
                // ignore malformed messages
            }
        });

        ws.on('close', () => {
            this.clients.delete(client);
        });
    }

    private handleWsMessage(client: PiClient, msg: any) {
        switch (msg.type) {
            case 'init':
                client.action = msg.action || '';
                client.context = msg.context || '';
                // Request settings for this context from Stream Deck
                this.callbacks.onGetSettings(client.context);
                this.callbacks.onGetGlobalSettings();
                break;
            case 'setSettings':
                if (msg.context && msg.settings) {
                    this.callbacks.onSetSettings(msg.context, msg.settings);
                }
                break;
            case 'setGlobalSettings':
                if (msg.settings) {
                    this.callbacks.onSetGlobalSettings(msg.settings);
                }
                break;
            case 'getCatalog':
                this.callbacks.onGetCatalog((devices, targets) => {
                    if (client.ws.readyState === WebSocket.OPEN) {
                        client.ws.send(JSON.stringify({ type: 'catalog', devices, targets }));
                    }
                });
                break;
        }
    }
}
