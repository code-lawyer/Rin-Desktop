import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { root, buildPreview } from './video-preview-server.mjs';

await buildPreview();
const require = createRequire(resolve(root, 'prototypes/live2d-codex/package.json'));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [resolve(root, 'prototypes/video-companion/desktop.cjs')], { stdio: 'inherit', env });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
