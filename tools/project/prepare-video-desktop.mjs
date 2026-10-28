import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const retired = 'The legacy three-state video desktop trial is retired. No package or data copy is created. See docs/development/two-state-app-integration-2026-10-27.md for the current wallpaper and docs/development/video-desktop-trial.md for historical evidence.';

// Retain the import boundary so old callers fail before reading or copying data.
export async function prepareVideoTrial() { throw new Error(retired); }

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(retired);
  if (process.argv.includes('--run') && !process.argv.includes('--help') && !process.argv.includes('-h')) process.exitCode = 1;
}
