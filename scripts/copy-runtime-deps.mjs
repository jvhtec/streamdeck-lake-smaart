import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const pluginRoot = path.join(projectRoot, 'com.jvhtec.lake-smaart.sdPlugin');
const sourceRoot = path.join(projectRoot, 'node_modules');
const runtimeDependencies = ['ws'];

await mkdir(path.join(pluginRoot, 'node_modules'), { recursive: true });

for (const dependency of runtimeDependencies) {
  const sourcePath = path.join(sourceRoot, dependency);
  const destinationPath = path.join(pluginRoot, 'node_modules', dependency);

  await rm(destinationPath, { recursive: true, force: true });
  await cp(sourcePath, destinationPath, { recursive: true });
  console.log(`Copied runtime dependency '${dependency}' to plugin bundle.`);
}
