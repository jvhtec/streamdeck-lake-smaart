/**
 * Embedded PI HTML served by the fallback HTTP server.
 * These mirror ui/key.html and ui/dial.html but connect to the plugin's
 * own WebSocket server instead of Stream Deck's, reading action/context
 * from URL query parameters.
 */

const COMMON_STYLES = `body{font-family:Arial,sans-serif;color:#ddd;background:#2d2d2d;margin:0;padding:10px}.sdpi-wrapper{display:flex;flex-direction:column;gap:8px}.sdpi-heading{font-size:12px;font-weight:700;text-transform:uppercase;color:#9aa0a6;margin-top:8px}.sdpi-item{display:flex;align-items:center;gap:8px}.sdpi-item-label{width:140px;font-size:12px;color:#cfcfcf}.sdpi-item-value{flex:1;min-height:28px;background:#3a3a3a;border:1px solid #555;color:#fff;border-radius:4px;padding:4px 6px}.sdpi-item-message{font-size:12px;color:#cfcfcf}button.sdpi-item-value{cursor:pointer}.fallback-banner{background:#3a3a3a;border:1px solid #555;border-radius:4px;padding:8px;margin-bottom:8px;font-size:11px;color:#aaa}`;

const LAKE_GLOBAL_FIELDS = `
        <div id="lakeGlobalSettings">
            <div id="lakeBackendSettings">
                <div class="sdpi-item">
                    <div class="sdpi-item-label">Lake Device Filter</div>
                    <input class="sdpi-item-value" type="text" id="lakeHost" placeholder="Optional device IP or frame ID" onchange="saveGlobalSettings()">
                </div>
                <div class="sdpi-item">
                    <div class="sdpi-item-label">Lake Port</div>
                    <input class="sdpi-item-value" type="number" id="lakePort" onchange="saveGlobalSettings()">
                </div>
                <div class="sdpi-item">
                    <div class="sdpi-item-label">Lake Adapter IP</div>
                    <select class="sdpi-item-value select" id="lakeBindAddress" onchange="saveGlobalSettings()"></select>
                </div>
                <div class="sdpi-item">
                    <div class="sdpi-item-label">Lake Debug Log</div>
                    <input class="sdpi-item-value" type="checkbox" id="lakeDebug" onchange="saveGlobalSettings()">
                </div>
            </div>
            <div id="laBackendSettings">
                <div class="sdpi-item">
                    <div class="sdpi-item-label">LA Adapter IP</div>
                    <select class="sdpi-item-value select" id="laBindAddress" onchange="saveGlobalSettings()"></select>
                </div>
                <div class="sdpi-item">
                    <div class="sdpi-item-label">L-Acoustics Subnet</div>
                    <input class="sdpi-item-value" type="text" id="laDiscoverySubnet" placeholder="Auto from LA adapter" onchange="saveGlobalSettings()">
                </div>
                <div class="sdpi-item">
                    <div class="sdpi-item-label">L-Acoustics Hosts</div>
                    <input class="sdpi-item-value" type="text" id="laDiscoveryHosts" placeholder="192.168.1.20,192.168.1.21" onchange="saveGlobalSettings()">
                </div>
                <div class="sdpi-item">
                    <div class="sdpi-item-label">HTTP User</div>
                    <input class="sdpi-item-value" type="text" id="laAuthUser" onchange="saveGlobalSettings()">
                </div>
                <div class="sdpi-item">
                    <div class="sdpi-item-label">HTTP Pass</div>
                    <input class="sdpi-item-value" type="password" id="laAuthPass" onchange="saveGlobalSettings()">
                </div>
                <div class="sdpi-item">
                    <div class="sdpi-item-label">LA Debug Log</div>
                    <input class="sdpi-item-value" type="checkbox" id="laDebugLogging" onchange="saveGlobalSettings()">
                </div>
            </div>
        </div>`;

const SMAART_GLOBAL_FIELDS = `
        <div id="smaartGlobalSettings" style="display:none;">
            <div class="sdpi-item">
                <div class="sdpi-item-label">Smaart Host</div>
                <input class="sdpi-item-value" type="text" id="smaartHost" onchange="saveGlobalSettings()">
            </div>
            <div class="sdpi-item">
                <div class="sdpi-item-label">Smaart Port</div>
                <input class="sdpi-item-value" type="number" id="smaartPort" onchange="saveGlobalSettings()">
            </div>
        </div>`;

