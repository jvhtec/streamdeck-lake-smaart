const dgram = require('dgram');
const path = require('path');

const DEFAULT_PORT = 6016;
const DEFAULT_BIND_ADDRESS = '127.0.0.1';
const DEFAULT_FRAME_ID = '01020304:11223344';
const DEFAULT_PRODUCT_FLAG = 0x0c;
const DEFAULT_ROUTER_COUNT = 4;

function loadDlmPacketModule() {
    try {
        return require(path.join(__dirname, '..', 'com.jvhtec.lake-smaart.sdPlugin', 'dist', 'lake', 'dlmPacket.js'));
    } catch (error) {
        const wrapped = new Error(
            `Unable to load compiled DLM helpers from dist. Run "npm run build" first. Inner error: ${error.message}`
        );
        wrapped.cause = error;
        throw wrapped;
    }
}

const {
    ACK_BAD_PARAM,
    ACK_SUCCESS,
    DLM_BROADCAST_IDHI,
    DLM_BROADCAST_IDLO,
    DLM_DEVICE_CLASS_ID,
    DLM_HOST_CLASS_ID,
    describePacket,
    encodeAck,
    encodeBroadcastAnnouncement,
    encodeDlmMsg,
    formatFrameId,
    parseDlmPacket,
    parseFrameId,
} = loadDlmPacketModule();

async function startMockLakeServer(options = {}) {
    const bindAddress = options.bindAddress || DEFAULT_BIND_ADDRESS;
    const requestedPort = Number.isInteger(options.port) ? options.port : DEFAULT_PORT;
    const verbose = options.verbose !== false;
    const frameIdText = options.frameId || DEFAULT_FRAME_ID;
    const parsedFrameId = parseFrameId(frameIdText);
    if (!parsedFrameId) {
        throw new Error(`Invalid frame ID "${frameIdText}". Expected 8hex:8hex.`);
    }

    const state = {
        frame: parsedFrameId,
        frameLabel: options.frameLabel || 'Mock Lake Frame',
        productFlag: Number.isInteger(options.productFlag) ? options.productFlag : DEFAULT_PRODUCT_FLAG,
        power: true,
        lastPreset: null,
        routerCount: Number.isInteger(options.routerCount) ? options.routerCount : DEFAULT_ROUTER_COUNT,
        modules: {
            A: { mute: false, gain: 0.0, outputChannels: 1, outputMutes: { 1: false } },
            B: { mute: false, gain: 0.0, outputChannels: 1, outputMutes: { 1: false } },
            C: { mute: false, gain: 0.0, outputChannels: 1, outputMutes: { 1: false } },
            D: { mute: false, gain: 0.0, outputChannels: 1, outputMutes: { 1: false } },
        },
        routers: {},
    };
    for (let index = 1; index <= state.routerCount; index++) {
        state.routers[index] = { forcePriority: 0 };
    }

    const socket = dgram.createSocket('udp4');
    const runtime = {
        socket,
        state,
        verbose,
        frameId: formatFrameId(state.frame.idHi, state.frame.idLo),
        productFlag: state.productFlag,
    };

    socket.on('message', async (msg, rinfo) => {
        const packet = parseDlmPacket(msg);
        log(runtime, `${rinfo.address}:${rinfo.port} -> ${msg.length} bytes`);
        if (!packet) {
            log(runtime, 'Unable to decode packet as DLM.');
            if (verbose) {
                log(runtime, msg.toString('hex'));
            }
            return;
        }

        log(runtime, describePacket(packet));
        if (verbose) {
            log(runtime, `Hex=${msg.toString('hex')}`);
        }

        if (packet.kind === 'broadcast') {
            const reply = encodeBroadcastAnnouncement({
                srcIdHi: state.frame.idHi,
                srcIdLo: state.frame.idLo,
                msgId: packet.header.msgId,
                productFlag: state.productFlag,
                destIdHi: DLM_BROADCAST_IDHI,
                destIdLo: DLM_BROADCAST_IDLO,
                srcClass: Number.isInteger(options.broadcastSrcClass) ? options.broadcastSrcClass : DLM_DEVICE_CLASS_ID,
            });
            await sendPacket(socket, reply, rinfo.port, rinfo.address);
            log(runtime, `Heartbeat reply sent for ${runtime.frameId}`);
            return;
        }

        if (packet.kind !== 'message') {
            return;
        }

        if (!isPacketForMock(state.frame, packet.header.destIdHi, packet.header.destIdLo)) {
            log(runtime, `Ignoring command for ${formatFrameId(packet.header.destIdHi, packet.header.destIdLo)}`);
            return;
        }

        const result = applyCommand(state, packet.payload);
        if (result.type === 'response') {
            const reply = encodeDlmMsg(result.payload, {
                srcIdHi: state.frame.idHi,
                srcIdLo: state.frame.idLo,
                destIdHi: packet.header.srcIdHi,
                destIdLo: packet.header.srcIdLo,
                srcClass: DLM_DEVICE_CLASS_ID,
                destClass: DLM_HOST_CLASS_ID,
                msgId: packet.header.msgId,
                footerMode: 'checksum',
            });
            await sendPacket(socket, reply, rinfo.port, rinfo.address);
            log(runtime, `Response payload="${result.payload}"`);
            return;
        }

        const ack = encodeAck({
            srcIdHi: state.frame.idHi,
            srcIdLo: state.frame.idLo,
            destIdHi: packet.header.srcIdHi,
            destIdLo: packet.header.srcIdLo,
            srcClass: DLM_DEVICE_CLASS_ID,
            destClass: DLM_HOST_CLASS_ID,
            msgId: packet.header.msgId,
            result: result.result,
        });
        await sendPacket(socket, ack, rinfo.port, rinfo.address);
        log(runtime, `Ack result=${result.result}`);
    });

    socket.on('error', (error) => {
        log(runtime, `Socket error: ${error.message}`);
    });

    await bindSocket(socket, requestedPort, bindAddress);
    const address = socket.address();
    const port = typeof address === 'string' ? requestedPort : address.port;

    if (options.banner !== false) {
        log(runtime, `Listening on udp://${bindAddress}:${port}`);
        log(runtime, `Frame ID ${runtime.frameId} product=0x${runtime.productFlag.toString(16)}`);
        log(runtime, `Point the plugin to Lake Device IP ${bindAddress}, Lake Port ${port}, Lake Adapter IP ${bindAddress}.`);
    }

    return {
        port,
        bindAddress,
        frameId: runtime.frameId,
        state,
        close: () => closeSocket(socket),
    };
}

