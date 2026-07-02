import { Action } from '../core/router';
import { IncomingEvent, KeyDownEvent, WillAppearEvent, WillDisappearEvent } from '../sd/events';
import { SDClient } from '../sd/sdClient';
import { SmaartClient, SmaartCommandResult } from '../smaart/smaartClient';

export class KeySmaartTraceToggleAction implements Action {
    private smaart: SmaartClient;
    private sdClient: SDClient;
    private contexts = new Set<string>();
    private visible: boolean | null = null;

    constructor(sdClient: SDClient, smaart: SmaartClient) {
        this.sdClient = sdClient;
        this.smaart = smaart;
    }

    onWillAppear(event: WillAppearEvent): void {
        this.contexts.add(event.context);
        void this.refreshVisibility(event.context);
    }

    onWillDisappear(event: WillDisappearEvent): void {
        this.contexts.delete(event.context);
    }

    async onKeyDown(event: IncomingEvent): Promise<void> {
        const e = event as KeyDownEvent;
        let currentVisible = this.visible;
        if (currentVisible === null) {
            currentVisible = await this.loadVisibility(e.context);
        }
        if (currentVisible === null) {
            this.sdClient.showAlert(e.context);
            return;
        }

        const nextVisible = !currentVisible;

        const result = await this.smaart.setActiveTraceVisible(nextVisible);
        if (!result.ok) {
            this.logFailure('trace visibility', result);
            this.sdClient.showAlert(e.context);
            return;
        }

        this.visible = nextVisible;
        this.updateVisibleKeys();
        this.sdClient.showOk(e.context);
    }

    private async refreshVisibility(context: string) {
        const visible = await this.loadVisibility(context);
        if (visible === null) {
            return;
        }

        this.visible = visible;
        this.updateVisibleKeys();
    }

    private async loadVisibility(context: string): Promise<boolean | null> {
        const result = await this.smaart.getActiveTraceVisibility();
        if (!result.ok) {
            this.logFailure('load trace visibility', result);
            this.sdClient.setTitle(context, 'OFFLINE');
            return null;
        }

        this.sdClient.setTitle(context, '');
        return typeof result.response?.visible === 'boolean' ? result.response.visible : null;
    }

    private updateVisibleKeys() {
        if (this.visible === null) {
            return;
        }

        this.contexts.forEach((context) => {
            this.sdClient.setState(context, this.visible ? 1 : 0);
        });
    }

    private logFailure(actionName: string, result: SmaartCommandResult) {
        this.sdClient.logMessage(`[Smaart] ${actionName} failed: ${result.error || 'Unknown error'}`);
    }
}