function buildScript(extraInit: string): string {
    return `
let websocket = null;
let action = '';
let context = '';
let catalog = { devices: [], targets: [], laAdapters: [] };
let catalogLoaded = false;
let pendingDeviceId = null;
let pendingTargetId = null;
let lastGlobalSettings = {};
let lastSettings = {};
let smaartSplCatalog = { inputs: [], metrics: [], error: '' };
let smaartSplRequestSeq = 0;
let catalogRefreshTimer = null;
const discoveryFields = ['lakeHost', 'lakePort', 'lakeBindAddress', 'lakeDebug', 'laBindAddress', 'laDiscoverySubnet', 'laDiscoveryHosts', 'laAuthUser', 'laAuthPass', 'laDebugLogging', 'smaartHost', 'smaartPort'];

function mergeDiscoveryFieldValues(base, source) {
    var next = Object.assign({}, base || {});
    if (!source) {
        return next;
    }
    discoveryFields.forEach(function(field) {
        if (Object.prototype.hasOwnProperty.call(source, field)) {
            next[field] = source[field];
        }
    });
    return next;
}

function applyDiscoveryFieldValues(settings) {
    lastGlobalSettings = mergeDiscoveryFieldValues(lastGlobalSettings, settings);
    discoveryFields.forEach(function(field) {
        var el = document.getElementById(field);
        if (!el || lastGlobalSettings[field] === undefined) {
            return;
        }
        if (el.type === 'checkbox') {
            el.checked = lastGlobalSettings[field] === true || lastGlobalSettings[field] === 'true' || lastGlobalSettings[field] === '1';
        } else {
            el.value = lastGlobalSettings[field];
        }
    });
    updateLakeAdapterOptions(lastGlobalSettings.lakeBindAddress);
    updateLaAdapterOptions(lastGlobalSettings.laBindAddress);
}

function getDiscoveryFieldValues() {
    var values = mergeDiscoveryFieldValues({}, lastGlobalSettings);
    discoveryFields.forEach(function(field) {
        var el = document.getElementById(field);
        if (!el) return;
        values[field] = el.type === 'checkbox' ? el.checked : (el.value || '');
    });
    return values;
}

function getActionName() {
    var parts = action.split('.');
    return parts[parts.length - 1] || '';
}

function isSmaartAction() {
    return getActionName().startsWith('smaart');
}

function isSmaartGeneratorGainAction() {
    return getActionName() === 'smaartgengain';
}

function isSmaartFileTransportAction() {
    return getActionName() === 'smaartfiletransport';
}

function isSmaartSplAction() {
    return getActionName() === 'smaartspl';
}

function usesSmaartApiGlobalSettings() {
    return isSmaartAction() && !isSmaartFileTransportAction();
}

function isMuteAction() {
    var name = getActionName();
    return name === 'lakeMute' || name === 'laMute';
}

function isPresetAction() {
    var name = getActionName();
    return name === 'lakePresetRecall' || name === 'laPresetRecall';
}

function isPriorityAction() {
    return getActionName() === 'priority';
}

function getRequiredBackend() {
    var name = getActionName();
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

function getRequiredCatalogAction() {
    if (isSmaartAction()) {
        return null;
    }
    if (isPresetAction()) {
        return 'preset';
    }
    if (isPriorityAction()) {
        return 'priority';
    }
    if (isMuteAction()) {
        return 'mute';
    }
    return 'level';
}

(function init() {
    const params = new URLSearchParams(window.location.search);
    action = params.get('action') || '';
    context = params.get('context') || '';
    const wsPort = params.get('wsPort') || location.port;
    const token = params.get('token') || '';

    websocket = new WebSocket('ws://' + location.hostname + ':' + wsPort);

    websocket.onopen = function () {
        websocket.send(JSON.stringify({
            type: 'init',
            action: action,
            context: context,
            token: token
        }));
        websocket.send(JSON.stringify({ type: 'getCatalog' }));
        if (isSmaartSplAction()) {
            websocket.send(JSON.stringify({ type: 'getSmaartSplCatalog' }));
        }
    };

    websocket.onmessage = function (evt) {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'settings') {
            loadSettings(msg.settings || {});
        }
        if (msg.type === 'globalSettings') {
            loadGlobalSettings(msg.settings || {});
        }
        if (msg.type === 'catalog') {
            catalog = { devices: msg.devices || [], targets: msg.targets || [], laAdapters: msg.laAdapters || [] };
            catalogLoaded = true;
            updateLakeAdapterOptions(lastGlobalSettings.lakeBindAddress);
            updateLaAdapterOptions(lastGlobalSettings.laBindAddress);
            var devId = pendingDeviceId;
            var tgtId = pendingTargetId;
            pendingDeviceId = null;
            pendingTargetId = null;
            updateSelectors(devId, tgtId);
        }
        if (msg.type === 'smaartSplCatalog') {
            applySmaartSplCatalog({
                inputs: msg.inputs || [],
                metrics: msg.metrics || [],
                error: msg.error || ''
            });
        }
    };

    ${extraInit}
})();

function loadSettings(settings) {
    lastSettings = Object.assign({}, settings);
    const inputs = document.querySelectorAll('.sdpi-item-value');
    inputs.forEach(function(input) {
        if (!input.id || discoveryFields.includes(input.id)) return;
        if (input.type === 'checkbox') {
            input.checked = Boolean(settings[input.id]);
        } else {
            input.value = settings[input.id] != null ? settings[input.id] : '';
        }
    });
    applyDiscoveryFieldValues(settings);
    if (catalog.devices.length > 0 || catalog.targets.length > 0) {
        updateSelectors(settings.deviceId, settings.targetId);
    } else {
        pendingDeviceId = settings.deviceId || null;
        pendingTargetId = settings.targetId || null;
    }
    updateSmaartSplSelectors(settings.splStreamEndpoint, settings.splMetric);
    if (typeof updateUI === 'function') updateUI();
}

function loadGlobalSettings(settings) {
    applyDiscoveryFieldValues(settings);
    if (isSmaartSplAction()) {
        requestSmaartSplCatalog();
    }
    scheduleCatalogRefresh();
    if (typeof updateUI === 'function') updateUI();
}

function saveSettings() {
    if (!websocket) return;
    var settings = {};
    var inputs = document.querySelectorAll('.sdpi-item-value');
    inputs.forEach(function(input) {
        if (!input.id || discoveryFields.includes(input.id)) return;
        if (input.type === 'checkbox') {
            settings[input.id] = input.checked;
        } else {
            settings[input.id] = input.value;
        }
    });
    var mergedSettings = Object.assign({}, settings, getDiscoveryFieldValues());
    websocket.send(JSON.stringify({
        type: 'setSettings',
        context: context,
        settings: mergedSettings
    }));
    lastSettings = Object.assign({}, mergedSettings);
    updateSelectors(settings.deviceId, settings.targetId);
    updateSmaartSplSelectors(settings.splStreamEndpoint, settings.splMetric);
}

function saveGlobalSettings() {
    if (!websocket) return;
    var payload = getDiscoveryFieldValues();
    lastGlobalSettings = Object.assign({}, payload);
    websocket.send(JSON.stringify({
        type: 'setGlobalSettings',
        settings: payload
    }));
    websocket.send(JSON.stringify({
        type: 'setSettings',
        context: context,
        settings: Object.assign({}, lastSettings, payload)
    }));
    lastSettings = Object.assign({}, lastSettings, payload);
    if (isSmaartSplAction()) {
        setTimeout(requestSmaartSplCatalog, 0);
    }
    scheduleCatalogRefresh();
}

function updateLaAdapterOptions(selectedAddress) {
    var select = document.getElementById('laBindAddress');
    if (!select) return;

    var currentValue = selectedAddress || select.value || '';
    var adapters = Array.isArray(catalog.laAdapters) ? catalog.laAdapters : [];
    select.innerHTML = '';

    var autoOption = document.createElement('option');
    autoOption.value = '';
    autoOption.textContent = 'Auto / system routing';
    select.appendChild(autoOption);

    adapters.forEach(function(adapter) {
        var option = document.createElement('option');
        option.value = adapter.address;
        option.textContent = adapter.label || adapter.address;
        select.appendChild(option);
    });

    if (catalogLoaded && currentValue && !adapters.some(function(adapter) { return adapter.address === currentValue; })) {
        var missingOption = document.createElement('option');
        missingOption.value = currentValue;
        missingOption.textContent = currentValue + ' (Unavailable)';
        select.appendChild(missingOption);
    }

    select.value = currentValue;
}

function updateLakeAdapterOptions(selectedAddress) {
    var select = document.getElementById('lakeBindAddress');
    if (!select) return;

    var currentValue = selectedAddress || select.value || '';
    var adapters = Array.isArray(catalog.laAdapters) ? catalog.laAdapters : [];
    select.innerHTML = '';

    var autoOption = document.createElement('option');
    autoOption.value = '';
    autoOption.textContent = 'Auto / system routing';
    select.appendChild(autoOption);

    adapters.forEach(function(adapter) {
        var option = document.createElement('option');
        option.value = adapter.address;
        option.textContent = adapter.label || adapter.address;
        select.appendChild(option);
    });

    if (catalogLoaded && currentValue && !adapters.some(function(adapter) { return adapter.address === currentValue; })) {
        var missingOption = document.createElement('option');
        missingOption.value = currentValue;
        missingOption.textContent = currentValue + ' (Unavailable)';
        select.appendChild(missingOption);
    }

    select.value = currentValue;
}

function requestCatalog() {
    if (!websocket) return;
    websocket.send(JSON.stringify({
        type: 'getCatalog',
        discoverySettings: getDiscoveryFieldValues()
    }));
}

function refreshCatalog() {
    requestCatalog();
}

function scheduleCatalogRefresh(delayMs = 400) {
    if (!websocket || isSmaartAction()) return;
    if (catalogRefreshTimer) {
        clearTimeout(catalogRefreshTimer);
    }
    catalogRefreshTimer = setTimeout(function() {
        catalogRefreshTimer = null;
        requestCatalog();
    }, delayMs);
}

function requestSmaartSplCatalog() {
    var hostField = document.getElementById('smaartHost');
    var portField = document.getElementById('smaartPort');
    var host = (hostField && hostField.value) || lastGlobalSettings.smaartHost || '127.0.0.1';
    var port = Number((portField && portField.value) || lastGlobalSettings.smaartPort || 26000) || 26000;
    var requestSeq = ++smaartSplRequestSeq;

    requestSmaartSplCatalogDirect(host, port, requestSeq);

    if (!websocket) return;
    websocket.send(JSON.stringify({ type: 'getSmaartSplCatalog' }));
}

function requestSmaartSplCatalogDirect(host, port, requestSeq) {
    var ws = null;
    var ready = false;
    var finished = false;

    function finish(response) {
        if (finished || requestSeq !== smaartSplRequestSeq) {
            if (ws) {
                try { ws.close(); } catch (error) {}
            }
            return;
        }

        finished = true;
        applySmaartSplCatalog(response);
        if (ws) {
            try { ws.close(); } catch (error) {}
        }
    }

    try {
        ws = new WebSocket('ws://' + host + ':' + port + '/api/v4/');
    } catch (error) {
        finish({
            inputs: [],
            metrics: [],
            error: 'Unable to open Smaart WebSocket at ' + host + ':' + port + '.'
        });
        return;
    }

    var timeout = setTimeout(function() {
        finish({
            inputs: [],
            metrics: [],
            error: 'Timed out talking to Smaart at ' + host + ':' + port + '.'
        });
    }, 2500);

    function finishWithTimeoutClear(response) {
        clearTimeout(timeout);
        finish(response);
    }

    ws.onopen = function() {
        ws.send(JSON.stringify({ action: 'get' }));
    };

    ws.onmessage = function(evt) {
        var parsed;
        try {
            parsed = JSON.parse(evt.data);
        } catch (error) {
            return;
        }

        var response = parsed && parsed.response;
        if (!response) return;

        if (response.authenticationRequired === true) {
            finishWithTimeoutClear({
                inputs: [],
                metrics: [],
                error: 'Smaart API authentication is enabled.'
            });
            return;
        }

        if (!ready && (response.authenticationRequired === false || response.applicationName)) {
            ready = true;
            ws.send(JSON.stringify({ action: 'get', target: 'activeCalibratedInputs' }));
            return;
        }

        if (Array.isArray(response.devices) || Array.isArray(response.metrics)) {
            finishWithTimeoutClear(mapSmaartSplCatalogResponse(response));
        }
    };

    ws.onerror = function() {
        finishWithTimeoutClear({
            inputs: [],
            metrics: [],
            error: 'Unable to reach Smaart at ' + host + ':' + port + '.'
        });
    };

    ws.onclose = function() {
        if (!finished) {
            finishWithTimeoutClear({
                inputs: [],
                metrics: [],
                error: 'Smaart closed the connection at ' + host + ':' + port + '.'
            });
        }
    };
}

function mapSmaartSplCatalogResponse(response) {
    var inputs = Array.isArray(response && response.devices)
        ? response.devices.flatMap(function(device) {
            return Array.isArray(device && device.activeCalibratedChannels)
                ? device.activeCalibratedChannels
                    .filter(function(channel) { return typeof (channel && channel.streamEndpoint) === 'string'; })
                    .map(function(channel) {
                        return {
                            deviceName: device.deviceName || 'Unknown Device',
                            channelName: channel.channelName || 'Unknown Channel',
                            streamEndpoint: channel.streamEndpoint,
                            label: (device.deviceName || 'Unknown Device') + ' : ' + (channel.channelName || 'Unknown Channel')
                        };
                    })
                : [];
        })
        : [];

    var metrics = Array.isArray(response && response.metrics)
        ? response.metrics.filter(function(metric) { return typeof metric === 'string' && metric !== 'FS Peak'; })
        : [];

    return {
        inputs: inputs,
        metrics: metrics,
        error: inputs.length === 0 ? 'No active calibrated inputs found in Smaart.' : ''
    };
}

function applySmaartSplCatalog(nextCatalog) {
    smaartSplCatalog = {
        inputs: nextCatalog.inputs || [],
        metrics: nextCatalog.metrics || [],
        error: nextCatalog.error || ''
    };
    updateSmaartSplSelectors(lastSettings.splStreamEndpoint, lastSettings.splMetric);
}

function onDeviceChange() {
    var newDeviceId = document.getElementById('deviceId').value;
    updateSelectors(newDeviceId, null);
    saveSettings();
}

function updateSelectors(selectedDeviceId, selectedTargetId) {
    var deviceSelect = document.getElementById('deviceId');
    var targetSelect = document.getElementById('targetId');
    var noDevices = document.getElementById('noDevices');
    if (!deviceSelect || !targetSelect) return;
    if (isSmaartAction()) return;

    var currentDeviceId = deviceSelect.value || '';
    var currentTargetId = targetSelect.value || '';
    var preferredDeviceId = selectedDeviceId !== undefined
        ? selectedDeviceId
        : (lastSettings.deviceId || currentDeviceId);
    var preferredTargetId = selectedTargetId !== undefined
        ? selectedTargetId
        : (lastSettings.targetId || currentTargetId);

    var devices = (catalog.devices || []).filter(function(device) {
        return deviceSupportsRequiredAction(device);
    });
    var targets = catalog.targets || [];

    deviceSelect.innerHTML = '';
    devices.forEach(function(device) {
        var option = document.createElement('option');
        option.value = device.id;
        var prefix = device.backend === 'lake' ? '[Lake] ' : '[LA] ';
        option.textContent = prefix + device.name;
        deviceSelect.appendChild(option);
    });

    if (devices.length === 0) {
        if (noDevices) noDevices.style.display = 'flex';
        targetSelect.innerHTML = '';
        return;
    }

    if (noDevices) noDevices.style.display = 'none';

    var activeDevice = devices.some(function(device) { return device.id === preferredDeviceId; })
        ? preferredDeviceId
        : devices[0].id;
    deviceSelect.value = activeDevice;

    var filteredTargets = targets.filter(function(target) {
        return target.deviceId === activeDevice && isTargetSelectableForCurrentAction(target);
    });

    targetSelect.innerHTML = '';
    filteredTargets.forEach(function(target) {
        var option = document.createElement('option');
        var id = buildCatalogTargetId(target);
        option.value = id;
        option.textContent = target.name;
        targetSelect.appendChild(option);
    });

    if (preferredTargetId && filteredTargets.some(function(target) { return buildCatalogTargetId(target) === preferredTargetId; })) {
        targetSelect.value = preferredTargetId;
    } else if (targetSelect.options.length > 0) {
        targetSelect.value = targetSelect.options[0].value;
    }

    syncLevelModeOptions();
}

function deviceSupportsRequiredAction(device) {
    var requiredAction = getRequiredCatalogAction();
    var requiredBackend = getRequiredBackend();
    if (!requiredAction) return true;
    if (requiredBackend && device.backend !== requiredBackend) return false;

    if (Array.isArray(device.supportedActions) && device.supportedActions.length > 0) {
        return device.supportedActions.includes(requiredAction);
    }

    return (catalog.targets || []).some(function(target) {
        return target.deviceId === device.id && isTargetSelectableForCurrentAction(target);
    });
}

function isTargetSelectableForCurrentAction(target) {
    var requiredBackend = getRequiredBackend();
    if (requiredBackend && target.backend !== requiredBackend) return false;
    if (isPresetAction()) return target.kind === 'preset';
    if (isPriorityAction()) return target.supports && target.supports.includes('priority');
    if (isMuteAction()) return target.supports && target.supports.includes('mute');
    return target.supports && target.supports.includes('level');
}

function buildCatalogTargetId(target) {
    return target.backend === 'lake'
        ? target.backend + ':' + target.deviceId + ':' + target.kind + ':' + target.id
        : target.backend + ':' + target.deviceId + ':' + target.kind + ':' + (target.kind === 'preset' ? target.index : target.id);
}

function getSelectedCatalogTarget() {
    var targetSelect = document.getElementById('targetId');
    if (!targetSelect) return null;
    var selectedTargetId = targetSelect.value;
    return (catalog.targets || []).find(function(target) {
        if (target.backend === 'lake') {
            return target.backend + ':' + target.deviceId + ':' + target.kind + ':' + target.id === selectedTargetId;
        }
        var suffix = target.kind === 'preset' ? target.index : target.id;
        return target.backend + ':' + target.deviceId + ':' + target.kind + ':' + suffix === selectedTargetId;
    }) || null;
}

function syncLevelModeOptions() {
    var levelMode = document.getElementById('levelMode');
    if (!levelMode) return;

    var volumeOption = levelMode.querySelector('option[value="volume"]');
    if (!volumeOption) return;

    var target = getSelectedCatalogTarget();
    var supportsVolume = Boolean(target && target.supports && target.supports.includes('volume'));
    volumeOption.hidden = !supportsVolume;
    volumeOption.disabled = !supportsVolume;

    if (!supportsVolume && levelMode.value === 'volume') {
        levelMode.value = 'gain';
    }
}

function syncPriorityOptions() {
    var triggerRow = document.getElementById('priorityTriggerOptions');
    var priorityRow = document.getElementById('priorityOptions');
    var triggerSelect = document.getElementById('priorityTriggerMode');
    if (!triggerRow || !priorityRow || !triggerSelect) return;

    var isPriority = isPriorityAction();
    triggerRow.style.display = isPriority ? 'flex' : 'none';
    priorityRow.style.display = isPriority && triggerSelect.value !== 'push_count' ? 'flex' : 'none';
}

function updateSmaartSplSelectors(selectedEndpoint, selectedMetric) {
    var inputSelect = document.getElementById('splStreamEndpoint');
    var metricSelect = document.getElementById('splMetric');
    var emptyRow = document.getElementById('smaartSplEmpty');
    if (!inputSelect || !metricSelect || !isSmaartSplAction()) return;

    var inputs = smaartSplCatalog.inputs || [];
    var metrics = smaartSplCatalog.metrics || [];

    inputSelect.innerHTML = '';
    inputs.forEach(function(input) {
        var option = document.createElement('option');
        option.value = input.streamEndpoint;
        option.textContent = input.label || (input.deviceName + ' : ' + input.channelName);
        inputSelect.appendChild(option);
    });

    metricSelect.innerHTML = '';
    metrics.forEach(function(metric) {
        var option = document.createElement('option');
        option.value = metric;
        option.textContent = metric;
        metricSelect.appendChild(option);
    });

    if (selectedEndpoint) {
        inputSelect.value = selectedEndpoint;
    }
    if (!inputSelect.value && inputs.length > 0) {
        inputSelect.value = inputs[0].streamEndpoint;
    }

    if (selectedMetric) {
        metricSelect.value = selectedMetric;
    }
    if (!metricSelect.value && metrics.length > 0) {
        metricSelect.value = metrics[0];
    }

    if (emptyRow) {
        var message = emptyRow.querySelector('.sdpi-item-value');
        if (message) {
            message.textContent = smaartSplCatalog.error || 'No active calibrated inputs found in Smaart.';
        }
        emptyRow.style.display = inputs.length === 0 ? 'flex' : 'none';
    }

    var resolvedEndpoint = inputSelect.value || '';
    var resolvedMetric = metricSelect.value || '';
    if (
        resolvedEndpoint &&
        resolvedMetric &&
        (lastSettings.splStreamEndpoint !== resolvedEndpoint || lastSettings.splMetric !== resolvedMetric)
    ) {
        lastSettings = Object.assign({}, lastSettings, {
            splStreamEndpoint: resolvedEndpoint,
            splMetric: resolvedMetric
        });
        setTimeout(saveSettings, 0);
    }
}`;
}

