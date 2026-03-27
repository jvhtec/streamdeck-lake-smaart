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
}

export interface SmaartSignalGeneratorStatus {
    active: boolean;
    gain?: number;
    type?: string;
}

interface PendingRequest {
    resolve: (result: SmaartCommandResult) => void;
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
    private pendingRequests: PendingRequest[] = [];

    constructor(host: string, port: number) {
        this.host = host;
        this.port = port;
    }

    public setTarget(host: string, port: number) {
        const previousWs = this.ws;
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
                previousWs.close();
            }

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
                    console.error('[Smaart] API authentication is required, but this plugin does not yet send a password.');
                    return;
                }

                if (!this.apiReady && (response.authenticationRequired === false || response.applicationName)) {
                    this.isConnected = true;
                    this.apiReady = true;
                    console.log(`[Smaart] API ready on ${this.host}:${this.port}`);
                    this.flushPendingCommands();
                }

                if (response.error) {
                    console.error(`[Smaart] API error: ${response.error}`);
                }

                this.resolvePendingRequest(response);
            });

            ws.on('close', () => {
                if (this.ws !== ws) return;
                this.isConnected = false;
                this.apiReady = false;
                this.ws = null;
                this.clearPending('Connection closed');
                console.log(`[Smaart] Disconnected from ${this.host}:${this.port}`);
            });

            ws.on('error', (err: Error) => {
                if (this.ws !== ws) return;
                this.isConnected = false;
                this.apiReady = false;
                this.clearPending(err.message);
                console.error(`[Smaart] Connection error: ${err.message}`);
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

    public send(command: object): boolean {
        const payload = JSON.stringify(command);
        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.apiReady) {
            this.sendPayload(payload);
            return true;
        }

        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            this.pendingCommands.push({ payload, timeoutMs: 0 });
            console.log(`[Smaart] Queued until API ready: ${payload}`);
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

    private flushPendingCommands() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.apiReady) {
            return;
        }

        while (this.pendingCommands.length > 0) {
            const command = this.pendingCommands.shift();
            if (command) {
                if (command.resolve) {
                    this.trackPendingRequest(command.resolve, command.timeoutMs);
                }
                this.sendPayload(command.payload);
            }
        }
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
            }));
    }

    private request(command: object, timeoutMs = 1500): Promise<SmaartCommandResult> {
        const payload = JSON.stringify(command);

        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.apiReady) {
            return new Promise((resolve) => {
                this.trackPendingRequest(resolve, timeoutMs);
                this.sendPayload(payload);
            });
        }

        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return new Promise((resolve) => {
                this.pendingCommands.push({ payload, resolve, timeoutMs });
                console.log(`[Smaart] Queued request until API ready: ${payload}`);
            });
        }

        console.warn(`[Smaart] Request not sent (connected: ${this.isConnected}, readyState: ${this.ws?.readyState ?? 'none'}): ${payload}`);
        return Promise.resolve({
            ok: false,
            error: 'Not connected to Smaart.',
        });
    }

    private trackPendingRequest(resolve: (result: SmaartCommandResult) => void, timeoutMs: number) {
        const pendingRequest: PendingRequest = {
            resolve,
            timeout: setTimeout(() => {
                const index = this.pendingRequests.indexOf(pendingRequest);
                if (index >= 0) {
                    this.pendingRequests.splice(index, 1);
                }
                resolve({
                    ok: false,
                    error: 'Timed out waiting for a Smaart response.',
                });
            }, timeoutMs),
        };

        this.pendingRequests.push(pendingRequest);
    }

    private resolvePendingRequest(response: any) {
        const pendingRequest = this.pendingRequests.shift();
        if (!pendingRequest) {
            return;
        }

        clearTimeout(pendingRequest.timeout);
        pendingRequest.resolve({
            ok: !response?.error,
            error: response?.error,
            response,
        });
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

        while (this.pendingRequests.length > 0) {
            const pendingRequest = this.pendingRequests.shift();
            if (!pendingRequest) {
                continue;
            }
            clearTimeout(pendingRequest.timeout);
            pendingRequest.resolve({
                ok: false,
                error: reason,
            });
        }
    }
}
