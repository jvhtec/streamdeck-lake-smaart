import { Action } from '../core/router';
import { DialDownEvent, DialRotateEvent, IncomingEvent, WillAppearEvent, WillDisappearEvent } from '../sd/events';
import { SDClient } from '../sd/sdClient';
import { compileHotkeyMacro, MacroOperation, sendWindowsMacro } from '../windows/hotkeyMacro';

interface SmaartFileTransportSettings {
    windowTitle: string;
    activateWindow: boolean;
    focusDelayMs: number;
    betweenStepDelayMs: number;
    previousMacro: string;
    nextMacro: string;
    pressMacro: string;
}

const DEFAULT_SETTINGS: SmaartFileTransportSettings = {
    windowTitle: 'Smaart',
    activateWindow: true,
    focusDelayMs: 120,
    betweenStepDelayMs: 40,
    previousMacro: '',
    nextMacro: '',
    pressMacro: '',
};

export class SmaartFileTransportDialAction implements Action {
    private readonly sdClient: SDClient;
    private readonly feedbackTimers = new Map<string, NodeJS.Timeout>();

    constructor(sdClient: SDClient) {
        this.sdClient = sdClient;
    }

    onWillAppear(event: WillAppearEvent): void {
        const settings = this.ensureSettings(event.context, event.payload.settings);
        this.sdClient.setFeedbackLayout(event.context, 'layouts/dialValue.json');
        this.updateIdleFeedback(event.context, settings);
    }

    onWillDisappear(event: WillDisappearEvent): void {
        const timer = this.feedbackTimers.get(event.context);
        if (timer) {
            clearTimeout(timer);
        }
        this.feedbackTimers.delete(event.context);
    }

    onDidReceiveSettings(event: IncomingEvent): void {
        if (event.event !== 'didReceiveSettings') return;
        const settings = this.ensureSettings(event.context, event.payload.settings);
        this.sdClient.setFeedbackLayout(event.context, 'layouts/dialValue.json');
        this.updateIdleFeedback(event.context, settings);
    }

    async onDialRotate(event: IncomingEvent): Promise<void> {
        if (event.event !== 'dialRotate') return;

        const e = event as DialRotateEvent;
        if (!e.payload.ticks) {
            return;
        }

        const settings = this.readSettings(e.payload.settings);
        const repeatCount = Math.abs(e.payload.ticks);
        const macro = e.payload.ticks > 0 ? settings.nextMacro : settings.previousMacro;
        const label = e.payload.ticks > 0 ? 'NEXT' : 'PREV';

        await this.runConfiguredMacro(e.context, settings, macro, label, repeatCount);
    }

    async onDialDown(event: IncomingEvent): Promise<void> {
        if (event.event !== 'dialDown') return;

        const e = event as DialDownEvent;
        const settings = this.readSettings(e.payload.settings);
        await this.runConfiguredMacro(e.context, settings, settings.pressMacro, 'PLAY/PAUSE', 1);
    }

    private ensureSettings(context: string, rawSettings: any): SmaartFileTransportSettings {
        const settings = this.readSettings(rawSettings);

        const current = rawSettings || {};
        const needsPersist =
            current.windowTitle === undefined ||
            current.activateWindow === undefined ||
            current.focusDelayMs === undefined ||
            current.betweenStepDelayMs === undefined ||
            current.previousMacro === undefined ||
            current.nextMacro === undefined ||
            current.pressMacro === undefined;

        if (needsPersist) {
            this.sdClient.setSettings(context, {
                ...current,
                ...settings,
            });
        }

        return settings;
    }

