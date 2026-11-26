import { access, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { releaseVersion, requireFreshDirectory, reserveFreshDirectory } from './release-inputs.mjs';
import { inspectMotionAssets } from './motion-assets.mjs';
import { inspectPuppetAssets } from './puppet-assets.mjs';
import characters from '../../prototypes/live2d-codex/backend/character-profiles.cjs';
import { writeManifest } from './manifest.mjs';
import { captureSourceState, verifySourceState } from './source-state.mjs';
import { createRunDirectory } from '../qa/run-output.mjs';

const root = resolve(import.meta.dirname, '../..'), app = join(root, 'prototypes/live2d-codex');
const args = process.argv.slice(2);
const preflight = args.length === 1 && args[0] === '--preflight';
if (args.length && !preflight) throw new Error('Use npm run package or npm run package -- --preflight.');
const version = await releaseVersion(root);
const stable = !version.includes('-');
if (!stable && !preflight) throw new Error('Use npm run package:test -- --public for a publishable prerelease, or --preflight for an unsigned rehearsal.');
const sign = stable && !preflight;
const signingScript = process.env.RIN_RELEASE_SIGN_SCRIPT;
if (sign) {
  if (!signingScript || !/\.ps1$/i.test(signingScript) || !process.env.RIN_RELEASE_SUBJECT?.trim())
    throw new Error('A stable installer requires RIN_RELEASE_SIGN_SCRIPT (.ps1) and RIN_RELEASE_SUBJECT. Use --preflight for an unsigned rehearsal.');
  await access(resolve(signingScript));
}
const source = await captureSourceState(root, { build: `v${version}`, version, channel: preflight ? 'preflight' : 'release', publishable: !preflight });

await inspectMotionAssets(join(app, 'assets/motion/female'));
for (const directory of characters.POSE_DIRECTORIES) await inspectPuppetAssets(join(app, 'assets/scene', directory));
const resources = process.env.VIBE_RESOURCE_APP || app;
await access(join(resources, 'runtime/node.exe'));
await access(join(app, 'voice-resources.json'));
const compiler = process.env.INNO_ISCC || join(root, 'work/release-build/tools/inno/ISCC.exe');
await access(compiler);

const output = preflight ? await createRunDirectory('release-preflight') : join(root, 'release', `v${version}`);
const stage = preflight ? join(output, 'application') : join(root, 'release', `Rin-Desktop-${version}-win-x64`);
await requireFreshDirectory(stage);
if (!preflight) await reserveFreshDirectory(output);

const run = (binary, parameters) => execFileSync(binary, parameters, { windowsHide: true, stdio: 'inherit' });
const powershell = (script, ...parameters) => run('pwsh.exe', ['-NoProfile', '-File', script, ...parameters]);
const verifySignature = file => powershell(join(root, 'tools/release/verify-signature.ps1'), '-FilePath', file);
run(process.execPath, [join(app, 'scripts/package-portable.mjs'), `--out=${stage}`]);
await writeFile(join(stage, 'source-state.json'), JSON.stringify(source, null, 2));

const inno = [`/DVersion=${version}`, `/DSourceDir=${stage}`, `/DReleaseDir=${output}`];
if (preflight) inno.push('/DReleasePreflight');
if (sign) {
  const signer = resolve(signingScript);
  for (const name of ['VibeVoice.exe', 'resources/app/runtime/rc003-helper.exe']) {
    const file = join(stage, name);
    powershell(signer, file);
    verifySignature(file);
  }
  const innoSigner = signer.replaceAll('$', () => '$$');
  inno.push('/DSignRelease', `/SRinRelease=pwsh.exe -NoProfile -File $q${innoSigner}$q $f`);
}
await writeManifest(stage, version);
await verifySourceState(root, source);
run(compiler, ['/Qp', ...inno, join(root, 'tools/release/installer.iss')]);
const name = `Rin-Desktop-${version}${preflight ? '-Preflight' : ''}-Setup.exe`;
const setup = join(output, name);
if (sign) verifySignature(setup);
const hash = createHash('sha256');
for await (const chunk of createReadStream(setup)) hash.update(chunk);
const sha256 = hash.digest('hex');
await verifySourceState(root, source, { rehash: false });
await writeFile(join(output, 'SHA256SUMS.txt'), `${sha256}  ${name}\n`);
const result = { output, stage, setup, sha256, preflight, signed: sign, head: source.head, publishable: source.publishable };
await writeFile(join(output, 'build-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
