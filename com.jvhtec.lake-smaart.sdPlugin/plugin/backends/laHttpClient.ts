import http from 'http';
import crypto from 'crypto';

interface HttpResponse<T> {
    status: number;
    data: T | null;
    headers: http.IncomingHttpHeaders;
}

interface DigestChallenge {
    realm: string;
    nonce: string;
    qop?: string;
    opaque?: string;
}

export class LaHttpClient {
    private host: string;
    private username?: string;
    private password?: string;
    private nonceCount = 0;

    constructor(host: string, username?: string, password?: string) {
        this.host = host;
        this.username = username;
        this.password = password;
    }

    public async get<T>(path: string): Promise<HttpResponse<T>> {
        return this.request<T>('GET', path);
    }

    public async post<T>(path: string, body: unknown): Promise<HttpResponse<T>> {
        return this.request<T>('POST', path, body);
    }

    private async request<T>(method: string, path: string, body?: unknown, authHeader?: string): Promise<HttpResponse<T>> {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (payload) {
            headers['Content-Length'] = Buffer.byteLength(payload).toString();
        }
        if (authHeader) {
            headers['Authorization'] = authHeader;
        }

        const response = await this.send<T>(method, path, payload, headers);
        if (response.status === 401 && this.username && this.password && response.headers['www-authenticate']) {
            const challenge = this.parseDigestChallenge(response.headers['www-authenticate']);
            if (challenge) {
                const auth = this.buildDigestAuthHeader(method, path, challenge);
                return this.send<T>(method, path, payload, { ...headers, Authorization: auth });
            }
        }
        return response;
    }

    private send<T>(method: string, path: string, payload?: string, headers?: Record<string, string>): Promise<HttpResponse<T>> {
        return new Promise((resolve, reject) => {
            const options: http.RequestOptions = {
                method,
                host: this.host,
                path,
                headers,
                timeout: 1200,
            };

            const req = http.request(options, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    let data: T | null = null;
                    if (text) {
                        try {
                            data = JSON.parse(text) as T;
                        } catch (error) {
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

    private parseDigestChallenge(header: string | string[]): DigestChallenge | null {
        const value = Array.isArray(header) ? header[0] : header;
        const match = value.match(/Digest\s+(.*)/i);
        if (!match) return null;
        const parts = match[1].split(',').map((part) => part.trim());
        const data: Record<string, string> = {};
        for (const part of parts) {
            const [key, raw] = part.split('=');
            if (!key || raw === undefined) continue;
            data[key] = raw.replace(/"/g, '');
        }
        if (!data.realm || !data.nonce) return null;
        return {
            realm: data.realm,
            nonce: data.nonce,
            qop: data.qop,
            opaque: data.opaque,
        };
    }

    private buildDigestAuthHeader(method: string, uri: string, challenge: DigestChallenge): string {
        const username = this.username || '';
        const password = this.password || '';
        const realm = challenge.realm;
        const nonce = challenge.nonce;
        const qop = challenge.qop?.split(',')[0];
        const nc = this.getNonceCount();
        const cnonce = crypto.randomBytes(8).toString('hex');

        const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
        const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');

        let response: string;
        if (qop) {
            response = crypto
                .createHash('md5')
                .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
                .digest('hex');
        } else {
            response = crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');
        }

        const params: string[] = [
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

    private getNonceCount() {
        this.nonceCount += 1;
        return this.nonceCount.toString(16).padStart(8, '0');
    }
}
