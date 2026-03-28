import WebSocket from 'ws';
import { Action } from '../core/router';
import { IncomingEvent, KeyDownEvent, WillAppearEvent, WillDisappearEvent } from '../sd/events';
import { SDClient } from '../sd/sdClient';
import { SmaartClient } from '../smaart/smaartClient';

interface SmaartSplSettings {
    splStreamEndpoint: string;
    splMetric: string;
}

interface SmaartSplContextConnection {
    ws: WebSocket;
    settings: SmaartSplSettings;
    reconnectTimer: ReturnType<typeof setTimeout> | null;
}

export class KeySmaartSplMeterAction implements Action {
    private static readonly RECONNECT_DELAY_MS = 2000;
    private static readonly TARGET_FPS = 2;

    private sdClient: SDClient;
    private smaart: SmaartClient;
    private contexts = new Map<string, SmaartSplContextConnection>();

    constructor(sdClient: SDClient, smaart: SmaartClient) {
        this.sdClient = sdClient;
        this.smaart = smaart;
    }

    onWillAppear(event: WillAppearEvent): void {
        this.applySettings(event.context, event.payload.settings);
    }

    onWillDisappear(event: WillDisappearEvent): void {
        this.disconnectContext(event.context);
        this.sdClient.setTitle(event.context, '');
        this.sdClient.setImage(event.context, '');
    }

    onDidReceiveSettings(event: IncomingEvent): void {
        if (event.event !== 'didReceiveSettings') return;
        this.applySettings(event.context, event.payload.settings);
    }

    onKeyDown(event: IncomingEvent): void {
        const e = event as KeyDownEvent;
        const settings = this.normalizeSettings(e.payload.settings);
        if (!settings) {
            this.sdClient.showAlert(e.context);
            return;
        }

        this.connectContext(e.context, settings);
        this.sdClient.showOk(e.context);
    }

    private applySettings(context: string, settings: any) {
        const normalizedSettings = this.normalizeSettings(settings);
        if (!normalizedSettings) {
            this.disconnectContext(context);
            this.updateDisplay(context, {
                label: 'SPL',
                value: 'SET',
                footer: 'CONFIGURE',
                tone: 'warning',
            });
            return;
        }

        const current = this.contexts.get(context);
        if (
            current &&
            current.settings.splStreamEndpoint === normalizedSettings.splStreamEndpoint &&
            current.settings.splMetric === normalizedSettings.splMetric
        ) {
            return;
        }

        this.connectContext(context, normalizedSettings);
    }

    private connectContext(context: string, settings: SmaartSplSettings) {
        this.disconnectContext(context);

        const titlePrefix = this.formatMetricLabel(settings.splMetric);
        this.updateDisplay(context, {
            label: titlePrefix,
            value: '...',
            footer: this.formatEndpointLabel(settings.splStreamEndpoint),
            tone: 'pending',
        });

        const streamUrl = this.smaart.buildStreamUrl(settings.splStreamEndpoint);
        const ws = new WebSocket(streamUrl);
        const connection: SmaartSplContextConnection = {
            ws,
            settings,
            reconnectTimer: null,
        };

        this.contexts.set(context, connection);

        ws.on('open', () => {
            if (this.contexts.get(context)?.ws !== ws) return;

            ws.send(JSON.stringify({
                action: 'set',
                properties: [{ targetFPS: KeySmaartSplMeterAction.TARGET_FPS }],
            }));
        });

        ws.on('message', (data) => {
            if (this.contexts.get(context)?.ws !== ws) return;

            const value = this.extractMetricValue(data.toString(), settings.splMetric);
            if (value === null) return;

            this.updateDisplay(context, {
                label: titlePrefix,
                value: value.toFixed(1),
                footer: this.formatEndpointLabel(settings.splStreamEndpoint),
                tone: this.pickValueTone(value),
            });
        });

        ws.on('close', () => {
            if (this.contexts.get(context)?.ws !== ws) return;
            this.scheduleReconnect(context, settings, `${titlePrefix}\nWAIT`);
        });

        ws.on('error', (error: Error) => {
            if (this.contexts.get(context)?.ws !== ws) return;
            this.sdClient.logMessage(`[Smaart SPL] Stream error for ${settings.splMetric}: ${error.message}`);
            this.scheduleReconnect(context, settings, `${titlePrefix}\nERR`);
        });
    }

