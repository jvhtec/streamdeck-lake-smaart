import { LaHttpClient } from './laHttpClient';
import {
    createUnexpectedStatusError,
    isPropertyWriteSuccessStatus,
    laAmplifiedOutputsPath,
    LaLogFn,
} from './laApi';

export type AbPresetId = 'A' | 'B';

export interface AbDelayTarget {
    host: string;
    delayMs: number;
}

export interface AbDelayConfig {
    name?: string;
    delayUnit?: string;
    targets: AbDelayTarget[];
}

export const AB_DELAY_DEFAULT_SAMPLE_RATE = 96000;
export const AB_DELAY_DEFAULT_OUTPUT_COUNT = 4;
export const AB_DELAY_DEFAULT_USERNAME = 'admin';
export const AB_DELAY_DEFAULT_PASSWORD = 'rest';
export const AB_DELAY_MIN_SAMPLES = 0;
export const AB_DELAY_MAX_SAMPLES = 96000;
export const AB_DELAY_MAX_OUTPUT_COUNT = 64;

export type AbDelayConfigResult =
    | { ok: true; config: AbDelayConfig }
    | { ok: false; error: string };

export function delayMsToSamples(delayMs: number, sampleRate: number): number {
    return Math.round(delayMs * sampleRate / 1000);
}

export function validateAbDelayConfig(value: unknown, label: string): AbDelayConfigResult {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { ok: false, error: `${label} is not a JSON object.` };
    }

    const record = value as Record<string, unknown>;
    if (record.delayUnit !== undefined && record.delayUnit !== 'ms') {
        return { ok: false, error: `${label} has unsupported delayUnit "${String(record.delayUnit)}"; only "ms" is supported.` };
    }

    const targets = record.targets;
    if (!Array.isArray(targets) || targets.length === 0) {
        return { ok: false, error: `${label} must contain a non-empty "targets" array.` };
    }

    const parsedTargets: AbDelayTarget[] = [];
    for (let index = 0; index < targets.length; index++) {
        const target = (targets[index] ?? {}) as Record<string, unknown>;
        const host = typeof target.host === 'string' ? target.host.trim() : '';
        if (!host) {
            return { ok: false, error: `${label} target ${index + 1} is missing a "host" string.` };
        }
        const delayMs = target.delayMs;
        if (typeof delayMs !== 'number' || !Number.isFinite(delayMs)) {
            return { ok: false, error: `${label} target ${index + 1} (${host}) is missing a numeric "delayMs".` };
        }
        parsedTargets.push({ host, delayMs });
    }

    return {
        ok: true,
        config: {
            name: typeof record.name === 'string' ? record.name : undefined,
            delayUnit: 'ms',
            targets: parsedTargets,
        },
    };
}

export interface AbDelaySettings {
    configA: AbDelayConfig;
    configB: AbDelayConfig;
    activePreset?: AbPresetId;
    sampleRate: number;
    outputCount: number;
    authEnabled: boolean;
    username: string;
    password: string;
}

export type AbDelaySettingsResult =
    | { ok: true; settings: AbDelaySettings }
    | { ok: false; error: string };

export function parseAbDelaySettings(raw: any): AbDelaySettingsResult {
    const configAResult = validateAbDelayConfig(raw?.configA, 'Config A');
    if (!configAResult.ok) {
        return { ok: false, error: `${configAResult.error} Load a preset JSON file in the inspector.` };
    }
    const configBResult = validateAbDelayConfig(raw?.configB, 'Config B');
    if (!configBResult.ok) {
        return { ok: false, error: `${configBResult.error} Load a preset JSON file in the inspector.` };
    }

    const sampleRate = coercePositiveInteger(raw?.abSampleRate, AB_DELAY_DEFAULT_SAMPLE_RATE);
    const outputCount = Math.min(
        coercePositiveInteger(raw?.abOutputCount, AB_DELAY_DEFAULT_OUTPUT_COUNT),
        AB_DELAY_MAX_OUTPUT_COUNT
    );
    const authEnabled = raw?.abAuthEnabled === true || raw?.abAuthEnabled === 'true';
    const username = typeof raw?.abAuthUser === 'string' && raw.abAuthUser.trim()
        ? raw.abAuthUser.trim()
        : AB_DELAY_DEFAULT_USERNAME;
    const password = typeof raw?.abAuthPass === 'string' && raw.abAuthPass
        ? raw.abAuthPass
        : AB_DELAY_DEFAULT_PASSWORD;
    const activePreset = raw?.activePreset === 'A' || raw?.activePreset === 'B'
        ? raw.activePreset as AbPresetId
        : undefined;

    return {
        ok: true,
        settings: {
            configA: configAResult.config,
            configB: configBResult.config,
            activePreset,
            sampleRate,
            outputCount,
            authEnabled,
            username,
            password,
        },
    };
}

export interface AbDelayApplyOptions {
    sampleRate: number;
    outputCount: number;
    authEnabled: boolean;
    username?: string;
    password?: string;
    logger?: LaLogFn;
    debugLogging?: boolean;
}

export async function applyAbDelayPreset(config: AbDelayConfig, options: AbDelayApplyOptions): Promise<void> {
    // Convert and range-check every target up front so a bad entry never
    // leaves the fleet half-applied.
    const jobs = config.targets.map((target) => {
        const delaySamples = delayMsToSamples(target.delayMs, options.sampleRate);
        if (delaySamples < AB_DELAY_MIN_SAMPLES || delaySamples > AB_DELAY_MAX_SAMPLES) {
            throw new Error(
                `${target.host}: ${target.delayMs} ms at ${options.sampleRate} Hz is ${delaySamples} samples; ` +
                `allowed range is ${AB_DELAY_MIN_SAMPLES}..${AB_DELAY_MAX_SAMPLES}.`
            );
        }
        return { target, delaySamples };
    });

    await Promise.all(jobs.map(async ({ target, delaySamples }) => {
        const client = new LaHttpClient(
            target.host,
            options.authEnabled ? options.username : undefined,
            options.authEnabled ? options.password : undefined,
            {
                debug: Boolean(options.debugLogging),
                logger: options.logger,
            }
        );
        const body = Array.from({ length: options.outputCount }, () => ({ delay: delaySamples }));
        const response = await client.post(laAmplifiedOutputsPath(), body);
        if (!isPropertyWriteSuccessStatus(response.status)) {
            throw createUnexpectedStatusError(response, [200, 204]);
        }
    }));
}

function coercePositiveInteger(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }
    return Math.round(parsed);
}