export const KEY_HTML = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8" />
    <title>Key Property Inspector (Fallback)</title>
    <style>${COMMON_STYLES}</style>
</head>
<body>
    <div class="sdpi-wrapper">
        <div class="fallback-banner">Web-based fallback inspector (plugin path contains special characters).</div>
        <div id="targetControls">
            <div class="sdpi-heading">Target</div>
            <div class="sdpi-item">
                <div class="sdpi-item-label">Device</div>
                <select class="sdpi-item-value select" id="deviceId" onchange="onDeviceChange()"></select>
            </div>
            <div class="sdpi-item">
                <div class="sdpi-item-label">Target</div>
                <select class="sdpi-item-value select" id="targetId" onchange="saveSettings()"></select>
            </div>
            <div class="sdpi-item" id="noDevices" style="display:none;">
                <div class="sdpi-item-value">No devices found.</div>
            </div>
            <div class="sdpi-item">
                <button class="sdpi-item-value" type="button" onclick="refreshCatalog()">Refresh Devices</button>
            </div>
        </div>

        <div id="smaartControls" style="display:none;">
            <div class="sdpi-item-message" id="smaartActionMessage">This action sends a command to the Smaart API.</div>
            <div id="smaartSplOptions" style="display:none;">
                <div class="sdpi-item">
                    <div class="sdpi-item-label">Input</div>
                    <select class="sdpi-item-value select" id="splStreamEndpoint" onchange="saveSettings()"></select>
                </div>
                <div class="sdpi-item">
                    <div class="sdpi-item-label">Metric</div>
                    <select class="sdpi-item-value select" id="splMetric" onchange="saveSettings()"></select>
                </div>
                <div class="sdpi-item" id="smaartSplEmpty" style="display:none;">
                    <div class="sdpi-item-value">No active calibrated inputs found in Smaart.</div>
                </div>
                <div class="sdpi-item">
                    <button class="sdpi-item-value" type="button" onclick="requestSmaartSplCatalog()">Refresh Smaart Inputs</button>
                </div>
            </div>
        </div>

        <div class="sdpi-heading">Action Options</div>
        <div class="sdpi-item" id="muteOptions" style="display:none;">
            <div class="sdpi-item-label">Momentary</div>
            <input class="sdpi-item-value" type="checkbox" id="momentary" onchange="saveSettings()">
        </div>
        <div class="sdpi-item" id="presetOptions" style="display:none;">
            <div class="sdpi-item-label">Double Press</div>
            <input class="sdpi-item-value" type="checkbox" id="requireDoublePress" onchange="saveSettings()">
        </div>
        <div class="sdpi-item" id="priorityTriggerOptions" style="display:none;">
            <div class="sdpi-item-label">Trigger</div>
            <select class="sdpi-item-value select" id="priorityTriggerMode" onchange="saveSettings(); syncPriorityOptions();">
                <option value="fixed">Fixed Priority</option>
                <option value="push_count">Push Count</option>
            </select>
        </div>
        <div class="sdpi-item" id="priorityOptions" style="display:none;">
            <div class="sdpi-item-label">Priority</div>
            <select class="sdpi-item-value select" id="priorityMode" onchange="saveSettings()">
                <option value="auto">Auto Select</option>
                <option value="1">Force Priority 1</option>
                <option value="2">Force Priority 2</option>
                <option value="3">Force Priority 3</option>
                <option value="4">Force Priority 4</option>
            </select>
        </div>
        <div class="sdpi-heading">Global Discovery Settings</div>
