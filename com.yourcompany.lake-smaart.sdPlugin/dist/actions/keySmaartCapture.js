"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeySmaartCaptureAction = void 0;
class KeySmaartCaptureAction {
    smaart;
    sdClient;
    constructor(sdClient, smaart) {
        this.sdClient = sdClient;
        this.smaart = smaart;
    }
    onWillAppear(_event) { }
    onKeyDown(event) {
        const e = event;
        this.smaart.send({ action: 'capture' });
        this.sdClient.showAlert(e.context);
    }
}
exports.KeySmaartCaptureAction = KeySmaartCaptureAction;
