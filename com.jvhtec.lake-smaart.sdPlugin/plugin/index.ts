import { SDClient } from './sd/sdClient';
import { Router } from './core/router';
import { DlmClient } from './lake/dlmClient';
import { DeviceManager } from './core/deviceManager';
import { LakeBackend } from './backends/lakeBackend';
import { LaHttpBackend } from './backends/laHttpBackend';
import { LevelEncoderAction } from './actions/levelEncoderAction';
import { MuteAction } from './actions/muteAction';
import { PriorityAction } from './actions/priorityAction';
import { PresetRecallAction } from './actions/presetRecallAction';
import { SmaartClient } from './smaart/smaartClient';
import { KeySmaartGenAction } from './actions/keySmaartGen';
import { KeySmaartCaptureAction } from './actions/keySmaartCapture';
import { KeySmaartComputeDelayAction } from './actions/keySmaartComputeDelay';
import { KeySmaartTraceToggleAction } from './actions/keySmaartTraceToggle';
import { KeySmaartSplMeterAction } from './actions/keySmaartSplMeter';
import { SmaartGeneratorGainDialAction } from './actions/smaartGeneratorGainDialAction';
import { SmaartFileTransportDialAction } from './actions/smaartFileTransportDialAction';
import { PiServer } from './piServer';
import { deriveDiscoverySubnet, findIpv4AdapterByAddress, listIpv4Adapters } from './core/networkAdapters';
import { buildInspectorDevices } from './core/inspectorCatalog';

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
const discoverySettingKeys = [
    'lakeHost',
    'lakePort',
    'lakeBindAddress',
    'lakeDebug',
    'laBindAddress',
    'laDiscoverySubnet',
    'laDiscoveryHosts',
    'laAuthUser',
    'laAuthPass',
    'laDebugLogging',
    'smaartHost',
    'smaartPort',
] as const;
let currentDiscoverySettings: Record<string, any> = {};

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
const openInspectorContexts = new Set<string>();
const visibleActionContexts = new Map<string, {
    action: string;
    context: string;
    controller?: string;
    coordinates?: { column: number; row: number };
}>();
deviceManager.on('log', (message: string) => {
    logPluginMessage(`[DeviceManager] ${message}`);
});
deviceManager.on('catalogUpdated', () => {
    const catalog = buildInspectorCatalog();

    openInspectorContexts.forEach((context) => {
        sdClient.sendToPropertyInspector(context, catalog);
    });

    if (piServer) {
        piServer.sendCatalog(catalog.devices, catalog.targets, catalog.laAdapters);
    }
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
    const devices = deviceManager.getDevices();
    const targets = deviceManager.getTargets();
    return {
        devices: buildInspectorDevices(devices, targets),
        targets,
        laAdapters: buildLaAdapterCatalog(),
    };
}

function resolveLakeBackendSettings(settings: Record<string, any>, port: number, debug: boolean) {
    const adapters = listIpv4Adapters();
    const configuredBindAddress = String(settings.lakeBindAddress || defaultSettings.lakeBindAddress || '').trim();
    const selectedAdapter = findIpv4AdapterByAddress(configuredBindAddress, adapters);

    if (configuredBindAddress && !selectedAdapter) {
        logPluginMessage(`[Lake] Selected adapter IP ${configuredBindAddress} is no longer available on this machine.`);
    }

    return {
        host: settings.lakeHost || defaultSettings.lakeHost,
        port,
        bindAddress: selectedAdapter?.address || undefined,
        bindNetmask: selectedAdapter?.netmask || undefined,
        debug,
        adapter: selectedAdapter,
        configuredBindAddress,
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

function isEmptyDiscoveryValue(value: unknown) {
    return value == null || (typeof value === 'string' && value.trim() === '');
}

function mergeDiscoverySettings(
    base: Record<string, any>,
    overrides: Record<string, any>,
    options: { ignoreEmptyValues?: boolean } = {}
) {
    const next = { ...base };
    discoverySettingKeys.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(overrides, key)) {
            if (options.ignoreEmptyValues && isEmptyDiscoveryValue(overrides[key])) {
                return;
            }
            next[key] = overrides[key];
        }
    });
    return next;
}

