import { Action } from '../core/router';
import { DeviceManager } from '../core/deviceManager';
import { IncomingEvent, KeyDownEvent, KeyUpEvent, WillAppearEvent, WillDisappearEvent } from '../sd/events';
import { SDClient } from '../sd/sdClient';

export class MuteAction implements Action {
    private sdClient: SDClient;
    private deviceManager: DeviceManager;
    private lastMuteState = new Map<string, boolean>();
    private contextTargets = new Map<string, string>();

    constructor(sdClient: SDClient, deviceManager: DeviceManager) {
        this.sdClient = sdClient;
        this.deviceManager = deviceManager;
        this.deviceManager.on('targetStateUpdated', (target, state) => {
            const targetId = this.deviceManager.getTargetId(target);
            for (const [context, mappedTargetId] of this.contextTargets.entries()) {
                if (mappedTargetId === targetId && state.mute !== undefined) {
                    this.sdClient.setState(context, state.mute ? 1 : 0);
                }
            }
        });
    }

    onWillAppear(event: WillAppearEvent): void {
        const targetId = event.payload.settings.targetId;
        if (targetId) {
            this.deviceManager.registerBinding(event.context, targetId, 'mute');
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
            this.deviceManager.registerBinding(event.context, targetId, 'mute');
            this.contextTargets.set(event.context, targetId);
            if (!this.deviceManager.getTarget(targetId)) {
                this.sdClient.setTitle(event.context, 'OFFLINE');
            }
        }
    }

    async onKeyDown(event: IncomingEvent): Promise<void> {
        if (event.event !== 'keyDown') return;
        const e = event as KeyDownEvent;
        const { targetId, momentary } = e.payload.settings;
        if (!targetId) return;
        if (momentary) {
            await this.deviceManager.setMute(targetId, true);
            this.sdClient.setState(e.context, 1);
            return;
        }
        const current = this.deviceManager.getTargetState(targetId)?.mute;
        const next = current === undefined ? !this.lastMuteState.get(targetId) : !current;
        this.lastMuteState.set(targetId, Boolean(next));
        await this.deviceManager.setMute(targetId, Boolean(next));
        this.sdClient.setState(e.context, next ? 1 : 0);
    }

    async onKeyUp(event: IncomingEvent): Promise<void> {
        if (event.event !== 'keyUp') return;
        const e = event as KeyUpEvent;
        const { targetId, momentary } = e.payload.settings;
        if (!targetId || !momentary) return;
        await this.deviceManager.setMute(targetId, false);
        this.sdClient.setState(e.context, 0);
    }
}
