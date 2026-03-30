import { Action } from '../core/router';
import { DeviceManager } from '../core/deviceManager';
import { formatError } from '../core/errorUtils';
import { BackendId } from '../core/types';
import { IncomingEvent, DialDownEvent, DialRotateEvent, WillAppearEvent, WillDisappearEvent } from '../sd/events';
import { SDClient } from '../sd/sdClient';

interface LevelEncoderActionOptions {
    allowedBackend?: BackendId;
    logPrefix?: string;
}

export class LevelEncoderAction implements Action {
    private sdClient: SDClient;
    private deviceManager: DeviceManager;
    private contextTargets = new Map<string, string>();
    private optimisticStates = new Map<string, { mute?: boolean; levelDb?: number; volume?: number }>();
    private pendingLevelWrites = new Map<string, Promise<void>>();
    private pendingMuteWrites = new Map<string, Promise<void>>();
    private allowedBackend?: BackendId;
    private logPrefix: string;

    constructor(sdClient: SDClient, deviceManager: DeviceManager, options: LevelEncoderActionOptions = {}) {
        this.sdClient = sdClient;
        this.deviceManager = deviceManager;
        this.allowedBackend = options.allowedBackend;
        this.logPrefix = options.logPrefix || 'Level';
        this.deviceManager.on('targetStateUpdated', (target, state) => {
            const targetId = this.deviceManager.getTargetId(target);
            this.mergeObservedState(targetId, state);
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
        if (!this.isAllowedTarget(targetId, e.context)) {
            return;
        }
        const current = this.getCurrentLevel(targetId, levelMode === 'volume');
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
        this.setOptimisticLevel(targetId, next, levelMode === 'volume');

        const mode = levelMode === 'volume' ? 'volume' : 'gain';
        await this.enqueueLevelWrite(targetId, async () => {
            try {
                await this.deviceManager.setLevel(targetId, next, mode);
                this.updateFeedback(e.context, targetId, next, levelMode === 'volume');
            } catch (error) {
                this.restoreObservedLevel(targetId);
                this.sdClient.showAlert(e.context);
                this.sdClient.logMessage(`[${this.logPrefix}] Failed for ${targetId}: ${formatError(error)}`);
            }
        });
    }

    async onDialDown(event: IncomingEvent): Promise<void> {
        if (event.event !== 'dialDown') return;
        const e = event as DialDownEvent;
        const { targetId } = e.payload.settings;
        if (!targetId) return;
        if (!this.isAllowedTarget(targetId, e.context)) {
            return;
        }
        const current = this.getCurrentMute(targetId);
        const next = current === undefined ? true : !current;
        this.setOptimisticMute(targetId, next);

        await this.enqueueMuteWrite(targetId, async () => {
            try {
                await this.deviceManager.setMute(targetId, next);
                this.updateFeedback(e.context, targetId, undefined, false, next);
            } catch (error) {
                this.restoreObservedMute(targetId);
                this.sdClient.showAlert(e.context);
                this.sdClient.logMessage(`[${this.logPrefix}] Failed for ${targetId}: ${formatError(error)}`);
            }
        });
    }

    private updateFeedback(context: string, targetId: string, level?: number, isVolume?: boolean, muteOverride?: boolean) {
        const target = this.deviceManager.getTarget(targetId);
        const state = this.deviceManager.getTargetState(targetId);
        const optimistic = this.optimisticStates.get(targetId);
        if (!target || state?.online === false) {
            this.sdClient.setFeedback(context, { title: target?.name || 'OFFLINE', value: 'OFFLINE' });
            return;
        }
        const mute = muteOverride ?? optimistic?.mute ?? state?.mute ?? false;
        const resolvedValue = level !== undefined
            ? level
            : optimistic?.levelDb ?? optimistic?.volume ?? state?.levelDb ?? state?.volume;
        const volumeMode = isVolume ?? (
            optimistic?.volume !== undefined
                ? true
                : optimistic?.levelDb !== undefined
                    ? false
                    : state?.levelDb === undefined && state?.volume !== undefined
        );
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

    private isAllowedTarget(targetId: string, context: string): boolean {
        if (!this.allowedBackend) {
            return true;
        }

        const target = this.deviceManager.getTarget(targetId);
        if (!target || target.backend === this.allowedBackend) {
            return true;
        }

        this.sdClient.showAlert(context);
        this.sdClient.logMessage(
            `[${this.logPrefix}] Target ${targetId} is not a ${formatBackendName(this.allowedBackend)} target.`
        );
        return false;
    }

    private getCurrentLevel(targetId: string, isVolume: boolean): number {
        const optimistic = this.optimisticStates.get(targetId);
        const state = this.deviceManager.getTargetState(targetId);
        return isVolume
            ? optimistic?.volume ?? state?.volume ?? 0
            : optimistic?.levelDb ?? state?.levelDb ?? 0;
    }

    private getCurrentMute(targetId: string): boolean | undefined {
        const optimistic = this.optimisticStates.get(targetId);
        if (optimistic?.mute !== undefined) {
            return optimistic.mute;
        }
        return this.deviceManager.getTargetState(targetId)?.mute;
    }

    private setOptimisticLevel(targetId: string, value: number, isVolume: boolean) {
        const current = this.optimisticStates.get(targetId) || {};
        this.optimisticStates.set(targetId, isVolume
            ? { ...current, volume: value }
            : { ...current, levelDb: value });
    }

    private setOptimisticMute(targetId: string, mute: boolean) {
        const current = this.optimisticStates.get(targetId) || {};
        this.optimisticStates.set(targetId, { ...current, mute });
    }

    private restoreObservedLevel(targetId: string) {
        const current = this.optimisticStates.get(targetId) || {};
        const state = this.deviceManager.getTargetState(targetId);
        const next = { ...current };

        if (state?.levelDb !== undefined) {
            next.levelDb = state.levelDb;
        } else {
            delete next.levelDb;
        }

        if (state?.volume !== undefined) {
            next.volume = state.volume;
        } else {
            delete next.volume;
        }

        this.storeOptimisticState(targetId, next);
    }

    private restoreObservedMute(targetId: string) {
        const current = this.optimisticStates.get(targetId) || {};
        const state = this.deviceManager.getTargetState(targetId);
        const next = { ...current };

        if (state?.mute !== undefined) {
            next.mute = state.mute;
        } else {
            delete next.mute;
        }

        this.storeOptimisticState(targetId, next);
    }

    private mergeObservedState(targetId: string, state: { mute?: boolean; levelDb?: number; volume?: number }) {
        const current = this.optimisticStates.get(targetId) || {};
        const next = { ...current };

        if (!this.pendingMuteWrites.has(targetId) && state.mute !== undefined) {
            next.mute = state.mute;
        }

        if (!this.pendingLevelWrites.has(targetId)) {
            if (state.levelDb !== undefined) {
                next.levelDb = state.levelDb;
            }
            if (state.volume !== undefined) {
                next.volume = state.volume;
            }
        }

        if (next.mute === undefined && next.levelDb === undefined && next.volume === undefined) {
            this.optimisticStates.delete(targetId);
            return;
        }

        this.storeOptimisticState(targetId, next);
    }

    private async enqueueLevelWrite(targetId: string, writer: () => Promise<void>) {
        const previous = this.pendingLevelWrites.get(targetId) || Promise.resolve();
        let current: Promise<void> = Promise.resolve();
        current = previous
            .catch(() => undefined)
            .then(writer)
            .finally(() => {
                if (this.pendingLevelWrites.get(targetId) === current) {
                    this.pendingLevelWrites.delete(targetId);
                }
            });
        this.pendingLevelWrites.set(targetId, current);
        await current;
    }

    private async enqueueMuteWrite(targetId: string, writer: () => Promise<void>) {
        const previous = this.pendingMuteWrites.get(targetId) || Promise.resolve();
        let current: Promise<void> = Promise.resolve();
        current = previous
            .catch(() => undefined)
            .then(writer)
            .finally(() => {
                if (this.pendingMuteWrites.get(targetId) === current) {
                    this.pendingMuteWrites.delete(targetId);
                }
            });
        this.pendingMuteWrites.set(targetId, current);
        await current;
    }

    private storeOptimisticState(targetId: string, state: { mute?: boolean; levelDb?: number; volume?: number }) {
        if (state.mute === undefined && state.levelDb === undefined && state.volume === undefined) {
            this.optimisticStates.delete(targetId);
            return;
        }

        this.optimisticStates.set(targetId, state);
    }
}

function formatBackendName(backend: BackendId): string {
    return backend === 'la_http' ? 'L-Acoustics' : 'Lake';
}
