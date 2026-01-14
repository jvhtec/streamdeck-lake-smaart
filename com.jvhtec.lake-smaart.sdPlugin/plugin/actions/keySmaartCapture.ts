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
        this.smaart.send({ action: 'capture' });
        this.sdClient.showAlert(e.context);
    }
}
