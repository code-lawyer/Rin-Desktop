import { resolve } from 'node:path';
import { createTransitionServer } from './transition-preview-server.mjs';
const args = process.argv.slice(2);
if (!args.includes('--run') || args.includes('--help')) console.log('npm run preview:transitions -- --run --id=<local-bundle> [--port=0]\nReads only work/qa/three-state-preview/<id>; no generation or account access.');
else {
  const options = new Map();
  for (const arg of args) {
    if (arg === '--run') continue;
    const match = /^--(id|port)=(.+)$/.exec(arg);
    if (!match || options.has(match[1])) throw new Error('Invalid or repeated argument.');
    options.set(match[1], match[2]);
  }
  const id = options.get('id'), port = Number(options.get('port') ?? 0);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,90}$/.test(id ?? '') || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid bundle id or port.');
  const server = await createTransitionServer({ mediaRoot: resolve(import.meta.dirname, '../../work/qa/three-state-preview', id) });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log('Three-state preview: http://127.0.0.1:' + server.address().port + '/'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(); });
}
