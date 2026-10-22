import { realpathSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

export const lexicalPathKey = value => resolve(value).replace(/[\\/]+$/, '').toLocaleLowerCase('en-US');
export function pathKey(value) {
  const path = resolve(value);
  let ancestor = path;
  const missing = [];
  for (;;) {
    try { return lexicalPathKey(resolve(realpathSync.native(ancestor), ...missing)); }
    catch {
      // A deleted project can still live below a junction or an 8.3 parent
      // alias. Keep that existing parent's identity and append the missing tail.
      const parent = dirname(ancestor);
      if (parent === ancestor) return lexicalPathKey(path);
      missing.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
}
