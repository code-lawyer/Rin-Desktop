import { access, cp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeManifest } from './manifest.mjs';
import { releaseVersion, requireFreshDirectory } from './release-inputs.mjs';

const root = resolve(import.meta.dirname, '../..'), app = join(root, 'prototypes/live2d-codex');
const id = process.argv.find(arg => arg.startsWith('--id='))?.slice(5) || new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14) + '-data-agent';
if (!/^[a-z0-9][a-z0-9.-]{0,90}$/.test(id)) throw new Error('Invalid build id.');
const version = await releaseVersion(root);
const name = `Rin-Desktop-${version}-Test-${id}`, output = join(root,'release','test-builds',id), stage = join(output,name);
await requireFreshDirectory(output);
const compiler = process.env.INNO_ISCC || join(root,'work/release-build/tools/inno/ISCC.exe'); await access(compiler);
execFileSync(process.execPath,[join(root,'tools/release/audit-public.mjs'),'--worktree'],{cwd:root,windowsHide:true,stdio:'inherit'});
const git = args => execFileSync('git',['-c',`safe.directory=${root}`,...args],{cwd:root,encoding:'utf8'}).trim();
const remote = git(['remote','get-url','origin']);
let origin;
try { const url=new URL(remote);url.username='';url.password='';url.search='';url.hash='';origin=url.href; } catch { origin=/^git@[\w.-]+:[\w./-]+$/.test(remote)?remote:'[non-URL remote]'; }
const source = { format:1, build:id, baseVersion:version, channel:'internal-test', createdAt:new Date().toISOString(), head:git(['rev-parse','HEAD']), branch:git(['branch','--show-current']), origin, dirty:!!git(['status','--porcelain']), files:[] };
for (const file of [...new Set(git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean))].sort()) {
  try { const data=await readFile(join(root,file));source.files.push({file,sha256:createHash('sha256').update(data).digest('hex')}); } catch(error) {if(error.code!=='ENOENT')throw error;}
}
await mkdir(output,{recursive:true});
execFileSync(process.execPath,[join(app,'scripts/build.mjs')],{windowsHide:true,stdio:'inherit'});
execFileSync(process.execPath,[join(app,'scripts/package-portable.mjs'),`--out=${stage}`,`--test-build=${id}`],{windowsHide:true,stdio:'inherit'});
await mkdir(join(stage,'tools'),{recursive:true});await mkdir(join(stage,'resources/app/tests'),{recursive:true});
for(const name of ['data-safety','submission-safety','agent-protocol','agent-contract','companion','draft-session','rpc','provider-switch','remote-integration','remote-ui','speech-ui','composer-controls'])await cp(join(app,`tests/${name}.test.mjs`),join(stage,`resources/app/tests/${name}.test.mjs`));
for(const name of ['data-agent','recover-data'])await cp(join(root,`tools/qa/${name}.mjs`),join(stage,`tools/${name}.mjs`));
await cp(join(root,'docs/development/test-acceptance.md'),join(stage,'TEST-ACCEPTANCE.md'));
await cp(join(root,'docs/development/data-agent-validation.md'),join(stage,'VALIDATION.md'));
const cliGuide=join(stage,'CLI-AGENTS.md');
await writeFile(cliGuide,(await readFile(join(app,'CLI-AGENTS.md'),'utf8')).replaceAll('../../docs/development/data-agent-validation.md','VALIDATION.md').replaceAll('../../docs/development/test-acceptance.md','TEST-ACCEPTANCE.md'));
await writeFile(join(stage,'source-state.json'),JSON.stringify(source,null,2));
for(const [name,script] of [['Run-Offline-Checks','data-agent'],['Recover-Data','recover-data']])await writeFile(join(stage,name+'.cmd'),`@echo off\r\n"%~dp0resources\\app\\runtime\\node.exe" "%~dp0tools\\${script}.mjs" %*\r\nset "RIN_TEST_EXIT=%errorlevel%"\r\nif "%~1"=="" pause\r\nexit /b %RIN_TEST_EXIT%\r\n`);
await writeFile(join(stage,'Run-Remote-Checks.cmd'),`@echo off\r\n"%~dp0resources\\app\\runtime\\node.exe" --test "%~dp0resources\\app\\tests\\remote-integration.test.mjs" "%~dp0resources\\app\\tests\\remote-ui.test.mjs" "%~dp0resources\\app\\tests\\speech-ui.test.mjs" "%~dp0resources\\app\\tests\\composer-controls.test.mjs"\r\nset "RIN_TEST_EXIT=%errorlevel%"\r\nif "%~1"=="" pause\r\nexit /b %RIN_TEST_EXIT%\r\n`);
await writeFile(join(stage,'TEST-BUILD.txt'),`Rin Desktop internal test build ${id}\nSource baseline ${version}; this is not a stable release.\nRead TEST-ACCEPTANCE.md before testing. Normal application data and installation are separate by default.\nRun-Offline-Checks.cmd uses synthetic peers only. CLI accounts and RC003 acceptance require manual testing.\n`);
const manifest = await writeManifest(stage,version);
execFileSync(compiler,[`/DVersion=${version}`,`/DTestBuild=${id}`,`/DSourceDir=${stage}`,`/DReleaseDir=${output}`,join(root,'tools/release/installer.iss')],{windowsHide:true,stdio:'inherit'});
const zip=join(output,name+'.zip');
// tar receives argv directly; no shell interpolation of paths or user labels.
execFileSync('tar.exe',['-a','-c','-f',zip,'-C',output,name],{windowsHide:true,stdio:'inherit'});
const artifacts=[];
for(const file of [name+'.zip',name+'-Setup.exe']) {
  const path=join(output,file),hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);
  artifacts.push({file,bytes:(await stat(path)).size,sha256:hash.digest('hex')});
}
await writeFile(join(output,'SHA256SUMS.txt'),artifacts.map(a=>`${a.sha256}  ${a.file}`).join('\n')+'\n');
await writeFile(join(output,'build-result.json'),JSON.stringify({id,version,manifest,artifacts},null,2));
console.log(JSON.stringify({output,stage,artifacts},null,2));
