// Copies runtime npm dependencies into the plugin bundle after tsc.
// Cross-platform replacement for the former copy-runtime-deps.ps1, which
// broke `npm run build` on macOS/Linux.

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const pluginRoot = path.join(projectRoot, 'com.jvhtec.lake-smaart.sdPlugin');
const sourceRoot = path.join(projectRoot, 'node_modules');
const runtimeDependencies = ['ws'];

if (!fs.existsSync(pluginRoot)) {
    console.error(`Plugin root not found: ${pluginRoot}`);
    process.exit(1);
}

const pluginNodeModules = path.join(pluginRoot, 'node_modules');
fs.mkdirSync(pluginNodeModules, { recursive: true });

for (const dependency of runtimeDependencies) {
    const sourcePath = path.join(sourceRoot, dependency);
    const destinationPath = path.join(pluginNodeModules, dependency);

    if (!fs.existsSync(sourcePath)) {
        console.error(`Runtime dependency not found: ${sourcePath}. Run npm install first.`);
        process.exit(1);
    }

    fs.rmSync(destinationPath, { recursive: true, force: true });
    fs.cpSync(sourcePath, destinationPath, { recursive: true });
    console.log(`Copied runtime dependency '${dependency}' to plugin bundle.`);
}
