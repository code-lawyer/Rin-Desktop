import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { createStillServer } from '../tools/project/preview-stills.mjs';

test('a malformed preview URL returns 400 and the server continues serving its allowlist', async t => {
  const server = createStillServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const request = path => new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port: server.address().port, path }, response => {
      response.resume(); response.once('end', () => resolve(response.statusCode));
    });
    req.once('error', reject); req.setTimeout(3000, () => req.destroy(new Error('Preview request timed out')));
  });
  assert.equal(await request('http://['), 400);
  assert.equal(await request('/renderer/still-sequence.mjs'), 200);
  assert.equal(await request('/package.json'), 404);
});

test('preview HEAD returns the actual length without reading or opening asset contents', async () => {
  const expected = await promises.stat(new URL('../prototypes/live2d-codex/renderer/still-sequence.mjs', import.meta.url));
  const readFile = promises.readFile, createReadStream = fs.createReadStream;
  const server = createStillServer(), response = { headersSent: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; return this; },
    end(body) { this.body = body; this.ended = true; },
  };
  try {
    promises.readFile = () => { throw new Error('HEAD read the asset'); };
    fs.createReadStream = () => { throw new Error('HEAD opened the asset'); };
    syncBuiltinESMExports();
    await server.listeners('request')[0]({ method: 'HEAD', url: '/renderer/still-sequence.mjs' }, response);
    assert.equal(response.status, 200); assert.equal(response.headers['Content-Length'], expected.size);
    assert.equal(response.body, undefined); assert.equal(response.ended, true);
  } finally { promises.readFile = readFile; fs.createReadStream = createReadStream; syncBuiltinESMExports(); server.close(); }
});

test('disconnecting a preview consumer releases its active asset stream', async () => {
  const createReadStream = fs.createReadStream, source = new PassThrough(), response = new PassThrough();
  const server = createStillServer();
  response.writeHead = () => { response.headersSent = true; return response; };
  try {
    fs.createReadStream = () => source; syncBuiltinESMExports();
    await server.listeners('request')[0]({ method: 'GET', url: '/renderer/still-sequence.mjs' }, response);
    assert.equal(source.destroyed, false);
    const closed = once(source, 'close'); response.destroy(); await closed;
    assert.equal(source.destroyed, true);
  } finally { fs.createReadStream = createReadStream; syncBuiltinESMExports(); source.destroy(); response.destroy(); server.close(); }
});
