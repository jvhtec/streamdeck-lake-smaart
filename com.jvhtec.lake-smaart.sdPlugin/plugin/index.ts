import { SDClient } from './sd/sdClient';
import { Router } from './core/router';
import { DlmClient } from './lake/dlmClient';
import { DeviceManager } from './core/deviceManager';
import { LakeBackend } from './backends/lakeBackend';
import { LaHttpBackend } from './backends/laHttpBackend';
import { LevelEncoderAction } from './actions/levelEncoderAction';
import { MuteAction } from './actions/muteAction';
import { PresetRecallAction } from './actions/presetRecallAction';
import { SmaartClient } from './smaart/smaartClient';
import { KeySmaartGenAction } from './actions/keySmaartGen';
import { KeySmaartCaptureAction } from './actions/keySmaartCapture';
import { KeySmaartComputeDelayAction } from './actions/keySmaartComputeDelay';
import { KeySmaartTraceToggleAction } from './actions/keySmaartTraceToggle';
import { MultiMuteAction } from './actions/multiMuteAction';
import { SceneAction } from './actions/sceneAction';

const args = process.argv.slice(2);
let port = '0';
let uuid = '';
let registerEvent = '';

for (let i = 0; i < args.length; i++) {
    if (args[i] === '-port') {
        port = args[i + 1];
        i++;
    } else if (args[i] === '-pluginUUID') {
        uuid = args[i + 1];
        i++;
    } else if (args[i] === '-registerEvent') {
        registerEvent = args[i + 1];
        i++;
    }
}

const sdClient = new SDClient(port, uuid, registerEvent);

function clampInt(value: number, min: number, max: number) {
    const v = Math.floor(value);
    if (Number.isNaN(v)) return min;
    return Math.min(max, Math.max(min, v));
}

function clampPort(value: number, fallback: number) {
    if (!Number.isFinite(value)) return fallback;
    const v = Math.floor(value);
    if (v < 1 || v > 65535) return fallback;
    return v;
}

const log = (message: string) => {
    // Stream Deck provides a "logMessage" event visible in the plugin logs.
    // Keep console output too for local debugging.
    console.log(message);
    sdClient.logMessage(message);
};

process.on('uncaughtException', (err) => {
    log(`[fatal] uncaughtException: ${err?.stack || String(err)}`);
    // Crash so Stream Deck can restart the plugin cleanly.
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    log(`[fatal] unhandledRejection: ${String(reason)}`);
    // Crash so Stream Deck can restart the plugin cleanly.
    process.exit(1);
});

const defaultSettings = {
    lakeHost: '192.168.0.10',
    lakePort: 1024,
    laDiscoverySubnet: '192.168.0.0/24',
    laDiscoveryHosts: '',
    laAuthUser: '',
    laAuthPass: '',
    smaartHost: '127.0.0.1',
    smaartPort: 26000,

    // Tuning (sane defaults; overridable via Stream Deck global settings)
    devicePollIntervalMs: 500,
    deviceDiscoveryIntervalMs: 60_000,
    presetPollIntervalMs: 1500,

    laMaxConcurrency: 10,
    laRequestTimeoutMs: 1200,
};

const dlmClient = new DlmClient(defaultSettings.lakeHost, defaultSettings.lakePort);
const lakeBackend = new LakeBackend(dlmClient, { host: defaultSettings.lakeHost, port: defaultSettings.lakePort });
const laHttpBackend = new LaHttpBackend({
    discoverySubnet: defaultSettings.laDiscoverySubnet,
    discoveryHosts: [],
    username: defaultSettings.laAuthUser || undefined,
    password: defaultSettings.laAuthPass || undefined,
    maxConcurrency: defaultSettings.laMaxConcurrency,
    requestTimeoutMs: defaultSettings.laRequestTimeoutMs,
});
const smaartClient = new SmaartClient(defaultSettings.smaartHost, defaultSettings.smaartPort);

const deviceManager = new DeviceManager([lakeBackend, laHttpBackend], {
    pollIntervalMs: defaultSettings.devicePollIntervalMs,
    discoveryIntervalMs: defaultSettings.deviceDiscoveryIntervalMs,
    presetPollIntervalMs: defaultSettings.presetPollIntervalMs,
});

deviceManager.on('log', (msg) => {
    log(`[deviceManager] ${msg}`);
});

let lastCatalogLogMs = 0;
deviceManager.on('catalogUpdated', () => {
    const now = Date.now();
    // Avoid spamming Stream Deck logs during periodic discovery.
    if (now - lastCatalogLogMs < 60_000) return;
    lastCatalogLogMs = now;
    log(`[deviceManager] Catalog updated: ${deviceManager.getDevices().length} device(s), ${deviceManager.getTargets().length} target(s)`);
});

