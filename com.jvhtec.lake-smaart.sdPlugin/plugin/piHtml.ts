/**
 * Embedded PI HTML served by the fallback HTTP server.
 * These mirror ui/key.html and ui/dial.html but connect to the plugin's
 * own WebSocket server instead of Stream Deck's, reading action/context
 * from URL query parameters.
 */

const COMMON_STYLES = `body{font-family:Arial,sans-serif;color:#ddd;background:#2d2d2d;margin:0;padding:10px}.sdpi-wrapper{display:flex;flex-direction:column;gap:8px}.sdpi-heading{font-size:12px;font-weight:700;text-transform:uppercase;color:#9aa0a6;margin-top:8px}.sdpi-item{display:flex;align-items:center;gap:8px}.sdpi-item-label{width:140px;font-size:12px;color:#cfcfcf}.sdpi-item-value{flex:1;min-height:28px;background:#3a3a3a;border:1px solid #555;color:#fff;border-radius:4px;padding:4px 6px}.sdpi-item-message{font-size:12px;color:#cfcfcf}button.sdpi-item-value{cursor:pointer}.fallback-banner{background:#3a3a3a;border:1px solid #555;border-radius:4px;padding:8px;margin-bottom:8px;font-size:11px;color:#aaa}`;

const COMMON_GLOBAL_FIELDS = `
        <div class="sdpi-heading">Global Discovery Settings</div>
        <div class="sdpi-item">
            <div class="sdpi-item-label">Lake Host</div>
            <input class="sdpi-item-value" type="text" id="lakeHost" onchange="saveGlobalSettings()">
        </div>
        <div class="sdpi-item">
            <div class="sdpi-item-label">Lake Port</div>
            <input class="sdpi-item-value" type="number" id="lakePort" onchange="saveGlobalSettings()">
        </div>
        <div class="sdpi-item">
            <div class="sdpi-item-label">L-Acoustics Subnet</div>
            <input class="sdpi-item-value" type="text" id="laDiscoverySubnet" placeholder="192.168.0.0/24" onchange="saveGlobalSettings()">
        </div>
        <div class="sdpi-item">
            <div class="sdpi-item-label">L-Acoustics Hosts</div>
            <input class="sdpi-item-value" type="text" id="laDiscoveryHosts" placeholder="192.168.0.20,192.168.0.21" onchange="saveGlobalSettings()">
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
            <div class="sdpi-item-label">Smaart Host</div>
            <input class="sdpi-item-value" type="text" id="smaartHost" onchange="saveGlobalSettings()">
        </div>
        <div class="sdpi-item">
            <div class="sdpi-item-label">Smaart Port</div>
            <input class="sdpi-item-value" type="number" id="smaartPort" onchange="saveGlobalSettings()">
        </div>`;

