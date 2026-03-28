const { createMockLaServer } = require('./lib/mock-la-server');

async function main() {
    const args = process.argv.slice(2);
    const host = readOption(args, 'bind') || process.env.npm_config_bind || '127.0.0.1';
    const port = Number(readOption(args, 'port') || process.env.npm_config_port || '80');
    const authEnabled = readFlag(args, 'auth') || isTrueEnv(process.env.npm_config_auth);
    const verbose = !(readFlag(args, 'quiet') || isTrueEnv(process.env.npm_config_quiet));
    const username = readOption(args, 'user') || process.env.npm_config_user || 'admin';
    const password = readOption(args, 'pass') || process.env.npm_config_pass || 'admin';
    const challengeStatus = Number(readOption(args, 'challenge-status') || process.env.npm_config_challenge_status || '401');

    const server = createMockLaServer({
        host,
        port,
        verbose,
        auth: authEnabled
            ? {
                  enabled: true,
                  username,
                  password,
                  challengeStatus,
              }
            : undefined,
    });

    const address = await server.start();
    console.log(`[mock-la] Listening on http://${address.host}:${address.port}`);
    console.log('[mock-la] Point the plugin L-Acoustics host to this address or use --host with the smoke CLI.');
    if (authEnabled) {
        console.log(`[mock-la] Digest auth enabled with user "${username}".`);
    }

    process.on('SIGINT', async () => {
        await server.stop();
        process.exit(0);
    });
}

function readOption(args, name) {
    const flag = `--${name}`;
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
}

function readFlag(args, name) {
    return args.includes(`--${name}`);
}

function isTrueEnv(value) {
    return value === 'true' || value === '1';
}

main().catch((error) => {
    console.error('[mock-la] Failed to start:', error);
    process.exit(1);
});