function applyCommand(state, command) {
    let match = command.match(/^Mod\.In\.Mute\?([A-D])$/);
    if (match) {
        const moduleId = match[1];
        const mute = state.modules[moduleId].mute ? 1 : 0;
        return { type: 'response', payload: `Mod.In.Mute=${moduleId} ${mute}` };
    }

    match = command.match(/^Mod\.In\.Mute=([A-D])\s+([01])$/);
    if (match) {
        const moduleId = match[1];
        state.modules[moduleId].mute = match[2] === '1';
        return { type: 'ack', result: ACK_SUCCESS };
    }

    match = command.match(/^Mod\.In\.Gain\?([A-D])$/);
    if (match) {
        const moduleId = match[1];
        return { type: 'response', payload: `Mod.In.Gain=${moduleId} ${state.modules[moduleId].gain.toFixed(2)}` };
    }

    match = command.match(/^Mod\.In\.Gain=([A-D])\s+(-?\d+(?:\.\d+)?)$/);
    if (match) {
        const moduleId = match[1];
        state.modules[moduleId].gain = parseFloat(match[2]);
        return { type: 'ack', result: ACK_SUCCESS };
    }

    match = command.match(/^Mod\.Out\.Chans\?([A-D])$/);
    if (match) {
        const moduleId = match[1];
        return { type: 'response', payload: `${state.modules[moduleId].outputChannels}` };
    }

    match = command.match(/^Mod\.Out\.Mute\?([A-D])\s+([1-6])$/);
    if (match) {
        const moduleId = match[1];
        const channel = parseInt(match[2], 10);
        if (channel > state.modules[moduleId].outputChannels) {
            return { type: 'ack', result: ACK_BAD_PARAM };
        }
        const mute = state.modules[moduleId].outputMutes[channel] ? 1 : 0;
        return { type: 'response', payload: `Mod.Out.Mute=${moduleId} ${channel} ${mute}` };
    }

    match = command.match(/^Mod\.Out\.Mute=([A-D])\s+([1-6])\s+([01])$/);
    if (match) {
        const moduleId = match[1];
        const channel = parseInt(match[2], 10);
        if (channel > state.modules[moduleId].outputChannels) {
            return { type: 'ack', result: ACK_BAD_PARAM };
        }
        state.modules[moduleId].outputMutes[channel] = match[3] === '1';
        return { type: 'ack', result: ACK_SUCCESS };
    }

    match = command.match(/^Dev\.Preset\.Recall!(\d+)$/);
    if (match) {
        state.lastPreset = parseInt(match[1], 10);
        return { type: 'ack', result: ACK_SUCCESS };
    }

    match = command.match(/^Dev\.Router\.ForceInputPriority\?(\d+)$/);
    if (match) {
        const routerIndex = parseInt(match[1], 10);
        const router = state.routers[routerIndex];
        if (!router) {
            return { type: 'response', payload: `ERR Unsupported ${command}` };
        }
        return { type: 'response', payload: `Dev.Router.ForceInputPriority=${routerIndex} ${router.forcePriority}` };
    }

    match = command.match(/^Dev\.Router\.ForceInputPriority=(\d+)\s+([0-4])$/);
    if (match) {
        const routerIndex = parseInt(match[1], 10);
        const router = state.routers[routerIndex];
        if (!router) {
            return { type: 'ack', result: ACK_BAD_PARAM };
        }
        router.forcePriority = parseInt(match[2], 10);
        return { type: 'ack', result: ACK_SUCCESS };
    }

    if (command === 'Dev.FrameLabel?') {
        return { type: 'response', payload: `Dev.FrameLabel=${state.frameLabel}` };
    }

    if (command === 'Dev.Power?') {
        return { type: 'response', payload: `Dev.Power=${state.power ? 1 : 0}` };
    }

    match = command.match(/^Dev\.Power=([01])$/);
    if (match) {
        state.power = match[1] === '1';
        return { type: 'ack', result: ACK_SUCCESS };
    }

    if (command.includes('?')) {
        return { type: 'response', payload: `ERR Unsupported ${command}` };
    }

    return { type: 'ack', result: ACK_BAD_PARAM };
}

