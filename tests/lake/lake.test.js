const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { startMockLakeServer } = require('../../scripts/mock-lake-dlm');

const distRoot = path.join(__dirname, '..', '..', 'com.jvhtec.lake-smaart.sdPlugin', 'dist');
const { buildInspectorDevices } = require(path.join(distRoot, 'core', 'inspectorCatalog.js'));
const { DlmClient } = require(path.join(distRoot, 'lake', 'dlmClient.js'));

test('buildInspectorDevices keeps only devices with targets and records supported actions', () => {
    const devices = [
        { id: 'lake:frame-a', name: 'LM 44', backend: 'lake', online: true, model: 'LM 44' },
        { id: 'la_192.168.1.2', name: 'P1 A', backend: 'la_http', online: true, model: 'P1' },
        { id: 'la_192.168.1.3', name: 'LC16D A', backend: 'la_http', online: true, model: 'LC16D' },
        { id: 'lake:orphan', name: 'Orphan', backend: 'lake', online: true, model: 'LM 26' },
    ];
    const targets = [
        {
            backend: 'lake',
            deviceId: 'lake:frame-a',
            kind: 'module',
            id: 'A',
            name: 'Module A',
            supports: ['mute', 'level'],
        },
        {
            backend: 'lake',
            deviceId: 'lake:frame-a',
            kind: 'preset',
            id: '1',
            name: 'Preset 1',
        },
        {
            backend: 'la_http',
            deviceId: 'la_192.168.1.2',
            kind: 'output',
            id: 'ana:1',
            index: 1,
            name: 'ANA 1',
            supports: ['mute', 'level'],
            path: '/api/output/settings/ana/1',
            profile: 'p1',
        },
        {
            backend: 'la_http',
            deviceId: 'la_192.168.1.2',
            kind: 'preset',
            index: 2,
            name: 'Show A',
            profile: 'p1',
        },
        {
            backend: 'la_http',
            deviceId: 'la_192.168.1.3',
            kind: 'preset',
            index: 3,
            name: 'Matrix B',
            profile: 'lc16d',
        },
    ];

    const inspectorDevices = buildInspectorDevices(devices, targets);

    assert.deepEqual(
        inspectorDevices.map((device) => [device.id, device.supportedActions]),
        [
            ['lake:frame-a', ['mute', 'level', 'preset']],
            ['la_192.168.1.2', ['mute', 'level', 'preset']],
            ['la_192.168.1.3', ['preset']],
        ]
    );
});

test('DlmClient clears cached discoveries when the Lake routing filter changes', async (t) => {
    const server = await startMockLakeServer({
        port: 0,
        bindAddress: '127.0.0.1',
        verbose: false,
        banner: false,
    });
    t.after(async () => server.close());

    const client = new DlmClient({
        host: '127.0.0.1',
        port: server.port,
        bindAddress: '127.0.0.1',
    });
    t.after(() => client.close());

    const discovered = await client.discoverUnits(300);
    assert.equal(discovered.length, 1);
    assert.equal(client.getKnownUnits().length, 1);

    client.updateConfig({ host: '10.255.255.10' });

    assert.equal(client.getKnownUnits().length, 0);
});
