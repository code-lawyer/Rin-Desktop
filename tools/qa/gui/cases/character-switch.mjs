// Compatibility entry for the current isolated production-renderer checks.
import { requireLiveRun } from '../../run-output.mjs';
requireLiveRun('node tools/qa/gui/run.mjs --case=character-switch --run [--output=work/qa/new-run]\nCurrent entry: npm run qa:stills -- --character-switch',
  'isolated Electron image failure/retry, character voices and a fresh-process restore; no CLI, accounts or devices',
  process.argv.includes('--run'), process.argv.includes('--help') || process.argv.includes('-h'));
const args = process.argv.slice(2);
if (args.some(arg => arg.startsWith('--package'))) throw new Error('The legacy packaged Live2D test is retired. Current character-switch checks source renderer/stores only; use the release acceptance plan for an installed package.');
if (args.some(arg => !['--run', '--case=character-switch'].includes(arg) && !arg.startsWith('--output='))) throw new Error('Use --run and optional --output=work/qa/new-run.');
process.argv = [...process.argv.slice(0, 2), '--character-switch', ...args.filter(arg => arg.startsWith('--output='))];
await import('../../still-desktop.mjs');
