import { Action } from '../core/router';
import { DeviceManager } from '../core/deviceManager';
import { IncomingEvent, DialDownEvent, DialRotateEvent, WillAppearEvent, WillDisappearEvent } from '../sd/events';
import { SDClient } from '../sd/sdClient';

export class LevelEncoderAction implements Action {
    private sdClient: SDClient;
    private deviceManager: DeviceManager;
    private contextTargets = new Map<string, string>();

    constructor(sdClient: SDClient, deviceManager: DeviceManager) {
        this.sdClient = sdClient;
        this.deviceManager = deviceManager;
        this.deviceManager.on('targetStateUpdated', (target, state) => {
            const targetId = this.deviceManager.getTargetId(target);
            for (const [context, mappedTargetId] of this.contextTargets.entries()) {
                if (mappedTargetId === targetId) {
                    this.updateFeedback(context, targetId);
                    if (state.mute !== undefined) {
                        this.sdClient.setState(context, state.mute ? 1 : 0);
                    }
                }
            }
        });
    }

    onWillAppear(event: WillAppearEvent): void {
        const targetId = event.payload.settings.targetId;
        if (targetId) {
            this.deviceManager.registerBinding(event.context, targetId, 'level');
            this.contextTargets.set(event.context, targetId);
            if (!this.deviceManager.getTarget(targetId)) {
                this.sdClient.setFeedback(event.context, { title: 'OFFLINE', value: '--' });
            }
        }
        this.sdClient.setFeedbackLayout(event.context, 'layouts/dialValue.json');
    }

    onWillDisappear(event: WillDisappearEvent): void {
        this.deviceManager.unregisterBinding(event.context);
        this.contextTargets.delete(event.context);
    }

    onDidReceiveSettings(event: IncomingEvent): void {
        if (event.event !== 'didReceiveSettings') return;
        const targetId = event.payload.settings.targetId;
        if (targetId) {
            this.deviceManager.registerBinding(event.context, targetId, 'level');
            this.contextTargets.set(event.context, targetId);
            if (!this.deviceManager.getTarget(targetId)) {
                this.sdClient.setFeedback(event.context, { title: 'OFFLINE', value: '--' });
            }
        }
    }

    async onDialRotate(event: IncomingEvent): Promise<void> {
        if (event.event !== 'dialRotate') return;
        const e = event as DialRotateEvent;
        const { targetId, levelMode, stepSize, minLevel, maxLevel } = e.payload.settings;
        if (!targetId) return;
        const state = this.deviceManager.getTargetState(targetId);
        const current = levelMode === 'volume' ? state?.volume ?? 0 : state?.levelDb ?? 0;
        const step = Number(stepSize) || (levelMode === 'volume' ? 10 : 1);
        let next = current + step * e.payload.ticks;
        const min = Number(minLevel);
        const max = Number(maxLevel);
        if (!Number.isNaN(min)) {
            next = Math.max(next, min);
        }
        if (!Number.isNaN(max)) {
            next = Math.min(next, max);
        }
        await this.deviceManager.setLevel(targetId, next, levelMode === 'volume' ? 'volume' : 'gain');
        this.updateFeedback(e.context, targetId, next, levelMode === 'volume');
    }

    async onDialDown(event: IncomingEvent): Promise<void> {
        if (event.event !== 'dialDown') return;
        const e = event as DialDownEvent;
        const { targetId } = e.payload.settings;
        if (!targetId) return;
        const current = this.deviceManager.getTargetState(targetId)?.mute;
        const next = current === undefined ? true : !current;
        await this.deviceManager.setMute(targetId, next);
        this.updateFeedback(e.context, targetId, undefined, false, next);
    }

    private updateFeedback(context: string, targetId: string, level?: number, isVolume?: boolean, muteOverride?: boolean) {
        const target = this.deviceManager.getTarget(targetId);
        const state = this.deviceManager.getTargetState(targetId);
        if (!target || state?.online === false) {
            this.sdClient.setFeedback(context, { title: target?.name || 'OFFLINE', value: 'OFFLINE' });
            return;
        }
        const mute = muteOverride ?? state?.mute ?? false;
        const resolvedValue = level !== undefined ? level : state?.levelDb ?? state?.volume;
        const volumeMode = isVolume ?? (state?.levelDb === undefined && state?.volume !== undefined);
        const display = resolvedValue === undefined
            ? '--'
            : volumeMode
                ? `${Math.round(resolvedValue)}`
                : `${resolvedValue.toFixed(1)} dB`;

        this.sdClient.setFeedback(context, {
            title: target ? target.name : 'Level',
            value: mute ? `MUTED` : display,
        });
    }
}
