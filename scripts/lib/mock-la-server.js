const http = require('http');
const crypto = require('crypto');

const P1_INPUT_FAMILIES = ['ana', 'aes', 'avb', 'mic'];

function createMockLaServer(options = {}) {
    const host = options.host || '127.0.0.1';
    const port = Number(options.port || 0);
    const verbose = Boolean(options.verbose);
    const profile = options.profile || 'p1';
    const authEnabled = Boolean(options.auth && options.auth.enabled);
    const authRealm = options.auth?.realm || 'L-Acoustics Mock';
    const authUsername = options.auth?.username || 'admin';
    const authPassword = options.auth?.password || 'admin';
    const authNonce = options.auth?.nonce || 'mocknonce';
    const authOpaque = options.auth?.opaque || 'mockopaque';
    const challengeStatus = Number(options.auth?.challengeStatus || 401);
    const faults = { ...(options.faults || {}) };
    const requests = [];
    const state = cloneState(options.state || createDefaultState(profile));

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

        if (requestRecord.method === 'GET' && pathname === '/api/info') {
            return complete(requestRecord, 200, state.info);
        }

        if (requestRecord.method === 'GET' && pathname === '/api/configuration/library') {
            return complete(requestRecord, 200, state.configurationLibrary);
        }

        if (handleConfigurationLibraryItem(requestRecord)) {
            return;
        }

        if (pathname === '/api/configuration/load' && requestRecord.method === 'POST') {
            const index = Number(body && body.index);
            if (!Number.isInteger(index) || index < 1 || index > state.configurationLibrary.length) {
                return complete(requestRecord, 400, { error: 'Invalid configuration index' });
            }

            state.activePresetIndex = index;
            return complete(requestRecord, 204);
        }

        if (pathname === '/api/configuration/active/index' && requestRecord.method === 'GET') {
            return complete(requestRecord, 200, state.activePresetIndex);
        }

        if (profile === 'amplified' && handleAmplifiedOutputs(requestRecord)) {
            return;
        }

        if (profile === 'p1' && handleP1Inputs(requestRecord)) {
            return;
        }

        return complete(requestRecord, 404, { error: 'Not found' });

        function handleConfigurationLibraryItem(record) {
            const presetUsedMatch = pathname.match(/^\/api\/configuration\/library\/(\d+)\/used$/);
            const presetNameMatch = pathname.match(/^\/api\/configuration\/library\/(\d+)\/name$/);

            if (presetUsedMatch && record.method === 'GET') {
                const index = Number(presetUsedMatch[1]);
                const preset = state.configurationLibrary[index - 1];
                complete(record, 200, Boolean(preset && preset.used));
                return true;
            }

            if (presetNameMatch && record.method === 'GET') {
                const index = Number(presetNameMatch[1]);
                const preset = state.configurationLibrary[index - 1];
                complete(record, 200, preset ? preset.name : `Preset ${index}`);
                return true;
            }

            return false;
        }

        function handleAmplifiedOutputs(record) {
            const outputMatch = pathname.match(/^\/api\/control\/dsp\/output\/(\d+)(?:\/(mute|gain|volume))?$/);

            if (record.method === 'GET' && pathname === '/api/control/dsp/output') {
                complete(record, 200, state.outputs);
                return true;
            }

            if (!outputMatch) {
                return false;
            }

            const index = Number(outputMatch[1]);
            const property = outputMatch[2];
            const output = state.outputs[index - 1];
            if (!output) {
                complete(record, 404, { error: 'Output not found' });
                return true;
            }

            if (record.method === 'GET' && !property) {
                complete(record, 200, output);
                return true;
            }

            if (record.method === 'GET' && property) {
                complete(record, 200, output[property]);
                return true;
            }

            if (record.method === 'POST' && property) {
                if (!['mute', 'gain', 'volume'].includes(property)) {
                    complete(record, 404, { error: 'Property not found' });
                    return true;
                }
                if (property === 'mute') {
                    output.mute = Boolean(body);
                } else if (property === 'gain') {
                    output.gain = Number(body);
                } else {
                    output.volume = Math.round(Number(body));
                }
                complete(record, 200, output[property]);
                return true;
            }

            return false;
        }

        function handleP1Inputs(record) {
            if (record.method === 'GET' && pathname === '/api/input/settings') {
                complete(record, 200, state.inputSettings);
                return true;
            }

            const indexedMatch = pathname.match(/^\/api\/input\/settings\/(ana|aes|avb|mic)(?:\/(\d+)(?:\/(mute|gain))?)?$/);
            if (indexedMatch) {
                const family = indexedMatch[1];
                const index = indexedMatch[2] ? Number(indexedMatch[2]) : null;
                const property = indexedMatch[3];

                if (!P1_INPUT_FAMILIES.includes(family)) {
                    complete(record, 404, { error: 'Input family not found' });
                    return true;
                }

                const familyInputs = state.inputSettings[family] || [];

                if (record.method === 'GET' && index === null) {
                    complete(record, 200, familyInputs);
                    return true;
                }

                const input = familyInputs[index - 1];
                if (!input) {
                    complete(record, 404, { error: 'Input not found' });
                    return true;
                }

                if (record.method === 'GET' && !property) {
                    complete(record, 200, input);
                    return true;
                }

                if (record.method === 'GET' && property) {
                    complete(record, 200, input[property]);
                    return true;
                }

                if (record.method === 'POST' && property) {
                    if (!['mute', 'gain'].includes(property)) {
                        complete(record, 404, { error: 'Property not found' });
                        return true;
                    }
                    if (property === 'mute') {
                        input.mute = Boolean(body);
                    } else {
                        input.gain = Number(body);
                    }
                    complete(record, 200, input[property]);
                    return true;
                }

                return false;
            }

            const mplMatch = pathname.match(/^\/api\/input\/settings\/mpl(?:\/(mute|gain))?$/);
            if (!mplMatch) {
                return false;
            }

            const property = mplMatch[1];
            const input = state.inputSettings.mpl;
            if (!input) {
                complete(record, 404, { error: 'MPL input not found' });
                return true;
            }

            if (record.method === 'GET' && !property) {
                complete(record, 200, input);
                return true;
            }

            if (record.method === 'GET' && property) {
                complete(record, 200, input[property]);
                return true;
            }

            if (record.method === 'POST' && property) {
                if (!['mute', 'gain'].includes(property)) {
                    complete(record, 404, { error: 'Property not found' });
                    return true;
                }
                if (property === 'mute') {
                    input.mute = Boolean(body);
                } else {
                    input.gain = Number(body);
                }
                complete(record, 200, input[property]);
                return true;
            }

            return false;
        }

        function complete(record, status, responseBody, headers) {
            requests.push({ ...record, status });
            if (verbose) {
                console.log(`[mock-la] ${record.method} ${pathname} -> ${status}`);
            }
            respond(res, status, responseBody, headers);
        }
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

function createDefaultState(profile) {
    if (profile === 'amplified') {
        return {
            info: {
                name: 'LA4X',
                unit_name: 'Amp Rack',
                firmware_version: '2.13.0',
                serial: 'AMP123456',
                mac: '00:11:22:33:44:55',
                avdecc_entity_id: '0001020304050607',
            },
            outputs: [
                { name: 'Output 1', mute: false, gain: -3.0, volume: 320 },
                { name: 'Output 2', mute: false, gain: -6.0, volume: 300 },
                { name: 'Output 3', mute: true, gain: -9.5, volume: 280 },
                { name: 'Output 4', mute: false, gain: 0.0, volume: 360 },
            ],
            configurationLibrary: createConfigurationLibrary(10, ['Show A', 'Show B']),
            activePresetIndex: 1,
        };
    }

    if (profile === 'lc16d') {
        return {
            info: {
                name: 'LC16D',
                unit_name: 'LC16D Core',
                firmware_version: '2.13.0',
                serial: 'LC16123456',
                mac: '00:11:22:33:44:66',
                avdecc_entity_id: '0001020304050608',
            },
            configurationLibrary: createConfigurationLibrary(10, ['Festival', 'Corporate', 'Broadcast']),
            activePresetIndex: 1,
        };
    }

    return {
        info: {
            name: 'P1',
            unit_name: 'P1 Frontfill',
            firmware_version: '2.13.0',
            serial: 'P1123456',
            mac: '00:11:22:33:44:77',
            avdecc_entity_id: '0001020304050609',
        },
        inputSettings: {
            ana: [
                { name: 'Analog Left', mute: false, gain: -3.0 },
                { name: 'Analog Right', mute: false, gain: -3.0 },
                { name: 'Analog Fill', mute: false, gain: -6.0 },
                { name: 'Analog Sub', mute: true, gain: -8.0 },
            ],
            aes: [
                { name: 'AES 1', mute: false, gain: -2.0 },
                { name: 'AES 2', mute: false, gain: -2.0 },
                { name: 'AES 3', mute: false, gain: -4.0 },
                { name: 'AES 4', mute: true, gain: -7.0 },
            ],
            avb: Array.from({ length: 8 }, (_, index) => ({
                name: `AVB ${index + 1}`,
                mute: false,
                gain: -1 * index,
            })),
            mic: [
                { name: 'Mic 1', mute: false, gain: -12.0 },
                { name: 'Mic 2', mute: false, gain: -12.0 },
            ],
            mpl: { name: 'MPL Input', mute: false, gain: -9.0 },
        },
        configurationLibrary: createConfigurationLibrary(30, ['Show A', 'Show B', 'Show C']),
        activePresetIndex: 1,
    };
}

function createConfigurationLibrary(length, usedNames) {
    return Array.from({ length }, (_, index) => ({
        index: index + 1,
        used: index < usedNames.length,
        name: index < usedNames.length ? usedNames[index] : `Unused ${index + 1}`,
    }));
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
