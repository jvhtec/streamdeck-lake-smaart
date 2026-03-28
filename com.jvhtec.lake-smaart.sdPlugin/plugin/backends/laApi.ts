import http from 'http';
import type { LaHttpDeviceProfile } from '../core/types';

export type LaLogFn = (message: string) => void;
export type LaControlSupport = 'mute' | 'level' | 'volume';
export type LaP1IndexedInputFamily = 'ana' | 'aes' | 'avb' | 'mic';
export type LaP1InputFamily = LaP1IndexedInputFamily | 'mpl';
export type LaResolvedControlKind = 'input' | 'output';

export interface LaRequestInfo {
    host: string;
    method: string;
    path: string;
    attemptedDigest: boolean;
    usedDigest: boolean;
}

export interface LaRequestResult<T> {
    status: number;
    data: T | null;
    rawText: string;
    headers: http.IncomingHttpHeaders;
    durationMs: number;
    request: LaRequestInfo;
}

export interface LaHttpErrorOptions {
    host: string;
    method: string;
    path: string;
    status?: number;
    cause?: unknown;
}

export class LaHttpError extends Error {
    public readonly host: string;
    public readonly method: string;
    public readonly path: string;
    public readonly status?: number;
    public readonly cause?: unknown;

    constructor(message: string, options: LaHttpErrorOptions) {
        super(message);
        this.name = 'LaHttpError';
        this.host = options.host;
        this.method = options.method;
        this.path = options.path;
        this.status = options.status;
        this.cause = options.cause;
    }
}

export interface LaDeviceInfo {
    name?: string;
    unit_name?: string;
    firmware_version?: string;
    firmware_tag?: string;
    firmware_date?: string;
    serial?: string;
    mac?: string;
    avdecc_entity_id?: string;
}

export interface LaControlObject {
    name?: string;
    mute?: boolean;
    gain?: number;
    volume?: number;
    [key: string]: unknown;
}

export interface LaConfigurationSlot {
    index: number;
    used: boolean;
    name?: string;
}

export interface LaResolvedControlTarget {
    kind: LaResolvedControlKind;
    id: string;
    index?: number;
    name: string;
    path: string;
    supports: LaControlSupport[];
    state: LaControlObject;
    family?: string;
}

const P1_INPUT_FAMILIES: LaP1InputFamily[] = ['ana', 'aes', 'avb', 'mic', 'mpl'];
const AMPLIFIED_DEVICE_NAMES = ['LA1.16I', 'LA7.16', 'LA7.16I', 'LA12X', 'LA4X', 'LA2XI', 'LA8', 'LA4'];
const P1_INPUT_LABELS: Record<LaP1IndexedInputFamily, string> = {
    ana: 'Analog Input',
    aes: 'AES Input',
    avb: 'AVB Input',
    mic: 'Mic Input',
};

export function laInfoPath(): string {
    return '/api/info';
}

export function laAmplifiedOutputsPath(): string {
    return '/api/control/dsp/output';
}

export function laAmplifiedOutputPath(index: number): string {
    return `${laAmplifiedOutputsPath()}/${index}`;
}

export function laP1InputSettingsPath(family?: LaP1InputFamily, index?: number): string {
    let path = '/api/input/settings';
    if (family) {
        path += `/${family}`;
    }
    if (typeof index === 'number' && family && family !== 'mpl') {
        path += `/${index}`;
    }
    return path;
}

export function laControlPropertyPath(basePath: string, property: 'mute' | 'gain' | 'volume'): string {
    return `${basePath}/${property}`;
}

export function laConfigurationLibraryPath(): string {
    return '/api/configuration/library';
}

export function laPresetUsedPath(index: number): string {
    return `${laConfigurationLibraryPath()}/${index}/used`;
}

export function laPresetNamePath(index: number): string {
    return `${laConfigurationLibraryPath()}/${index}/name`;
}

export function laConfigurationLoadPath(): string {
    return '/api/configuration/load';
}

export function laActivePresetIndexPath(): string {
    return '/api/configuration/active/index';
}

export function buildLaConfigurationLoadBody(index: number): { index: number } {
    return { index };
}

