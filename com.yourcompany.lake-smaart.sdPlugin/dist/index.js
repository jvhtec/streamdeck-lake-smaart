"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sdClient_1 = require("./sd/sdClient");
const router_1 = require("./core/router");
const dlmClient_1 = require("./lake/dlmClient");
const deviceManager_1 = require("./core/deviceManager");
const lakeBackend_1 = require("./backends/lakeBackend");
const laHttpBackend_1 = require("./backends/laHttpBackend");
const levelEncoderAction_1 = require("./actions/levelEncoderAction");
const muteAction_1 = require("./actions/muteAction");
const presetRecallAction_1 = require("./actions/presetRecallAction");
const smaartClient_1 = require("./smaart/smaartClient");
const keySmaartGen_1 = require("./actions/keySmaartGen");
const keySmaartCapture_1 = require("./actions/keySmaartCapture");
const keySmaartComputeDelay_1 = require("./actions/keySmaartComputeDelay");
const keySmaartTraceToggle_1 = require("./actions/keySmaartTraceToggle");
const args = process.argv.slice(2);
let port = '0';
let uuid = '';
let registerEvent = '';
for (let i = 0; i < args.length; i++) {
    if (args[i] === '-port') {
        port = args[i + 1];
        i++;
    }
    else if (args[i] === '-pluginUUID') {
        uuid = args[i + 1];
        i++;
    }
    else if (args[i] === '-registerEvent') {
        registerEvent = args[i + 1];
        i++;
    }
}
const sdClient = new sdClient_1.SDClient(port, uuid, registerEvent);
const defaultSettings = {
    lakeHost: '192.168.0.10',
    lakePort: 1024,
    laDiscoverySubnet: '192.168.0.0/24',
    laDiscoveryHosts: '',
    laAuthUser: '',
    laAuthPass: '',
    smaartHost: '127.0.0.1',
    smaartPort: 26000,
};
const dlmClient = new dlmClient_1.DlmClient(defaultSettings.lakeHost, defaultSettings.lakePort);
const lakeBackend = new lakeBackend_1.LakeBackend(dlmClient, { host: defaultSettings.lakeHost, port: defaultSettings.lakePort });
const laHttpBackend = new laHttpBackend_1.LaHttpBackend({
    discoverySubnet: defaultSettings.laDiscoverySubnet,
    discoveryHosts: [],
    username: defaultSettings.laAuthUser || undefined,
    password: defaultSettings.laAuthPass || undefined,
});
const smaartClient = new smaartClient_1.SmaartClient(defaultSettings.smaartHost, defaultSettings.smaartPort);
const deviceManager = new deviceManager_1.DeviceManager([lakeBackend, laHttpBackend]);
const router = new router_1.Router(sdClient);
router.registerAction('com.jvhtec.lake-smaart.level', new levelEncoderAction_1.LevelEncoderAction(sdClient, deviceManager));
router.registerAction('com.jvhtec.lake-smaart.mute', new muteAction_1.MuteAction(sdClient, deviceManager));
router.registerAction('com.jvhtec.lake-smaart.presetRecall', new presetRecallAction_1.PresetRecallAction(sdClient, deviceManager));
router.registerAction('com.jvhtec.lake-smaart.smaartgen', new keySmaartGen_1.KeySmaartGenAction(sdClient, smaartClient));
router.registerAction('com.jvhtec.lake-smaart.smaartcapture', new keySmaartCapture_1.KeySmaartCaptureAction(sdClient, smaartClient));
router.registerAction('com.jvhtec.lake-smaart.smaartdelay', new keySmaartComputeDelay_1.KeySmaartComputeDelayAction(sdClient, smaartClient));
router.registerAction('com.jvhtec.lake-smaart.smaarttrace', new keySmaartTraceToggle_1.KeySmaartTraceToggleAction(sdClient, smaartClient));
sdClient.onEvents((event) => {
    if (event.event === 'didReceiveGlobalSettings') {
        const settings = event.payload.settings;
        lakeBackend.updateSettings({
            host: settings.lakeHost || defaultSettings.lakeHost,
            port: Number(settings.lakePort) || defaultSettings.lakePort,
        });
        laHttpBackend.updateSettings({
            discoverySubnet: settings.laDiscoverySubnet || defaultSettings.laDiscoverySubnet,
            discoveryHosts: (settings.laDiscoveryHosts || '')
                .split(',')
                .map((host) => host.trim())
                .filter(Boolean),
            username: settings.laAuthUser || undefined,
            password: settings.laAuthPass || undefined,
        });
        smaartClient.setTarget(settings.smaartHost || defaultSettings.smaartHost, Number(settings.smaartPort) || defaultSettings.smaartPort);
        smaartClient.connect();
        deviceManager.refreshCatalog().catch(() => undefined);
    }
    if (event.event === 'sendToPlugin') {
        const request = event.payload?.request;
        if (request === 'catalog') {
            deviceManager.refreshCatalog().then(() => {
                sdClient.sendToPropertyInspector(event.context, {
                    devices: deviceManager.getDevices(),
                    targets: deviceManager.getTargets(),
                });
            });
        }
    }
    router.route(event);
});
sdClient.connect();
deviceManager.start();
smaartClient.connect();