function buildScript(extraInit: string): string {
    return `
let websocket = null;
let action = '';
let context = '';
let catalog = { devices: [], targets: [] };
let pendingDeviceId = null;
let pendingTargetId = null;

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
            catalog = { devices: msg.devices || [], targets: msg.targets || [] };
            var devId = pendingDeviceId;
            var tgtId = pendingTargetId;
            pendingDeviceId = null;
            pendingTargetId = null;
            updateSelectors(devId, tgtId);
        }
    };

    ${extraInit}
})();

function loadSettings(settings) {
    const globalFields = ['lakeHost', 'lakePort', 'laDiscoverySubnet', 'laDiscoveryHosts', 'laAuthUser', 'laAuthPass', 'smaartHost', 'smaartPort'];
    const inputs = document.querySelectorAll('.sdpi-item-value');
    inputs.forEach(function(input) {
        if (!input.id || globalFields.includes(input.id)) return;
        if (input.type === 'checkbox') {
            input.checked = Boolean(settings[input.id]);
        } else {
            input.value = settings[input.id] != null ? settings[input.id] : '';
        }
    });
    if (catalog.devices.length > 0 || catalog.targets.length > 0) {
        updateSelectors(settings.deviceId, settings.targetId);
    } else {
        pendingDeviceId = settings.deviceId || null;
        pendingTargetId = settings.targetId || null;
    }
    if (typeof updateUI === 'function') updateUI();
}

function loadGlobalSettings(settings) {
    var fields = ['lakeHost', 'lakePort', 'laDiscoverySubnet', 'laDiscoveryHosts', 'laAuthUser', 'laAuthPass', 'smaartHost', 'smaartPort'];
    fields.forEach(function(field) {
        var el = document.getElementById(field);
        if (el && settings[field] !== undefined) {
            el.value = settings[field];
        }
    });
}

function saveSettings() {
    if (!websocket) return;
    var globalFields = ['lakeHost', 'lakePort', 'laDiscoverySubnet', 'laDiscoveryHosts', 'laAuthUser', 'laAuthPass', 'smaartHost', 'smaartPort'];
    var settings = {};
    var inputs = document.querySelectorAll('.sdpi-item-value');
    inputs.forEach(function(input) {
        if (!input.id || globalFields.includes(input.id)) return;
        if (input.type === 'checkbox') {
            settings[input.id] = input.checked;
        } else {
            settings[input.id] = input.value;
        }
    });
    websocket.send(JSON.stringify({
        type: 'setSettings',
        context: context,
        settings: settings
    }));
    updateSelectors(settings.deviceId, settings.targetId);
}

function saveGlobalSettings() {
    if (!websocket) return;
    var payload = {
        lakeHost: (document.getElementById('lakeHost') || {}).value || '',
        lakePort: (document.getElementById('lakePort') || {}).value || '',
        laDiscoverySubnet: (document.getElementById('laDiscoverySubnet') || {}).value || '',
        laDiscoveryHosts: (document.getElementById('laDiscoveryHosts') || {}).value || '',
        laAuthUser: (document.getElementById('laAuthUser') || {}).value || '',
        laAuthPass: (document.getElementById('laAuthPass') || {}).value || '',
        smaartHost: (document.getElementById('smaartHost') || {}).value || '',
        smaartPort: (document.getElementById('smaartPort') || {}).value || ''
    };
    websocket.send(JSON.stringify({
        type: 'setGlobalSettings',
        settings: payload
    }));
}

function requestCatalog() {
    if (!websocket) return;
    websocket.send(JSON.stringify({ type: 'getCatalog' }));
}

function refreshCatalog() {
    requestCatalog();
}

function updateSelectors(selectedDeviceId, selectedTargetId) {
    var deviceSelect = document.getElementById('deviceId');
    var targetSelect = document.getElementById('targetId');
    var noDevices = document.getElementById('noDevices');
    if (!deviceSelect || !targetSelect) return;
    if (action.includes('smaart')) return;

    var devices = catalog.devices || [];
    var targets = catalog.targets || [];

    deviceSelect.innerHTML = '';
    devices.forEach(function(device) {
        var option = document.createElement('option');
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

    var activeDevice = selectedDeviceId || deviceSelect.value || devices[0].id;
    deviceSelect.value = activeDevice;

    var filteredTargets = targets.filter(function(target) {
        if (target.deviceId !== activeDevice) return false;
        if (action.includes('preset')) return target.kind === 'preset';
        if (action.includes('mute')) return target.supports && target.supports.includes('mute');
        return target.supports && target.supports.includes('level');
    });

    targetSelect.innerHTML = '';
    filteredTargets.forEach(function(target) {
        var option = document.createElement('option');
        var id = target.backend === 'lake'
            ? target.backend + ':' + target.deviceId + ':' + target.kind + ':' + target.id
            : target.backend + ':' + target.deviceId + ':' + target.kind + ':' + target.index;
        option.value = id;
        option.textContent = target.name;
        targetSelect.appendChild(option);
    });

    if (selectedTargetId) {
        targetSelect.value = selectedTargetId;
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
                <select class="sdpi-item-value select" id="deviceId" onchange="saveSettings()"></select>
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
            <div class="sdpi-item-message">This action sends a command to the Smaart API.</div>
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
${COMMON_GLOBAL_FIELDS}
    </div>
    <script>
function updateUI() {
    var muteOptions = document.getElementById('muteOptions');
    var presetOptions = document.getElementById('presetOptions');
    var targetControls = document.getElementById('targetControls');
    var smaartControls = document.getElementById('smaartControls');

    if (muteOptions) {
        muteOptions.style.display = action.includes('mute') ? 'flex' : 'none';
    }
    if (presetOptions) {
        presetOptions.style.display = action.includes('preset') ? 'flex' : 'none';
    }
    if (targetControls && smaartControls) {
        var isSmaart = action.includes('smaart');
        targetControls.style.display = isSmaart ? 'none' : 'block';
        smaartControls.style.display = isSmaart ? 'block' : 'none';
    }
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
        <div class="sdpi-heading">Target</div>
        <div class="sdpi-item">
            <div class="sdpi-item-label">Device</div>
            <select class="sdpi-item-value select" id="deviceId" onchange="saveSettings()"></select>
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

        <div class="sdpi-heading">Level Options</div>
        <div class="sdpi-item">
            <div class="sdpi-item-label">Mode</div>
            <select class="sdpi-item-value select" id="levelMode" onchange="saveSettings()">
                <option value="gain">Gain (dB)</option>
                <option value="volume">Volume</option>
            </select>
        </div>
        <div class="sdpi-item">
            <div class="sdpi-item-label">Step Size</div>
            <input class="sdpi-item-value" type="number" id="stepSize" onchange="saveSettings()">
        </div>
        <div class="sdpi-item">
            <div class="sdpi-item-label">Min</div>
            <input class="sdpi-item-value" type="number" id="minLevel" onchange="saveSettings()">
        </div>
        <div class="sdpi-item">
            <div class="sdpi-item-label">Max</div>
            <input class="sdpi-item-value" type="number" id="maxLevel" onchange="saveSettings()">
        </div>
${COMMON_GLOBAL_FIELDS}
    </div>
    <script>
${buildScript('')}
    </script>
</body>
</html>`;
