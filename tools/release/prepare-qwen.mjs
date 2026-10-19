import { cp, mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join, basename, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2).filter(value => value !== '--resume');
const original = resolve(args[0] || join(root, 'prototypes/qwen-tts-evaluation'));
const output = resolve(args[1] || join(root, 'work/release-build/qwen'));
const config = await readFile(join(original, '.venv/pyvenv.cfg'), 'utf8');
const home = /^home\s*=\s*(.+)$/m.exec(config)?.[1]?.trim();
if (!home) throw new Error('Provide an existing verified Qwen environment. Python home was not found.');
await mkdir(output, { recursive: process.argv.includes('--resume') });
const python = join(output, 'python'); await mkdir(python,{recursive:true});
const clean = file => !/[/\\](__pycache__|\.cache|\.git)([/\\]|$)/.test(file) && !/\.(pyc|pyo)$/.test(file);
for (const name of ['python.exe','pythonw.exe','python3.dll','python312.dll','vcruntime140.dll','vcruntime140_1.dll','LICENSE.txt','DLLs','Lib']) {
  await cp(join(home, name), join(python, name), { recursive: true, filter: file => clean(relative(home,file)) && !/[/\\](site-packages|test|tests|idlelib|tkinter)([/\\]|$)/.test(relative(home,file)) });
}
await cp(join(original, '.venv/Lib/site-packages'), join(python, 'Lib/site-packages'), { recursive: true,
  filter: file => clean(file) && !['_virtualenv.pth','_virtualenv.py','nvperf_host.dll','cusolverMg64_11.dll'].includes(basename(file)) });
await cp(join(original, 'models/Qwen3-TTS-12Hz-1.7B-CustomVoice'), join(output, 'models/Qwen3-TTS-12Hz-1.7B-CustomVoice'), { recursive: true, filter: clean });
// Verify relocation without inheriting the developer's Python search path.
const env = { ...process.env, PYTHONNOUSERSITE:'1', HF_HUB_OFFLINE:'1', PYTHONUTF8:'1' };
delete env.PYTHONHOME; delete env.PYTHONPATH; delete env.VIRTUAL_ENV;
const probe = execFileSync(join(python, 'python.exe'), ['-I', '-c', 'import sys,torch,numpy;from qwen_tts import Qwen3TTSModel;print(sys.prefix);print(torch.__version__);print("QWEN_IMPORT_OK")'], { env, windowsHide:true, timeout:180000, encoding:'utf8' });
if (!probe.includes(python) || !probe.includes('QWEN_IMPORT_OK')) throw new Error('Portable Python validation failed');
await cp(join(original, 'requirements.lock.txt'), join(output, 'requirements.lock.txt'));
let bytes = 0, files = 0;
async function count(dir) { for (const entry of await readdir(dir,{withFileTypes:true})) { const file=join(dir,entry.name); if(entry.isDirectory()) await count(file); else { bytes+=(await stat(file)).size; files++; } } }
await count(output);
await writeFile(join(output, 'runtime.json'), JSON.stringify({ format:1, python:'3.12.14', qwen:'0.1.1', torch:'2.9.1+cu128', model:'Qwen3-TTS-12Hz-1.7B-CustomVoice', revision:'0c0e3051f131929182e2c023b9537f8b1c68adfe', bytes, files },null,2));
console.log(JSON.stringify({ output, bytes, files, relocatedImports:true }));
