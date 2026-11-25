import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile, cp, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

// Preserve npm's nested layout for the ACP SDK and Windows input bridge.
// The Claude Agent SDK is installed directly from upstream by its users.
export async function copyAgentDependencies(root, destination) {
  const seen = new Set();
  async function copy(name, from) {
    const require = createRequire(join(from, 'package.json'));
    const folder = (require.resolve.paths(name) ?? []).map(base => join(base, name)).find(base => existsSync(join(base, 'package.json')));
    if (!folder) throw new Error(`Missing runtime dependency ${name}; run npm install before packaging.`);
    if (seen.has(folder)) return; seen.add(folder);
    const rel = relative(root, folder);
    if (rel.startsWith('..') || !rel.startsWith('node_modules' + sep)) throw new Error(`Dependency ${name} must be installed inside the app.`);
    const target = resolve(destination, rel), manifest = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'));
    await mkdir(dirname(target), { recursive: true });
    await cp(folder, target, { recursive: true, filter: file => !relative(folder, file).split(sep).includes('node_modules') });
    for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      if (manifest.optionalDependencies?.[dependency] || manifest.peerDependenciesMeta?.[dependency]?.optional) continue;
      await copy(dependency, folder);
    }
  }
  for (const name of ['@agentclientprotocol/sdk', 'koffi', '@koromix/koffi-win32-x64']) await copy(name, root);
}
