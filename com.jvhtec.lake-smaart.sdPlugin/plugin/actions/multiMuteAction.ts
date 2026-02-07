import { Action } from '../core/router';
import { DeviceManager } from '../core/deviceManager';
import { IncomingEvent, KeyDownEvent, KeyUpEvent, WillAppearEvent, WillDisappearEvent } from '../sd/events';
import { SDClient } from '../sd/sdClient';

function uniq(xs: string[]) {
    return Array.from(new Set(xs.map((x) => String(x || '').trim()).filter(Boolean)));
}

export class MultiMuteAction implements Action {
    private sdClient: SDClient;
    private deviceManager: DeviceManager;
    private contextTargets = new Map<string, string[]>();
    private lastState = new Map<string, boolean>();

    constructor(sdClient: SDClient, deviceManager: DeviceManager) {
        this.sdClient = sdClient;
        this.deviceManager = deviceManager;

        this.deviceManager.on('targetStateUpdated', (target, state) => {
            const updatedTargetId = this.deviceManager.getTargetId(target);

            // Update any contexts that include this target.
            for (const [context, targetIds] of this.contextTargets.entries()) {
                if (!targetIds.includes(updatedTargetId)) continue;

                const groupMute = this.computeGroupMute(targetIds);
                if (groupMute !== undefined) {
                    this.sdClient.setState(context, groupMute ? 1 : 0);
                }
                break;
            }
        });
    }

    onWillAppear(event: WillAppearEvent): void {
        const targetIds = uniq(event.payload.settings.targetIds || []);
        if (targetIds.length === 0) {
            this.sdClient.setTitle(event.context, 'NO TARGETS');
            return;
        }

        this.deviceManager.registerBindings(event.context, targetIds, 'mute');
        this.contextTargets.set(event.context, targetIds);

        const groupMute = this.computeGroupMute(targetIds);
        if (groupMute !== undefined) {
            this.sdClient.setState(event.context, groupMute ? 1 : 0);
        }
    }

    onWillDisappear(event: WillDisappearEvent): void {
        this.deviceManager.unregisterBinding(event.context);
        this.contextTargets.delete(event.context);
    }

    onDidReceiveSettings(event: IncomingEvent): void {
        if (event.event !== 'didReceiveSettings') return;
        const targetIds = uniq(event.payload.settings.targetIds || []);
        if (targetIds.length === 0) return;
        this.deviceManager.registerBindings(event.context, targetIds, 'mute');
        this.contextTargets.set(event.context, targetIds);
    }

    async onKeyDown(event: IncomingEvent): Promise<void> {
        if (event.event !== 'keyDown') return;
        const e = event as KeyDownEvent;

        const targetIds = uniq(e.payload.settings.targetIds || []);
        if (targetIds.length === 0) return;

        const momentary = Boolean(e.payload.settings.momentary);
        const desired = e.payload.settings.desiredState; // 'mute'|'unmute'|'toggle'

        let next: boolean;
        if (momentary) {
            // Momentary always mutes while held.
            next = true;
        } else if (desired === 'mute') {
            next = true;
        } else if (desired === 'unmute') {
            next = false;
        } else {
            // Toggle: if ANY is unmuted -> mute all, else unmute all.
            const groupMute = this.computeGroupMute(targetIds);
            if (groupMute === undefined) {
                next = !(this.lastState.get(e.context) ?? false);
            } else {
                next = !groupMute;
            }
        }

        await Promise.all(targetIds.map((id) => this.deviceManager.setMute(id, next)));
        this.lastState.set(e.context, next);
        this.sdClient.setState(e.context, next ? 1 : 0);
    }

    async onKeyUp(event: IncomingEvent): Promise<void> {
        if (event.event !== 'keyUp') return;
        const e = event as KeyUpEvent;
        const momentary = Boolean(e.payload.settings.momentary);
        if (!momentary) return;

        const targetIds = uniq(e.payload.settings.targetIds || []);
        if (targetIds.length === 0) return;

        await Promise.all(targetIds.map((id) => this.deviceManager.setMute(id, false)));
        this.lastState.set(e.context, false);
        this.sdClient.setState(e.context, 0);
    }

    private computeGroupMute(targetIds: string[]): boolean | undefined {
        const states = targetIds
            .map((id) => this.deviceManager.getTargetState(id))
            .filter(Boolean);

        if (states.length === 0) return undefined;
        const mutes = states.map((s) => s?.mute).filter((m) => typeof m === 'boolean') as boolean[];
        if (mutes.length === 0) return undefined;

        // Consider group muted if all known mutes are true.
        return mutes.every(Boolean);
    }
}
