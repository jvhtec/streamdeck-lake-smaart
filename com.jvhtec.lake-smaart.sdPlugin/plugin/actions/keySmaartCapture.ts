import { Action } from '../core/router';
import { IncomingEvent, KeyDownEvent, WillAppearEvent } from '../sd/events';
import { SDClient } from '../sd/sdClient';
import { SmaartClient, SmaartCommandResult } from '../smaart/smaartClient';

export class KeySmaartCaptureAction implements Action {
    private smaart: SmaartClient;
    private sdClient: SDClient;

    constructor(sdClient: SDClient, smaart: SmaartClient) {
        this.sdClient = sdClient;
        this.smaart = smaart;
    }

    onWillAppear(_event: WillAppearEvent): void {}

    async onKeyDown(event: IncomingEvent): Promise<void> {
        const e = event as KeyDownEvent;
        const result = await this.smaart.capture();

        if (result.ok) {
            this.sdClient.showOk(e.context);
            return;
        }

        this.logFailure('capture', result);
        this.sdClient.showAlert(e.context);
    }

    private logFailure(actionName: string, result: SmaartCommandResult) {
        this.sdClient.logMessage(`[Smaart] ${actionName} failed: ${result.error || 'Unknown error'}`);
    }
}
