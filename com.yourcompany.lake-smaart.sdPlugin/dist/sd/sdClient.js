"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SDClient = void 0;
const ws_1 = __importDefault(require("ws"));
class SDClient {
    ws = null;
    port;
    uuid;
    registerEvent;
    eventHandlers = [];
    constructor(port, uuid, registerEvent) {
        this.port = parseInt(port);
        this.uuid = uuid;
        this.registerEvent = registerEvent;
    }
    connect() {
        this.ws = new ws_1.default(`ws://127.0.0.1:${this.port}`);
        this.ws.on('open', () => {
            this.register();
        });
        this.ws.on('message', (data) => {
            try {
                const json = JSON.parse(data);
                this.emit(json);
            }
            catch (e) {
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
    register() {
        if (!this.ws)
            return;
        const json = {
            event: this.registerEvent,
            uuid: this.uuid,
        };
        this.ws.send(JSON.stringify(json));
        // Request global settings on startup
        this.getGlobalSettings();
    }
    onEvents(handler) {
        this.eventHandlers.push(handler);
    }
    emit(event) {
        this.eventHandlers.forEach((h) => h(event));
    }
    setSettings(context, settings) {
        this.send({
            event: 'setSettings',
            context,
            payload: settings,
        });
    }
    getSettings(context) {
        this.send({
            event: 'getSettings',
            context,
        });
    }
    getGlobalSettings() {
        this.send({
            event: 'getGlobalSettings',
            context: this.uuid,
        });
    }
    setGlobalSettings(settings) {
        this.send({
            event: 'setGlobalSettings',
            context: this.uuid,
            payload: settings,
        });
    }
    setTitle(context, title) {
        this.send({
            event: 'setTitle',
            context,
            payload: {
                title,
                target: 0,
            },
        });
    }
    setState(context, state) {
        this.send({
            event: 'setState',
            context,
            payload: {
                state,
            },
        });
    }
    setFeedback(context, payload) {
        this.send({
            event: 'setFeedback',
            context,
            payload,
        });
    }
    setFeedbackLayout(context, layout) {
        this.send({
            event: 'setFeedbackLayout',
            context,
            payload: {
                layout,
            },
        });
    }
    sendToPropertyInspector(context, payload) {
        this.send({
            event: 'sendToPropertyInspector',
            context,
            payload,
        });
    }
    showAlert(context) {
        this.send({
            event: 'showAlert',
            context,
        });
    }
    showOk(context) {
        this.send({
            event: 'showOk',
            context,
        });
    }
    logMessage(message) {
        this.send({
            event: 'logMessage',
            context: this.uuid,
            payload: {
                message
            }
        });
    }
    send(json) {
        if (this.ws && this.ws.readyState === ws_1.default.OPEN) {
            this.ws.send(JSON.stringify(json));
        }
    }
}
exports.SDClient = SDClient;
