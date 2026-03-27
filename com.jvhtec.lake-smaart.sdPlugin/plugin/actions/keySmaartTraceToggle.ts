import { Action } from '../core/router';
import { IncomingEvent, KeyDownEvent, WillAppearEvent } from '../sd/events';
import { SDClient } from '../sd/sdClient';
import { SmaartClient, SmaartCommandResult } from '../smaart/smaartClient';

export class KeySmaartTraceToggleAction implements Action {
    private smaart: SmaartClient;
    private sdClient: SDClient;
    private visible = true;

    constructor(sdClient: SDClient, smaart: SmaartClient) {
        this.sdClient = sdClient;
        this.smaart = smaart;
    }

    onWillAppear(event: WillAppearEvent): void {
        this.sdClient.setState(event.context, this.visible ? 1 : 0);
    }

    async onKeyDown(event: IncomingEvent): Promise<void> {
        const e = event as KeyDownEvent;
        const nextVisible = !this.visible;

        const result = await this.smaart.setActiveTraceVisible(nextVisible);
        if (!result.ok) {
            this.logFailure('trace visibility', result);
            this.sdClient.showAlert(e.context);
            return;
        }

        this.visible = nextVisible;
        this.sdClient.setState(e.context, this.visible ? 1 : 0);
        this.sdClient.showOk(e.context);
    }

    private logFailure(actionName: string, result: SmaartCommandResult) {
        this.sdClient.logMessage(`[Smaart] ${actionName} failed: ${result.error || 'Unknown error'}`);
    }
}
