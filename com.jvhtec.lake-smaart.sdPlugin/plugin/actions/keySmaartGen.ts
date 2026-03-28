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

    async onKeyDown(event: IncomingEvent): Promise<void> {
        const e = event as KeyDownEvent;
        const nextState = !this.state;

        const result = await this.smaart.setGeneratorActive(nextState);
        if (!result.ok) {
            this.sdClient.showAlert(e.context);
            return;
        }

        this.state = typeof result.response?.active === 'boolean' ? result.response.active : nextState;
        this.sdClient.setState(e.context, this.state ? 1 : 0);
        this.sdClient.showOk(e.context);
    }
}
