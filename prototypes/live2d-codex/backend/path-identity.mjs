import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export const lexicalPathKey = value => resolve(value).replace(/[\\/]+$/, '').toLocaleLowerCase('en-US');
export function pathKey(value) {
  const path = resolve(value);
  try { return lexicalPathKey(realpathSync.native(path)); }
  catch { return lexicalPathKey(path); } // Missing projects retain their identity.
}
