"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LaHttpClient = void 0;
const http_1 = __importDefault(require("http"));
const crypto_1 = __importDefault(require("crypto"));
class LaHttpClient {
    host;
    username;
    password;
    nonceCount = 0;
    constructor(host, username, password) {
        this.host = host;
        this.username = username;
        this.password = password;
    }
    async get(path) {
        return this.request('GET', path);
    }
    async post(path, body) {
        return this.request('POST', path, body);
    }
    async request(method, path, body, authHeader) {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const headers = {
            'Content-Type': 'application/json',
        };
        if (payload) {
            headers['Content-Length'] = Buffer.byteLength(payload).toString();
        }
        if (authHeader) {
            headers['Authorization'] = authHeader;
        }
        const response = await this.send(method, path, payload, headers);
        if (response.status === 401 && this.username && this.password && response.headers['www-authenticate']) {
            const challenge = this.parseDigestChallenge(response.headers['www-authenticate']);
            if (challenge) {
                const auth = this.buildDigestAuthHeader(method, path, challenge);
                return this.send(method, path, payload, { ...headers, Authorization: auth });
            }
        }
        return response;
    }
    send(method, path, payload, headers) {
        return new Promise((resolve, reject) => {
            const options = {
                method,
                host: this.host,
                path,
                headers,
                timeout: 1200,
            };
            const req = http_1.default.request(options, (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    let data = null;
                    if (text) {
                        try {
                            data = JSON.parse(text);
                        }
                        catch (error) {
                            data = null;
                        }
                    }
                    resolve({
                        status: res.statusCode || 0,
                        data,
                        headers: res.headers,
                    });
                });
            });
            req.on('error', (error) => reject(error));
            req.on('timeout', () => {
                req.destroy(new Error('timeout'));
            });
            if (payload) {
                req.write(payload);
            }
            req.end();
        });
    }
    parseDigestChallenge(header) {
        const value = Array.isArray(header) ? header[0] : header;
        const match = value.match(/Digest\s+(.*)/i);
        if (!match)
            return null;
        const parts = match[1].split(',').map((part) => part.trim());
        const data = {};
        for (const part of parts) {
            const [key, raw] = part.split('=');
            if (!key || raw === undefined)
                continue;
            data[key] = raw.replace(/"/g, '');
        }
        if (!data.realm || !data.nonce)
            return null;
        return {
            realm: data.realm,
            nonce: data.nonce,
            qop: data.qop,
            opaque: data.opaque,
        };
    }
    buildDigestAuthHeader(method, uri, challenge) {
        const username = this.username || '';
        const password = this.password || '';
        const realm = challenge.realm;
        const nonce = challenge.nonce;
        const qop = challenge.qop?.split(',')[0];
        const nc = this.getNonceCount();
        const cnonce = crypto_1.default.randomBytes(8).toString('hex');
        const ha1 = crypto_1.default.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
        const ha2 = crypto_1.default.createHash('md5').update(`${method}:${uri}`).digest('hex');
        let response;
        if (qop) {
            response = crypto_1.default
                .createHash('md5')
                .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
                .digest('hex');
        }
        else {
            response = crypto_1.default.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');
        }
        const params = [
            `username="${username}"`,
            `realm="${realm}"`,
            `nonce="${nonce}"`,
            `uri="${uri}"`,
            `response="${response}"`,
        ];
        if (challenge.opaque) {
            params.push(`opaque="${challenge.opaque}"`);
        }
        if (qop) {
            params.push(`qop=${qop}`);
            params.push(`nc=${nc}`);
            params.push(`cnonce="${cnonce}"`);
        }
        return `Digest ${params.join(', ')}`;
    }
    getNonceCount() {
        this.nonceCount += 1;
        return this.nonceCount.toString(16).padStart(8, '0');
    }
}
exports.LaHttpClient = LaHttpClient;
