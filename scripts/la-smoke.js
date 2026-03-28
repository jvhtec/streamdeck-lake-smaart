const path = require('path');

const backendModulePath = path.join(__dirname, '..', 'com.jvhtec.lake-smaart.sdPlugin', 'dist', 'backends', 'laHttpBackend.js');
const { LaHttpBackend } = require(backendModulePath);

async function main() {
    const args = process.argv.slice(2);
    const host = readOption(args, 'host') || firstPositionalArg(args) || process.env.npm_config_host;
    if (!host) {
        printUsage();
        process.exit(1);
    }

    const verbose = readFlag(args, 'verbose') || process.env.npm_config_loglevel === 'verbose';
    const writeChecks = readFlag(args, 'write-checks') || isTrueEnv(process.env.npm_config_write_checks);
    const username = readOption(args, 'user') || process.env.npm_config_user;
    const password = readOption(args, 'pass') || process.env.npm_config_pass;
    const bindAddress = readOption(args, 'bind') || process.env.npm_config_bind;

    const backend = new LaHttpBackend(
        {
            discoverySubnet: '192.168.1.0/24',
            discoveryHosts: [host],
            bindAddress: bindAddress || undefined,
            username: username || undefined,
            password: password || undefined,
            debugLogging: verbose,
        },
        (message) => console.log(message)
    );

    console.log(`[la-smoke] Discovering ${host}${bindAddress ? ` via ${bindAddress}` : ''}...`);
    const devices = await backend.discover();
    if (devices.length === 0) {
        throw new Error(`No L-Acoustics device responded at ${host}.`);
    }

    const device = devices[0];
    console.log(`[la-smoke] Device: ${device.name}${device.model ? ` (${device.model})` : ''}`);

    const targets = await backend.getTargets(device);
    const outputTargets = targets.filter((target) => target.kind === 'output');
    const presetTargets = targets.filter((target) => target.kind === 'preset');

    console.log(`[la-smoke] Outputs discovered: ${outputTargets.length}`);
    console.log(`[la-smoke] Presets discovered: ${presetTargets.length}`);

    const activePresetIndex = await backend.getActivePresetIndex(device);
    console.log(`[la-smoke] Active preset index: ${activePresetIndex ?? 'unknown'}`);

    for (const target of outputTargets.slice(0, Math.min(2, outputTargets.length))) {
        const state = await backend.getState(target);
        console.log(
            `[la-smoke] ${target.name}: mute=${state.mute ?? 'n/a'} gain=${state.levelDb ?? 'n/a'} volume=${state.volume ?? 'n/a'}`
        );
    }

    if (!writeChecks) {
        console.log('[la-smoke] Read-only checks passed. Re-run with --write-checks to exercise mute/gain/preset writes.');
        return;
    }

    if (outputTargets.length === 0) {
        console.log('[la-smoke] No writable output targets were discovered; skipping mute/gain write checks.');
    } else {
        const outputTarget = outputTargets[0];
        const initialState = await backend.getState(outputTarget);
        const initialMute = Boolean(initialState.mute);
        const initialGain = typeof initialState.levelDb === 'number' ? initialState.levelDb : 0;

        await backend.setMute(outputTarget, !initialMute);
        const toggledMuteState = await backend.getState(outputTarget);
        ensure(toggledMuteState.mute === !initialMute, 'Mute write check did not take effect.');
        console.log(`[la-smoke] Mute write check passed on ${outputTarget.name}.`);

        await backend.setMute(outputTarget, initialMute);
        const restoredMuteState = await backend.getState(outputTarget);
        ensure(restoredMuteState.mute === initialMute, 'Mute restore check did not take effect.');

        const testGain = clamp(initialGain >= 14 ? initialGain - 1 : initialGain + 1, -60, 15);
        await backend.setLevel(outputTarget, testGain, 'gain');
        const updatedGainState = await backend.getState(outputTarget);
        ensure(updatedGainState.levelDb === testGain, 'Gain write check did not take effect.');
        console.log(`[la-smoke] Gain write check passed on ${outputTarget.name}.`);

        await backend.setLevel(outputTarget, initialGain, 'gain');
        const restoredGainState = await backend.getState(outputTarget);
        ensure(restoredGainState.levelDb === initialGain, 'Gain restore check did not take effect.');
    }

    if (presetTargets.length > 0) {
        const recallTarget = pickPresetTarget(presetTargets, activePresetIndex);
        await backend.recallPreset(device, recallTarget.index);
        const recalledIndex = await backend.getActivePresetIndex(device);
        ensure(recalledIndex === recallTarget.index, 'Preset recall check did not take effect.');
        console.log(`[la-smoke] Preset recall check passed with slot ${recallTarget.index}.`);

        if (typeof activePresetIndex === 'number' && activePresetIndex !== recallTarget.index) {
            await backend.recallPreset(device, activePresetIndex);
            const restoredPresetIndex = await backend.getActivePresetIndex(device);
            ensure(restoredPresetIndex === activePresetIndex, 'Preset restore check did not take effect.');
        }
    } else {
        console.log('[la-smoke] No presets discovered; skipping preset write check.');
    }

    console.log('[la-smoke] Write checks passed and original state was restored where possible.');
}

function pickPresetTarget(presetTargets, activePresetIndex) {
    if (typeof activePresetIndex === 'number') {
        const alternate = presetTargets.find((target) => target.index !== activePresetIndex);
        if (alternate) {
            return alternate;
        }
        const current = presetTargets.find((target) => target.index === activePresetIndex);
        if (current) {
            return current;
        }
    }
    return presetTargets[0];
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value.toFixed(2))));
}

function ensure(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function readOption(args, name) {
    const flag = `--${name}`;
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
}

function readFlag(args, name) {
    return args.includes(`--${name}`);
}

function firstPositionalArg(args) {
    return args.find((value) => !value.startsWith('--'));
}

function isTrueEnv(value) {
    return value === 'true' || value === '1';
}

function printUsage() {
    console.log('Usage: node scripts/la-smoke.js --host <ip-or-host> [--bind <local-ip>] [--user admin --pass admin] [--verbose] [--write-checks]');
}

main().catch((error) => {
    console.error('[la-smoke] Failed:', error.message || error);
    process.exit(1);
});
