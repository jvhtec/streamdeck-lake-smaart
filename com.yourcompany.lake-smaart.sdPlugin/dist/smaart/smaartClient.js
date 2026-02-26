"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmaartClient = void 0;
const ws_1 = __importDefault(require("ws"));
class SmaartClient {
    ws = null;
    host;
    port;
    isConnected = false;
    constructor(host, port) {
        this.host = host;
        this.port = port;
    }
    setTarget(host, port) {
        this.host = host;
        this.port = port;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.isConnected = false;
        }
    }
    connect() {
        try {
            this.ws = new ws_1.default(`ws://${this.host}:${this.port}`);
            this.ws.on('open', () => {
                this.isConnected = true;
            });
            this.ws.on('close', () => {
                this.isConnected = false;
            });
            this.ws.on('error', () => {
                this.isConnected = false;
            });
        }
        catch (e) {
            this.isConnected = false;
        }
    }
    send(command) {
        if (this.ws && this.isConnected) {
            this.ws.send(JSON.stringify(command));
        }
    }
    setGenerator(enable) {
        this.send({ action: 'generator', state: enable });
    }
    computeDelay() {
        this.send({ action: 'compute_delay' });
    }
    setActiveTraceVisible(visible) {
        this.send({ action: 'active_trace', visible });
    }
}
exports.SmaartClient = SmaartClient;
