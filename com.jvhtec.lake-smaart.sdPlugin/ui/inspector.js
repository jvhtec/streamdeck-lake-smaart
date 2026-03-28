let websocket = null;
let uuid = null;
let actionInfo = null;
let catalog = { devices: [], targets: [] };
let lastGlobalSettings = {};

function getActionId() {
    return actionInfo?.action || '';
}

function getActionName() {
    const parts = getActionId().split('.');
    return parts[parts.length - 1] || '';
}

function isSmaartAction() {
    return getActionName().startsWith('smaart');
}

function isMuteAction() {
    const name = getActionName();
    return name === 'lakeMute' || name === 'laMute';
}

function isPresetAction() {
    const name = getActionName();
    return name === 'lakePresetRecall' || name === 'laPresetRecall';
}

function getRequiredBackend() {
    const name = getActionName();
    if (name === 'priority' || name === 'lakeMute' || name === 'lakeLevel') {
        return 'lake';
    }
    if (name === 'lakePresetRecall') {
        return 'lake';
    }
    if (name === 'laMute' || name === 'laLevel' || name === 'laPresetRecall') {
        return 'la_http';
    }
    return null;
}

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
        if (!input.id || ['lakeHost', 'lakePort', 'lakeBindAddress', 'lakeDebug', 'laBindAddress', 'laDiscoverySubnet', 'laDiscoveryHosts', 'laAuthUser', 'laAuthPass', 'laDebugLogging', 'smaartHost', 'smaartPort'].includes(input.id)) {
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
    lastGlobalSettings = Object.assign({}, settings);
    const fields = ['lakeHost', 'lakePort', 'lakeBindAddress', 'lakeDebug', 'laBindAddress', 'laDiscoverySubnet', 'laDiscoveryHosts', 'laAuthUser', 'laAuthPass', 'laDebugLogging', 'smaartHost', 'smaartPort'];
    fields.forEach((field) => {
        const el = document.getElementById(field);
        if (el && settings[field] !== undefined) {
            if (el.type === 'checkbox') {
                el.checked = settings[field] === true || settings[field] === 'true' || settings[field] === '1';
            } else {
                el.value = settings[field];
            }
        }
    });
}

function saveSettings() {
    if (!websocket) return;
    const settings = {};
    const inputs = document.querySelectorAll('.sdpi-item-value');
    inputs.forEach(input => {
        if (!input.id || ['lakeHost', 'lakePort', 'lakeBindAddress', 'lakeDebug', 'laBindAddress', 'laDiscoverySubnet', 'laDiscoveryHosts', 'laAuthUser', 'laAuthPass', 'laDebugLogging', 'smaartHost', 'smaartPort'].includes(input.id)) {
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
    const payload = Object.assign({}, lastGlobalSettings);
    const fields = ['lakeHost', 'lakePort', 'lakeBindAddress', 'lakeDebug', 'laBindAddress', 'laDiscoverySubnet', 'laDiscoveryHosts', 'laAuthUser', 'laAuthPass', 'laDebugLogging', 'smaartHost', 'smaartPort'];
    fields.forEach((field) => {
        const el = document.getElementById(field);
        if (el) {
            payload[field] = el.type === 'checkbox' ? el.checked : (el.value || '');
        }
    });

    websocket.send(JSON.stringify({
        event: 'setGlobalSettings',
        context: uuid,
        payload
    }));
}

function updateUI() {
    const muteOptions = document.getElementById('muteOptions');
    const presetOptions = document.getElementById('presetOptions');
    const targetControls = document.getElementById('targetControls');
    const smaartControls = document.getElementById('smaartControls');

    if (muteOptions) {
        muteOptions.style.display = isMuteAction() ? 'flex' : 'none';
    }
    if (presetOptions) {
        presetOptions.style.display = isPresetAction() ? 'flex' : 'none';
    }
    if (targetControls && smaartControls) {
        const isSmaart = isSmaartAction();
        targetControls.style.display = isSmaart ? 'none' : 'block';
        smaartControls.style.display = isSmaart ? 'block' : 'none';
    }

    syncLevelModeOptions();
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
    if (isSmaartAction()) return;

    const devices = catalog.devices || [];
    const targets = catalog.targets || [];
    const requiredBackend = getRequiredBackend();

    deviceSelect.innerHTML = '';
    devices.filter((device) => !requiredBackend || device.backend === requiredBackend).forEach((device) => {
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
        if (requiredBackend && target.backend !== requiredBackend) return false;
        if (isPresetAction()) return target.kind === 'preset';
        if (isMuteAction()) return target.supports && target.supports.includes('mute');
        return target.supports && target.supports.includes('level');
    });

    targetSelect.innerHTML = '';
    filteredTargets.forEach((target) => {
        const option = document.createElement('option');
        const id = target.backend === 'lake'
            ? `${target.backend}:${target.deviceId}:${target.kind}:${target.id}`
            : `${target.backend}:${target.deviceId}:${target.kind}:${target.kind === 'preset' ? target.index : target.id}`;
        option.value = id;
        option.textContent = target.name;
        targetSelect.appendChild(option);
    });

    if (selectedTargetId) {
        targetSelect.value = selectedTargetId;
    }

    syncLevelModeOptions();
}

function getSelectedCatalogTarget() {
    const targetSelect = document.getElementById('targetId');
    if (!targetSelect) return null;
    const selectedTargetId = targetSelect.value;
    return (catalog.targets || []).find((target) => {
        if (target.backend === 'lake') {
            return `${target.backend}:${target.deviceId}:${target.kind}:${target.id}` === selectedTargetId;
        }
        const suffix = target.kind === 'preset' ? target.index : target.id;
        return `${target.backend}:${target.deviceId}:${target.kind}:${suffix}` === selectedTargetId;
    }) || null;
}

function syncLevelModeOptions() {
    const levelMode = document.getElementById('levelMode');
    if (!levelMode) return;

    const volumeOption = levelMode.querySelector('option[value="volume"]');
    if (!volumeOption) return;

    const target = getSelectedCatalogTarget();
    const supportsVolume = Boolean(target && target.supports && target.supports.includes('volume'));
    volumeOption.hidden = !supportsVolume;
    volumeOption.disabled = !supportsVolume;

    if (!supportsVolume && levelMode.value === 'volume') {
        levelMode.value = 'gain';
    }
}
