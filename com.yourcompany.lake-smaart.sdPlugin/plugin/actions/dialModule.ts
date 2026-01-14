import { Action } from '../core/router';
import { SDClient } from '../sd/sdClient';
import { StateStore } from '../core/stateStore';
import { DlmClient } from '../lake/dlmClient';
import { IncomingEvent, WillAppearEvent, DialRotateEvent, DialDownEvent, DialUpEvent } from '../sd/events';
import { ModuleId, getModuleId, GROUPS } from '../lake/lakeModel';
import { buildSetGain, buildSetMute } from '../lake/dlmCommands';

export class DialModuleAction implements Action {
    private sdClient: SDClient;
    private stateStore: StateStore;
    private dlmClient: DlmClient;

    // Per-context state
    private contexts = new Map<string, {
        module: ModuleId;
        isPressed: boolean;
        groupTarget?: 'LR' | 'ALL';
        pressAction: 'mute' | 'reset';
        wasRotated: boolean;
    }>();

    constructor(sdClient: SDClient, stateStore: StateStore, dlmClient: DlmClient) {
        this.sdClient = sdClient;
        this.stateStore = stateStore;
        this.dlmClient = dlmClient;

        // Subscribe to state changes to update feedback
        this.stateStore.on('update', ({ module, state }) => {
            this.updateAllFeedback(module);
        });
    }

    private updateAllFeedback(module: ModuleId) {
        this.contexts.forEach((ctx, contextId) => {
            if (ctx.module === module) {
                this.updateFeedback(contextId);
            }
        });
    }

    private updateFeedback(context: string) {
        const ctx = this.contexts.get(context);
        if (!ctx) return;

        const isGroupMode = ctx.isPressed && ctx.groupTarget;

        if (isGroupMode) {
            // Show Group info
            this.sdClient.setFeedback(context, {
                title: `${ctx.groupTarget} Group`,
                value: 'Adjust', // We don't track group absolute gain easily, just offset
                indicator: 'images/indicator_active' // Placeholder
            });
        } else {
            // Show Module info
            const state = this.stateStore.getModule(ctx.module);
            this.sdClient.setFeedback(context, {
                title: `Module ${ctx.module}`,
                value: state.online ? `${state.gainDb?.toFixed(1)} dB` : 'Offline',
                indicator: state.mute ? 'images/indicator_muted' : 'images/indicator_on',
                icon: state.mute ? 'images/icon_muted' : 'images/icon_on'
            });
        }
    }

    onWillAppear(event: WillAppearEvent): void {
        const column = event.payload.coordinates.column;
        const settings = event.payload.settings || {};
        // Map column (0-3) to Module A-D if no setting
        const module = (settings.moduleSelect as ModuleId) || getModuleId(column) || 'A';

        let groupTarget: 'LR' | 'ALL' | undefined = settings.groupTarget || undefined;
        if (!groupTarget) {
            if (column === 0) groupTarget = 'LR';
            if (column === 1) groupTarget = 'ALL';
        }

        this.contexts.set(event.context, {
            module,
            isPressed: false,
            groupTarget,
            pressAction: settings.pressAction === 'reset' ? 'reset' : 'mute',
            wasRotated: false
        });

        // Initialize view
        this.sdClient.setFeedbackLayout(event.context, 'layouts/dialValue.json'); // or custom ID
        this.updateFeedback(event.context);
    }

    onWillDisappear(event: import("../sd/events").WillDisappearEvent): void {
        this.contexts.delete(event.context);
    }

    onDidReceiveSettings(event: IncomingEvent): void {
        if (!('context' in event)) return;
        const ctx = this.contexts.get(event.context);
        if (!ctx) return;
        const settings = (event as any).payload?.settings || {};

        if (settings.moduleSelect) {
            ctx.module = settings.moduleSelect as ModuleId;
        }
        if (settings.groupTarget !== undefined) {
            ctx.groupTarget = settings.groupTarget || undefined;
        }
        if (settings.pressAction) {
            ctx.pressAction = settings.pressAction === 'reset' ? 'reset' : 'mute';
        }
        this.updateFeedback(event.context);
    }

    onDialRotate(event: IncomingEvent): void {
        const e = event as DialRotateEvent;
        const ctx = this.contexts.get(e.context);
        if (!ctx) return;

        const ticks = e.payload.ticks;
        const step = 0.5; // Configurable ideally
        const diff = ticks * step;
        ctx.wasRotated = true;

        if (ctx.isPressed && ctx.groupTarget) {
            // Group Gain
            console.log(`Adjusting Group ${ctx.groupTarget} by ${diff} dB`);
            const group = GROUPS[ctx.groupTarget];
            group.gainMembers.forEach(m => {
                const current = this.stateStore.getModule(m.module).gainDb ?? -100;
                // Naive: read current, add diff, set. 
                // Better: send relative if supported, OR assume we have fresh state from polling.
                const newGain = current + diff;
                // Clamp if needed
                this.dlmClient.send(buildSetGain(m.module, newGain));
                // Optimistic update
                this.stateStore.updateModule(m.module, { gainDb: newGain });
            });
        } else {
            // Module Gain
            const current = this.stateStore.getModule(ctx.module).gainDb ?? -100;
            const newGain = current + diff;
            this.dlmClient.send(buildSetGain(ctx.module, newGain));
            this.stateStore.updateModule(ctx.module, { gainDb: newGain });
        }
        this.updateFeedback(e.context);
    }

    onDialDown(event: IncomingEvent): void {
        const e = event as DialDownEvent;
        const ctx = this.contexts.get(e.context);
        if (ctx) {
            ctx.isPressed = true;
            ctx.wasRotated = false;
            this.updateFeedback(e.context);
        }
    }

    onDialUp(event: IncomingEvent): void {
        const e = event as DialUpEvent;
        const ctx = this.contexts.get(e.context);
        if (ctx) {
            ctx.isPressed = false;
            if (ctx.wasRotated) {
                ctx.wasRotated = false;
                this.updateFeedback(e.context);
                return;
            }

            if (ctx.pressAction === 'reset') {
                const newGain = 0;
                this.dlmClient.send(buildSetGain(ctx.module, newGain));
                this.stateStore.updateModule(ctx.module, { gainDb: newGain });
            } else {
                const currentMute = this.stateStore.getModule(ctx.module).mute;
                const newMute = !currentMute;
                this.dlmClient.send(buildSetMute(ctx.module, newMute));
                this.stateStore.updateModule(ctx.module, { mute: newMute });
            }

            this.updateFeedback(e.context);
        }
    }
}
