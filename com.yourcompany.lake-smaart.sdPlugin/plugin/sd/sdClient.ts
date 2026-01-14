import WebSocket from 'ws';
import { IncomingEvent } from './events';

type EventHandler = (event: IncomingEvent) => void;

export class SDClient {
    private ws: WebSocket | null = null;
    private port: number;
    private uuid: string;
    private registerEvent: string;
    private eventHandlers: EventHandler[] = [];

    constructor(port: string, uuid: string, registerEvent: string) {
        this.port = parseInt(port);
        this.uuid = uuid;
        this.registerEvent = registerEvent;
    }

    public connect() {
        this.ws = new WebSocket(`ws://127.0.0.1:${this.port}`);

        this.ws.on('open', () => {
            this.register();
        });

        this.ws.on('message', (data: string) => {
            try {
                const json: IncomingEvent = JSON.parse(data);
                this.emit(json);
            } catch (e) {
                console.error('Error parsing WS message', e);
            }
        });

        this.ws.on('error', (err) => {
            console.error('WebSocket error:', err);
        });

        this.ws.on('close', () => {
            console.log('WebSocket closed');
        });
    }

    private register() {
        if (!this.ws) return;
        const json = {
            event: this.registerEvent,
            uuid: this.uuid,
        };
        this.ws.send(JSON.stringify(json));
        // Request global settings on startup
        this.getGlobalSettings();
    }

    public onEvents(handler: EventHandler) {
        this.eventHandlers.push(handler);
    }

    private emit(event: IncomingEvent) {
        this.eventHandlers.forEach((h) => h(event));
    }

    public setSettings(context: string, settings: any) {
        this.send({
            event: 'setSettings',
            context,
            payload: settings,
        });
    }

    public getSettings(context: string) {
        this.send({
            event: 'getSettings',
            context,
        });
    }

    public getGlobalSettings() {
        this.send({
            event: 'getGlobalSettings',
            context: this.uuid,
        });
    }

    public setGlobalSettings(settings: any) {
        this.send({
            event: 'setGlobalSettings',
            context: this.uuid,
            payload: settings,
        });
    }

    public setTitle(context: string, title: string) {
        this.send({
            event: 'setTitle',
            context,
            payload: {
                title,
                target: 0,
            },
        });
    }

    public setState(context: string, state: number) {
        this.send({
            event: 'setState',
            context,
            payload: {
                state,
            },
        });
    }

    public setFeedback(context: string, payload: any) {
        this.send({
            event: 'setFeedback',
            context,
            payload,
        });
    }

    public setFeedbackLayout(context: string, layout: string) {
        this.send({
            event: 'setFeedbackLayout',
            context,
            payload: {
                layout,
            },
        });
    }

    public showAlert(context: string) {
        this.send({
            event: 'showAlert',
            context,
        });
    }

    public showOk(context: string) {
        this.send({
            event: 'showOk',
            context,
        });
    }

    public logMessage(message: string) {
        this.send({
            event: 'logMessage',
            context: this.uuid,
            payload: {
                message
            }
        })
    }

    private send(json: any) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(json));
        }
    }
}
