import { Action } from '../core/router';
import { SDClient } from '../sd/sdClient';
import { DlmClient } from '../lake/dlmClient';
import { StateStore } from '../core/stateStore';
import { KeyDownEvent, IncomingEvent } from '../sd/events';
import { GROUPS } from '../lake/lakeModel';
import { buildSetMute } from '../lake/dlmCommands';

import { SmaartClient } from '../smaart/smaartClient';

export class KeyGroupMuteAction implements Action {
    private sdClient: SDClient;
    private dlmClient: DlmClient;
    private stateStore: StateStore;
    private smaartClient: SmaartClient;
    private type: 'MUTE' | 'UNMUTE' | 'TOGGLE';

    constructor(sdClient: SDClient, dlmClient: DlmClient, stateStore: StateStore, smaartClient: SmaartClient, type: 'MUTE' | 'UNMUTE' | 'TOGGLE' = 'TOGGLE') {
        this.sdClient = sdClient;
        this.dlmClient = dlmClient;
        this.stateStore = stateStore;
        this.smaartClient = smaartClient;
        this.type = type;
    }

    onKeyDown(event: IncomingEvent): void {
        const e = event as KeyDownEvent;
        // Identify Group from settings (default ALL or LR)
        const groupName = e.payload.settings.groupName || 'ALL';
        const group = GROUPS[groupName];

        if (!group) return;

        console.log(`Group Action ${this.type} on ${groupName}`);

        // If Toggle, we need to decide state. logic: if any unmuted -> mute all? if all muted -> unmute?
        // Panic usually means MUTE ALL immediately.
        // Recover means UNMUTE ALL.
        // The user spec has specific keys: "Key 5: ALL Mute toggle (Panic)", "Key 6: ALL Unmute (Recover)"
        // Actually "Key 5: ALL Group Mute toggle". "Key 6: ALL Group Unmute".
        // Wait, "Panic" usually implies specific direction. User said "Key 5: ALL Group Mute toggle (panic)". 
        // If I panic, I want silence. If it toggles back to sound, that's bad panic.
        // But implementation calls for Toggle.

        const actionType = e.payload.settings.muteMode || e.payload.settings.actionType || this.type;

        let targetMute = true;
        if (actionType === 'UNMUTE') {
            targetMute = false;
        } else if (actionType === 'TOGGLE') {
            const members = group.muteMembers.map((m) => this.stateStore.getModule(m.module));
            const anyUnmuted = members.some((m) => m.mute === false);
            targetMute = anyUnmuted;
        } else {
            targetMute = true; // Default to mute for safety
        }

        if (targetMute) {
            // Panic: Stop Generator
            this.smaartClient.setGenerator(false);
        }

        group.muteMembers.forEach(m => {
            this.dlmClient.send(buildSetMute(m.module, targetMute));
            this.stateStore.updateModule(m.module, { mute: targetMute });
        });

        // Update UI
        this.sdClient.setState(e.context, targetMute ? 1 : 0);
    }
}
