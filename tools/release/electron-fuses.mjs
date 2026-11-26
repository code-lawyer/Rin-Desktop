import { open, readFile } from 'node:fs/promises';

export const FUSE_SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';
const SENTINEL = Buffer.from(FUSE_SENTINEL, 'ascii');
export const FUSE_V1 = Object.freeze({
  runAsNode: 0,
  enableCookieEncryption: 1,
  enableNodeOptionsEnvironmentVariable: 2,
  enableNodeCliInspectArguments: 3,
  enableEmbeddedAsarIntegrityValidation: 4,
  onlyLoadAppFromAsar: 5,
  loadBrowserProcessSpecificV8Snapshot: 6,
  grantFileProtocolExtraPrivileges: 7,
  wasmTrapHandlers: 8,
});

export const PACKAGED_FUSES = Object.freeze({
  runAsNode: false,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
});

function locateWire(buffer) {
  const index = buffer.indexOf(SENTINEL);
  if (index < 0) throw new Error('Electron fuse sentinel not found in binary.');
  if (buffer.indexOf(SENTINEL, index + 1) >= 0) throw new Error('Multiple Electron fuse sentinels found in binary.');
  const offset = index + SENTINEL.length;
  const version = buffer[offset];
  const length = buffer[offset + 1];
  if (version !== 1 || !length || offset + 2 + length > buffer.length) {
    throw new Error(`Unsupported Electron fuse wire: version=${version}, length=${length}`);
  }
  return { offset: offset + 2, version, length };
}

export async function readElectronFuses(binaryPath) {
  const buffer = await readFile(binaryPath);
  const { offset, version, length } = locateWire(buffer);
  const values = {};
  for (const [name, index] of Object.entries(FUSE_V1)) {
    if (index < length) values[name] = buffer[offset + index] === 0x31;
  }
  return { version, length, values };
}

export async function flipElectronFuses(binaryPath, overrides = PACKAGED_FUSES) {
  const buffer = await readFile(binaryPath);
  const { offset, version, length } = locateWire(buffer);
  const wire = Buffer.from(buffer.subarray(offset, offset + length));
  for (const [name, enabled] of Object.entries(overrides)) {
    const index = FUSE_V1[name];
    if (index === undefined || index >= length) throw new Error(`Unknown Electron fuse: ${name}`);
    if (typeof enabled !== 'boolean') throw new Error(`Invalid Electron fuse value for ${name}`);
    wire[index] = enabled ? 0x31 : 0x30;
  }
  const handle = await open(binaryPath, 'r+');
  try {
    await handle.write(wire, 0, wire.length, offset);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return readElectronFuses(binaryPath);
}
