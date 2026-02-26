"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeySmaartTraceToggleAction = void 0;
class KeySmaartTraceToggleAction {
    smaart;
    sdClient;
    visible = true;
    constructor(sdClient, smaart) {
        this.sdClient = sdClient;
        this.smaart = smaart;
    }
    onWillAppear(event) {
        this.sdClient.setState(event.context, this.visible ? 1 : 0);
    }
    onKeyDown(event) {
        const e = event;
        this.visible = !this.visible;
        this.smaart.setActiveTraceVisible(this.visible);
        this.sdClient.setState(e.context, this.visible ? 1 : 0);
    }
}
exports.KeySmaartTraceToggleAction = KeySmaartTraceToggleAction;