export function inferLaDeviceProfile(modelName: string | undefined | null): LaHttpDeviceProfile {
    const normalized = (modelName || '').trim().toUpperCase();
    if (!normalized) {
        return 'unknown';
    }
    if (normalized.includes('P1')) {
        return 'p1';
    }
    if (normalized.includes('LC16D')) {
        return 'lc16d';
    }
    if (AMPLIFIED_DEVICE_NAMES.some((candidate) => normalized.includes(candidate))) {
        return 'amplified';
    }
    return 'unknown';
}

export function asLaDeviceInfo(value: unknown): LaDeviceInfo | null {
    if (!isRecord(value)) return null;

    const data: LaDeviceInfo = {};
    const name = coerceString(value.name);
    const unitName = coerceString(value.unit_name);
    const firmwareVersion = coerceString(value.firmware_version);
    const firmwareTag = coerceString(value.firmware_tag);
    const firmwareDate = coerceString(value.firmware_date);
    const serial = coerceString(value.serial);
    const mac = coerceString(value.mac);
    const avdeccEntityId = coerceString(value.avdecc_entity_id);

    if (name !== null) data.name = name;
    if (unitName !== null) data.unit_name = unitName;
    if (firmwareVersion !== null) data.firmware_version = firmwareVersion;
    if (firmwareTag !== null) data.firmware_tag = firmwareTag;
    if (firmwareDate !== null) data.firmware_date = firmwareDate;
    if (serial !== null) data.serial = serial;
    if (mac !== null) data.mac = mac;
    if (avdeccEntityId !== null) data.avdecc_entity_id = avdeccEntityId;

    return data;
}

export function asLaControls(value: unknown): LaControlObject[] | null {
    if (!Array.isArray(value)) return null;

    const controls: LaControlObject[] = [];
    for (const item of value) {
        const control = asLaControl(item);
        if (!control) {
            return null;
        }
        controls.push(control);
    }

    return controls;
}

export function asLaControl(value: unknown): LaControlObject | null {
    if (!isRecord(value)) return null;

    const control: LaControlObject = { ...value };
    const mute = coerceBoolean(value.mute);
    const gain = coerceNumber(value.gain);
    const volume = coerceNumber(value.volume);
    const name = coerceString(value.name);

    if (mute !== null) control.mute = mute;
    if (gain !== null) control.gain = gain;
    if (volume !== null) control.volume = volume;
    if (name !== null) control.name = name;

    return control;
}

export function asAmplifiedOutputs(value: unknown): LaResolvedControlTarget[] | null {
    const outputs = asLaControls(value);
    if (!outputs) {
        return null;
    }

    return outputs.map((output, index) => {
        const resolvedIndex = index + 1;
        return {
            kind: 'output',
            id: `dsp:${resolvedIndex}`,
            index: resolvedIndex,
            name: formatIndexedLabel('Output', resolvedIndex, coerceString(output.name)),
            path: laAmplifiedOutputPath(resolvedIndex),
            supports: detectLaControlSupports(output),
            state: output,
            family: 'dsp',
        };
    });
}

export function asP1Inputs(value: unknown): LaResolvedControlTarget[] | null {
    if (!isRecord(value)) {
        return null;
    }

    const inputs: LaResolvedControlTarget[] = [];
    for (const family of P1_INPUT_FAMILIES) {
        const familyValue = value[family];
        if (familyValue === undefined) {
            continue;
        }

        if (family === 'mpl') {
            const mplInput = asP1MplInput(familyValue);
            if (!mplInput) {
                return null;
            }
            inputs.push(mplInput);
            continue;
        }

        const familyInputs = asP1InputFamily(family, familyValue);
        if (!familyInputs) {
            return null;
        }
        inputs.push(...familyInputs);
    }

    return inputs.length > 0 ? inputs : null;
}

export function asP1InputFamily(family: LaP1IndexedInputFamily, value: unknown): LaResolvedControlTarget[] | null {
    const inputs = asLaControls(value);
    if (!inputs) {
        return null;
    }

    return inputs.map((input, index) => {
        const resolvedIndex = index + 1;
        const label = P1_INPUT_LABELS[family];
        return {
            kind: 'input',
            id: `${family}:${resolvedIndex}`,
            index: resolvedIndex,
            name: formatIndexedLabel(label, resolvedIndex, coerceString(input.name)),
            path: laP1InputSettingsPath(family, resolvedIndex),
            supports: detectLaControlSupports(input),
            state: input,
            family,
        };
    });
}

