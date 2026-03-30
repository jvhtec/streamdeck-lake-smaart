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
    onGetVisibleActions: () => Array<{
        action: string;
        context: string;
        controller?: string;
        coordinates?: { column: number; row: number };
    }>;
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

    public getHubUrl(): string {
        return `http://${this.boundAddress}:${this.assignedPort}/?token=${encodeURIComponent(this.sessionToken)}`;
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

        if (path === '/instances') {
            const instances = this.callbacks.onGetVisibleActions();
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-cache',
            });
            res.end(JSON.stringify({ instances }));
            return;
        }

        let html: string;
        if (path === '/dial') {
            html = DIAL_HTML;
        } else if (path === '/key') {
            html = KEY_HTML;
        } else {
            html = buildHubHtml(this.sessionToken);
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

function buildHubHtml(token: string): string {
    const escapedToken = JSON.stringify(token);
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8" />
    <title>Plugin Inspector Hub</title>
    <style>
        body{font-family:Arial,sans-serif;color:#ddd;background:#1f1f1f;margin:0;padding:16px}
        .wrap{max-width:840px;margin:0 auto}
        h1{font-size:20px;margin:0 0 8px}
        p{color:#bcbcbc;line-height:1.4}
        .note{background:#2b2b2b;border:1px solid #444;border-radius:8px;padding:12px;margin:12px 0 18px}
        .list{display:flex;flex-direction:column;gap:10px}
        .item{display:flex;justify-content:space-between;align-items:center;gap:12px;background:#2a2a2a;border:1px solid #444;border-radius:8px;padding:12px}
        .meta{display:flex;flex-direction:column;gap:4px}
        .name{font-weight:700;color:#fff}
        .sub{font-size:12px;color:#aaa}
        .link{display:inline-block;background:#4b7bec;color:#fff;text-decoration:none;padding:8px 12px;border-radius:6px;font-size:13px}
        .empty{background:#2a2a2a;border:1px dashed #555;border-radius:8px;padding:16px;color:#aaa}
    </style>
</head>
<body>
    <div class="wrap">
        <h1>Browser Inspector Hub</h1>
        <p>The plugin detected a Windows path with characters that break the built-in inspector URL. Use this page to open the safe browser-based inspector for any visible action.</p>
        <div class="note">
            Keep Stream Controller running while this page is open. The list below refreshes automatically.
        </div>
        <div id="list" class="list"></div>
    </div>
    <script>
        const token = ${escapedToken};

        function actionLabel(uuid) {
            const name = (uuid || '').split('.').pop() || uuid || 'action';
            switch (name) {
                case 'lakeLevel': return 'Lake Level + Press-to-Mute';
                case 'laLevel': return 'L-Acoustics Level + Press-to-Mute';
                case 'lakePresetRecall': return 'Lake Preset Recall';
                case 'laPresetRecall': return 'L-Acoustics Preset Recall';
                case 'lakeMute': return 'Lake Mute';
                case 'laMute': return 'L-Acoustics Mute';
                case 'priority': return 'Lake Input Priority';
                case 'smaartgengain': return 'Smaart Generator Gain';
                case 'smaartfiletransport': return 'Smaart File Transport';
                case 'smaartgen': return 'Smaart Generator';
                case 'smaartspl': return 'Smaart SPL Meter';
                case 'smaartcapture': return 'Smaart Capture';
                case 'smaartdelay': return 'Smaart Compute Delay';
                case 'smaarttrace': return 'Smaart Toggle Trace';
                default: return name;
            }
        }

        function isDialAction(action) {
            return action === 'com.jvhtec.lake-smaart.lakeLevel' ||
                action === 'com.jvhtec.lake-smaart.laLevel' ||
                action === 'com.jvhtec.lake-smaart.smaartgengain' ||
                action === 'com.jvhtec.lake-smaart.smaartfiletransport';
        }

        function render(instances) {
            const container = document.getElementById('list');
            if (!container) return;

            if (!Array.isArray(instances) || instances.length === 0) {
                container.innerHTML = '<div class="empty">No visible plugin actions yet. Put an action on the deck or make its page visible, then wait a moment.</div>';
                return;
            }

            container.innerHTML = instances.map((instance) => {
                const page = isDialAction(instance.action) ? 'dial' : 'key';
                const href = '/' + page + '?action=' + encodeURIComponent(instance.action) +
                    '&context=' + encodeURIComponent(instance.context) +
                    '&wsPort=' + encodeURIComponent(String(location.port)) +
                    '&token=' + encodeURIComponent(token);
                const coords = instance.coordinates
                    ? 'col ' + instance.coordinates.column + ', row ' + instance.coordinates.row
                    : 'no coordinates';
                const controller = instance.controller || 'Unknown';
                return '<div class="item">' +
                    '<div class="meta">' +
                    '<div class="name">' + escapeHtml(actionLabel(instance.action)) + '</div>' +
                    '<div class="sub">' + escapeHtml(controller + ' | ' + coords) + '</div>' +
                    '<div class="sub">' + escapeHtml(instance.context) + '</div>' +
                    '</div>' +
                    '<a class="link" href="' + href + '">Open Inspector</a>' +
                    '</div>';
            }).join('');
        }

        function escapeHtml(text) {
            return String(text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        async function refresh() {
            try {
                const response = await fetch('/instances?token=' + encodeURIComponent(token), { cache: 'no-store' });
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status);
                }
                const payload = await response.json();
                render(payload.instances || []);
            } catch (error) {
                const container = document.getElementById('list');
                if (container) {
                    container.innerHTML = '<div class="empty">Unable to load visible actions from the plugin hub.</div>';
                }
            }
        }

        refresh();
        setInterval(refresh, 1500);
    </script>
</body>
</html>`;
}