${LAKE_GLOBAL_FIELDS}
${SMAART_GLOBAL_FIELDS}
    </div>
    <script>
function updateUI() {
    var muteOptions = document.getElementById('muteOptions');
    var presetOptions = document.getElementById('presetOptions');
    var priorityTriggerOptions = document.getElementById('priorityTriggerOptions');
    var priorityOptions = document.getElementById('priorityOptions');
    var targetControls = document.getElementById('targetControls');
    var smaartControls = document.getElementById('smaartControls');
    var smaartActionMessage = document.getElementById('smaartActionMessage');
    var smaartSplOptions = document.getElementById('smaartSplOptions');
    var lakeGlobalSettings = document.getElementById('lakeGlobalSettings');
    var lakeBackendSettings = document.getElementById('lakeBackendSettings');
    var laBackendSettings = document.getElementById('laBackendSettings');
    var smaartGlobalSettings = document.getElementById('smaartGlobalSettings');
    var isSmaart = isSmaartAction();
    var isSmaartSpl = isSmaartSplAction();
    var requiredBackend = getRequiredBackend();

    if (muteOptions) {
        muteOptions.style.display = isMuteAction() ? 'flex' : 'none';
    }
    if (presetOptions) {
        presetOptions.style.display = isPresetAction() ? 'flex' : 'none';
    }
    if (priorityTriggerOptions) {
        priorityTriggerOptions.style.display = isPriorityAction() ? 'flex' : 'none';
    }
    if (priorityOptions) {
        priorityOptions.style.display = isPriorityAction() ? 'flex' : 'none';
    }
    if (targetControls && smaartControls) {
        targetControls.style.display = isSmaart ? 'none' : 'block';
        smaartControls.style.display = isSmaart ? 'block' : 'none';
    }
    if (smaartActionMessage) {
        smaartActionMessage.textContent = isSmaartSpl
            ? 'This action subscribes to live Smaart SPL data.'
            : 'This action sends a command to the Smaart API.';
    }
    if (smaartSplOptions) {
        smaartSplOptions.style.display = isSmaartSpl ? 'block' : 'none';
    }
    if (lakeGlobalSettings) {
        lakeGlobalSettings.style.display = isSmaart ? 'none' : 'block';
    }
    if (lakeBackendSettings) {
        lakeBackendSettings.style.display = !isSmaart && requiredBackend !== 'la_http' ? 'block' : 'none';
    }
    if (laBackendSettings) {
        laBackendSettings.style.display = !isSmaart && requiredBackend !== 'lake' ? 'block' : 'none';
    }
    if (smaartGlobalSettings) {
        smaartGlobalSettings.style.display = isSmaart ? 'block' : 'none';
    }

    syncPriorityOptions();
}
${buildScript('updateUI();')}
    </script>
