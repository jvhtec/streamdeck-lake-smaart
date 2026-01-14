import { Action } from '../core/router';
import { DeviceManager } from '../core/deviceManager';
import { IncomingEvent, KeyDownEvent, WillAppearEvent, WillDisappearEvent } from '../sd/events';
import { SDClient } from '../sd/sdClient';

const DOUBLE_PRESS_WINDOW_MS = 1200;

export class PresetRecallAction implements Action {
    private sdClient: SDClient;
    private deviceManager: DeviceManager;
    private lastPress = new Map<string, number>();
    private contextTargets = new Map<string, string>();

    constructor(sdClient: SDClient, deviceManager: DeviceManager) {
        this.sdClient = sdClient;
        this.deviceManager = deviceManager;
        this.deviceManager.on('deviceStateUpdated', (device, state) => {
            if (!state || state.activePresetIndex === undefined) return;
            for (const [context, targetId] of this.contextTargets.entries()) {
                const target = this.deviceManager.getTarget(targetId);
                if (!target || target.deviceId !== device.id || target.kind !== 'preset') continue;
                const targetIndex = target.backend === 'lake' ? parseInt(target.id, 10) : target.index;
                if (Number.isNaN(targetIndex)) continue;
                this.sdClient.setState(context, state.activePresetIndex === targetIndex ? 1 : 0);
            }
        });
    }
    }

    onWillAppear(event: WillAppearEvent): void {
        const targetId = event.payload.settings.targetId;
        if (targetId) {
            this.deviceManager.registerBinding(event.context, targetId, 'preset');
            this.contextTargets.set(event.context, targetId);
            if (!this.deviceManager.getTarget(targetId)) {
                this.sdClient.setTitle(event.context, 'OFFLINE');
            }
        }
    }

    onWillDisappear(event: WillDisappearEvent): void {
        this.deviceManager.unregisterBinding(event.context);
        this.contextTargets.delete(event.context);
    }

    onDidReceiveSettings(event: IncomingEvent): void {
        if (event.event !== 'didReceiveSettings') return;
        const targetId = event.payload.settings.targetId;
        if (targetId) {
            this.deviceManager.registerBinding(event.context, targetId, 'preset');
            this.contextTargets.set(event.context, targetId);
            if (!this.deviceManager.getTarget(targetId)) {
                this.sdClient.setTitle(event.context, 'OFFLINE');
            }
        }
    }

    async onKeyDown(event: IncomingEvent): Promise<void> {
        if (event.event !== 'keyDown') return;
        const e = event as KeyDownEvent;
        const { targetId, requireDoublePress } = e.payload.settings;
        if (!targetId) return;

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
