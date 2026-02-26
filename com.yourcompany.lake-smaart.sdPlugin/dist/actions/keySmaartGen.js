"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeySmaartGenAction = void 0;
class KeySmaartGenAction {
    smaart;
    sdClient;
    state = false;
    constructor(sdClient, smaart) {
        this.sdClient = sdClient;
        this.smaart = smaart;
    }
    onWillAppear(event) {
        this.sdClient.setState(event.context, this.state ? 1 : 0);
    }
    onKeyDown(event) {
        const e = event;
        this.state = !this.state;
        this.smaart.setGenerator(this.state);
        this.sdClient.setState(e.context, this.state ? 1 : 0);
    }
}
exports.KeySmaartGenAction = KeySmaartGenAction;
