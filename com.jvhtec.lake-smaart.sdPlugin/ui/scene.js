let websocket = null;
let uuid = null;
let actionInfo = null;
let catalog = { devices: [], targets: [] };
let settingsCache = { steps: [] };

// temp group builder
let groupTargets = [];

function connectElgatoStreamDeckSocket(inPort, inPropertyInspectorUUID, inRegisterEvent, inInfo, inActionInfo) {
  uuid = inPropertyInspectorUUID;
  actionInfo = JSON.parse(inActionInfo);

  websocket = new WebSocket('ws://127.0.0.1:' + inPort);

  websocket.onopen = function () {
    websocket.send(JSON.stringify({ event: inRegisterEvent, uuid: inPropertyInspectorUUID }));

    websocket.send(JSON.stringify({ event: 'getGlobalSettings', context: uuid }));
    websocket.send(JSON.stringify({ event: 'getSettings', context: actionInfo.context }));

    scRequestCatalog();
  };

  websocket.onmessage = function (evt) {
    const jsonObj = JSON.parse(evt.data);

    if (jsonObj.event === 'didReceiveGlobalSettings') {
      scLoadGlobalSettings(jsonObj.payload.settings || {});
    }

    if (jsonObj.event === 'didReceiveSettings') {
      scLoadSettings(jsonObj.payload.settings || {});
    }

    if (jsonObj.event === 'sendToPropertyInspector') {
      if (jsonObj.payload && jsonObj.payload.devices) {
        catalog = jsonObj.payload;
        scInitSelectors();
        scRenderStepInputs();
        scRenderSteps();
      }
      if (jsonObj.payload && jsonObj.payload.ok !== undefined) {
        const status = document.getElementById('status');
        if (status) {
          status.textContent = jsonObj.payload.ok ? 'OK' : `ERROR: ${jsonObj.payload.error || 'unknown'}`;
        }
      }
    }
  };
}

function scLoadSettings(s) {
  settingsCache = { steps: [], ...s };

  document.getElementById('sceneName').value = settingsCache.sceneName || '';
  document.getElementById('requireDoublePress').checked = Boolean(settingsCache.requireDoublePress);

  scInitSelectors();
  scRenderStepInputs();
  scRenderSteps();
}

