import http from 'http';
import crypto from 'crypto';
import {
    formatLaRequestSummary,
    LaHttpError,
    LaLogFn,
    LaRequestResult,
} from './laApi';

interface LaHttpClientOptions {
    debug?: boolean;
    logger?: LaLogFn;
    timeoutMs?: number;
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
    private debug: boolean;
    private logger?: LaLogFn;
    private timeoutMs: number;

    constructor(host: string, username?: string, password?: string, options?: LaHttpClientOptions) {
        this.host = host;
        this.username = username;
        this.password = password;
        this.debug = Boolean(options?.debug);
        this.logger = options?.logger;
        this.timeoutMs = options?.timeoutMs ?? 1200;
    }

    public async get<T>(path: string): Promise<LaRequestResult<T>> {
        return this.request<T>('GET', path);
    }

    public async post<T>(path: string, body: unknown): Promise<LaRequestResult<T>> {
        return this.request<T>('POST', path, body);
    }

    private async request<T>(method: string, path: string, body?: unknown, authHeader?: string): Promise<LaRequestResult<T>> {
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

        const response = await this.send<T>(method, path, payload, headers, false);
        const authChallengeHeader = response.headers['www-authenticate'];
        const shouldRetryDigest =
            (response.status === 401 || response.status === 403) &&
            this.username &&
            this.password &&
            authChallengeHeader;

        if (shouldRetryDigest) {
            const challenge = this.parseDigestChallenge(authChallengeHeader);
            if (challenge) {
                this.logDebug(`[LA] Digest auth challenge received for http://${this.host}${path}; retrying with digest.`);
                const auth = this.buildDigestAuthHeader(method, path, challenge);
                const retriedResponse = await this.send<T>(method, path, payload, { ...headers, Authorization: auth }, true);
                if (retriedResponse.status === 401 || retriedResponse.status === 403) {
                    this.log(`[LA] Authentication failed for http://${this.host}${path} (HTTP ${retriedResponse.status}).`, true);
                }
                return retriedResponse;
            }
        }

        if ((response.status === 401 || response.status === 403) && response.headers['www-authenticate']) {
            this.log(`[LA] Authentication is required for http://${this.host}${path} (HTTP ${response.status}).`, true);
        }

        return response;
    }

    private send<T>(
        method: string,
        path: string,
        payload?: string,
        headers?: Record<string, string>,
        usedDigest = false
    ): Promise<LaRequestResult<T>> {
        return new Promise((resolve, reject) => {
            const startedAt = Date.now();
            const target = this.resolveTarget();
            const options: http.RequestOptions = {
                method,
                hostname: target.hostname,
                port: target.port,
                path,
                headers,
                timeout: this.timeoutMs,
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
                    const result: LaRequestResult<T> = {
                        status: res.statusCode || 0,
                        data,
                        rawText: text,
                        headers: res.headers,
                        durationMs: Date.now() - startedAt,
                        request: {
                            host: this.host,
                            method,
                            path,
                            attemptedDigest: usedDigest || Boolean(headers?.Authorization),
                            usedDigest,
                        },
                    };
                    this.logDebug(`[LA] ${formatLaRequestSummary(result)}`);
                    resolve(result);
                });
            });

            req.on('error', (error) => {
                const wrappedError = new LaHttpError(
                    `L-Acoustics ${method} ${path} failed: ${error.message}`,
                    {
                        host: this.host,
                        method,
                        path,
                        cause: error,
                    }
                );
                this.log(`[LA] ${wrappedError.message}`, true);
                reject(wrappedError);
            });
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
        const data: Record<string, string> = {};
        const pattern = /([a-z0-9_-]+)=(?:"([^"]*)"|([^,\s]+))/gi;
        let partMatch: RegExpExecArray | null = null;
        while ((partMatch = pattern.exec(match[1])) !== null) {
            const key = partMatch[1];
            const valuePart = partMatch[2] ?? partMatch[3] ?? '';
            data[key] = valuePart;
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

    private log(message: string, force = false) {
        if (!this.logger) {
            return;
        }
        if (force || this.debug) {
            this.logger(message);
        }
    }

    private logDebug(message: string) {
        this.log(message, false);
    }

    private resolveTarget(): { hostname: string; port: number } {
        const ipv6Match = this.host.match(/^\[([^\]]+)\](?::(\d+))?$/);
        if (ipv6Match) {
            return {
                hostname: ipv6Match[1],
                port: ipv6Match[2] ? Number(ipv6Match[2]) : 80,
            };
        }

        const lastColonIndex = this.host.lastIndexOf(':');
        if (lastColonIndex > -1) {
            const maybePort = this.host.slice(lastColonIndex + 1);
            if (/^\d+$/.test(maybePort)) {
                return {
                    hostname: this.host.slice(0, lastColonIndex),
                    port: Number(maybePort),
                };
            }
        }

        return {
            hostname: this.host,
            port: 80,
        };
    }
}
