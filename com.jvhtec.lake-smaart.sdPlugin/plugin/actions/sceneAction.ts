import { Action } from '../core/router';
import { DeviceManager } from '../core/deviceManager';
import { IncomingEvent, KeyDownEvent, WillAppearEvent, WillDisappearEvent } from '../sd/events';
import { SDClient } from '../sd/sdClient';
import { SmaartClient } from '../smaart/smaartClient';

const DOUBLE_PRESS_WINDOW_MS = 1200;

export type SceneStep =
    | { type: 'mute'; targetIds: string[] }
    | { type: 'unmute'; targetIds: string[] }
    | { type: 'toggleMute'; targetIds: string[] }
    | { type: 'level'; targetId: string; value: number; mode?: 'gain' | 'volume' }
    | { type: 'preset'; targetId: string }
    | { type: 'smaart'; command: 'generator'; state: boolean }
    | { type: 'smaart'; command: 'capture' }
    | { type: 'smaart'; command: 'computeDelay' }
    | { type: 'smaart'; command: 'activeTrace'; visible: boolean };

function uniq(xs: string[]) {
    return Array.from(new Set(xs.map((x) => String(x || '').trim()).filter(Boolean)));
}

async function runSteps(opts: {
    deviceManager: DeviceManager;
    smaartClient: SmaartClient;
    steps: SceneStep[];
    warn?: (msg: string) => void;
}) {
    const warn = opts.warn || (() => undefined);

    for (const step of opts.steps) {
        if (step.type === 'preset') {
            await opts.deviceManager.recallPreset(step.targetId);
            continue;
        }

        if (step.type === 'level') {
            const mode = step.mode === 'volume' ? 'volume' : 'gain';
            await opts.deviceManager.setLevel(step.targetId, Number(step.value), mode);
            continue;
        }

        if (step.type === 'mute' || step.type === 'unmute') {
            const targetIds = uniq(step.targetIds);
            const desired = step.type === 'mute';
            const results = await Promise.allSettled(targetIds.map((id) => opts.deviceManager.setMute(id, desired)));
            const failed = results.filter((r) => r.status === 'rejected');
            if (failed.length) warn(`Scene: ${failed.length}/${results.length} mute ops failed`);
            continue;
        }

        if (step.type === 'toggleMute') {
            const targetIds = uniq(step.targetIds);
            const states = targetIds
                .map((id) => opts.deviceManager.getTargetState(id))
                .filter(Boolean);
            const mutes = states.map((s) => s?.mute).filter((m) => typeof m === 'boolean') as boolean[];
            // If any known mute is false => mute all, else unmute all.
            const desired = mutes.length === 0 ? true : !mutes.every(Boolean);
            const results = await Promise.allSettled(targetIds.map((id) => opts.deviceManager.setMute(id, desired)));
            const failed = results.filter((r) => r.status === 'rejected');
            if (failed.length) warn(`Scene: ${failed.length}/${results.length} toggle ops failed`);
            continue;
        }

        if (step.type === 'smaart') {
            if (step.command === 'generator') {
                opts.smaartClient.setGenerator(Boolean(step.state));
            } else if (step.command === 'capture') {
                // Keep compatibility with existing SmaartClient API (send raw)
                opts.smaartClient.send({ action: 'capture' });
            } else if (step.command === 'computeDelay') {
                opts.smaartClient.computeDelay();
            } else if (step.command === 'activeTrace') {
                opts.smaartClient.setActiveTraceVisible(Boolean(step.visible));
            }
            continue;
        }

        // Exhaustive guard
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _never: never = step;
    }
}

export class SceneAction implements Action {
    private sdClient: SDClient;
    private deviceManager: DeviceManager;
    private smaartClient: SmaartClient;

    private lastPress = new Map<string, number>();

    constructor(sdClient: SDClient, deviceManager: DeviceManager, smaartClient: SmaartClient) {
        this.sdClient = sdClient;
        this.deviceManager = deviceManager;
        this.smaartClient = smaartClient;
    }

    onWillAppear(event: WillAppearEvent): void {
        const name = event.payload.settings.sceneName;
        if (name) {
            this.sdClient.setTitle(event.context, String(name));
        }
    }

    onWillDisappear(_event: WillDisappearEvent): void {
        // nothing
    }

    onDidReceiveSettings(_event: IncomingEvent): void {
        // nothing
    }

    async onKeyDown(event: IncomingEvent): Promise<void> {
        if (event.event !== 'keyDown') return;
        const e = event as KeyDownEvent;
        const steps: SceneStep[] = Array.isArray(e.payload.settings.steps) ? e.payload.settings.steps : [];
        const requireDoublePress = Boolean(e.payload.settings.requireDoublePress);

        if (requireDoublePress) {
            const last = this.lastPress.get(e.context) || 0;
            const now = Date.now();
            if (now - last > DOUBLE_PRESS_WINDOW_MS) {
                this.lastPress.set(e.context, now);
                this.sdClient.setTitle(e.context, 'Press Again');
                setTimeout(() => this.sdClient.setTitle(e.context, e.payload.settings.sceneName || ''), 800);
                return;
            }
        }

        try {
            await runSteps({
                deviceManager: this.deviceManager,
                smaartClient: this.smaartClient,
                steps,
                warn: (msg) => console.warn(msg),
            });
            this.sdClient.showOk(e.context);
        } catch (err) {
            console.error('SceneAction failed:', err);
            this.sdClient.showAlert(e.context);
        }
    }

    public async runScene(steps: SceneStep[]) {
        await runSteps({
            deviceManager: this.deviceManager,
            smaartClient: this.smaartClient,
            steps,
            warn: (msg) => console.warn(msg),
        });
    }
}