const router = new Router(sdClient);

router.registerAction('com.jvhtec.lake-smaart.level', new LevelEncoderAction(sdClient, deviceManager));
router.registerAction('com.jvhtec.lake-smaart.mute', new MuteAction(sdClient, deviceManager));
router.registerAction('com.jvhtec.lake-smaart.presetRecall', new PresetRecallAction(sdClient, deviceManager));
router.registerAction('com.jvhtec.lake-smaart.smaartgen', new KeySmaartGenAction(sdClient, smaartClient));
router.registerAction('com.jvhtec.lake-smaart.smaartcapture', new KeySmaartCaptureAction(sdClient, smaartClient));
router.registerAction('com.jvhtec.lake-smaart.smaartdelay', new KeySmaartComputeDelayAction(sdClient, smaartClient));
router.registerAction('com.jvhtec.lake-smaart.smaarttrace', new KeySmaartTraceToggleAction(sdClient, smaartClient));
const sceneAction = new SceneAction(sdClient, deviceManager, smaartClient);

router.registerAction('com.jvhtec.lake-smaart.multiMute', new MultiMuteAction(sdClient, deviceManager));
router.registerAction('com.jvhtec.lake-smaart.scene', sceneAction);

let started = false;

sdClient.onEvents((event) => {
    if (event.event === 'didReceiveGlobalSettings') {
        const settings = event.payload.settings;
        const lakePort = clampPort(Number(settings.lakePort), defaultSettings.lakePort);
        const smaartPort = clampPort(Number(settings.smaartPort), defaultSettings.smaartPort);

        lakeBackend.updateSettings({
            host: settings.lakeHost || defaultSettings.lakeHost,
            port: lakePort,
        });
        laHttpBackend.updateSettings({
            discoverySubnet: settings.laDiscoverySubnet || defaultSettings.laDiscoverySubnet,
            discoveryHosts: (settings.laDiscoveryHosts || '')
                .split(',')
                .map((host: string) => host.trim())
                .filter(Boolean),
            username: settings.laAuthUser || undefined,
            password: settings.laAuthPass || undefined,
            maxConcurrency: clampInt(Number(settings.laMaxConcurrency) || defaultSettings.laMaxConcurrency, 1, 50),
            requestTimeoutMs: clampInt(Number(settings.laRequestTimeoutMs) || defaultSettings.laRequestTimeoutMs, 100, 30_000),
        });
        smaartClient.setTarget(
            settings.smaartHost || defaultSettings.smaartHost,
            smaartPort
        );
        smaartClient.connect();

        // Apply tuning settings (optional)
        deviceManager.updateConfig({
            pollIntervalMs: Number(settings.devicePollIntervalMs) || defaultSettings.devicePollIntervalMs,
            discoveryIntervalMs: Number(settings.deviceDiscoveryIntervalMs) || defaultSettings.deviceDiscoveryIntervalMs,
            presetPollIntervalMs: Number(settings.presetPollIntervalMs) || defaultSettings.presetPollIntervalMs,
        });

        // Start background discovery/polling only after we've received settings.
        if (!started) {
            started = true;
            deviceManager.start();
        }

        deviceManager.refreshCatalog().catch((err) => log(`[deviceManager] Failed to refresh catalog: ${String(err)}`));
    }
    if (event.event === 'sendToPlugin') {
        const request = event.payload?.request;
        if (request === 'catalog') {
            deviceManager
                .refreshCatalog()
                .then(() => {
                    sdClient.sendToPropertyInspector(event.context, {
                        devices: deviceManager.getDevices(),
                        targets: deviceManager.getTargets(),
                    });
                })
                .catch((err) => {
                    log(`[deviceManager] Failed to refresh catalog: ${String(err)}`);
                });
        }

        if (request === 'runScene') {
            // Property inspector should send steps under payload, but accept legacy top-level too.
            const steps = Array.isArray(event.payload?.steps)
                ? event.payload.steps
                : Array.isArray((event as any).steps)
                  ? (event as any).steps
                  : [];
            sceneAction
                .runScene(steps)
                .then(() => {
                    sdClient.sendToPropertyInspector(event.context, { ok: true });
                })
                .catch((err) => {
                    sdClient.sendToPropertyInspector(event.context, { ok: false, error: String(err) });
                });
        }
    }
    router.route(event);
});

sdClient.connect();
// deviceManager starts after didReceiveGlobalSettings to avoid scanning defaults.
// smaartClient connects after didReceiveGlobalSettings (and is idempotent).
