/**
 * DLM Command Builders
 */

export function buildGetMute(module: string): string {
    return `Mod.In.Mute?${module}`;
}

export function buildSetMute(module: string, mute: boolean): string {
    return `Mod.In.Mute=${module} ${mute ? 1 : 0}`;
}

export function buildGetGain(module: string): string {
    return `Mod.In.Gain?${module}`;
}

export function buildSetGain(module: string, gain: number): string {
    // Gain formatting might be specific (e.g. fixed point string).
    // Assuming decimal string is accepted.
    return `Mod.In.Gain=${module} ${gain.toFixed(2)}`;
}

export function buildRecallPreset(presetNumber: number): string {
    return `Dev.Preset.Recall!${presetNumber}`;
}
