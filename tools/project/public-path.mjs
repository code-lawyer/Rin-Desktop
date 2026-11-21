import { existsSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

// Case-insensitive policy also rejects alternate casing on Windows.
const privateRoot = /^(work|release|artwork|docs\/history|prototypes\/(dots-bridge|qwen-tts-evaluation))(?:\/|$)/i;
const privateDirectory = /(^|\/)(node_modules|\.venv|__pycache__|runtime|models|vendor|\.git|evidence|research)(?:\/|$)/i;
const privateFile = /^prototypes\/live2d-codex\/(backend\/dots\.mjs|tests\/dots\.test\.mjs)$|(^|\/)\.env(?:\..*)?$/i;

export function isPrivateProjectPath(name) {
  const path = name.replaceAll('\\', '/');
  return privateRoot.test(path) || privateDirectory.test(path) || privateFile.test(path);
}

export function publicPathIssue(directory, name) {
  const absolute = resolve(directory, name), local = relative(directory, absolute).replaceAll('\\', '/');
  if (local === '..' || local.startsWith('../') || isAbsolute(local) || isPrivateProjectPath(local)) return `private or external dependency ${name}`;
  if (!existsSync(absolute)) return `missing ${name}`;
  return null;
}
