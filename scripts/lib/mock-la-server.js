const http = require('http');
const crypto = require('crypto');

function createMockLaServer(options = {}) {
    const host = options.host || '127.0.0.1';
    const port = Number(options.port || 0);
    const verbose = Boolean(options.verbose);
    const authEnabled = Boolean(options.auth && options.auth.enabled);
    const authRealm = options.auth?.realm || 'L-Acoustics Mock';
    const authUsername = options.auth?.username || 'admin';
    const authPassword = options.auth?.password || 'admin';
    const authNonce = options.auth?.nonce || 'mocknonce';
    const authOpaque = options.auth?.opaque || 'mockopaque';
    const challengeStatus = Number(options.auth?.challengeStatus || 401);
    const faults = { ...(options.faults || {}) };
    const requests = [];
    const state = cloneState(options.state || createDefaultState());

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port || 80}`}`);
        const pathname = url.pathname;
        const body = await readJsonBody(req);
        const requestRecord = {
            method: req.method || 'GET',
            path: pathname,
            authorized: Boolean(req.headers.authorization),
            body,
        };

        if (authEnabled && !isAuthorized(req, authRealm, authUsername, authPassword, authNonce)) {
            requests.push({ ...requestRecord, status: challengeStatus });
            if (verbose) {
                console.log(`[mock-la] ${requestRecord.method} ${pathname} -> ${challengeStatus} (digest challenge)`);
            }
            res.writeHead(challengeStatus, {
                'WWW-Authenticate': buildDigestChallengeHeader(authRealm, authNonce, authOpaque),
            });
            res.end();
            return;
        }

        const fault = consumeFault(faults, requestRecord.method, pathname);
        if (fault) {
            requests.push({ ...requestRecord, status: fault.status });
            if (verbose) {
                console.log(`[mock-la] ${requestRecord.method} ${pathname} -> ${fault.status} (fault)`);
            }
            respond(res, fault.status, fault.body, fault.headers);
            return;
        }

        const outputMatch = pathname.match(/^\/api\/control\/dsp\/output\/(\d+)(?:\/(mute|gain|volume))?$/);
        const presetUsedMatch = pathname.match(/^\/api\/configuration\/library\/(\d+)\/used$/);
        const presetNameMatch = pathname.match(/^\/api\/configuration\/library\/(\d+)\/name$/);

        if (requestRecord.method === 'GET' && pathname === '/api/info') {
            requests.push({ ...requestRecord, status: 200 });
            if (verbose) console.log(`[mock-la] GET ${pathname} -> 200`);
            respond(res, 200, state.info);
            return;
        }

        if (requestRecord.method === 'GET' && pathname === '/api/control/dsp/output') {
            requests.push({ ...requestRecord, status: 200 });
            if (verbose) console.log(`[mock-la] GET ${pathname} -> 200`);
            respond(res, 200, state.outputs);
            return;
        }

        if (outputMatch) {
            const index = Number(outputMatch[1]);
            const property = outputMatch[2];
            const output = state.outputs[index - 1];
            if (!output) {
                requests.push({ ...requestRecord, status: 404 });
                if (verbose) console.log(`[mock-la] ${requestRecord.method} ${pathname} -> 404`);
                respond(res, 404, { error: 'Output not found' });
                return;
            }

            if (requestRecord.method === 'GET' && !property) {
                requests.push({ ...requestRecord, status: 200 });
                if (verbose) console.log(`[mock-la] GET ${pathname} -> 200`);
                respond(res, 200, output);
                return;
            }

            if (requestRecord.method === 'GET' && property) {
                requests.push({ ...requestRecord, status: 200 });
                if (verbose) console.log(`[mock-la] GET ${pathname} -> 200`);
                respond(res, 200, output[property]);
                return;
            }

            if (requestRecord.method === 'POST' && property) {
                if (!['mute', 'gain', 'volume'].includes(property)) {
                    requests.push({ ...requestRecord, status: 404 });
                    if (verbose) console.log(`[mock-la] POST ${pathname} -> 404`);
                    respond(res, 404, { error: 'Property not found' });
                    return;
                }

                if (property === 'mute') {
                    output.mute = Boolean(body);
                } else if (property === 'gain') {
                    output.gain = Number(body);
                } else if (property === 'volume') {
                    output.volume = Math.round(Number(body));
                }

                requests.push({ ...requestRecord, status: 200 });
                if (verbose) console.log(`[mock-la] POST ${pathname} -> 200`);
                respond(res, 200, output[property]);
                return;
            }
        }

        if (presetUsedMatch && requestRecord.method === 'GET') {
            const index = Number(presetUsedMatch[1]);
            const preset = state.configurationLibrary[index - 1];
            requests.push({ ...requestRecord, status: 200 });
            if (verbose) console.log(`[mock-la] GET ${pathname} -> 200`);
            respond(res, 200, Boolean(preset && preset.used));
            return;
        }

        if (presetNameMatch && requestRecord.method === 'GET') {
            const index = Number(presetNameMatch[1]);
            const preset = state.configurationLibrary[index - 1];
            requests.push({ ...requestRecord, status: 200 });
            if (verbose) console.log(`[mock-la] GET ${pathname} -> 200`);
            respond(res, 200, preset ? preset.name : `Preset ${index}`);
            return;
        }

        if (pathname === '/api/configuration/load' && requestRecord.method === 'POST') {
            const index = Number(body && body.index);
            if (!Number.isInteger(index) || index < 1 || index > state.configurationLibrary.length) {
                requests.push({ ...requestRecord, status: 400 });
                if (verbose) console.log(`[mock-la] POST ${pathname} -> 400`);
                respond(res, 400, { error: 'Invalid configuration index' });
                return;
            }

            state.activePresetIndex = index;
            requests.push({ ...requestRecord, status: 204 });
            if (verbose) console.log(`[mock-la] POST ${pathname} -> 204`);
            respond(res, 204);
            return;
        }

        if (pathname === '/api/configuration/active/index' && requestRecord.method === 'GET') {
            requests.push({ ...requestRecord, status: 200 });
            if (verbose) console.log(`[mock-la] GET ${pathname} -> 200`);
            respond(res, 200, state.activePresetIndex);
            return;
        }

        requests.push({ ...requestRecord, status: 404 });
        if (verbose) console.log(`[mock-la] ${requestRecord.method} ${pathname} -> 404`);
        respond(res, 404, { error: 'Not found' });
    });

    return {
        state,
        requests,
        server,
        async start() {
            await new Promise((resolve, reject) => {
                server.listen(port, host, () => resolve(undefined));
                server.once('error', reject);
            });
            const address = server.address();
            if (!address || typeof address === 'string') {
                throw new Error('Unable to determine mock server address.');
            }
            return {
                host: address.address,
                port: address.port,
            };
        },
        async stop() {
            if (!server.listening) {
                return;
            }
            await new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve(undefined);
                });
            });
        },
    };
}

