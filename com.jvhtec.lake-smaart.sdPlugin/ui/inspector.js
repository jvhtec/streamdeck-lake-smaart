let websocket = null;
let uuid = null;
let actionInfo = null;
let catalog = { devices: [], targets: [] };

function connectElgatoStreamDeckSocket(inPort, inPropertyInspectorUUID, inRegisterEvent, inInfo, inActionInfo) {
    uuid = inPropertyInspectorUUID;
    actionInfo = JSON.parse(inActionInfo);

    websocket = new WebSocket('ws://127.0.0.1:' + inPort);

    websocket.onopen = function () {
        websocket.send(JSON.stringify({
            event: inRegisterEvent,
            uuid: inPropertyInspectorUUID
        }));

        websocket.send(JSON.stringify({
            event: 'getGlobalSettings',
            context: uuid
        }));

        websocket.send(JSON.stringify({
            event: 'getSettings',
            context: actionInfo.context
        }));

        requestCatalog();
    };

    websocket.onmessage = function (evt) {
        const jsonObj = JSON.parse(evt.data);
        if (jsonObj.event === 'didReceiveGlobalSettings') {
            loadGlobalSettings(jsonObj.payload.settings || {});
        }
        if (jsonObj.event === 'didReceiveSettings') {
            loadSettings(jsonObj.payload.settings || {});
        }
        if (jsonObj.event === 'sendToPropertyInspector') {
            if (jsonObj.payload && jsonObj.payload.devices) {
                catalog = jsonObj.payload;
                updateSelectors();
            }
        }
    };
}

function loadSettings(settings) {
    const inputs = document.querySelectorAll('.sdpi-item-value');
    inputs.forEach(input => {
        if (!input.id || ['lakeHost', 'lakePort', 'laDiscoverySubnet', 'laDiscoveryHosts', 'laAuthUser', 'laAuthPass', 'smaartHost', 'smaartPort'].includes(input.id)) {
            return;
        }
        if (input.type === 'checkbox') {
            input.checked = Boolean(settings[input.id]);
        } else {
            input.value = settings[input.id] ?? '';
        }
    });
    updateSelectors(settings.deviceId, settings.targetId);
    updateUI();
}

function loadGlobalSettings(settings) {
    const fields = ['lakeHost', 'lakePort', 'laDiscoverySubnet', 'laDiscoveryHosts', 'laAuthUser', 'laAuthPass', 'smaartHost', 'smaartPort'];
    fields.forEach((field) => {
        const el = document.getElementById(field);
        if (el && settings[field] !== undefined) {
            el.value = settings[field];
        }
    });
}

function saveSettings() {
    if (!websocket) return;
    const settings = {};
    const inputs = document.querySelectorAll('.sdpi-item-value');
    inputs.forEach(input => {
        if (!input.id || ['lakeHost', 'lakePort', 'laDiscoverySubnet', 'laDiscoveryHosts', 'laAuthUser', 'laAuthPass', 'smaartHost', 'smaartPort'].includes(input.id)) {
            return;
        }
        if (input.type === 'checkbox') {
            settings[input.id] = input.checked;
        } else {
            settings[input.id] = input.value;
        }
    });

    websocket.send(JSON.stringify({
        event: 'setSettings',
        context: actionInfo.context,
        payload: settings
    }));

    updateSelectors(settings.deviceId, settings.targetId);
}

function saveGlobalSettings() {
    if (!websocket) return;
    const payload = {
        lakeHost: document.getElementById('lakeHost')?.value || '',
        lakePort: document.getElementById('lakePort')?.value || '',
        laDiscoverySubnet: document.getElementById('laDiscoverySubnet')?.value || '',
        laDiscoveryHosts: document.getElementById('laDiscoveryHosts')?.value || '',
        laAuthUser: document.getElementById('laAuthUser')?.value || '',
        laAuthPass: document.getElementById('laAuthPass')?.value || '',
        smaartHost: document.getElementById('smaartHost')?.value || '',
        smaartPort: document.getElementById('smaartPort')?.value || ''
    };

    websocket.send(JSON.stringify({
        event: 'setGlobalSettings',
        context: uuid,
        payload
    }));
}

function updateUI() {
    const action = actionInfo.action || '';
    const muteOptions = document.getElementById('muteOptions');
    const presetOptions = document.getElementById('presetOptions');
    const targetControls = document.getElementById('targetControls');
    const smaartControls = document.getElementById('smaartControls');

    if (muteOptions) {
        muteOptions.style.display = action.includes('mute') ? 'flex' : 'none';
    }
    if (presetOptions) {
        presetOptions.style.display = action.includes('preset') ? 'flex' : 'none';
    }
    if (targetControls && smaartControls) {
        const isSmaart = action.includes('smaart');
        targetControls.style.display = isSmaart ? 'none' : 'block';
        smaartControls.style.display = isSmaart ? 'block' : 'none';
    }
}

function requestCatalog() {
    if (!websocket) return;
    websocket.send(JSON.stringify({
        event: 'sendToPlugin',
        context: actionInfo.context,
        payload: { request: 'catalog' }
    }));
}

function refreshCatalog() {
    requestCatalog();
}

function updateSelectors(selectedDeviceId, selectedTargetId) {
    const deviceSelect = document.getElementById('deviceId');
    const targetSelect = document.getElementById('targetId');
    const noDevices = document.getElementById('noDevices');
    if (!deviceSelect || !targetSelect) return;
    const action = actionInfo.action || '';
    if (action.includes('smaart')) return;

    const devices = catalog.devices || [];
    const targets = catalog.targets || [];

    deviceSelect.innerHTML = '';
    devices.forEach((device) => {
        const option = document.createElement('option');
        option.value = device.id;
        option.textContent = device.name;
        deviceSelect.appendChild(option);
    });

    if (devices.length === 0) {
        if (noDevices) noDevices.style.display = 'flex';
        targetSelect.innerHTML = '';
        return;
    }

    if (noDevices) noDevices.style.display = 'none';

    const activeDevice = selectedDeviceId || deviceSelect.value || devices[0].id;
    deviceSelect.value = activeDevice;

    const filteredTargets = targets.filter((target) => {
        if (target.deviceId !== activeDevice) return false;
        if (action.includes('preset')) return target.kind === 'preset';
        if (action.includes('mute')) return target.supports && target.supports.includes('mute');
        return target.supports && target.supports.includes('level');
    });

    targetSelect.innerHTML = '';
    filteredTargets.forEach((target) => {
        const option = document.createElement('option');
        const id = target.backend === 'lake'
            ? `${target.backend}:${target.deviceId}:${target.kind}:${target.id}`
            : `${target.backend}:${target.deviceId}:${target.kind}:${target.index}`;
        option.value = id;
        option.textContent = target.name;
        targetSelect.appendChild(option);
    });

    if (selectedTargetId) {
        targetSelect.value = selectedTargetId;
    }
}