function hasDiscoverySettings(settings: Record<string, any> | undefined | null) {
    if (!settings) {
        return false;
    }

    return discoverySettingKeys.some((key) => Object.prototype.hasOwnProperty.call(settings, key));
}

function applyDiscoverySettings(settings: Record<string, any>, options: { ignoreEmptyValues?: boolean } = {}) {
    currentDiscoverySettings = mergeDiscoverySettings(currentDiscoverySettings, settings, options);

    const configuredLakePort = Number(currentDiscoverySettings.lakePort);
    const usesLegacyLakePort = !configuredLakePort || configuredLakePort === 1024;
    const resolvedLakePort = usesLegacyLakePort ? defaultSettings.lakePort : configuredLakePort;
    const resolvedLakeDebug =
        currentDiscoverySettings.lakeDebug === true ||
        currentDiscoverySettings.lakeDebug === 'true' ||
        currentDiscoverySettings.lakeDebug === '1';

    const resolvedLake = resolveLakeBackendSettings(currentDiscoverySettings, resolvedLakePort, resolvedLakeDebug);
    lakeBackend.updateSettings({
        host: resolvedLake.host,
        port: resolvedLake.port,
        bindAddress: resolvedLake.bindAddress,
        bindNetmask: resolvedLake.bindNetmask,
        debug: resolvedLake.debug,
    });
    if (resolvedLakeDebug) {
        const bindingDetail = resolvedLake.adapter
            ? `adapter ${resolvedLake.adapter.name} (${resolvedLake.adapter.address}/${resolvedLake.adapter.prefixLength})`
            : resolvedLake.configuredBindAddress
                ? `adapter IP ${resolvedLake.configuredBindAddress} (unavailable)`
                : 'system routing';
        logPluginMessage(`[Lake] Using ${bindingDetail}; discovery port ${resolvedLakePort}.`);
    }

    const resolvedLa = resolveLaBackendSettings(currentDiscoverySettings);
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
        currentDiscoverySettings.smaartHost || defaultSettings.smaartHost,
        Number(currentDiscoverySettings.smaartPort) || defaultSettings.smaartPort
    );
    smaartClient.connect();

    if (usesLegacyLakePort && settings !== currentDiscoverySettings) {
        sdClient.setGlobalSettings({
            ...currentDiscoverySettings,
            lakePort: resolvedLakePort,
        });
        currentDiscoverySettings = {
            ...currentDiscoverySettings,
            lakePort: resolvedLakePort,
        };
    }
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

