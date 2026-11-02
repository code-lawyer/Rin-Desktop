import { requireLiveRun } from '../run-output.mjs';

const cases = ['avatar-controls', 'avatar-drag', 'placement', 'bubble-drag', 'character-switch'];
const usage = `node tools/qa/gui/run.mjs --case=<name> --run\nCases: ${cases.join(', ')}\nRequires a built app and visual resources. character-switch uses an isolated source fixture without CLI/Playwright; other cases require Playwright (or VIBE_PLAYWRIGHT).`;
requireLiveRun(usage, 'Electron windows; legacy cases also connect the local CLI, without sending prompts');
const name = process.argv.find(arg => arg.startsWith('--case='))?.slice(7);
if (!cases.includes(name)) throw new Error(usage);
await import(`./cases/${name}.mjs`);
