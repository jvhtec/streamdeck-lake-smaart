import { Action } from '../core/router';
import { IncomingEvent, KeyDownEvent, WillAppearEvent, WillDisappearEvent } from '../sd/events';
import { SDClient } from '../sd/sdClient';
import { SmaartClient, SmaartCommandResult } from '../smaart/smaartClient';

export class KeySmaartGenAction implements Action {
    private smaart: SmaartClient;
    private sdClient: SDClient;
    private contexts = new Set<string>();
    private state: boolean | null = null;

    constructor(sdClient: SDClient, smaart: SmaartClient) {
        this.sdClient = sdClient;
        this.smaart = smaart;
    }

    onWillAppear(event: WillAppearEvent): void {
        this.contexts.add(event.context);
        void this.refreshState(event.context);
    }

    onWillDisappear(event: WillDisappearEvent): void {
        this.contexts.delete(event.context);
    }

    async onKeyDown(event: IncomingEvent): Promise<void> {
        const e = event as KeyDownEvent;
        let currentState = this.state;
        if (currentState === null) {
            currentState = await this.loadState(e.context);
        }
        if (currentState === null) {
            this.sdClient.showAlert(e.context);
            return;
        }
        const nextState = !currentState;

        const result = await this.smaart.setGeneratorActive(nextState);
        if (!result.ok) {
            this.logFailure('set generator active state', result);
            this.sdClient.showAlert(e.context);
            return;
        }

        this.state = typeof result.response?.active === 'boolean' ? result.response.active : nextState;
        this.updateVisibleKeys();
        this.sdClient.showOk(e.context);
    }

    private async refreshState(context: string) {
        const state = await this.loadState(context);
        if (state === null) {
            return;
        }

        this.state = state;
        this.updateVisibleKeys();
    }

    private async loadState(context: string): Promise<boolean | null> {
        const result = await this.smaart.getSignalGeneratorStatus();
        if (!result.ok) {
            this.logFailure('load generator status', result);
            this.sdClient.setTitle(context, 'OFFLINE');
            return null;
        }

        this.sdClient.setTitle(context, '');
        return Boolean(result.response?.active);
    }

    private updateVisibleKeys() {
        if (this.state === null) {
            return;
        }

        this.contexts.forEach((context) => {
            this.sdClient.setState(context, this.state ? 1 : 0);
        });
    }

    private logFailure(actionName: string, result: SmaartCommandResult) {
        this.sdClient.logMessage(`[Smaart] ${actionName} failed: ${result.error || 'Unknown error'}`);
    }
}