router.registerAction('com.jvhtec.lake-smaart.lakeLevel', new LevelEncoderAction(sdClient, deviceManager, {
    allowedBackend: 'lake',
    logPrefix: 'Lake Level',
}));
router.registerAction('com.jvhtec.lake-smaart.laLevel', new LevelEncoderAction(sdClient, deviceManager, {
    allowedBackend: 'la_http',
    logPrefix: 'L-Acoustics Level',
}));
router.registerAction('com.jvhtec.lake-smaart.lakeMute', new MuteAction(sdClient, deviceManager, {
    allowedBackend: 'lake',
    logPrefix: 'Lake Mute',
}));
router.registerAction('com.jvhtec.lake-smaart.laMute', new MuteAction(sdClient, deviceManager, {
    allowedBackend: 'la_http',
    logPrefix: 'L-Acoustics Mute',
}));
router.registerAction('com.jvhtec.lake-smaart.priority', new PriorityAction(sdClient, deviceManager));
router.registerAction('com.jvhtec.lake-smaart.lakePresetRecall', new PresetRecallAction(sdClient, deviceManager, {
    allowedBackend: 'lake',
    logPrefix: 'Lake Preset',
}));
router.registerAction('com.jvhtec.lake-smaart.laPresetRecall', new PresetRecallAction(sdClient, deviceManager, {
    allowedBackend: 'la_http',
    logPrefix: 'L-Acoustics Preset',
}));
router.registerAction('com.jvhtec.lake-smaart.smaartgengain', new SmaartGeneratorGainDialAction(sdClient, smaartClient));
router.registerAction('com.jvhtec.lake-smaart.smaartfiletransport', new SmaartFileTransportDialAction(sdClient));
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
let fallbackHubOpened = false;

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
        onGetVisibleActions: () => Array.from(visibleActionContexts.values()),
    });
    piServerReady = piServer.start().then((assignedPort) => {
        piServerPort = assignedPort;
        piServerHost = piServer!.getBoundAddress();
        piServerToken = piServer!.getSessionToken();
        console.log(`[PI Fallback] Plugin path contains special characters.`);
        console.log(`[PI Fallback] Browser inspector hub: ${piServer!.getHubUrl()}`);
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
    if (event.event === 'willAppear') {
        visibleActionContexts.set(event.context, {
            action: event.action,
            context: event.context,
            controller: event.payload?.controller,
            coordinates: event.payload?.coordinates,
        });
        if (hasUnsafePathChars && piServerReady && piServer && !fallbackHubOpened) {
            piServerReady.then(() => {
                if (fallbackHubOpened || !piServer) {
                    return;
                }
                fallbackHubOpened = true;
                sdClient.openUrl(piServer.getHubUrl());
            });
        }
    }

    // Auto-open browser PI when the embedded PI can't load
    if (piServerReady && event.event === 'propertyInspectorDidAppear') {
        openInspectorContexts.add(event.context);
        const piEvent = event;
        piServerReady.then(() => {
            if (!piServerPort) return;
            const isDialAction =
                piEvent.action === 'com.jvhtec.lake-smaart.lakeLevel' ||
                piEvent.action === 'com.jvhtec.lake-smaart.laLevel' ||
                piEvent.action === 'com.jvhtec.lake-smaart.smaartgengain' ||
                piEvent.action === 'com.jvhtec.lake-smaart.smaartfiletransport';
            const page = isDialAction ? 'dial' : 'key';
            const url = `http://${piServerHost}:${piServerPort}/${page}?action=${encodeURIComponent(piEvent.action)}&context=${encodeURIComponent(piEvent.context)}&wsPort=${piServerPort}&token=${encodeURIComponent(piServerToken)}`;
            sdClient.openUrl(url);
        });
    }
    if (event.event === 'propertyInspectorDidAppear') {
        openInspectorContexts.add(event.context);
        sdClient.sendToPropertyInspector(event.context, buildInspectorCatalog());
    }
    if (event.event === 'willDisappear') {
        openInspectorContexts.delete(event.context);
        visibleActionContexts.delete(event.context);
    }

    if (event.event === 'didReceiveGlobalSettings') {
        const settings = event.payload.settings || {};
        applyDiscoverySettings(settings);
        deviceManager.refreshCatalog().catch(() => undefined);
    }
    if ((event.event === 'didReceiveSettings' || event.event === 'willAppear') && hasDiscoverySettings(event.payload?.settings)) {
        applyDiscoverySettings(event.payload.settings || {}, { ignoreEmptyValues: true });
        deviceManager.refreshCatalog().catch(() => undefined);
    }
    if (event.event === 'sendToPlugin') {
        const request = event.payload?.request;
        if (request === 'catalog') {
            if (hasDiscoverySettings(event.payload?.discoverySettings)) {
                applyDiscoverySettings(event.payload.discoverySettings || {});
            }
            deviceManager.refreshCatalog().then(() => {
                sdClient.sendToPropertyInspector(event.context, buildInspectorCatalog());
            });
            return;
        }

        if (request === 'smaartSplCatalog') {
            smaartClient.waitForReady(5000).then((isReady) => {
                if (!isReady) {
                    sdClient.logMessage('Smaart client not ready after timeout');
                    return;
                }
                return smaartClient.getActiveCalibratedInputs();
            }).then((result) => {
                if (!result) return;
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