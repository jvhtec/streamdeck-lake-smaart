import WebSocket from 'ws';

export interface SmaartCommandResult {
    ok: boolean;
    error?: string;
    response?: any;
}

export interface SmaartMeasurementTarget {
    measurementName: string;
    measurementType: 'spectrum' | 'transferFunction';
    active: boolean;
    trackingDelay?: boolean;
    visible?: boolean;
}

export interface SmaartSignalGeneratorStatus {
    active: boolean;
    gain?: number;
    type?: string;
}

export interface SmaartSplInputDescriptor {
    deviceName: string;
    channelName: string;
    streamEndpoint: string;
    logEndpointPrefix?: string;
    alarms?: any[];
}

interface PendingRequest {
    payload: string;
    resolve?: (result: SmaartCommandResult) => void;
    timeout: ReturnType<typeof setTimeout>;
}

interface QueuedCommand {
    payload: string;
    timeoutMs: number;
    resolve?: (result: SmaartCommandResult) => void;
}

export class SmaartClient {
    private ws: WebSocket | null = null;
    private host: string;
    private port: number;
    private isConnected = false;
    private apiReady = false;
    private pendingCommands: QueuedCommand[] = [];
    private activeRequest: PendingRequest | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectDelayMs = 1000;

    constructor(host: string, port: number) {
        this.host = host;
        this.port = port;
    }

    public setTarget(host: string, port: number) {
        if (this.host === host && this.port === port) {
            return;
        }

        const previousWs = this.ws;
        this.clearReconnectTimer();
        this.host = host;
        this.port = port;
        this.ws = null;
        this.isConnected = false;
        this.apiReady = false;
        this.clearPending('Connection target changed');
        if (previousWs) {
            previousWs.close();
        }
    }

    public connect() {
        try {
            const wsUrl = `ws://${this.host}:${this.port}/api/v4/`;
            const previousWs = this.ws;

            if (previousWs && (previousWs.readyState === WebSocket.OPEN || previousWs.readyState === WebSocket.CONNECTING)) {
                this.clearReconnectTimer();
                return;
            }

            this.clearReconnectTimer();
            console.log(`[Smaart] Connecting to ${wsUrl}`);
            const ws = new WebSocket(wsUrl);
            this.ws = ws;
            this.isConnected = false;
            this.apiReady = false;

            ws.on('open', () => {
                if (this.ws !== ws) return;
                console.log(`[Smaart] Socket open to ${this.host}:${this.port}`);
                ws.send(JSON.stringify({ action: 'get' }));
            });

            ws.on('message', (data) => {
                if (this.ws !== ws) return;
                const text = data.toString();
                console.log(`[Smaart] Received: ${text}`);

                let parsed: any;
                try {
                    parsed = JSON.parse(text);
                } catch {
                    return;
                }

                const response = parsed?.response;
                if (!response) return;

                if (response.authenticationRequired === true) {
                    this.isConnected = false;
                    this.apiReady = false;
                    this.clearPending('Smaart API authentication is required.');
                    console.error('[Smaart] API authentication is required, but this plugin does not yet send a password.');
                    return;
                }

                if (!this.apiReady && (response.authenticationRequired === false || response.applicationName)) {
                    this.isConnected = true;
                    this.apiReady = true;
                    console.log(`[Smaart] API ready on ${this.host}:${this.port}`);
                    this.dispatchNextCommand();
                    return;
                }

                if (response.error) {
                    console.error(`[Smaart] API error: ${response.error}`);
                }

                this.resolveActiveRequest(response);
            });

            ws.on('close', () => {
                if (this.ws !== ws) return;
                this.isConnected = false;
                this.apiReady = false;
                this.ws = null;
                this.clearPending('Connection closed');
                console.log(`[Smaart] Disconnected from ${this.host}:${this.port}`);
                this.scheduleReconnect();
            });

            ws.on('error', (err: Error) => {
                if (this.ws !== ws) return;
                this.isConnected = false;
                this.apiReady = false;
                this.clearPending(err.message);
                console.error(`[Smaart] Connection error: ${err.message}`);
                this.scheduleReconnect();
            });
        } catch (e) {
            this.isConnected = false;
            this.apiReady = false;
            console.error(`[Smaart] Exception during connect: ${e}`);
        }
    }

    public isReady() {
        return this.ws?.readyState === WebSocket.OPEN && this.apiReady;
    }

    public close() {
        const previousWs = this.ws;
        this.clearReconnectTimer();
        this.ws = null;
        this.isConnected = false;
        this.apiReady = false;
        this.clearPending('Smaart client closed');
        if (previousWs && (previousWs.readyState === WebSocket.OPEN || previousWs.readyState === WebSocket.CONNECTING)) {
            previousWs.close();
        }
    }

