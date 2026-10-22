import { existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

// Case-insensitive policy also rejects alternate casing on Windows.
const privatePath = /^(work|release|artwork|docs\/(history|evidence|research)|prototypes\/dots-bridge)(?:\/|$)|^prototypes\/live2d-codex\/backend\/dots\.mjs$|(^|\/)(node_modules|\.venv|runtime|models|vendor|\.git)(?:\/|$)/i;

export function publicPathIssue(directory, name) {
  const absolute = resolve(directory, name), local = relative(directory, absolute).replaceAll('\\', '/');
  if (local === '..' || local.startsWith('../') || isAbsolute(local) || privatePath.test(local)) return `private or external dependency ${name}`;
  if (!existsSync(absolute)) return `missing ${name}`;
  return null;
}
