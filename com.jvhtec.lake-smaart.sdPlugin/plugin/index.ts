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
import { KeySmaartSplMeterAction } from './actions/keySmaartSplMeter';
import { SmaartGeneratorGainDialAction } from './actions/smaartGeneratorGainDialAction';
import { PiServer } from './piServer';
import { deriveDiscoverySubnet, findIpv4AdapterByAddress, listIpv4Adapters } from './core/networkAdapters';

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
const logPluginMessage = (message: string) => {
    console.log(message);
    sdClient.logMessage(message);
};
const defaultSettings = {
    lakeHost: '',
    lakePort: 6016,
    lakeBindAddress: '',
    lakeDebug: false,
    laBindAddress: '',
    laDiscoverySubnet: '',
    laDiscoveryHosts: '',
    laAuthUser: '',
    laAuthPass: '',
    laDebugLogging: false,
    smaartHost: '127.0.0.1',
    smaartPort: 26000,
};

const dlmClient = new DlmClient({
    host: defaultSettings.lakeHost,
    port: defaultSettings.lakePort,
    bindAddress: defaultSettings.lakeBindAddress,
    debug: defaultSettings.lakeDebug,
});
const lakeBackend = new LakeBackend(dlmClient, {
    host: defaultSettings.lakeHost,
    port: defaultSettings.lakePort,
    bindAddress: defaultSettings.lakeBindAddress,
    debug: defaultSettings.lakeDebug,
});
const laHttpBackend = new LaHttpBackend({
    discoverySubnet: defaultSettings.laDiscoverySubnet,
    discoveryHosts: [],
    bindAddress: defaultSettings.laBindAddress || undefined,
    username: defaultSettings.laAuthUser || undefined,
    password: defaultSettings.laAuthPass || undefined,
    debugLogging: defaultSettings.laDebugLogging,
}, (message) => logPluginMessage(message));
const smaartClient = new SmaartClient(defaultSettings.smaartHost, defaultSettings.smaartPort);

const deviceManager = new DeviceManager([lakeBackend, laHttpBackend]);
deviceManager.on('log', (message: string) => {
    logPluginMessage(`[DeviceManager] ${message}`);
});
dlmClient.on('log', (message: string) => {
    logPluginMessage(message);
});

const router = new Router(sdClient);

function buildLaAdapterCatalog() {
    return listIpv4Adapters().map((adapter) => ({
        address: adapter.address,
        label: adapter.label,
        netmask: adapter.netmask,
        prefixLength: adapter.prefixLength,
        cidr: adapter.cidr,
    }));
}

function buildInspectorCatalog() {
    return {
        devices: deviceManager.getDevices(),
        targets: deviceManager.getTargets(),
        laAdapters: buildLaAdapterCatalog(),
    };
}

function resolveLaBackendSettings(settings: Record<string, any>) {
    const adapters = listIpv4Adapters();
    const configuredBindAddress = String(settings.laBindAddress || defaultSettings.laBindAddress || '').trim();
    const selectedAdapter = findIpv4AdapterByAddress(configuredBindAddress, adapters);
    const configuredSubnet = String(settings.laDiscoverySubnet || defaultSettings.laDiscoverySubnet || '').trim();
    const resolvedSubnet =
        configuredSubnet ||
        (selectedAdapter ? deriveDiscoverySubnet(selectedAdapter.address, selectedAdapter.netmask) || '' : '');

    if (configuredBindAddress && !selectedAdapter) {
        logPluginMessage(`[LA] Selected adapter IP ${configuredBindAddress} is no longer available on this machine.`);
    }

    return {
        bindAddress: selectedAdapter?.address || undefined,
        discoverySubnet: resolvedSubnet,
        discoveryHosts: String(settings.laDiscoveryHosts || '')
            .split(',')
            .map((host: string) => host.trim())
            .filter(Boolean),
        username: settings.laAuthUser || undefined,
        password: settings.laAuthPass || undefined,
        debugLogging:
            settings.laDebugLogging === true ||
            settings.laDebugLogging === 'true' ||
            settings.laDebugLogging === '1',
        adapter: selectedAdapter,
        configuredSubnet,
    };
}