    private disconnectContext(context: string) {
        const current = this.contexts.get(context);
        if (!current) {
            return;
        }

        if (current.reconnectTimer) {
            clearTimeout(current.reconnectTimer);
        }

        this.contexts.delete(context);

        if (current.ws.readyState === WebSocket.OPEN || current.ws.readyState === WebSocket.CONNECTING) {
            current.ws.close();
        }
    }

    private scheduleReconnect(context: string, settings: SmaartSplSettings, title: string) {
        const current = this.contexts.get(context);
        if (!current) {
            return;
        }

        if (current.reconnectTimer) {
            return;
        }

        const [label, value = ''] = title.split('\n');
        this.updateDisplay(context, {
            label,
            value,
            footer: this.formatEndpointLabel(settings.splStreamEndpoint),
            tone: value === 'ERR' ? 'error' : 'pending',
        });
        current.reconnectTimer = setTimeout(() => {
            const latest = this.contexts.get(context);
            if (!latest || latest.settings !== settings) {
                return;
            }

            this.connectContext(context, settings);
        }, KeySmaartSplMeterAction.RECONNECT_DELAY_MS);
    }

    private normalizeSettings(settings: any): SmaartSplSettings | null {
        const splStreamEndpoint = typeof settings?.splStreamEndpoint === 'string' ? settings.splStreamEndpoint.trim() : '';
        const splMetric = typeof settings?.splMetric === 'string' ? settings.splMetric.trim() : '';

        if (!splStreamEndpoint || !splMetric) {
            return null;
        }

        return {
            splStreamEndpoint,
            splMetric,
        };
    }

    private extractMetricValue(payload: string, selectedMetric: string): number | null {
        let parsed: any;
        try {
            parsed = JSON.parse(payload);
        } catch {
            return null;
        }

        const metrics = Array.isArray(parsed?.metrics) ? parsed.metrics : [];
        for (const metric of metrics) {
            if (metric && typeof metric[selectedMetric] === 'number') {
                return metric[selectedMetric];
            }
        }

        return null;
    }

    private formatMetricLabel(metric: string): string {
        const replacements: Record<string, string> = {
            'SPL Fast': 'Fast',
            'SPL A Fast': 'A Fast',
            'SPL C Fast': 'C Fast',
            'SPL Slow': 'Slow',
            'SPL A Slow': 'A Slow',
            'SPL C Slow': 'C Slow',
            'Exposure O': 'Exp O',
            'Exposure N': 'Exp N',
        };

        const replacement = replacements[metric];
        if (replacement) {
            return replacement;
        }

        const compact = metric.replace(/^SPL\s+/i, '').replace(/^Exposure\s+/i, 'Exp ');
        return compact.length > 8 ? compact.slice(0, 8) : compact;
    }

    private formatEndpointLabel(streamEndpoint: string): string {
        const trimmed = streamEndpoint.trim().replace(/\/+$/, '');
        const segment = trimmed.split('/').pop() || 'Input';

        try {
            const decoded = decodeURIComponent(segment);
            return decoded.length > 12 ? decoded.slice(0, 12) : decoded;
        } catch {
            return segment.length > 12 ? segment.slice(0, 12) : segment;
        }
    }

    private pickValueTone(value: number): 'good' | 'warn' | 'hot' {
        if (value >= 100) {
            return 'hot';
        }

        if (value >= 90) {
            return 'warn';
        }

        return 'good';
    }

    private updateDisplay(
        context: string,
        options: {
            label: string;
            value: string;
            footer: string;
            tone: 'pending' | 'good' | 'warn' | 'hot' | 'warning' | 'error';
        }
    ) {
        const image = this.renderKeyImage(options);
        this.sdClient.setImage(context, image);
        this.sdClient.setTitle(context, '');
    }

