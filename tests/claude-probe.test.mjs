import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const probe = fileURLToPath(new URL('../tools/probes/cli-agents/claude-probe.mjs', import.meta.url));
const pathsUrl = new URL('../tools/probes/cli-agents/paths.mjs', import.meta.url).href;
const gateUrl = new URL('../tools/qa/run-output.mjs', import.meta.url).href;
for (const [name, account, accepted] of [
  ['API key', { apiProvider: 'firstParty', apiKeySource: 'ANTHROPIC_API_KEY' }, true],
  ['cloud', { apiProvider: 'bedrock' }, true],
  ['subscription only', { apiProvider: 'firstParty', tokenSource: 'oauth', subscriptionType: 'max' }, false],
  ['unknown source', { apiProvider: 'future' }, false],
]) test(`actual Claude probe gates ${name} before any prompt and closes its client`, async t => {
  const output = await mkdtemp(join(tmpdir(), 'rin-claude-auth-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const trace = join(output, 'trace.jsonl');
  // Execute the real entry point and authentication; replace external I/O only.
  const fakePaths = `
    import {appendFileSync} from 'node:fs';
    import {requireLiveRun as gate} from ${JSON.stringify(gateUrl)};
    export const outputRoot=${JSON.stringify(output)};
    export const requireLiveRun=usage=>gate(usage,'offline test only');
    const mark=event=>appendFileSync(${JSON.stringify(trace)},JSON.stringify(event)+'\\n');
    export const appDependency=async()=>({query({prompt}){
      mark('query');
      return {accountInfo:async()=>{mark('account');return ${JSON.stringify(account)};},
        supportedModels:async()=>{mark('models');return [];},close(){mark('close');},
        async *[Symbol.asyncIterator](){for await(const input of prompt){mark('prompt');
          yield {type:'result',is_error:true,result:'Offline fixture stops after authentication'};break;}}
      };
    }});`;
  const preload = join(output, 'preload.mjs');
  await writeFile(preload, `import cp from 'node:child_process';
    import {registerHooks,syncBuiltinESMExports} from 'node:module';
    cp.execFileSync=(binary,args)=>{if(binary!=='fixture-claude' || args.join()!=='--version')throw new Error('Unexpected real CLI access');return 'fixture';};
    cp.spawn=()=>{throw new Error('Unexpected process spawn');};syncBuiltinESMExports();
    registerHooks({load(url,context,next){return url===${JSON.stringify(pathsUrl)}?{format:'module',shortCircuit:true,source:${JSON.stringify(fakePaths)}}:next(url,context);}});`);
  await assert.rejects(exec(process.execPath, ['--import', pathToFileURL(preload).href, probe, '--run'], {
    env: { ...process.env, PROBE_CLAUDE_BINARY: 'fixture-claude' }, windowsHide: true, timeout: 15000,
  }), error => error.code === 2);
  const events = (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events, accepted ? ['query', 'account', 'models', 'prompt', 'close'] : ['query', 'account', 'close']);
  const reports = await readdir(join(output, 'evidence'));
  assert.equal(reports.length, 1);
  const report = JSON.parse(await readFile(join(output, 'evidence', reports[0]), 'utf8'));
  assert.equal(report.blockedReason, accepted ? 'existing-authentication' : 'unsupported-authentication');
  assert.equal(report.events.some(event => event.type === 'account'), accepted);
});