function mapSmaartSplCatalog(response: any) {
    const inputs = Array.isArray(response?.devices)
        ? response.devices.flatMap((device: any) =>
            Array.isArray(device?.activeCalibratedChannels)
                ? device.activeCalibratedChannels
                    .filter((channel: any) => typeof channel?.streamEndpoint === 'string')
                    .map((channel: any) => ({
                        deviceName: device.deviceName || 'Unknown Device',
                        channelName: channel.channelName || 'Unknown Channel',
                        streamEndpoint: channel.streamEndpoint,
                        label: `${device.deviceName || 'Unknown Device'} : ${channel.channelName || 'Unknown Channel'}`,
                    }))
                : []
        )
        : [];

    const metrics = Array.isArray(response?.metrics)
        ? response.metrics.filter((metric: any) => typeof metric === 'string' && metric !== 'FS Peak')
        : [];

    return { inputs, metrics };
}

router.registerAction('com.jvhtec.lake-smaart.level', new LevelEncoderAction(sdClient, deviceManager));
router.registerAction('com.jvhtec.lake-smaart.mute', new MuteAction(sdClient, deviceManager));
router.registerAction('com.jvhtec.lake-smaart.presetRecall', new PresetRecallAction(sdClient, deviceManager));
router.registerAction('com.jvhtec.lake-smaart.smaartgengain', new SmaartGeneratorGainDialAction(sdClient, smaartClient));
router.registerAction('com.jvhtec.lake-smaart.smaartgen', new KeySmaartGenAction(sdClient, smaartClient));
router.registerAction('com.jvhtec.lake-smaart.smaartspl', new KeySmaartSplMeterAction(sdClient, smaartClient));
router.registerAction('com.jvhtec.lake-smaart.smaartcapture', new KeySmaartCaptureAction(sdClient, smaartClient));
router.registerAction('com.jvhtec.lake-smaart.smaartdelay', new KeySmaartComputeDelayAction(sdClient, smaartClient));
router.registerAction('com.jvhtec.lake-smaart.smaarttrace', new KeySmaartTraceToggleAction(sdClient, smaartClient));

