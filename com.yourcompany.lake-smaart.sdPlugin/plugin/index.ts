import { SDClient } from './sd/sdClient';
import { Router } from './core/router';
import { DlmClient } from './lake/dlmClient';
import { StateStore } from './core/stateStore';
import { Scheduler } from './core/scheduler';
import { DialModuleAction } from './actions/dialModule';
import { KeyPresetAction } from './actions/keyPreset';
import { KeyGroupMuteAction } from './actions/keyGroupMute';
import { SmaartClient } from './smaart/smaartClient';
import { KeySmaartGenAction } from './actions/keySmaartGen';
import { KeySmaartCaptureAction } from './actions/keySmaartCapture';

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

// Dependencies
const sdClient = new SDClient(port, uuid, registerEvent);
const result = { // Config holder
    lakeHost: '192.168.0.10', // Default, should read from global settings
    lakePort: 1024
};

// We need to wait for Global Settings to configure DLM properly, 
// but we can init with defaults and update later.
const stateStore = new StateStore();
const dlmClient = new DlmClient(result.lakeHost, result.lakePort);
const smaartClient = new SmaartClient('127.0.0.1', 26000); // Default local
const scheduler = new Scheduler(dlmClient, stateStore);

const router = new Router(sdClient);

// Actions
router.registerAction('com.yourcompany.lake-smaart.dial', new DialModuleAction(sdClient, stateStore, dlmClient));
router.registerAction('com.yourcompany.lake-smaart.preset', new KeyPresetAction(sdClient, dlmClient, smaartClient));
router.registerAction('com.yourcompany.lake-smaart.groupmute', new KeyGroupMuteAction(sdClient, dlmClient, stateStore, smaartClient));
router.registerAction('com.yourcompany.lake-smaart.smaartgen', new KeySmaartGenAction(sdClient, smaartClient));
router.registerAction('com.yourcompany.lake-smaart.smaartcapture', new KeySmaartCaptureAction(sdClient, smaartClient));

sdClient.onEvents((event) => {
    if (event.event === 'didReceiveGlobalSettings') {
        const settings = event.payload.settings;
        if (settings.lakeIp) {
            dlmClient.setTarget(settings.lakeIp, result.lakePort);
        }
    }
    router.route(event);
});

sdClient.connect();
smaartClient.connect();
scheduler.start();