    private renderKeyImage(options: { label: string; value: string; footer: string; tone: string }): string {
        const palette = this.getPalette(options.tone);
        const label = this.escapeXml(options.label.toUpperCase());
        const value = this.escapeXml(options.value);
        const footer = this.escapeXml(options.footer.toUpperCase());
        const unit = this.isNumericValue(options.value) ? 'dB' : '';
        const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.bgStart}" />
      <stop offset="100%" stop-color="${palette.bgEnd}" />
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${palette.accent}" />
      <stop offset="100%" stop-color="${palette.accentSoft}" />
    </linearGradient>
  </defs>
  <rect width="144" height="144" rx="24" fill="url(#bg)" />
  <circle cx="116" cy="28" r="10" fill="${palette.accentSoft}" opacity="0.18" />
  <circle cx="116" cy="28" r="5.5" fill="${palette.accent}" />
  <rect x="16" y="16" width="112" height="4" rx="2" fill="url(#accent)" />
  <text x="18" y="40" font-family="Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="1.2" fill="${palette.label}">${label}</text>
  <text x="72" y="88" text-anchor="middle" font-family="Arial, sans-serif" font-size="${this.pickValueFontSize(options.value)}" font-weight="700" fill="${palette.value}">${value}</text>
  <text x="72" y="107" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="600" letter-spacing="1.4" fill="${palette.subtle}">${unit}</text>
  <rect x="16" y="118" width="112" height="12" rx="6" fill="${palette.footerBg}" />
  <text x="72" y="127" text-anchor="middle" font-family="Arial, sans-serif" font-size="10.5" font-weight="700" letter-spacing="1.1" fill="${palette.footerText}">${footer}</text>
</svg>`.trim();

        return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    }

    private pickValueFontSize(value: string): number {
        if (value.length >= 6) {
            return 38;
        }

        if (value.length >= 5) {
            return 44;
        }

        return 52;
    }

    private isNumericValue(value: string): boolean {
        return /^-?\d+(\.\d+)?$/.test(value);
    }

    private escapeXml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    private getPalette(tone: string) {
        switch (tone) {
            case 'good':
                return {
                    bgStart: '#0e1f1b',
                    bgEnd: '#091412',
                    accent: '#57e0b5',
                    accentSoft: '#1f9d86',
                    label: '#b9efe0',
                    value: '#f4fff8',
                    subtle: '#93cdbd',
                    footerBg: '#143028',
                    footerText: '#9fd8c8',
                };
            case 'warn':
                return {
                    bgStart: '#211a0d',
                    bgEnd: '#151008',
                    accent: '#ffca57',
                    accentSoft: '#d38b18',
                    label: '#ffe6a3',
                    value: '#fff8e4',
                    subtle: '#dbc68a',
                    footerBg: '#36280f',
                    footerText: '#f3d88b',
                };
            case 'hot':
                return {
                    bgStart: '#231111',
                    bgEnd: '#140909',
                    accent: '#ff6b6b',
                    accentSoft: '#cc3a3a',
                    label: '#ffc2c2',
                    value: '#fff2f2',
                    subtle: '#e6a7a7',
                    footerBg: '#381717',
                    footerText: '#f0b1b1',
                };
            case 'warning':
                return {
                    bgStart: '#20160d',
                    bgEnd: '#130d08',
                    accent: '#ffb347',
                    accentSoft: '#c7821c',
                    label: '#ffd29a',
                    value: '#fff4e5',
                    subtle: '#ddb889',
                    footerBg: '#322112',
                    footerText: '#eec18b',
                };
            case 'error':
                return {
                    bgStart: '#251115',
                    bgEnd: '#15090b',
                    accent: '#ff5d7a',
                    accentSoft: '#b4233f',
                    label: '#ffc1cb',
                    value: '#fff0f3',
                    subtle: '#d8a0aa',
                    footerBg: '#36131a',
                    footerText: '#ebb0bb',
                };
            default:
                return {
                    bgStart: '#101820',
                    bgEnd: '#0a1016',
                    accent: '#65d6ff',
                    accentSoft: '#267ca0',
                    label: '#b8e8f7',
                    value: '#f2fbff',
                    subtle: '#92b7c4',
                    footerBg: '#132630',
                    footerText: '#9dc9d8',
                };
        }
    }
}
