import { Action } from '../core/router';
import { IncomingEvent, KeyDownEvent, WillAppearEvent } from '../sd/events';
import { SDClient } from '../sd/sdClient';
import { SmaartClient } from '../smaart/smaartClient';

export class KeySmaartCaptureAction implements Action {
    private smaart: SmaartClient;
    private sdClient: SDClient;

    constructor(sdClient: SDClient, smaart: SmaartClient) {
        this.sdClient = sdClient;
        this.smaart = smaart;
    }

    onWillAppear(_event: WillAppearEvent): void {}

    onKeyDown(event: IncomingEvent): void {
        const e = event as KeyDownEvent;
        // Trigger capture
        this.smaart.send({ action: 'capture' }); // Hypothetical capture command
        this.sdClient.showAlert(e.context); // Feedback
    }

    onKeyUp(_event: IncomingEvent): void {}
    onDialRotate(): void {}
    onDialPress(): void {}
    onTouchTap(): void {}
}
