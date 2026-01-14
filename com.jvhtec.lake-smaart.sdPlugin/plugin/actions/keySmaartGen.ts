import { Action } from '../core/router';
import { IncomingEvent, KeyDownEvent, WillAppearEvent } from '../sd/events';
import { SDClient } from '../sd/sdClient';
import { SmaartClient } from '../smaart/smaartClient';

export class KeySmaartGenAction implements Action {
    private smaart: SmaartClient;
    private sdClient: SDClient;
    private state = false;

    constructor(sdClient: SDClient, smaart: SmaartClient) {
        this.sdClient = sdClient;
        this.smaart = smaart;
    }

    onWillAppear(event: WillAppearEvent): void {
        this.sdClient.setState(event.context, this.state ? 1 : 0);
    }

    onKeyDown(event: IncomingEvent): void {
        const e = event as KeyDownEvent;
        this.state = !this.state;
        this.smaart.setGenerator(this.state);
        this.sdClient.setState(e.context, this.state ? 1 : 0);
    }
}