function createDefaultState() {
    return {
        info: {
            name: 'Mock P1',
            firmware_version: '2.13.0',
            serial: 'MOCK123456',
            mac: '00:11:22:33:44:55',
            avdecc_entity_id: '0001020304050607',
        },
        outputs: [
            { name: 'Output 1', mute: false, gain: -3.0, volume: 320 },
            { name: 'Output 2', mute: false, gain: -6.0, volume: 300 },
            { name: 'Output 3', mute: true, gain: -9.5, volume: 280 },
            { name: 'Output 4', mute: false, gain: 0.0, volume: 360 },
        ],
        configurationLibrary: [
            { used: true, name: 'Show A' },
            { used: true, name: 'Show B' },
            { used: false, name: 'Unused 3' },
            { used: false, name: 'Unused 4' },
            { used: false, name: 'Unused 5' },
            { used: false, name: 'Unused 6' },
            { used: false, name: 'Unused 7' },
            { used: false, name: 'Unused 8' },
            { used: false, name: 'Unused 9' },
            { used: false, name: 'Unused 10' },
        ],
        activePresetIndex: 1,
    };
}

function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
}

function respond(res, status, body, headers = {}) {
    const finalHeaders = { ...headers };
    if (status === 204) {
        res.writeHead(status, finalHeaders);
        res.end();
        return;
    }

    const payload = body === undefined ? '' : JSON.stringify(body);
    if (!finalHeaders['Content-Type']) {
        finalHeaders['Content-Type'] = 'application/json';
    }
    finalHeaders['Content-Length'] = Buffer.byteLength(payload).toString();
    res.writeHead(status, finalHeaders);
    res.end(payload);
}

function consumeFault(faults, method, path) {
    const key = `${method} ${path}`;
    const match = faults[key];
    if (!match) {
        return null;
    }
    if (Array.isArray(match)) {
        const next = match.shift() || null;
        if (match.length === 0) {
            delete faults[key];
        }
        return next;
    }
    delete faults[key];
    return match;
}

function buildDigestChallengeHeader(realm, nonce, opaque) {
    return `Digest realm="${realm}", qop="auth", nonce="${nonce}", opaque="${opaque}"`;
}

function isAuthorized(req, realm, username, password, nonce) {
    const authorization = req.headers.authorization;
    if (!authorization || !authorization.startsWith('Digest ')) {
        return false;
    }

    const params = parseAuthorizationHeader(authorization);
    if (!params.username || !params.response || !params.uri) {
        return false;
    }
    if (params.username !== username || params.realm !== realm || params.nonce !== nonce) {
        return false;
    }

    const ha1 = md5(`${username}:${realm}:${password}`);
    const ha2 = md5(`${req.method || 'GET'}:${params.uri}`);
    let expectedResponse;
    if (params.qop) {
        expectedResponse = md5(`${ha1}:${nonce}:${params.nc}:${params.cnonce}:${params.qop}:${ha2}`);
    } else {
        expectedResponse = md5(`${ha1}:${nonce}:${ha2}`);
    }

    return expectedResponse === params.response;
}

function parseAuthorizationHeader(header) {
    const trimmed = header.replace(/^Digest\s+/i, '');
    const params = {};
    const pattern = /([a-z0-9_-]+)=(?:"([^"]*)"|([^,\s]+))/gi;
    let match = null;
    while ((match = pattern.exec(trimmed)) !== null) {
        params[match[1]] = match[2] || match[3] || '';
    }
    return params;
}

function md5(value) {
    return crypto.createHash('md5').update(value).digest('hex');
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (!text) {
                resolve(undefined);
                return;
            }
            try {
                resolve(JSON.parse(text));
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}

module.exports = {
    createMockLaServer,
};