export function asP1MplInput(value: unknown): LaResolvedControlTarget | null {
    const input = asLaControl(value);
    if (!input) {
        return null;
    }

    return {
        kind: 'input',
        id: 'mpl',
        index: 1,
        name: formatSingleLabel('MPL Input', coerceString(input.name)),
        path: laP1InputSettingsPath('mpl'),
        supports: detectLaControlSupports(input),
        state: input,
        family: 'mpl',
    };
}

export function asLaConfigurationLibrary(value: unknown): LaConfigurationSlot[] | null {
    if (!Array.isArray(value)) {
        return null;
    }

    const slots: LaConfigurationSlot[] = [];
    value.forEach((item, position) => {
        if (!isRecord(item)) {
            throw new Error('Invalid configuration slot payload.');
        }
        const index = coerceNumber(item.index) ?? position + 1;
        const used = coerceBoolean(item.used);
        if (!Number.isInteger(index) || used === null) {
            throw new Error('Invalid configuration slot fields.');
        }
        slots.push({
            index,
            used,
            name: coerceString(item.name) ?? undefined,
        });
    });

    return slots;
}

export function pickResolvedControlTarget(targets: LaResolvedControlTarget[], id: string): LaResolvedControlTarget | null {
    return targets.find((target) => target.id === id) || null;
}

export function detectLaControlSupports(control: LaControlObject | null): LaControlSupport[] {
    if (!control) {
        return ['mute'];
    }

    const supports: LaControlSupport[] = [];
    if (Object.prototype.hasOwnProperty.call(control, 'mute')) {
        supports.push('mute');
    }
    if (Object.prototype.hasOwnProperty.call(control, 'gain')) {
        supports.push('level');
    }
    if (Object.prototype.hasOwnProperty.call(control, 'volume')) {
        supports.push('volume');
    }

    return supports.length > 0 ? supports : ['mute'];
}

export function coerceBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    return null;
}

export function coerceNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return null;
}

export function coerceString(value: unknown): string | null {
    if (typeof value === 'string') return value;
    return null;
}

export function getLaPresetSlotFallbackCount(profile: LaHttpDeviceProfile): number {
    if (profile === 'p1') {
        return 30;
    }
    return 10;
}

export function isReadSuccessStatus(status: number): boolean {
    return status === 200;
}

export function isPropertyWriteSuccessStatus(status: number): boolean {
    return status === 200 || status === 204;
}

export function isRecallSuccessStatus(status: number): boolean {
    return status === 204;
}

export function createUnexpectedStatusError<T>(
    result: LaRequestResult<T>,
    expectedStatus: number | number[],
    detail?: string
): LaHttpError {
    const expected = Array.isArray(expectedStatus) ? expectedStatus.join(' or ') : String(expectedStatus);
    const suffix = detail ? ` ${detail}` : '';
    return new LaHttpError(
        `L-Acoustics ${result.request.method} ${result.request.path} returned HTTP ${result.status}; expected ${expected}.${suffix}`,
        {
            host: result.request.host,
            method: result.request.method,
            path: result.request.path,
            status: result.status,
        }
    );
}

export function createInvalidPayloadError<T>(result: LaRequestResult<T>, detail: string): LaHttpError {
    return new LaHttpError(
        `L-Acoustics ${result.request.method} ${result.request.path} returned an unexpected payload. ${detail}`,
        {
            host: result.request.host,
            method: result.request.method,
            path: result.request.path,
            status: result.status,
        }
    );
}

export function formatLaRequestSummary<T>(result: LaRequestResult<T>): string {
    const digest = result.request.usedDigest ? ' digest' : '';
    return `${result.request.method} http://${result.request.host}${result.request.path} -> ${result.status} in ${result.durationMs} ms${digest}`;
}

export function formatError(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return String(error);
}

function formatIndexedLabel(prefix: string, index: number, customName: string | null): string {
    const base = `${prefix} ${index}`;
    if (!customName || customName.trim() === '' || customName.trim().toLowerCase() === base.toLowerCase()) {
        return base;
    }
    return `${base} - ${customName.trim()}`;
}

function formatSingleLabel(prefix: string, customName: string | null): string {
    if (!customName || customName.trim() === '' || customName.trim().toLowerCase() === prefix.toLowerCase()) {
        return prefix;
    }
    return `${prefix} - ${customName.trim()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