function scLoadGlobalSettings(settings) {
  const fields = [
    'lakeHost', 'lakePort',
    'laDiscoverySubnet', 'laDiscoveryHosts', 'laAuthUser', 'laAuthPass',
    'smaartHost', 'smaartPort',
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

function scSaveSettings() {
  if (!websocket) return;

  const payload = {
    ...settingsCache,
    sceneName: document.getElementById('sceneName')?.value || '',
    requireDoublePress: Boolean(document.getElementById('requireDoublePress')?.checked),
    steps: Array.isArray(settingsCache.steps) ? settingsCache.steps : [],
  };

  settingsCache = payload;

  websocket.send(JSON.stringify({
    event: 'setSettings',
    context: actionInfo.context,
    payload,
  }));

  scRenderSteps();
}

function scSaveGlobalSettings() {
  if (!websocket) return;

  const payload = {
    lakeHost: document.getElementById('lakeHost')?.value || '',
    lakePort: document.getElementById('lakePort')?.value || '',
    laDiscoverySubnet: document.getElementById('laDiscoverySubnet')?.value || '',
    laDiscoveryHosts: document.getElementById('laDiscoveryHosts')?.value || '',
    laAuthUser: document.getElementById('laAuthUser')?.value || '',
    laAuthPass: document.getElementById('laAuthPass')?.value || '',
    smaartHost: document.getElementById('smaartHost')?.value || '',
    smaartPort: document.getElementById('smaartPort')?.value || '',

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

function scRequestCatalog() {
  if (!websocket) return;
  websocket.send(JSON.stringify({
    event: 'sendToPlugin',
    context: actionInfo.context,
    payload: { request: 'catalog' }
  }));
}

function scInitSelectors() {
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

  if (devices.length > 0) {
    const current = settingsCache.deviceId || deviceSelect.value || devices[0].id;
    deviceSelect.value = current;
    settingsCache.deviceId = current;
  }
}

function scOnDeviceChange() {
  settingsCache.deviceId = document.getElementById('deviceId')?.value || '';
  groupTargets = [];
  scRenderStepInputs();
}

function scRenderStepInputs() {
  const type = document.getElementById('stepType')?.value || 'preset';

  const deviceTargetBlock = document.getElementById('deviceTargetBlock');
  const levelValueBlock = document.getElementById('levelValueBlock');
  const groupAddBlock = document.getElementById('groupAddBlock');
  const groupListBlock = document.getElementById('groupListBlock');

  const usesDeviceTarget = !type.startsWith('smaart_');
  if (deviceTargetBlock) deviceTargetBlock.style.display = usesDeviceTarget ? 'block' : 'none';

  const isLevel = type === 'level_gain' || type === 'level_volume';
  if (levelValueBlock) levelValueBlock.style.display = isLevel ? 'flex' : 'none';

  const isGroup = type === 'mute' || type === 'unmute' || type === 'toggleMute';
  if (groupAddBlock) groupAddBlock.style.display = isGroup ? 'flex' : 'none';
  if (groupListBlock) groupListBlock.style.display = isGroup ? 'flex' : 'none';

  // target selector options
  const targetSelect = document.getElementById('targetId');
  const deviceId = document.getElementById('deviceId')?.value || settingsCache.deviceId;
  if (!targetSelect) return;

  let targets = (catalog.targets || []).filter((t) => t.deviceId === deviceId);

  if (type === 'preset') {
    targets = targets.filter((t) => t.kind === 'preset');
  } else if (isLevel) {
    targets = targets.filter((t) => t.supports && t.supports.includes('level'));
  } else if (isGroup) {
    targets = targets.filter((t) => t.supports && t.supports.includes('mute'));
  }

  targetSelect.innerHTML = '';
  targets.forEach((t) => {
    const option = document.createElement('option');
    option.value = scTargetId(t);
    option.textContent = t.name;
    targetSelect.appendChild(option);
  });

  scRenderGroupList();
}

function scAddToGroup() {
  const targetId = document.getElementById('targetId')?.value || '';
  if (!targetId) return;
  groupTargets = Array.from(new Set([...groupTargets, targetId]));
  scRenderGroupList();
}

function scRenderGroupList() {
  const el = document.getElementById('groupList');
  if (!el) return;
  if (!groupTargets.length) {
    el.textContent = '(empty)';
    return;
  }
  el.textContent = groupTargets.join('\n');
}

function scAddStep() {
  const type = document.getElementById('stepType')?.value || 'preset';

  let step = null;

  if (type === 'preset') {
    step = { type: 'preset', targetId: document.getElementById('targetId')?.value || '' };
  } else if (type === 'mute' || type === 'unmute' || type === 'toggleMute') {
    step = { type, targetIds: groupTargets.slice() };
  } else if (type === 'level_gain' || type === 'level_volume') {
    const mode = type === 'level_volume' ? 'volume' : 'gain';
    step = {
      type: 'level',
      targetId: document.getElementById('targetId')?.value || '',
      value: Number(document.getElementById('levelValue')?.value || 0),
      mode,
    };
  } else if (type === 'smaart_gen_on') {
    step = { type: 'smaart', command: 'generator', state: true };
  } else if (type === 'smaart_gen_off') {
    step = { type: 'smaart', command: 'generator', state: false };
  } else if (type === 'smaart_capture') {
    step = { type: 'smaart', command: 'capture' };
  } else if (type === 'smaart_delay') {
    step = { type: 'smaart', command: 'computeDelay' };
  } else if (type === 'smaart_trace_on') {
    step = { type: 'smaart', command: 'activeTrace', visible: true };
  } else if (type === 'smaart_trace_off') {
    step = { type: 'smaart', command: 'activeTrace', visible: false };
  }

  // basic validation
  if (!step) return;
  if (step.type === 'preset' && !step.targetId) return;
  if (step.type === 'level' && !step.targetId) return;
  if ((step.type === 'mute' || step.type === 'unmute' || step.type === 'toggleMute') && (!step.targetIds || step.targetIds.length === 0)) return;

  settingsCache.steps = Array.isArray(settingsCache.steps) ? settingsCache.steps : [];
  settingsCache.steps = [...settingsCache.steps, step];

  groupTargets = [];
  scSaveSettings();
  scRenderStepInputs();
}

function scRenderSteps() {
  const root = document.getElementById('steps');
  if (!root) return;

  const steps = Array.isArray(settingsCache.steps) ? settingsCache.steps : [];
  if (steps.length === 0) {
    root.innerHTML = '<div class="sdpi-item-message">No steps yet.</div>';
    return;
  }

  root.innerHTML = '';
  steps.forEach((s, idx) => {
    const div = document.createElement('div');
    div.className = 'step';

    const left = document.createElement('div');
    left.className = 'mono';
    left.textContent = `${idx + 1}. ${JSON.stringify(s)}`;

    const right = document.createElement('div');

    const up = document.createElement('button');
    up.textContent = '↑';
    up.onclick = () => scMoveStep(idx, -1);

    const down = document.createElement('button');
    down.textContent = '↓';
    down.onclick = () => scMoveStep(idx, +1);

    const del = document.createElement('button');
    del.textContent = '✕';
    del.onclick = () => scDeleteStep(idx);

    right.appendChild(up);
    right.appendChild(down);
    right.appendChild(del);

    div.appendChild(left);
    div.appendChild(right);
    root.appendChild(div);
  });
}

function scDeleteStep(idx) {
  const steps = Array.isArray(settingsCache.steps) ? settingsCache.steps : [];
  settingsCache.steps = steps.filter((_, i) => i !== idx);
  scSaveSettings();
}

function scMoveStep(idx, delta) {
  const steps = Array.isArray(settingsCache.steps) ? settingsCache.steps.slice() : [];
  const j = idx + delta;
  if (j < 0 || j >= steps.length) return;
  const tmp = steps[idx];
  steps[idx] = steps[j];
  steps[j] = tmp;
  settingsCache.steps = steps;
  scSaveSettings();
}

function scTestRun() {
  if (!websocket) return;
  const steps = Array.isArray(settingsCache.steps) ? settingsCache.steps : [];

  const status = document.getElementById('status');
  if (status) status.textContent = 'Running...';

  websocket.send(JSON.stringify({
    event: 'sendToPlugin',
    context: actionInfo.context,
    payload: { request: 'runScene', steps },
  }));
}

function scTargetId(target) {
  // Must match plugin/core/deviceManager.getTargetId
  if (target.backend === 'lake') {
    return `${target.backend}:${target.deviceId}:${target.kind}:${target.id}`;
  }
  return `${target.backend}:${target.deviceId}:${target.kind}:${target.index}`;
}
