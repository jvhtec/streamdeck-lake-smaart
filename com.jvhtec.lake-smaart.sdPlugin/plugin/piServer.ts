import http from 'http';
import crypto from 'crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { KEY_HTML, DIAL_HTML } from './piHtml';

interface PiClient {
    ws: WebSocket;
    action: string;
    context: string;
    authenticated: boolean;
    authTimer: ReturnType<typeof setTimeout> | null;
}

export interface PiServerCallbacks {
    onGetSettings: (context: string) => void;
    onSetSettings: (context: string, settings: any) => void;
    onGetGlobalSettings: () => void;
    onSetGlobalSettings: (settings: any) => void;
    onGetCatalog: (respond: (devices: any[], targets: any[], laAdapters: any[]) => void) => void;
    onGetSmaartSplCatalog: (respond: (inputs: any[], metrics: string[], error?: string) => void) => void;
}

export class PiServer {
    private httpServer: http.Server;
    private wss: WebSocketServer;
    private clients = new Set<PiClient>();
    private callbacks: PiServerCallbacks;
    private assignedPort = 0;
    private boundAddress = '127.0.0.1';
    private sessionToken = crypto.randomBytes(24).toString('hex');

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
                    this.boundAddress = addr.address || '127.0.0.1';
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

    public getBoundAddress(): string {
        return this.boundAddress;
    }

    public getSessionToken(): string {
        return this.sessionToken;
    }

    /** Forward settings received from Stream Deck to any matching browser PI. */
    public sendSettings(context: string, settings: any) {
        for (const client of this.clients) {
            if (client.authenticated && client.context === context && client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({ type: 'settings', settings }));
            }
        }
    }

    /** Forward global settings to all connected browser PIs. */
    public sendGlobalSettings(settings: any) {
        for (const client of this.clients) {
            if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({ type: 'globalSettings', settings }));
            }
        }
    }

    /** Forward catalog to all connected browser PIs. */
    public sendCatalog(devices: any[], targets: any[], laAdapters: any[]) {
        for (const client of this.clients) {
            if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({ type: 'catalog', devices, targets, laAdapters }));
            }
        }
    }

    public sendSmaartSplCatalog(inputs: any[], metrics: string[], error?: string) {
        for (const client of this.clients) {
            if (client.authenticated && client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(JSON.stringify({ type: 'smaartSplCatalog', inputs, metrics, error }));
            }
        }
    }

    private handleHttp(req: http.IncomingMessage, res: http.ServerResponse) {
        const url = new URL(req.url || '/', `http://${this.boundAddress}`);
        const path = url.pathname;
        const token = url.searchParams.get('token');

        if (token !== this.sessionToken) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden');
            return;
        }

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
        const client: PiClient = { ws, action: '', context: '', authenticated: false, authTimer: null };
        this.clients.add(client);

        // Close unauthenticated connections after 5 seconds
        client.authTimer = setTimeout(() => {
            if (!client.authenticated) {
                client.ws.close(4408, 'Authentication timeout');
                this.clients.delete(client);
            }
        }, 5000);

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                this.handleWsMessage(client, msg);
            } catch {
                // ignore malformed messages
            }
        });

        ws.on('close', () => {
            if (client.authTimer) clearTimeout(client.authTimer);
            this.clients.delete(client);
        });
    }

    private handleWsMessage(client: PiClient, msg: any) {
        // The init message must include a valid token to authenticate
        if (msg.type === 'init') {
            if (msg.token !== this.sessionToken) {
                client.ws.close(4401, 'Invalid token');
                this.clients.delete(client);
                return;
            }
            client.authenticated = true;
            if (client.authTimer) {
                clearTimeout(client.authTimer);
                client.authTimer = null;
            }
            client.action = msg.action || '';
            client.context = msg.context || '';
            this.callbacks.onGetSettings(client.context);
            this.callbacks.onGetGlobalSettings();
            return;
        }

        // All other messages require authentication
        if (!client.authenticated) {
            return;
        }

        switch (msg.type) {
            case 'setSettings':
                if (msg.settings) {
                    this.callbacks.onSetSettings(client.context, msg.settings);
                }
                break;
            case 'setGlobalSettings':
                if (msg.settings) {
                    this.callbacks.onSetGlobalSettings(msg.settings);
                }
                break;
            case 'getCatalog':
                this.callbacks.onGetCatalog((devices, targets, laAdapters) => {
                    if (client.ws.readyState === WebSocket.OPEN) {
                        client.ws.send(JSON.stringify({ type: 'catalog', devices, targets, laAdapters }));
                    }
                });
                break;
            case 'getSmaartSplCatalog':
                this.callbacks.onGetSmaartSplCatalog((inputs, metrics, error) => {
                    if (client.ws.readyState === WebSocket.OPEN) {
                        client.ws.send(JSON.stringify({ type: 'smaartSplCatalog', inputs, metrics, error }));
                    }
                });
                break;
        }
    }
}
