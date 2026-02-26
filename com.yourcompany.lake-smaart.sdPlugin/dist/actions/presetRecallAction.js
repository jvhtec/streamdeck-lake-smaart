"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PresetRecallAction = void 0;
const DOUBLE_PRESS_WINDOW_MS = 1200;
class PresetRecallAction {
    sdClient;
    deviceManager;
    lastPress = new Map();
    contextTargets = new Map();
    constructor(sdClient, deviceManager) {
        this.sdClient = sdClient;
        this.deviceManager = deviceManager;
        this.deviceManager.on('deviceStateUpdated', (device, state) => {
            if (!state || state.activePresetIndex === undefined)
                return;
            for (const [context, targetId] of this.contextTargets.entries()) {
                const target = this.deviceManager.getTarget(targetId);
                if (!target || target.deviceId !== device.id || target.kind !== 'preset')
                    continue;
                const targetIndex = target.backend === 'lake' ? parseInt(target.id, 10) : target.index;
                if (Number.isNaN(targetIndex))
                    continue;
                this.sdClient.setState(context, state.activePresetIndex === targetIndex ? 1 : 0);
            }
        });
    }
    onWillAppear(event) {
        const targetId = event.payload.settings.targetId;
        if (targetId) {
            this.deviceManager.registerBinding(event.context, targetId, 'preset');
            this.contextTargets.set(event.context, targetId);
            if (!this.deviceManager.getTarget(targetId)) {
                this.sdClient.setTitle(event.context, 'OFFLINE');
            }
        }
    }
    onWillDisappear(event) {
        this.deviceManager.unregisterBinding(event.context);
        this.contextTargets.delete(event.context);
    }
    onDidReceiveSettings(event) {
        if (event.event !== 'didReceiveSettings')
            return;
        const targetId = event.payload.settings.targetId;
        if (targetId) {
            this.deviceManager.registerBinding(event.context, targetId, 'preset');
            this.contextTargets.set(event.context, targetId);
            if (!this.deviceManager.getTarget(targetId)) {
                this.sdClient.setTitle(event.context, 'OFFLINE');
            }
        }
    }
    async onKeyDown(event) {
        if (event.event !== 'keyDown')
            return;
        const e = event;
        const { targetId, requireDoublePress } = e.payload.settings;
        if (!targetId)
            return;
        if (requireDoublePress) {
            const last = this.lastPress.get(e.context) || 0;
            const now = Date.now();
            if (now - last > DOUBLE_PRESS_WINDOW_MS) {
                this.lastPress.set(e.context, now);
                this.sdClient.setTitle(e.context, 'Press Again');
                setTimeout(() => this.sdClient.setTitle(e.context, ''), 800);
                return;
            }
        }
        await this.deviceManager.recallPreset(targetId);
        this.sdClient.showOk(e.context);
    }
}
exports.PresetRecallAction = PresetRecallAction;
