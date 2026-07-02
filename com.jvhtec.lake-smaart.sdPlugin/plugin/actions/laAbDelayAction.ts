import { Action } from '../core/router';
import { formatError } from '../core/errorUtils';
import { IncomingEvent, KeyDownEvent, WillAppearEvent, WillDisappearEvent } from '../sd/events';
import { SDClient } from '../sd/sdClient';
import { AbPresetId, applyAbDelayPreset, parseAbDelaySettings } from '../backends/laAbDelayClient';

export class LaAbDelayAction implements Action {
    private sdClient: SDClient;
    private applyInFlight = new Set<string>();

    constructor(sdClient: SDClient) {
        this.sdClient = sdClient;
    }

    onWillAppear(event: WillAppearEvent): void {
        this.updateTitle(event.context, event.payload.settings);
    }

    onWillDisappear(event: WillDisappearEvent): void {
        this.applyInFlight.delete(event.context);
    }

    onDidReceiveSettings(event: IncomingEvent): void {
        if (event.event !== 'didReceiveSettings') return;
        this.updateTitle(event.context, event.payload.settings);
    }

    async onKeyDown(event: IncomingEvent): Promise<void> {
        if (event.event !== 'keyDown') return;
        const e = event as KeyDownEvent;
        if (this.applyInFlight.has(e.context)) {
            return;
        }

        const rawSettings = e.payload.settings || {};
        const parsed = parseAbDelaySettings(rawSettings);
        if (!parsed.ok) {
            this.sdClient.showAlert(e.context);
            this.sdClient.logMessage(`[LA A/B Delay] ${parsed.error}`);
            return;
        }

        const nextPreset: AbPresetId = parsed.settings.activePreset === 'A' ? 'B' : 'A';
        const config = nextPreset === 'A' ? parsed.settings.configA : parsed.settings.configB;

        this.applyInFlight.add(e.context);
        try {
            await applyAbDelayPreset(config, {
                sampleRate: parsed.settings.sampleRate,
                outputCount: parsed.settings.outputCount,
                authEnabled: parsed.settings.authEnabled,
                username: parsed.settings.username,
                password: parsed.settings.password,
                logger: (message) => this.sdClient.logMessage(message),
            });
            this.sdClient.setSettings(e.context, { ...rawSettings, activePreset: nextPreset });
            this.sdClient.setTitle(e.context, nextPreset);
            this.sdClient.showOk(e.context);
        } catch (error) {
            this.sdClient.showAlert(e.context);
            this.sdClient.logMessage(`[LA A/B Delay] Failed to apply preset ${nextPreset}: ${formatError(error)}`);
        } finally {
            this.applyInFlight.delete(e.context);
        }
    }

    private updateTitle(context: string, settings: any) {
        const activePreset = settings?.activePreset === 'A' || settings?.activePreset === 'B'
            ? settings.activePreset
            : null;
        this.sdClient.setTitle(context, activePreset || 'A/B');
    }
}
