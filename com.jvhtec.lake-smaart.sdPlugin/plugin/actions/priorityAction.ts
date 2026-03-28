import { Action } from '../core/router';
import { DeviceManager } from '../core/deviceManager';
import { formatError } from '../core/errorUtils';
import { InputPriorityMode } from '../core/types';
import { IncomingEvent, KeyDownEvent, WillAppearEvent, WillDisappearEvent } from '../sd/events';
import { SDClient } from '../sd/sdClient';

const MULTI_PRESS_WINDOW_MS = 900;

type PriorityTriggerMode = 'fixed' | 'push_count';

export class PriorityAction implements Action {
    private sdClient: SDClient;
    private deviceManager: DeviceManager;
    private contextTargets = new Map<string, string>();
    private contextModes = new Map<string, InputPriorityMode>();
    private contextTriggerModes = new Map<string, PriorityTriggerMode>();
    private contextLastRequestedModes = new Map<string, InputPriorityMode>();
    private contextPressCounts = new Map<string, number>();
    private contextTimers = new Map<string, NodeJS.Timeout>();

    constructor(sdClient: SDClient, deviceManager: DeviceManager) {
        this.sdClient = sdClient;
        this.deviceManager = deviceManager;
        this.deviceManager.on('targetStateUpdated', (target, state) => {
            const targetId = this.deviceManager.getTargetId(target);
            for (const [context, mappedTargetId] of this.contextTargets.entries()) {
                if (mappedTargetId !== targetId || state.priorityMode === undefined) {
                    continue;
                }
                const expectedMode = this.getExpectedModeForContext(context);
                this.sdClient.setState(context, expectedMode === state.priorityMode ? 1 : 0);
            }
        });
    }

    onWillAppear(event: WillAppearEvent): void {
        this.bindContext(event.context, event.payload.settings);
    }

    onWillDisappear(event: WillDisappearEvent): void {
        this.clearPendingContextTimer(event.context);
        this.deviceManager.unregisterBinding(event.context);
        this.contextTargets.delete(event.context);
        this.contextModes.delete(event.context);
        this.contextTriggerModes.delete(event.context);
        this.contextLastRequestedModes.delete(event.context);
        this.contextPressCounts.delete(event.context);
    }

    onDidReceiveSettings(event: IncomingEvent): void {
        if (event.event !== 'didReceiveSettings') return;
        this.bindContext(event.context, event.payload.settings);
    }

    async onKeyDown(event: IncomingEvent): Promise<void> {
        if (event.event !== 'keyDown') return;
        const e = event as KeyDownEvent;
        const { targetId } = e.payload.settings;
        const priorityMode = normalizePriorityMode(e.payload.settings.priorityMode);
        const triggerMode = normalizePriorityTriggerMode(e.payload.settings.priorityTriggerMode);
        if (!targetId) return;

        if (triggerMode === 'push_count') {
            const nextPressCount = Math.min((this.contextPressCounts.get(e.context) || 0) + 1, 4);
            this.contextPressCounts.set(e.context, nextPressCount);
            this.sdClient.setTitle(e.context, `P${nextPressCount}`);
            this.clearPendingContextTimer(e.context);
            const timer = setTimeout(() => {
                const pressCount = this.contextPressCounts.get(e.context) || 1;
                const resolvedMode = mapPressCountToMode(pressCount);
                this.contextPressCounts.delete(e.context);
                this.executePriorityChange(e.context, targetId, resolvedMode).catch(() => undefined);
            }, MULTI_PRESS_WINDOW_MS);
            this.contextTimers.set(e.context, timer);
            return;
        }

        await this.executePriorityChange(e.context, targetId, priorityMode);
    }

    private bindContext(context: string, settings: Record<string, unknown>) {
        const targetId = typeof settings.targetId === 'string' ? settings.targetId : '';
        const priorityMode = normalizePriorityMode(settings.priorityMode);
        const triggerMode = normalizePriorityTriggerMode(settings.priorityTriggerMode);

        this.clearPendingContextTimer(context);
        this.contextPressCounts.delete(context);
        this.contextModes.set(context, priorityMode);
        this.contextTriggerModes.set(context, triggerMode);

        if (!targetId) {
            this.clearPendingContextTimer(context);
            this.deviceManager.unregisterBinding(context);
            this.contextTargets.delete(context);
            return;
        }

        this.deviceManager.registerBinding(context, targetId, 'priority');
        this.contextTargets.set(context, targetId);
        if (!this.deviceManager.getTarget(targetId)) {
            this.sdClient.setTitle(context, 'OFFLINE');
            return;
        }

        const state = this.deviceManager.getTargetState(targetId);
        const expectedMode = this.getExpectedModeForContext(context);
        if (state?.priorityMode !== undefined) {
            this.sdClient.setState(context, expectedMode === state.priorityMode ? 1 : 0);
        }
    }

    private async executePriorityChange(context: string, targetId: string, priorityMode: InputPriorityMode) {
        try {
            await this.deviceManager.setPriority(targetId, priorityMode);
            this.contextLastRequestedModes.set(context, priorityMode);
            this.sdClient.setTitle(context, '');
            this.sdClient.setState(context, 1);
            this.sdClient.showOk(context);
        } catch (error) {
            this.sdClient.setTitle(context, '');
            this.sdClient.showAlert(context);
            this.sdClient.logMessage(`[Priority] Failed for ${targetId}: ${formatError(error)}`);
        } finally {
            this.clearPendingContextTimer(context);
        }
    }

    private getExpectedModeForContext(context: string) {
        const triggerMode = this.contextTriggerModes.get(context) || 'fixed';
        if (triggerMode === 'push_count') {
            return this.contextLastRequestedModes.get(context);
        }
        return this.contextModes.get(context);
    }

    private clearPendingContextTimer(context: string) {
        const timer = this.contextTimers.get(context);
        if (!timer) {
            return;
        }
        clearTimeout(timer);
        this.contextTimers.delete(context);
    }
}

function normalizePriorityMode(value: unknown): InputPriorityMode {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    switch (normalized) {
        case '1':
        case '2':
        case '3':
        case '4':
            return normalized;
        default:
            return 'auto';
    }
}

function normalizePriorityTriggerMode(value: unknown): PriorityTriggerMode {
    return value === 'push_count' ? 'push_count' : 'fixed';
}

function mapPressCountToMode(pressCount: number): InputPriorityMode {
    switch (Math.max(1, Math.min(4, pressCount))) {
        case 2:
            return '2';
        case 3:
            return '3';
        case 4:
            return '4';
        default:
            return '1';
    }
}