    public waitForReady(timeoutMs = 5000): Promise<boolean> {
        if (this.isReady()) {
            return Promise.resolve(true);
        }
        return new Promise((resolve) => {
            const interval = 100;
            let elapsed = 0;
            const timer = setInterval(() => {
                elapsed += interval;
                if (this.isReady()) {
                    clearInterval(timer);
                    resolve(true);
                } else if (elapsed >= timeoutMs) {
                    clearInterval(timer);
                    resolve(false);
                }
            }, interval);
        });
    }

    public send(command: object): boolean {
        const payload = JSON.stringify(command);
        this.ensureSocket();
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            this.pendingCommands.push({ payload, timeoutMs: 1500 });
            if (this.apiReady) {
                console.log(`[Smaart] Queued command: ${payload}`);
            } else {
                console.log(`[Smaart] Queued until API ready: ${payload}`);
            }
            this.dispatchNextCommand();
            return true;
        }

        console.warn(`[Smaart] Command not sent (connected: ${this.isConnected}, readyState: ${this.ws?.readyState ?? 'none'}): ${payload}`);
        return false;
    }

    public setGenerator(enable: boolean): boolean {
        return this.send({
            action: 'set',
            target: 'signalGenerator',
            properties: [{ active: enable }],
        });
    }

    public async setGeneratorActive(enable: boolean): Promise<SmaartCommandResult> {
        return this.request({
            action: 'set',
            target: 'signalGenerator',
            properties: [{ active: enable }],
        });
    }

    public async setGeneratorGain(gain: number): Promise<SmaartCommandResult> {
        return this.request({
            action: 'set',
            target: 'signalGenerator',
            properties: [{ gain }],
        });
    }

    public async getSignalGeneratorStatus(): Promise<SmaartCommandResult> {
        return this.request({
            action: 'get',
            target: 'signalGenerator',
        });
    }

    public async getActiveCalibratedInputs(): Promise<SmaartCommandResult> {
        return this.request({
            action: 'get',
            target: 'activeCalibratedInputs',
        });
    }

    public buildStreamUrl(streamEndpoint: string): string {
        if (/^wss?:\/\//i.test(streamEndpoint)) {
            return streamEndpoint;
        }

        const baseUrl = `ws://${this.host}:${this.port}`;
        if (streamEndpoint.startsWith('/')) {
            return `${baseUrl}${streamEndpoint}`;
        }

        return `${baseUrl}/${streamEndpoint}`;
    }

    public async capture(): Promise<SmaartCommandResult> {
        const measurement = await this.getActiveMeasurement();
        if (!measurement) {
            return {
                ok: false,
                error: 'No active Smaart measurement is available for capture.',
            };
        }

        return this.request({
            action: 'capture',
            target: { measurementName: measurement.measurementName },
        });
    }

    public async computeDelay(): Promise<SmaartCommandResult> {
        const measurement = await this.getActiveMeasurement({ requireTransferFunction: true });
        if (!measurement) {
            return {
                ok: false,
                error: 'No active Smaart transfer function measurement is available for delay finding.',
            };
        }

        return this.request({
            action: 'findDelay',
            target: { measurementName: measurement.measurementName },
        });
    }

    public async setActiveTraceVisible(visible: boolean): Promise<SmaartCommandResult> {
        const measurement = await this.getActiveMeasurement();
        if (!measurement) {
            return {
                ok: false,
                error: 'No active Smaart measurement is available for trace visibility changes.',
            };
        }

        const properties =
            measurement.measurementType === 'transferFunction'
                ? [
                    { includeMagnitude: visible },
                    { includePhase: visible },
                    { includeCoherence: visible },
                ]
                : [{ includeMagnitude: visible }];

        const rootResult = await this.request({
            action: 'set',
            properties,
        });

        if (rootResult.ok || rootResult.error !== 'read only') {
            return rootResult;
        }

        return this.request({
            action: 'set',
            target: { measurementName: measurement.measurementName },
            properties,
        });
    }

    public async getActiveTraceVisibility(): Promise<SmaartCommandResult> {
        const measurement = await this.getActiveMeasurement();
        if (!measurement) {
            return {
                ok: false,
                error: 'No active Smaart measurement is available for trace visibility.',
            };
        }

        if (typeof measurement.visible !== 'boolean') {
            return {
                ok: false,
                error: 'The active Smaart measurement did not report trace visibility.',
            };
        }

        return {
            ok: true,
            response: {
                measurementName: measurement.measurementName,
                measurementType: measurement.measurementType,
                visible: measurement.visible,
            },
        };
    }

    private dispatchNextCommand() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.apiReady || this.activeRequest) {
            return;
        }

        const command = this.pendingCommands.shift();
        if (!command) {
            return;
        }

        const activeRequest: PendingRequest = {
            payload: command.payload,
            resolve: command.resolve,
            timeout: setTimeout(() => {
                if (this.activeRequest !== activeRequest) {
                    return;
                }

                this.activeRequest = null;
                console.warn(`[Smaart] Timed out waiting for response: ${activeRequest.payload}`);
                activeRequest.resolve?.({
                    ok: false,
                    error: 'Timed out waiting for a Smaart response.',
                });
                this.dispatchNextCommand();
            }, command.timeoutMs),
        };

        this.activeRequest = activeRequest;
        this.sendPayload(command.payload);
    }

    private sendPayload(payload: string) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }
        this.ws.send(payload);
        console.log(`[Smaart] Sent: ${payload}`);
    }

    private async getActiveMeasurement(options?: { requireTransferFunction?: boolean }): Promise<SmaartMeasurementTarget | null> {
        const activeResult = await this.request({ action: 'get', target: 'activeMeasurements' });
        if (!activeResult.ok) {
            return null;
        }

        const activeMeasurement = this.pickMeasurement(activeResult.response, options);
        if (activeMeasurement) {
            return activeMeasurement;
        }

        const measurementsResult = await this.request({ action: 'get', target: 'measurements' });
        if (!measurementsResult.ok) {
            return null;
        }

        return this.pickMeasurement(measurementsResult.response, options);
    }

    private pickMeasurement(response: any, options?: { requireTransferFunction?: boolean }): SmaartMeasurementTarget | null {
        const transferFunctionMeasurements = this.mapMeasurements(
            response?.transferFunctionMeasurements,
            'transferFunction'
        );
        const spectrumMeasurements = this.mapMeasurements(response?.spectrumMeasurements, 'spectrum');

        if (options?.requireTransferFunction) {
            return transferFunctionMeasurements.find((measurement) => measurement.active) ?? null;
        }

        return (
            transferFunctionMeasurements.find((measurement) => measurement.active) ??
            spectrumMeasurements.find((measurement) => measurement.active) ??
            null
        );
    }

    private mapMeasurements(
        measurements: any[] | undefined,
        measurementType: SmaartMeasurementTarget['measurementType']
    ): SmaartMeasurementTarget[] {
        if (!Array.isArray(measurements)) {
            return [];
        }

        return measurements
            .filter((measurement) => typeof measurement?.measurementName === 'string')
            .map((measurement) => ({
                measurementName: measurement.measurementName,
                measurementType,
                active: Boolean(measurement.active),
                trackingDelay:
                    typeof measurement.trackingDelay === 'boolean' ? measurement.trackingDelay : undefined,
                visible: this.pickTraceVisibility(measurement, measurementType),
            }));
    }

    private pickTraceVisibility(
        measurement: any,
        measurementType: SmaartMeasurementTarget['measurementType']
    ): boolean | undefined {
        if (measurementType === 'transferFunction') {
            const values = [
                measurement.includeMagnitude,
                measurement.includePhase,
                measurement.includeCoherence,
            ].filter((value): value is boolean => typeof value === 'boolean');
            return values.length > 0 ? values.some((value) => value) : undefined;
        }

        return typeof measurement.includeMagnitude === 'boolean' ? measurement.includeMagnitude : undefined;
    }

    private request(command: object, timeoutMs = 1500): Promise<SmaartCommandResult> {
        const payload = JSON.stringify(command);

        this.ensureSocket();
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return new Promise((resolve) => {
                this.pendingCommands.push({ payload, resolve, timeoutMs });
                if (this.apiReady) {
                    console.log(`[Smaart] Queued request: ${payload}`);
                } else {
                    console.log(`[Smaart] Queued request until API ready: ${payload}`);
                }
                this.dispatchNextCommand();
            });
        }

        console.warn(`[Smaart] Request not sent (connected: ${this.isConnected}, readyState: ${this.ws?.readyState ?? 'none'}): ${payload}`);
        return Promise.resolve({
            ok: false,
            error: 'Not connected to Smaart.',
        });
    }

    private resolveActiveRequest(response: any) {
        const activeRequest = this.activeRequest;
        if (!activeRequest) {
            return;
        }

        this.activeRequest = null;
        clearTimeout(activeRequest.timeout);
        activeRequest.resolve?.({
            ok: !response?.error,
            error: response?.error,
            response,
        });
        this.dispatchNextCommand();
    }

    private clearPending(reason: string) {
        while (this.pendingCommands.length > 0) {
            const command = this.pendingCommands.shift();
            if (command?.resolve) {
                command.resolve({
                    ok: false,
                    error: reason,
                });
            }
        }

        if (this.activeRequest) {
            const activeRequest = this.activeRequest;
            this.activeRequest = null;
            clearTimeout(activeRequest.timeout);
            activeRequest.resolve?.({
                ok: false,
                error: reason,
            });
        }
    }

    private ensureSocket() {
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
            this.connect();
        }
    }

    private scheduleReconnect() {
        if (this.reconnectTimer) {
            return;
        }

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, this.reconnectDelayMs);
    }

    private clearReconnectTimer() {
        if (!this.reconnectTimer) {
            return;
        }

        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
    }
}
