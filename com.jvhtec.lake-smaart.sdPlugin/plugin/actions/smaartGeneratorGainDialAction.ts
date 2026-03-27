import { Action } from '../core/router';
import { DialDownEvent, DialRotateEvent, IncomingEvent, WillAppearEvent, WillDisappearEvent } from '../sd/events';
import { SDClient } from '../sd/sdClient';
import {
    SmaartClient,
    SmaartCommandResult,
    SmaartSignalGeneratorStatus,
} from '../smaart/smaartClient';

export class SmaartGeneratorGainDialAction implements Action {
    private sdClient: SDClient;
    private smaart: SmaartClient;
    private contextStates = new Map<string, SmaartSignalGeneratorStatus>();

    constructor(sdClient: SDClient, smaart: SmaartClient) {
        this.sdClient = sdClient;
        this.smaart = smaart;
    }

    onWillAppear(event: WillAppearEvent): void {
        this.sdClient.setFeedbackLayout(event.context, 'layouts/dialValue.json');
        void this.refreshStatus(event.context);
    }

    onWillDisappear(event: WillDisappearEvent): void {
        this.contextStates.delete(event.context);
    }

    onDidReceiveSettings(event: IncomingEvent): void {
        if (event.event !== 'didReceiveSettings') return;
        this.sdClient.setFeedbackLayout(event.context, 'layouts/dialValue.json');
        const cachedState = this.contextStates.get(event.context);
        if (cachedState) {
            this.updateFeedback(event.context, cachedState);
        }
    }

    async onDialRotate(event: IncomingEvent): Promise<void> {
        if (event.event !== 'dialRotate') return;

        const e = event as DialRotateEvent;
        const currentState = await this.ensureStatus(e.context);
        if (!currentState) {
            this.sdClient.showAlert(e.context);
            return;
        }

        const stepSize = Number(e.payload.settings.stepSize);
        const step = Number.isNaN(stepSize) || stepSize === 0 ? 1 : stepSize;
        let nextGain = (currentState.gain ?? 0) + step * e.payload.ticks;

        const minGain = Number(e.payload.settings.minLevel);
        const maxGain = Number(e.payload.settings.maxLevel);
        if (!Number.isNaN(minGain)) {
            nextGain = Math.max(nextGain, minGain);
        }
        if (!Number.isNaN(maxGain)) {
            nextGain = Math.min(nextGain, maxGain);
        }

        nextGain = Number(nextGain.toFixed(2));

        const result = await this.smaart.setGeneratorGain(nextGain);
        if (!result.ok) {
            this.logFailure('set generator gain', result);
            this.sdClient.showAlert(e.context);
            return;
        }

        const updatedState: SmaartSignalGeneratorStatus = {
            ...currentState,
            gain: typeof result.response?.gain === 'number' ? result.response.gain : nextGain,
        };

        this.contextStates.set(e.context, updatedState);
        this.updateFeedback(e.context, updatedState);
    }

    async onDialDown(event: IncomingEvent): Promise<void> {
        if (event.event !== 'dialDown') return;

        const e = event as DialDownEvent;
        const currentState = await this.ensureStatus(e.context);
        if (!currentState) {
            this.sdClient.showAlert(e.context);
            return;
        }

        const nextActive = !currentState.active;
        const result = await this.smaart.setGeneratorActive(nextActive);
        if (!result.ok) {
            this.logFailure('toggle generator active state', result);
            this.sdClient.showAlert(e.context);
            return;
        }

        const updatedState: SmaartSignalGeneratorStatus = {
            ...currentState,
            active: typeof result.response?.active === 'boolean' ? result.response.active : nextActive,
        };

        this.contextStates.set(e.context, updatedState);
        this.sdClient.setState(e.context, updatedState.active ? 1 : 0);
        this.updateFeedback(e.context, updatedState);
        this.sdClient.showOk(e.context);
    }

    private async refreshStatus(context: string) {
        const result = await this.smaart.getSignalGeneratorStatus();
        if (!result.ok) {
            this.logFailure('load generator status', result);
            this.sdClient.setFeedback(context, { title: 'Generator', value: 'OFFLINE' });
            return;
        }

        const state = this.toSignalGeneratorStatus(result.response);
        this.contextStates.set(context, state);
        this.sdClient.setState(context, state.active ? 1 : 0);
        this.updateFeedback(context, state);
    }

    private async ensureStatus(context: string): Promise<SmaartSignalGeneratorStatus | null> {
        const cachedState = this.contextStates.get(context);
        if (cachedState) {
            return cachedState;
        }

        const result = await this.smaart.getSignalGeneratorStatus();
        if (!result.ok) {
            this.logFailure('load generator status', result);
            return null;
        }

        const state = this.toSignalGeneratorStatus(result.response);
        this.contextStates.set(context, state);
        return state;
    }

    private toSignalGeneratorStatus(response: any): SmaartSignalGeneratorStatus {
        return {
            active: Boolean(response?.active),
            gain: typeof response?.gain === 'number' ? response.gain : undefined,
            type: typeof response?.type === 'string' ? response.type : undefined,
        };
    }

    private updateFeedback(context: string, state: SmaartSignalGeneratorStatus) {
        const title = state.active ? 'Gen ON' : 'Gen OFF';
        const value = typeof state.gain === 'number' ? `${state.gain.toFixed(1)} dB` : '--';

        this.sdClient.setFeedback(context, {
            title,
            value,
        });
    }

    private logFailure(actionName: string, result: SmaartCommandResult) {
        this.sdClient.logMessage(`[Smaart] ${actionName} failed: ${result.error || 'Unknown error'}`);
    }
}
