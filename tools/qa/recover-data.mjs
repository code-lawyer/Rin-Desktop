import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const source = option('source'), out = option('out');
if (!source || !out) {
  console.log('recover-data --source="<closed app data>" --out="<new sibling folder>" [--from=backup|pending] [--run]\nDefault: validate and preview only. --run copies all data into a new folder; the source is never changed.');
} else {
  const bundled = resolve(import.meta.dirname, '../resources/app/backend/data-recovery.mjs');
  const modulePath = existsSync(bundled) ? bundled : resolve(import.meta.dirname, '../../prototypes/live2d-codex/backend/data-recovery.mjs');
  const { recoverDataCopy } = await import(pathToFileURL(modulePath).href);
  try { console.log(JSON.stringify(await recoverDataCopy(source, out, { from: option('from') ?? 'backup', run: process.argv.includes('--run') }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
