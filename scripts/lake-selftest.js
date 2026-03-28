const path = require('path');

const { startMockLakeServer } = require('./mock-lake-dlm');

function requireDistModule(relativePath) {
    try {
        return require(path.join(__dirname, '..', 'com.jvhtec.lake-smaart.sdPlugin', 'dist', relativePath));
    } catch (error) {
        const wrapped = new Error(
            `Unable to load compiled module "${relativePath}". Run "npm run build" first. Inner error: ${error.message}`
        );
        wrapped.cause = error;
        throw wrapped;
    }
}

const { DlmClient } = requireDistModule(path.join('lake', 'dlmClient.js'));
const { buildGetGain, buildGetMute, buildRecallPreset, buildSetGain, buildSetMute } = requireDistModule(path.join('lake', 'dlmCommands.js'));
const { DLM_BROADCAST_IDHI, DLM_BROADCAST_IDLO, encodeDlmMsg, parseDlmPacket } = requireDistModule(path.join('lake', 'dlmPacket.js'));

const EXPECTED_APPENDIX_D_HEX =
    '0000000001000000fefffffffdffffff060000003000bd02ffffffff4d6f642e496e2e4d7574653d4120310000000000';

async function main() {
    verifyAppendixDExample();

    const server = await startMockLakeServer({
        port: 0,
        bindAddress: '127.0.0.1',
        frameId: '01020304:11223344',
        frameLabel: 'Mock Lake Frame',
        verbose: false,
        banner: false,
    });

    const client = new DlmClient({
        host: '127.0.0.1',
        port: server.port,
        bindAddress: '127.0.0.1',
        debug: true,
    });

    const logs = [];
    client.on('log', (message) => {
        logs.push(message);
    });

    try {
        const discovered = await client.discoverUnits(400);
        assert(discovered.length === 1, `Expected one discovered unit, got ${discovered.length}.`);

        const unit = discovered[0];
        assert(unit.frameId === '01020304:11223344', `Unexpected frame ID ${unit.frameId}.`);

        await client.send(buildSetMute('A', true), unit);
        const muteResponse = await client.send(buildGetMute('A'), unit);
        assert(muteResponse && /Mod\.In\.Mute=A 1$/.test(muteResponse.payload), 'Mute query did not return the updated state.');

        await client.send(buildSetGain('B', -3.5), unit);
        const gainResponse = await client.send(buildGetGain('B'), unit);
        assert(gainResponse && /Mod\.In\.Gain=B -3\.50$/.test(gainResponse.payload), 'Gain query did not return the updated value.');

        await client.send(buildRecallPreset(3), unit);
        assert(server.state.lastPreset === 3, `Expected preset 3 to be recalled, got ${server.state.lastPreset}.`);

        const labelResponse = await client.send('Dev.FrameLabel?', unit);
        assert(labelResponse && /Mock Lake Frame$/.test(labelResponse.payload), 'Frame label query failed.');

        console.log('Lake self-test passed.');
        console.log(`Discovered ${unit.model} at ${unit.ip} (${unit.frameId}).`);
        console.log(`Validated discovery, mute, gain, preset recall, and frame-label query with ${logs.length} client log entries.`);
    } finally {
        client.close();
        await server.close();
    }
}

function verifyAppendixDExample() {
    const packet = encodeDlmMsg('Mod.In.Mute=A 1', {
        srcIdHi: 0,
        srcIdLo: 1,
        destIdHi: DLM_BROADCAST_IDHI,
        destIdLo: DLM_BROADCAST_IDLO,
        destClass: 0,
        msgId: 0xffffffff,
    });
    const encoded = packet.toString('hex');
    assert(
        encoded === EXPECTED_APPENDIX_D_HEX,
        `Appendix D packet mismatch.\nExpected: ${EXPECTED_APPENDIX_D_HEX}\nActual:   ${encoded}`
    );

    const parsed = parseDlmPacket(packet);
    assert(parsed && parsed.kind === 'message', 'Appendix D packet did not parse as a DLM message.');
    assert(parsed.checksumValid, 'Appendix D packet footer should be accepted as valid.');
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

main().catch((error) => {
    console.error(`Lake self-test failed: ${error.message}`);
    process.exit(1);
});
