/**
 * DLM Command Builders
 */

import { InputPriorityMode } from '../core/types';

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

export function buildGetForceInputPriority(routerIndex: number): string {
    return `Dev.Router.ForceInputPriority?${routerIndex}`;
}

export function buildSetForceInputPriority(routerIndex: number, value: InputPriorityMode): string {
    return `Dev.Router.ForceInputPriority=${routerIndex} ${priorityModeToProtocolValue(value)}`;
}

function priorityModeToProtocolValue(value: InputPriorityMode): number {
    return value === 'auto' ? 0 : parseInt(value, 10);
}