    private readSettings(rawSettings: any): SmaartFileTransportSettings {
        const settings = rawSettings || {};

        return {
            windowTitle: String(settings.windowTitle ?? DEFAULT_SETTINGS.windowTitle).trim() || DEFAULT_SETTINGS.windowTitle,
            activateWindow:
                settings.activateWindow === undefined
                    ? DEFAULT_SETTINGS.activateWindow
                    : settings.activateWindow === true ||
                        settings.activateWindow === 'true' ||
                        settings.activateWindow === '1',
            focusDelayMs: this.normalizeNumber(settings.focusDelayMs, DEFAULT_SETTINGS.focusDelayMs, 0, 5000),
            betweenStepDelayMs: this.normalizeNumber(settings.betweenStepDelayMs, DEFAULT_SETTINGS.betweenStepDelayMs, 0, 2000),
            previousMacro: String(settings.previousMacro ?? DEFAULT_SETTINGS.previousMacro).trim(),
            nextMacro: String(settings.nextMacro ?? DEFAULT_SETTINGS.nextMacro).trim(),
            pressMacro: String(settings.pressMacro ?? DEFAULT_SETTINGS.pressMacro).trim(),
        };
    }

    private normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
        const parsed = Number(value);
        if (Number.isNaN(parsed)) {
            return fallback;
        }

        return Math.min(Math.max(parsed, min), max);
    }

    private async runConfiguredMacro(
        context: string,
        settings: SmaartFileTransportSettings,
        macro: string,
        actionLabel: string,
        repeatCount: number
    ) {
        if (!macro.trim()) {
            this.logFailure(`${actionLabel.toLowerCase()} macro`, 'Set the macro in the dial inspector first.');
            this.showTransientFeedback(context, settings, 'Smaart File', 'SET MACRO');
            this.sdClient.showAlert(context);
            return;
        }

        const compiled = compileHotkeyMacro(macro);
        if (!compiled.ok) {
            this.logFailure(`${actionLabel.toLowerCase()} macro`, compiled.error || 'Invalid macro.');
            this.showTransientFeedback(context, settings, 'Smaart File', 'INVALID');
            this.sdClient.showAlert(context);
            return;
        }

        const operations = this.repeatOperations(compiled.operations, repeatCount);
        const result = await sendWindowsMacro({
            windowTitle: settings.windowTitle,
            activateWindow: settings.activateWindow,
            focusDelayMs: settings.focusDelayMs,
            betweenStepDelayMs: settings.betweenStepDelayMs,
            operations,
        });

        if (!result.ok) {
            this.logFailure(`${actionLabel.toLowerCase()} macro`, result.error || 'Macro send failed.');
            this.showTransientFeedback(context, settings, 'Smaart File', 'FAILED');
            this.sdClient.showAlert(context);
            return;
        }

        this.sdClient.showOk(context);
        this.showTransientFeedback(
            context,
            settings,
            'Smaart File',
            repeatCount > 1 ? `${actionLabel} x${repeatCount}` : actionLabel
        );
    }

    private repeatOperations(operations: MacroOperation[], repeatCount: number): MacroOperation[] {
        const repeated: MacroOperation[] = [];
        for (let index = 0; index < repeatCount; index++) {
            repeated.push(...operations.map((operation) => ({ ...operation })));
        }
        return repeated;
    }

    private updateIdleFeedback(context: string, settings: SmaartFileTransportSettings) {
        this.sdClient.setFeedback(context, {
            title: 'Smaart File',
            value: this.describeStatus(settings),
        });
    }

    private showTransientFeedback(
        context: string,
        settings: SmaartFileTransportSettings,
        title: string,
        value: string
    ) {
        const existingTimer = this.feedbackTimers.get(context);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        this.sdClient.setFeedback(context, { title, value });
        const timer = setTimeout(() => {
            this.feedbackTimers.delete(context);
            this.updateIdleFeedback(context, settings);
        }, 1200);
        this.feedbackTimers.set(context, timer);
    }

    private describeStatus(settings: SmaartFileTransportSettings): string {
        if (process.platform !== 'win32') {
            return 'WIN ONLY';
        }

        const configuredCount = [settings.previousMacro, settings.nextMacro, settings.pressMacro]
            .filter((value) => value.trim().length > 0)
            .length;

        if (configuredCount === 0) {
            return 'SET MACROS';
        }

        if (configuredCount < 3) {
            return `${configuredCount}/3 SET`;
        }

        return settings.activateWindow ? 'READY' : 'UNFOCUSED';
    }

    private logFailure(actionName: string, error: string) {
        this.sdClient.logMessage(`[Smaart Macro] ${actionName} failed: ${error}`);
    }
}