function isPacketForMock(frame, destIdHi, destIdLo) {
    return (
        (destIdHi === frame.idHi && destIdLo === frame.idLo) ||
        (destIdHi === DLM_BROADCAST_IDHI && destIdLo === DLM_BROADCAST_IDLO)
    );
}

function log(runtime, message) {
    console.log(`[mock-lake] ${message}`);
}

function bindSocket(socket, port, bindAddress) {
    return new Promise((resolve, reject) => {
        socket.once('listening', resolve);
        socket.once('error', reject);
        socket.bind(port, bindAddress);
    }).finally(() => {
        socket.removeAllListeners('error');
        socket.on('error', (error) => {
            console.error(`[mock-lake] Socket error: ${error.message}`);
        });
    });
}

function sendPacket(socket, packet, port, host) {
    return new Promise((resolve, reject) => {
        socket.send(packet, port, host, (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

function closeSocket(socket) {
    return new Promise((resolve) => {
        try {
            socket.close(() => resolve());
        } catch {
            resolve();
        }
    });
}

function readArg(args, name) {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
    const args = process.argv.slice(2);
    const port = parseInt(readArg(args, '--port') || `${DEFAULT_PORT}`, 10);
    const bindAddress = readArg(args, '--bind') || DEFAULT_BIND_ADDRESS;
    const frameId = readArg(args, '--frame-id') || DEFAULT_FRAME_ID;
    const frameLabel = readArg(args, '--label') || 'Mock Lake Frame';
    const productArg = readArg(args, '--product');
    const productFlag = productArg ? Number(productArg) : DEFAULT_PRODUCT_FLAG;
    const routerCountArg = readArg(args, '--router-count');
    const routerCount = routerCountArg ? parseInt(routerCountArg, 10) : DEFAULT_ROUTER_COUNT;
    const verbose = !args.includes('--quiet');

    const server = await startMockLakeServer({
        port,
        bindAddress,
        frameId,
        frameLabel,
        productFlag,
        routerCount,
        verbose,
        banner: true,
    });

    const shutdown = async () => {
        await server.close();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

if (require.main === module) {
    main().catch((error) => {
        console.error(`[mock-lake] ${error.message}`);
        process.exit(1);
    });
}

module.exports = {
    startMockLakeServer,
};
