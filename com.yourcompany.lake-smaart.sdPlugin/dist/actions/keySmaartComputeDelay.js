"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeySmaartComputeDelayAction = void 0;
class KeySmaartComputeDelayAction {
    smaart;
    sdClient;
    constructor(sdClient, smaart) {
        this.sdClient = sdClient;
        this.smaart = smaart;
    }
    onWillAppear(_event) { }
    onKeyDown(event) {
        const e = event;
        this.smaart.computeDelay();
        this.sdClient.showAlert(e.context);
    }
}
exports.KeySmaartComputeDelayAction = KeySmaartComputeDelayAction;
