import { access, cp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeManifest } from './manifest.mjs';
import { releaseVersion, requireFreshDirectory, reserveFreshDirectory } from './release-inputs.mjs';
import { inspectMotionAssets } from './motion-assets.mjs';
import { inspectPuppetAssets } from './puppet-assets.mjs';
import characters from '../../prototypes/live2d-codex/backend/character-profiles.cjs';
import { captureSourceState, verifySourceState } from './source-state.mjs';
import { createRunDirectory } from '../qa/run-output.mjs';

const root = resolve(import.meta.dirname, '../..'), app = join(root, 'prototypes/live2d-codex');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--public' && !/^--(?:id|output)=.+$/.test(arg)) ||
    new Set(args.map(arg => arg.split('=')[0])).size !== args.length) {
  throw new Error('Use npm run package:test -- [--id=<identifier>] [--public] [--output=work/qa/<new-directory>].');
}
const id = args.find(arg => arg.startsWith('--id='))?.slice(5) || new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14) + '-data-agent';
const requestedOutput = args.find(arg => arg.startsWith('--output='))?.slice(9);
const publishable = args.includes('--public');
if (!/^[a-z0-9][a-z0-9.-]{0,90}$/.test(id)) throw new Error('Invalid build id.');
const version = await releaseVersion(root);
if (publishable && !version.includes('-')) throw new Error('A public test build requires a prerelease version.');
const source = await captureSourceState(root, { build: id, version, channel: 'internal-test', publishable });
const name = `Rin-Desktop-${version}-Test-${id}`;
const output = requestedOutput ? await createRunDirectory('test-build', requestedOutput) : join(root,'release','test-builds',id);
const stage = join(output,name);
if (!requestedOutput) await requireFreshDirectory(output);
await inspectMotionAssets(join(app, 'assets/motion/female'));
for (const directory of characters.POSE_DIRECTORIES) await inspectPuppetAssets(join(app, 'assets/scene', directory));
const compiler = process.env.INNO_ISCC || join(root,'work/release-build/tools/inno/ISCC.exe'); await access(compiler);
if (!requestedOutput) await reserveFreshDirectory(output);
execFileSync(process.execPath,[join(app,'scripts/package-portable.mjs'),`--out=${stage}`,`--test-build=${id}`],{windowsHide:true,stdio:'inherit'});
await mkdir(join(stage,'tools'),{recursive:true});await mkdir(join(stage,'resources/app/tests'),{recursive:true});
for(const name of ['data-safety','submission-safety','agent-protocol','agent-contract','companion','draft-session','rpc','provider-switch','remote-integration','remote-ui','speech-ui','composer-controls'])await cp(join(app,`tests/${name}.test.mjs`),join(stage,`resources/app/tests/${name}.test.mjs`));
for(const name of ['data-agent','recover-data'])await cp(join(root,`tools/qa/${name}.mjs`),join(stage,`tools/${name}.mjs`));
const acceptance = (await readFile(join(root, 'tools/release/TEST-ACCEPTANCE.md'), 'utf8'))
  .replaceAll('../qa/README.md', 'https://github.com/code-lawyer/Rin-Desktop/blob/main/tools/qa/README.md');
await writeFile(join(stage,'TEST-ACCEPTANCE.md'), acceptance);
const cliGuide=join(stage,'CLI-AGENTS.md');
await writeFile(cliGuide,(await readFile(cliGuide,'utf8')).replaceAll('https://github.com/code-lawyer/Rin-Desktop/blob/main/tools/release/TEST-ACCEPTANCE.md','TEST-ACCEPTANCE.md'));
await writeFile(join(stage,'source-state.json'),JSON.stringify(source,null,2));
for(const [name,script] of [['Run-Offline-Checks','data-agent'],['Recover-Data','recover-data']])await writeFile(join(stage,name+'.cmd'),`@echo off\r\n"%~dp0resources\\app\\runtime\\node.exe" "%~dp0tools\\${script}.mjs" %*\r\nset "RIN_TEST_EXIT=%errorlevel%"\r\nif "%~1"=="" pause\r\nexit /b %RIN_TEST_EXIT%\r\n`);
await writeFile(join(stage,'Run-Remote-Checks.cmd'),`@echo off\r\n"%~dp0resources\\app\\runtime\\node.exe" --test "%~dp0resources\\app\\tests\\remote-integration.test.mjs" "%~dp0resources\\app\\tests\\remote-ui.test.mjs" "%~dp0resources\\app\\tests\\speech-ui.test.mjs" "%~dp0resources\\app\\tests\\composer-controls.test.mjs"\r\nset "RIN_TEST_EXIT=%errorlevel%"\r\nif "%~1"=="" pause\r\nexit /b %RIN_TEST_EXIT%\r\n`);
await writeFile(join(stage,'TEST-BUILD.txt'),`Rin Desktop internal test build ${id}\nSource baseline ${version}; this is not a stable release.\nRead TEST-ACCEPTANCE.md before testing. Normal application data and installation are separate by default.\nRun-Offline-Checks.cmd uses synthetic peers only. CLI accounts and RC003 acceptance require manual testing.\n`);
const manifest = await writeManifest(stage,version);
await verifySourceState(root, source);
execFileSync(compiler,[`/DVersion=${version}`,`/DTestBuild=${id}`,`/DSourceDir=${stage}`,`/DReleaseDir=${output}`,join(root,'tools/release/installer.iss')],{windowsHide:true,stdio:'inherit'});
const zip=join(output,name+'.zip');
// tar receives argv directly; no shell interpolation of paths or user labels.
execFileSync('tar.exe',['-a','-c','-f',zip,'-C',output,name],{windowsHide:true,stdio:'inherit'});
const artifacts=[];
for(const file of [name+'.zip',name+'-Setup.exe']) {
  const path=join(output,file),hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);
  artifacts.push({file,bytes:(await stat(path)).size,sha256:hash.digest('hex')});
}
await verifySourceState(root, source, { rehash: false });
await writeFile(join(output,'SHA256SUMS.txt'),artifacts.map(a=>`${a.sha256}  ${a.file}`).join('\n')+'\n');
await writeFile(join(output,'build-result.json'),JSON.stringify({id,version,head:source.head,publishable,manifest,artifacts},null,2));
console.log(JSON.stringify({output,stage,head:source.head,publishable,artifacts},null,2));