</body>
</html>`;

export const DIAL_HTML = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8" />
    <title>Dial Property Inspector (Fallback)</title>
    <style>${COMMON_STYLES}</style>
</head>
<body>
    <div class="sdpi-wrapper">
        <div class="fallback-banner">Web-based fallback inspector (plugin path contains special characters).</div>
        <div id="targetControls">
            <div class="sdpi-heading">Target</div>
            <div class="sdpi-item">
                <div class="sdpi-item-label">Device</div>
                <select class="sdpi-item-value select" id="deviceId" onchange="onDeviceChange()"></select>
            </div>
            <div class="sdpi-item">
                <div class="sdpi-item-label">Target</div>
                <select class="sdpi-item-value select" id="targetId" onchange="saveSettings()"></select>
            </div>
            <div class="sdpi-item" id="noDevices" style="display:none;">
                <div class="sdpi-item-value">No devices found.</div>
            </div>
            <div class="sdpi-item">
                <button class="sdpi-item-value" type="button" onclick="refreshCatalog()">Refresh Devices</button>
            </div>
        </div>

        <div id="smaartControls" style="display:none;">
            <div class="sdpi-item-message" id="smaartActionMessage">Rotate to adjust Smaart generator gain. Press the dial to toggle the generator on or off.</div>
            <div id="smaartFileTransportOptions" style="display:none;">
                <div class="sdpi-item">
                    <div class="sdpi-item-label">Window Title</div>
                    <input class="sdpi-item-value" type="text" id="windowTitle" placeholder="Smaart" onchange="saveSettings()">
                </div>
                <div class="sdpi-item">
                    <div class="sdpi-item-label">Focus Window</div>
                    <input class="sdpi-item-value" type="checkbox" id="activateWindow" onchange="saveSettings()">
                </div>
                <div class="sdpi-item">
                    <div class="sdpi-item-label">Focus Delay (ms)</div>
                    <input class="sdpi-item-value" type="number" id="focusDelayMs" min="0" onchange="saveSettings()">
                </div>
                <div class="sdpi-item">
                    <div class="sdpi-item-label">Step Delay (ms)</div>
                    <input class="sdpi-item-value" type="number" id="betweenStepDelayMs" min="0" onchange="saveSettings()">
                </div>
                <div class="sdpi-item">
                    <div class="sdpi-item-label">Previous Macro</div>
                    <input class="sdpi-item-value" type="text" id="previousMacro" placeholder="Ctrl+Shift+Left" onchange="saveSettings()">
                </div>
                <div class="sdpi-item">
                    <div class="sdpi-item-label">Next Macro</div>
                    <input class="sdpi-item-value" type="text" id="nextMacro" placeholder="Ctrl+Shift+Right" onchange="saveSettings()">
                </div>
                <div class="sdpi-item">
                    <div class="sdpi-item-label">Press Macro</div>
                    <input class="sdpi-item-value" type="text" id="pressMacro" placeholder="Space" onchange="saveSettings()">
                </div>
                <div class="sdpi-item-message">Macro format: <code>Ctrl+Alt+P</code> or multi-step like <code>Ctrl+1, Delay 100, Space</code>.</div>
            </div>
        </div>

        <div class="sdpi-heading" id="actionOptionsHeading">Level Options</div>
        <div id="dialOptions">
            <div class="sdpi-item" id="levelModeRow">
                <div class="sdpi-item-label">Mode</div>
                <select class="sdpi-item-value select" id="levelMode" onchange="saveSettings()">
                    <option value="gain">Gain (dB)</option>
                    <option value="volume">Volume</option>
                </select>
            </div>
            <div class="sdpi-item">
                <div class="sdpi-item-label" id="stepSizeLabel">Step Size</div>
                <input class="sdpi-item-value" type="number" id="stepSize" onchange="saveSettings()">
            </div>
            <div class="sdpi-item">
                <div class="sdpi-item-label" id="minLevelLabel">Min</div>
                <input class="sdpi-item-value" type="number" id="minLevel" onchange="saveSettings()">
            </div>
            <div class="sdpi-item">
                <div class="sdpi-item-label" id="maxLevelLabel">Max</div>
                <input class="sdpi-item-value" type="number" id="maxLevel" onchange="saveSettings()">
            </div>
        </div>
        <div class="sdpi-heading">Global Discovery Settings</div>
${LAKE_GLOBAL_FIELDS}
${SMAART_GLOBAL_FIELDS}
    </div>
    <script>
function updateUI() {
    var isSmaart = isSmaartAction();
    var isSmaartGain = isSmaartGeneratorGainAction();
    var isSmaartFileTransport = isSmaartFileTransportAction();
    var requiredBackend = getRequiredBackend();
    var targetControls = document.getElementById('targetControls');
    var smaartControls = document.getElementById('smaartControls');
    var smaartActionMessage = document.getElementById('smaartActionMessage');
    var smaartFileTransportOptions = document.getElementById('smaartFileTransportOptions');
    var dialOptions = document.getElementById('dialOptions');
    var levelModeRow = document.getElementById('levelModeRow');
    var actionOptionsHeading = document.getElementById('actionOptionsHeading');
    var stepSizeLabel = document.getElementById('stepSizeLabel');
    var minLevelLabel = document.getElementById('minLevelLabel');
    var maxLevelLabel = document.getElementById('maxLevelLabel');
    var lakeGlobalSettings = document.getElementById('lakeGlobalSettings');
    var lakeBackendSettings = document.getElementById('lakeBackendSettings');
    var laBackendSettings = document.getElementById('laBackendSettings');
    var smaartGlobalSettings = document.getElementById('smaartGlobalSettings');

    if (targetControls) {
        targetControls.style.display = isSmaart ? 'none' : 'block';
    }
    if (smaartControls) {
        smaartControls.style.display = isSmaart ? 'block' : 'none';
    }
    if (smaartActionMessage) {
        smaartActionMessage.textContent = isSmaartFileTransport
            ? 'Rotate to send your Previous/Next macros. Press the dial to send the play or pause macro.'
            : 'Rotate to adjust Smaart generator gain. Press the dial to toggle the generator on or off.';
    }
    if (smaartFileTransportOptions) {
        smaartFileTransportOptions.style.display = isSmaartFileTransport ? 'block' : 'none';
    }
    if (dialOptions) {
        dialOptions.style.display = isSmaartFileTransport ? 'none' : 'block';
    }
    if (levelModeRow) {
        levelModeRow.style.display = isSmaart ? 'none' : 'flex';
    }
    if (actionOptionsHeading) {
        actionOptionsHeading.textContent = isSmaartFileTransport
            ? 'File Transport Options'
            : isSmaartGain
                ? 'Generator Gain Options'
                : requiredBackend === 'lake'
                    ? 'Lake Level Options'
                    : requiredBackend === 'la_http'
                        ? 'L-Acoustics Level Options'
                        : 'Level Options';
    }
    if (stepSizeLabel) {
        stepSizeLabel.textContent = isSmaartGain ? 'Step Size (dB)' : 'Step Size';
    }
    if (minLevelLabel) {
        minLevelLabel.textContent = isSmaartGain ? 'Min Gain (dB)' : 'Min';
    }
    if (maxLevelLabel) {
        maxLevelLabel.textContent = isSmaartGain ? 'Max Gain (dB)' : 'Max';
    }
    if (lakeGlobalSettings) {
        lakeGlobalSettings.style.display = isSmaart ? 'none' : 'block';
    }
    if (lakeBackendSettings) {
        lakeBackendSettings.style.display = !isSmaart && requiredBackend !== 'la_http' ? 'block' : 'none';
    }
    if (laBackendSettings) {
        laBackendSettings.style.display = !isSmaart && requiredBackend !== 'lake' ? 'block' : 'none';
    }
    if (smaartGlobalSettings) {
        smaartGlobalSettings.style.display = usesSmaartApiGlobalSettings() ? 'block' : 'none';
    }

    syncLevelModeOptions();
}
${buildScript('updateUI();')}
    </script>
</body>
</html>`;