// Fallback PI server for paths with URL-breaking characters (e.g. '#')
const pluginPath = __dirname;
const hasUnsafePathChars = /[#?]/.test(pluginPath);
let piServer: PiServer | null = null;
let piServerPort = 0;
let piServerHost = '127.0.0.1';
let piServerToken = '';
let piServerReady: Promise<void> | null = null;

if (hasUnsafePathChars) {
    piServer = new PiServer({
        onGetSettings: (context) => sdClient.getSettings(context),
        onSetSettings: (context, settings) => sdClient.setSettings(context, settings),
        onGetGlobalSettings: () => sdClient.getGlobalSettings(),
        onSetGlobalSettings: (settings) => sdClient.setGlobalSettings(settings),
        onGetCatalog: (respond) => {
            deviceManager.refreshCatalog().then(() => {
                const catalog = buildInspectorCatalog();
                respond(catalog.devices, catalog.targets, catalog.laAdapters);
            }).catch(() => {
                const catalog = buildInspectorCatalog();
                respond(catalog.devices, catalog.targets, catalog.laAdapters);
            });
        },
        onGetSmaartSplCatalog: async (respond) => {
            const result = await smaartClient.getActiveCalibratedInputs();
            const { inputs, metrics } = mapSmaartSplCatalog(result.response);
            respond(inputs, metrics, result.ok ? undefined : result.error);
        },
    });
    piServerReady = piServer.start().then((assignedPort) => {
        piServerPort = assignedPort;
        piServerHost = piServer!.getBoundAddress();
        piServerToken = piServer!.getSessionToken();
        console.log(`[PI Fallback] Plugin path contains special characters.`);
        console.log(`[PI Fallback] Web-based inspector available at http://${piServerHost}:${piServerPort}/`);
    }).catch((err) => {
        console.error('[PI Fallback] Failed to start fallback server:', err);
    });
}

sdClient.onEvents((event) => {
    // Forward settings to fallback PI clients
    if (piServer && event.event === 'didReceiveSettings') {
        piServer.sendSettings(event.context, event.payload.settings);
    }
    if (piServer && event.event === 'didReceiveGlobalSettings') {
        piServer.sendGlobalSettings(event.payload.settings);
    }
    // Auto-open browser PI when the embedded PI can't load
    if (piServerReady && event.event === 'propertyInspectorDidAppear') {
        const piEvent = event;
        piServerReady.then(() => {
            if (!piServerPort) return;
            const isDialAction =
                piEvent.action === 'com.jvhtec.lake-smaart.level' ||
                piEvent.action === 'com.jvhtec.lake-smaart.smaartgengain';
            const page = isDialAction ? 'dial' : 'key';
            const url = `http://${piServerHost}:${piServerPort}/${page}?action=${encodeURIComponent(piEvent.action)}&context=${encodeURIComponent(piEvent.context)}&wsPort=${piServerPort}&token=${encodeURIComponent(piServerToken)}`;
            sdClient.openUrl(url);
        });
    }

    if (event.event === 'didReceiveGlobalSettings') {
        const settings = event.payload.settings || {};
        const configuredLakePort = Number(settings.lakePort);
        const usesLegacyLakePort = !configuredLakePort || configuredLakePort === 1024;
        const resolvedLakePort = usesLegacyLakePort ? defaultSettings.lakePort : configuredLakePort;
        const resolvedLakeDebug =
            settings.lakeDebug === true ||
            settings.lakeDebug === 'true' ||
            settings.lakeDebug === '1';

        if (usesLegacyLakePort) {
            sdClient.setGlobalSettings({
                ...settings,
                lakePort: resolvedLakePort,
            });
        }

        lakeBackend.updateSettings({
            host: settings.lakeHost || defaultSettings.lakeHost,
            port: resolvedLakePort,
            bindAddress: settings.lakeBindAddress || defaultSettings.lakeBindAddress,
            debug: resolvedLakeDebug,
        });
        const resolvedLa = resolveLaBackendSettings(settings);
        laHttpBackend.updateSettings({
            bindAddress: resolvedLa.bindAddress,
            discoverySubnet: resolvedLa.discoverySubnet,
            discoveryHosts: resolvedLa.discoveryHosts,
            username: resolvedLa.username,
            password: resolvedLa.password,
            debugLogging: resolvedLa.debugLogging,
        });
        if (resolvedLa.debugLogging) {
            const bindingDetail = resolvedLa.adapter
                ? `adapter ${resolvedLa.adapter.name} (${resolvedLa.adapter.address}/${resolvedLa.adapter.prefixLength})`
                : resolvedLa.bindAddress
                    ? `adapter IP ${resolvedLa.bindAddress}`
                    : 'system routing';
            const subnetDetail = resolvedLa.discoverySubnet || 'manual hosts only';
            logPluginMessage(`[LA] Using ${bindingDetail}; discovery subnet ${subnetDetail}.`);
        }
        smaartClient.setTarget(
            settings.smaartHost || defaultSettings.smaartHost,
            Number(settings.smaartPort) || defaultSettings.smaartPort
        );
        smaartClient.connect();
        deviceManager.refreshCatalog().catch(() => undefined);
    }
    if (event.event === 'sendToPlugin') {
        const request = event.payload?.request;
        if (request === 'catalog') {
            deviceManager.refreshCatalog().then(() => {
                sdClient.sendToPropertyInspector(event.context, buildInspectorCatalog());
            });
            return;
        }

        if (request === 'smaartSplCatalog') {
            smaartClient.getActiveCalibratedInputs().then((result) => {
                const { inputs, metrics } = mapSmaartSplCatalog(result.response);
                sdClient.sendToPropertyInspector(event.context, {
                    smaartSplInputs: inputs,
                    smaartSplMetrics: metrics,
                    smaartSplError: result.ok ? undefined : result.error,
                });
            });
        }
    }
    router.route(event);
});

sdClient.connect();
deviceManager.start();
smaartClient.connect();
