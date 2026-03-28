import os from 'os';

interface AdapterCandidate {
    address: string;
    netmask: string;
    family: string | number;
    internal: boolean;
}

export interface Ipv4Adapter {
    name: string;
    address: string;
    netmask: string;
    prefixLength: number;
    cidr: string;
    label: string;
}

export function listIpv4Adapters(): Ipv4Adapter[] {
    const interfaces = os.networkInterfaces();
    const adapters: Ipv4Adapter[] = [];
    const seenAddresses = new Set<string>();

    Object.entries(interfaces).forEach(([name, addresses]) => {
        const entries = (addresses || []) as AdapterCandidate[];
        entries.forEach((details: AdapterCandidate) => {
            const family = typeof details.family === 'string' ? details.family : details.family === 4 ? 'IPv4' : '';
            if (family !== 'IPv4' || details.internal || !details.address || !details.netmask) {
                return;
            }
            if (seenAddresses.has(details.address)) {
                return;
            }

            const prefixLength = prefixLengthFromNetmask(details.netmask);
            if (prefixLength === null) {
                return;
            }

            seenAddresses.add(details.address);
            adapters.push({
                name,
                address: details.address,
                netmask: details.netmask,
                prefixLength,
                cidr: `${details.address}/${prefixLength}`,
                label: `${name} - ${details.address}/${prefixLength}`,
            });
        });
    });

    return adapters.sort((left, right) => {
        if (left.name !== right.name) {
            return left.name.localeCompare(right.name);
        }
        return compareIpv4(left.address, right.address);
    });
}

export function findIpv4AdapterByAddress(address: string | undefined, adapters: Ipv4Adapter[]): Ipv4Adapter | null {
    if (!address) {
        return null;
    }
    return adapters.find((adapter) => adapter.address === address) || null;
}

export function deriveDiscoverySubnet(address: string, netmask: string): string | null {
    const prefixLength = prefixLengthFromNetmask(netmask);
    if (prefixLength === null) {
        return null;
    }

    const effectivePrefixLength = prefixLength < 24 ? 24 : prefixLength;
    const addressInt = ipv4ToInt(address);
    const maskInt = prefixLengthToMask(effectivePrefixLength);
    if (addressInt === null || maskInt === null) {
        return null;
    }

    const networkInt = addressInt & maskInt;
    return `${intToIpv4(networkInt)}/${effectivePrefixLength}`;
}

export function prefixLengthFromNetmask(netmask: string): number | null {
    const value = ipv4ToInt(netmask);
    if (value === null) {
        return null;
    }

    let foundZero = false;
    let prefixLength = 0;
    for (let bit = 31; bit >= 0; bit -= 1) {
        const isSet = ((value >>> bit) & 1) === 1;
        if (isSet) {
            if (foundZero) {
                return null;
            }
            prefixLength += 1;
        } else {
            foundZero = true;
        }
    }

    return prefixLength;
}

function prefixLengthToMask(prefixLength: number): number | null {
    if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) {
        return null;
    }
    if (prefixLength === 0) {
        return 0;
    }
    return (0xffffffff << (32 - prefixLength)) >>> 0;
}

function ipv4ToInt(address: string): number | null {
    const octets = address.split('.');
    if (octets.length !== 4) {
        return null;
    }

    let value = 0;
    for (const octet of octets) {
        const numeric = Number(octet);
        if (!Number.isInteger(numeric) || numeric < 0 || numeric > 255) {
            return null;
        }
        value = (value << 8) | numeric;
    }
    return value >>> 0;
}

function intToIpv4(value: number): string {
    return [
        (value >>> 24) & 255,
        (value >>> 16) & 255,
        (value >>> 8) & 255,
        value & 255,
    ].join('.');
}

function compareIpv4(left: string, right: string): number {
    const leftInt = ipv4ToInt(left);
    const rightInt = ipv4ToInt(right);
    if (leftInt === null || rightInt === null) {
        return left.localeCompare(right);
    }
    return leftInt - rightInt;
}
