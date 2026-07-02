const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const distRoot = path.join(__dirname, '..', '..', 'com.jvhtec.lake-smaart.sdPlugin', 'dist');
const { expandLaDiscoverySubnet } = require(path.join(distRoot, 'backends', 'laHttpBackend.js'));

test('expandLaDiscoverySubnet keeps /24 behaviour (254 hosts)', () => {
    const hosts = expandLaDiscoverySubnet('192.168.1.0/24');
    assert.equal(hosts.length, 254);
    assert.equal(hosts[0], '192.168.1.1');
    assert.equal(hosts[253], '192.168.1.254');
});

test('expandLaDiscoverySubnet supports narrower prefixes than /24', () => {
    assert.deepEqual(expandLaDiscoverySubnet('192.168.1.128/30'), ['192.168.1.129', '192.168.1.130']);
    assert.deepEqual(expandLaDiscoverySubnet('192.168.1.10/32'), ['192.168.1.10']);
    assert.deepEqual(expandLaDiscoverySubnet('192.168.1.128/31'), ['192.168.1.128', '192.168.1.129']);

    const slash25 = expandLaDiscoverySubnet('192.168.1.128/25');
    assert.equal(slash25.length, 126);
    assert.equal(slash25[0], '192.168.1.129');
    assert.equal(slash25[125], '192.168.1.254');

    // A non-network base address is clamped to its network.
    const clamped = expandLaDiscoverySubnet('192.168.1.35/24');
    assert.equal(clamped.length, 254);
    assert.equal(clamped[0], '192.168.1.1');
});

test('expandLaDiscoverySubnet supports last-octet ranges', () => {
    assert.deepEqual(expandLaDiscoverySubnet('192.168.1.20-22'), ['192.168.1.20', '192.168.1.21', '192.168.1.22']);
    assert.equal(expandLaDiscoverySubnet('192.168.1.40-20'), null);
});

test('expandLaDiscoverySubnet rejects unsupported formats instead of silently scanning nothing', () => {
    assert.equal(expandLaDiscoverySubnet('10.0.0.0/16'), null);
    assert.equal(expandLaDiscoverySubnet('not-a-subnet'), null);
    assert.equal(expandLaDiscoverySubnet('192.168.1.0/33'), null);
});
