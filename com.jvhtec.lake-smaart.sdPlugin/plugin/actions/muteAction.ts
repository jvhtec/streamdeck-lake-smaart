import { Action } from '../core/router';
import { DeviceManager } from '../core/deviceManager';
import { formatError } from '../core/errorUtils';
import { BackendId } from '../core/types';
import { IncomingEvent, KeyDownEvent, KeyUpEvent, WillAppearEvent, WillDisappearEvent } from '../sd/events';
import { SDClient } from '../sd/sdClient';

interface MuteActionOptions {
    allowedBackend?: BackendId;
    logPrefix?: string;
}

export class MuteAction implements Action {
    private sdClient: SDClient;
    private deviceManager: DeviceManager;
    private lastMuteState = new Map<string, boolean>();
    private contextTargets = new Map<string, string>();
    private allowedBackend?: BackendId;
    private logPrefix: string;

    constructor(sdClient: SDClient, deviceManager: DeviceManager, options: MuteActionOptions = {}) {
        this.sdClient = sdClient;
        this.deviceManager = deviceManager;
        this.allowedBackend = options.allowedBackend;
        this.logPrefix = options.logPrefix || 'Mute';
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
        if (!this.isAllowedTarget(targetId, e.context)) {
            return;
        }
        if (momentary) {
            try {
                await this.deviceManager.setMute(targetId, true);
                this.sdClient.setState(e.context, 1);
            } catch (error) {
                this.sdClient.showAlert(e.context);
                this.sdClient.logMessage(`[${this.logPrefix}] Failed for ${targetId}: ${formatError(error)}`);
            }
            return;
        }
        const current = this.deviceManager.getTargetState(targetId)?.mute;
        const next = current === undefined ? !this.lastMuteState.get(targetId) : !current;
        try {
            await this.deviceManager.setMute(targetId, Boolean(next));
            this.lastMuteState.set(targetId, Boolean(next));
            this.sdClient.setState(e.context, next ? 1 : 0);
        } catch (error) {
            this.sdClient.showAlert(e.context);
            this.sdClient.logMessage(`[${this.logPrefix}] Failed for ${targetId}: ${formatError(error)}`);
        }
    }

    async onKeyUp(event: IncomingEvent): Promise<void> {
        if (event.event !== 'keyUp') return;
        const e = event as KeyUpEvent;
        const { targetId, momentary } = e.payload.settings;
        if (!targetId || !momentary) return;
        if (!this.isAllowedTarget(targetId, e.context)) {
            return;
        }
        try {
            await this.deviceManager.setMute(targetId, false);
            this.sdClient.setState(e.context, 0);
        } catch (error) {
            this.sdClient.showAlert(e.context);
            this.sdClient.logMessage(`[${this.logPrefix}] Failed for ${targetId}: ${formatError(error)}`);
        }
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
}

function formatBackendName(backend: BackendId): string {
    return backend === 'la_http' ? 'L-Acoustics' : 'Lake';
}
