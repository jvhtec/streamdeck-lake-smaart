let websocket = null;
let uuid = null;
let actionInfo = null;
let settingsCache = {};
let catalog = { devices: [], targets: [] };

function connectElgatoStreamDeckSocket(inPort, inPropertyInspectorUUID, inRegisterEvent, inInfo, inActionInfo) {
  uuid = inPropertyInspectorUUID;
  actionInfo = JSON.parse(inActionInfo);

  websocket = new WebSocket('ws://127.0.0.1:' + inPort);

  websocket.onopen = function () {
    websocket.send(JSON.stringify({ event: inRegisterEvent, uuid: inPropertyInspectorUUID }));

    websocket.send(JSON.stringify({ event: 'getGlobalSettings', context: uuid }));
    websocket.send(JSON.stringify({ event: 'getSettings', context: actionInfo.context }));

    mmRequestCatalog();
  };

  websocket.onmessage = function (evt) {
    const jsonObj = JSON.parse(evt.data);

    if (jsonObj.event === 'didReceiveGlobalSettings') {
      mmLoadGlobalSettings(jsonObj.payload.settings || {});
    }

    if (jsonObj.event === 'didReceiveSettings') {
      mmLoadSettings(jsonObj.payload.settings || {});
    }

    if (jsonObj.event === 'sendToPropertyInspector') {
      if (jsonObj.payload && jsonObj.payload.devices) {
        catalog = jsonObj.payload;
        mmInitSelectors();
        mmRenderTargets();
      }
    }
  };
}

function mmLoadSettings(s) {
  settingsCache = s || {};
  const desired = document.getElementById('desiredState');
  const momentary = document.getElementById('momentary');
  if (desired) desired.value = settingsCache.desiredState || 'toggle';
  if (momentary) momentary.checked = Boolean(settingsCache.momentary);

  mmInitSelectors();
  mmRenderTargets();
}

function mmLoadGlobalSettings(settings) {
  const fields = [
    'lakeHost', 'lakePort',
    'laDiscoverySubnet', 'laDiscoveryHosts', 'laAuthUser', 'laAuthPass',
    'devicePollIntervalMs', 'deviceDiscoveryIntervalMs', 'presetPollIntervalMs',
    'laMaxConcurrency', 'laRequestTimeoutMs'
  ];

  fields.forEach((field) => {
    const el = document.getElementById(field);
    if (el && settings[field] !== undefined) {
      el.value = settings[field];
    }
  });
}

function mmSaveSettings() {
  if (!websocket) return;

  const desiredState = document.getElementById('desiredState')?.value || 'toggle';
  const momentary = Boolean(document.getElementById('momentary')?.checked);
  const deviceId = document.getElementById('deviceId')?.value || '';

  const targetIds = Array.isArray(settingsCache.targetIds) ? settingsCache.targetIds : [];

  const payload = {
    deviceId,
    desiredState,
    momentary,
    targetIds,
  };

  settingsCache = { ...settingsCache, ...payload };

  websocket.send(JSON.stringify({
    event: 'setSettings',
    context: actionInfo.context,
    payload,
  }));

  mmRenderTargets();
}

function mmSaveGlobalSettings() {
  if (!websocket) return;

  const payload = {
    lakeHost: document.getElementById('lakeHost')?.value || '',
    lakePort: document.getElementById('lakePort')?.value || '',
    laDiscoverySubnet: document.getElementById('laDiscoverySubnet')?.value || '',
    laDiscoveryHosts: document.getElementById('laDiscoveryHosts')?.value || '',
    laAuthUser: document.getElementById('laAuthUser')?.value || '',
    laAuthPass: document.getElementById('laAuthPass')?.value || '',

    devicePollIntervalMs: document.getElementById('devicePollIntervalMs')?.value || '',
    deviceDiscoveryIntervalMs: document.getElementById('deviceDiscoveryIntervalMs')?.value || '',
    presetPollIntervalMs: document.getElementById('presetPollIntervalMs')?.value || '',
    laMaxConcurrency: document.getElementById('laMaxConcurrency')?.value || '',
    laRequestTimeoutMs: document.getElementById('laRequestTimeoutMs')?.value || '',
  };

  websocket.send(JSON.stringify({
    event: 'setGlobalSettings',
    context: uuid,
    payload,
  }));
}

