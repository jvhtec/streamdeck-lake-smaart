// Minimal Inspector JS to handle saving/loading settings
// Note: This needs to interface with Stream Deck's WS for PI.

let websocket = null;
let uuid = null;
let actionInfo = null;

function connectElgatoStreamDeckSocket(inPort, inPropertyInspectorUUID, inRegisterEvent, inInfo, inActionInfo) {
    uuid = inPropertyInspectorUUID;
    actionInfo = JSON.parse(inActionInfo);

    websocket = new WebSocket('ws://127.0.0.1:' + inPort);

    websocket.onopen = function () {
        // Register
        const json = {
            event: inRegisterEvent,
            uuid: inPropertyInspectorUUID
        };
        websocket.send(JSON.stringify(json));

        // Request Global Settings
        websocket.send(JSON.stringify({
            event: 'getGlobalSettings',
            context: uuid
        }));

        // Populate fields from actionInfo.payload.settings
        loadSettings(actionInfo.payload.settings);
    };

    websocket.onmessage = function (evt) {
        const jsonObj = JSON.parse(evt.data);
        if (jsonObj.event === 'didReceiveGlobalSettings') {
            loadGlobalSettings(jsonObj.payload.settings);
        }
    };
}

function loadSettings(settings) {
    // Helper to set values of inputs based on settings object
    for (const key in settings) {
        const el = document.getElementById(key);
        if (el) {
            el.value = settings[key];
        }
    }
    updateUI();
}

function loadGlobalSettings(settings) {
    const el = document.getElementById('lakeIp');
    if (el && settings.lakeIp) el.value = settings.lakeIp;
}

function saveSettings() {
    if (!websocket) return;

    const settings = {};
    const inputs = document.querySelectorAll('.sdpi-item-value');

    inputs.forEach(input => {
        if (input.id && !['lakeIp'].includes(input.id)) { // Exclude global
            settings[input.id] = input.value;
        }
    });

    const json = {
        event: 'setSettings',
        context: uuid,
        payload: settings
    };
    websocket.send(JSON.stringify(json));
}

function saveGlobalSettings() {
    if (!websocket) return;
    const ip = document.getElementById('lakeIp').value;
    const json = {
        event: 'setGlobalSettings',
        context: uuid,
        payload: {
            lakeIp: ip
        }
    };
    websocket.send(JSON.stringify(json));
}

function updateUI() {
    if (!actionInfo || !actionInfo.action) return;

    const action = actionInfo.action;
    const isSmaart = action.includes('smaartgen') || action.includes('smaartcapture');

    const lakeControls = document.getElementById('lakeControls');
    const smaartControls = document.getElementById('smaartControls');

    if (isSmaart) {
        if (lakeControls) lakeControls.style.display = 'none';
        if (smaartControls) smaartControls.style.display = 'block';
    } else {
        if (lakeControls) lakeControls.style.display = 'block';
        if (smaartControls) smaartControls.style.display = 'none';

        // Handle Lake Sub-options
        const type = document.getElementById('actionType');
        if (type) {
            const val = type.value;
            // Pre-select based on UUID if it matches
            if (action.includes('groupmute') && val !== 'GROUP_MUTE') {
                // Force logic if we want strict mapping, but for now let's trust the stored setting or default
            }

            document.getElementById('presetSettings').style.display = (val === 'PRESET') ? 'block' : 'none';
            document.getElementById('groupSettings').style.display = (val === 'GROUP_MUTE') ? 'block' : 'none';
        }
    }
}
