const path = require('path');

const backendModulePath = path.join(__dirname, '..', 'com.jvhtec.lake-smaart.sdPlugin', 'dist', 'backends', 'laHttpBackend.js');
const { LaHttpBackend } = require(backendModulePath);

async function main() {
    const args = process.argv.slice(2);
    const positionals = positionalArgs(args);
    const configuredHost = normalizeCliValue(readOption(args, 'host') || process.env.npm_config_host);
    const configuredSubnet = normalizeCliValue(readOption(args, 'subnet') || process.env.npm_config_subnet);
    const firstPositional = positionals[0];
    const positionalSubnet = !configuredHost && !configuredSubnet && looksLikeSubnet(firstPositional) ? firstPositional : undefined;
    const host = configuredHost || (!configuredSubnet && !positionalSubnet ? firstPositional : undefined);
    const subnet =
        configuredSubnet ||
        positionalSubnet ||
        (host ? undefined : deriveDefaultSubnet(positionals[1] || normalizeCliValue(readOption(args, 'bind') || process.env.npm_config_bind)));
    if (!host && !subnet) {
        printUsage();
        process.exit(1);
    }

    const verbose = readFlag(args, 'verbose') || process.env.npm_config_loglevel === 'verbose';
    const writeChecks = readFlag(args, 'write-checks') || isTrueEnv(process.env.npm_config_write_checks);
    const scanOnly = readFlag(args, 'scan-only') || isTrueEnv(process.env.npm_config_scan_only);
    const username = normalizeCliValue(readOption(args, 'user') || process.env.npm_config_user) || positionals[2];
    const password = normalizeCliValue(readOption(args, 'pass') || process.env.npm_config_pass) || positionals[3];
    const bindAddress =
        normalizeCliValue(readOption(args, 'bind') || process.env.npm_config_bind) ||
        (host ? positionals[1] : positionals[0]);

    const backend = new LaHttpBackend(
        {
            discoverySubnet: subnet || '192.168.1.0/24',
            discoveryHosts: host ? [host] : [],
            bindAddress: bindAddress || undefined,
            username: username || undefined,
            password: password || undefined,
            debugLogging: verbose,
        },
        (message) => console.log(message)
    );

    console.log(
        host
            ? `[la-smoke] Discovering ${host}${bindAddress ? ` via ${bindAddress}` : ''}...`
            : `[la-smoke] Discovering L-Acoustics devices on ${subnet}${bindAddress ? ` via ${bindAddress}` : ''}...`
    );
    const devices = await backend.discover();
    if (devices.length === 0) {
        throw new Error(host ? `No L-Acoustics device responded at ${host}.` : `No L-Acoustics devices responded on ${subnet}.`);
    }

    console.log(`[la-smoke] Discovered ${devices.length} device(s).`);
    devices.forEach((device) => {
        console.log(`[la-smoke] - ${device.address || device.id}: ${device.name}${device.model ? ` (${device.model})` : ''}`);
    });

    if (scanOnly) {
        console.log('[la-smoke] Scan-only mode completed.');
        return;
    }

    for (const device of devices) {
        await runSmokeForDevice(backend, device, writeChecks);
    }
}

async function runSmokeForDevice(backend, device, writeChecks) {
    console.log(`[la-smoke] Device: ${device.name}${device.model ? ` (${device.model})` : ''}`);

    const targets = await backend.getTargets(device);
    const controlTargets = targets.filter((target) => target.kind !== 'preset');
    const presetTargets = targets.filter((target) => target.kind === 'preset');

    console.log(`[la-smoke] Control targets discovered: ${controlTargets.length}`);
    console.log(`[la-smoke] Presets discovered: ${presetTargets.length}`);

    const activePresetIndex = await backend.getActivePresetIndex(device);
    console.log(`[la-smoke] Active preset index: ${activePresetIndex ?? 'unknown'}`);

    for (const target of controlTargets.slice(0, Math.min(2, controlTargets.length))) {
        const state = await backend.getState(target);
        console.log(
            `[la-smoke] ${target.name}: mute=${state.mute ?? 'n/a'} gain=${state.levelDb ?? 'n/a'} volume=${state.volume ?? 'n/a'}`
        );
    }

    if (!writeChecks) {
        console.log('[la-smoke] Read-only checks passed. Re-run with --write-checks to exercise mute/gain/preset writes.');
        return;
    }

    if (controlTargets.length === 0) {
        console.log('[la-smoke] No writable control targets were discovered; skipping mute/gain write checks.');
    } else {
        const outputTarget = controlTargets[0];
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

function positionalArgs(args) {
    return args.filter((value) => !value.startsWith('--'));
}

function normalizeCliValue(value) {
    if (value === undefined || value === null) {
        return undefined;
    }

    const normalized = String(value).trim();
    if (!normalized || normalized === 'true') {
        return undefined;
    }

    return normalized;
}

function deriveDefaultSubnet(bindAddress) {
    if (!bindAddress) {
        return undefined;
    }

    const match = String(bindAddress).trim().match(/^(\d+\.\d+\.\d+)\.\d+$/);
    if (!match) {
        return undefined;
    }

    return `${match[1]}.0/24`;
}

function looksLikeSubnet(value) {
    return typeof value === 'string' && /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(value.trim());
}

function isTrueEnv(value) {
    return value === 'true' || value === '1';
}

function printUsage() {
    console.log(
        'Usage: node scripts/la-smoke.js [--host <ip-or-host> | --subnet <cidr>] [--bind <local-ip>] [--user admin --pass admin] [--verbose] [--write-checks] [--scan-only]'
    );
}

main().catch((error) => {
    console.error('[la-smoke] Failed:', error.message || error);
    process.exit(1);
});
