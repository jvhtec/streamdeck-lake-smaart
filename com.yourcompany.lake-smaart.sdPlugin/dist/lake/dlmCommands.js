"use strict";
/**
 * DLM Command Builders
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGetMute = buildGetMute;
exports.buildSetMute = buildSetMute;
exports.buildGetGain = buildGetGain;
exports.buildSetGain = buildSetGain;
exports.buildRecallPreset = buildRecallPreset;
function buildGetMute(module) {
    return `Mod.In.Mute?${module}`;
}
function buildSetMute(module, mute) {
    return `Mod.In.Mute=${module} ${mute ? 1 : 0}`;
}
function buildGetGain(module) {
    return `Mod.In.Gain?${module}`;
}
function buildSetGain(module, gain) {
    // Gain formatting might be specific (e.g. fixed point string).
    // Assuming decimal string is accepted.
    return `Mod.In.Gain=${module} ${gain.toFixed(2)}`;
}
function buildRecallPreset(presetNumber) {
    return `Dev.Preset.Recall!${presetNumber}`;
}