function mmRequestCatalog() {
  if (!websocket) return;
  websocket.send(JSON.stringify({
    event: 'sendToPlugin',
    context: actionInfo.context,
    payload: { request: 'catalog' }
  }));
}

function mmRefreshCatalog() {
  mmRequestCatalog();
}

function mmInitSelectors() {
  const deviceSelect = document.getElementById('deviceId');
  if (!deviceSelect) return;

  const devices = catalog.devices || [];
  deviceSelect.innerHTML = '';
  devices.forEach((device) => {
    const option = document.createElement('option');
    option.value = device.id;
    option.textContent = device.name;
    deviceSelect.appendChild(option);
  });

  const current = settingsCache.deviceId || deviceSelect.value || (devices[0] ? devices[0].id : '');
  if (current) deviceSelect.value = current;
}

function mmOnDeviceChange() {
  settingsCache.deviceId = document.getElementById('deviceId')?.value || '';
  // When changing device, clear selected targets.
  settingsCache.targetIds = [];
  mmSaveSettings();
}

function mmRenderTargets() {
  const deviceId = document.getElementById('deviceId')?.value || settingsCache.deviceId;
  const filter = (document.getElementById('search')?.value || '').toLowerCase();

  const availableEl = document.getElementById('available');
  const selectedEl = document.getElementById('selected');
  if (!availableEl || !selectedEl) return;

  const allTargets = (catalog.targets || []).filter((t) => t.supports && t.supports.includes('mute'));
  const deviceTargets = allTargets.filter((t) => t.deviceId === deviceId);

  const selected = new Set(Array.isArray(settingsCache.targetIds) ? settingsCache.targetIds : []);

  const available = deviceTargets
    .map((t) => ({ t, id: mmTargetId(t) }))
    .filter(({ t, id }) => {
      if (selected.has(id)) return false;
      if (!filter) return true;
      const text = `${t.name} ${t.kind} ${t.backend}`.toLowerCase();
      return text.includes(filter);
    });

  const selectedRows = deviceTargets
    .map((t) => ({ t, id: mmTargetId(t) }))
    .filter(({ id }) => selected.has(id));

  availableEl.innerHTML = '';
  selectedEl.innerHTML = '';

  available.forEach(({ t, id }) => {
    const row = document.createElement('div');
    row.className = 'target-row';

    const btn = document.createElement('button');
    btn.textContent = '+';
    btn.onclick = () => {
      settingsCache.targetIds = Array.from(new Set([...(settingsCache.targetIds || []), id]));
      mmSaveSettings();
    };

    const label = document.createElement('div');
    label.textContent = t.name;

    row.appendChild(btn);
    row.appendChild(label);
    availableEl.appendChild(row);
  });

  selectedRows.forEach(({ t, id }) => {
    const row = document.createElement('div');
    row.className = 'target-row';

    const btn = document.createElement('button');
    btn.textContent = '–';
    btn.onclick = () => {
      settingsCache.targetIds = (settingsCache.targetIds || []).filter((x) => x !== id);
      mmSaveSettings();
    };

    const label = document.createElement('div');
    label.textContent = t.name;

    row.appendChild(btn);
    row.appendChild(label);
    selectedEl.appendChild(row);
  });

  const summary = document.getElementById('summary');
  if (summary) {
    summary.textContent = `Selected: ${(settingsCache.targetIds || []).length} target(s)`;
  }
}

function mmTargetId(target) {
  // Matches plugin/core/deviceManager.getTargetId
  if (target.backend === 'lake') {
    return `${target.backend}:${target.deviceId}:${target.kind}:${target.id}`;
  }
  return `${target.backend}:${target.deviceId}:${target.kind}:${target.index}`;
}
