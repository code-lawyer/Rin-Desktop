import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve, basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { packagedSession } from './packaged-session.mjs';
import { ownedProcessTree, terminateOwnedProcesses } from './owned-processes.mjs';
import { findAgent, versionOf } from '../../prototypes/live2d-codex/backend/agent-process.mjs';
import { createRunDirectory, requireLiveRun, writeRunReport } from './run-output.mjs';

requireLiveRun(
  'npm run qa:agent-interactions -- --run --source|--package=<test package> --provider=codex|grok|antigravity [--model=<model id>]',
  'actual CLI approvals/questions, interruption, owned CLI disconnection and unresolved-receipt recovery in a fresh QA project; fixed harmless tasks only',
);
const args = process.argv.slice(2),
  source = args.includes('--source'),
  option = (key) => args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
if (
  source === Boolean(option('package')) ||
  !['codex', 'grok', 'antigravity'].includes(option('provider')) ||
  args.some((arg) => arg !== '--run' && arg !== '--source' && !/^--(package|provider|model)=./.test(arg))
)
  throw Error('Use --run, --provider and either --source or --package');
const provider = option('provider'),
  output = await createRunDirectory('agent-interactions'),
  project = join(output, 'project');
await mkdir(project);
const binary = findAgent(provider),
  options = {
    source,
    directory: source ? undefined : resolve(option('package')),
    output,
    project,
    provider,
    env: { [`VIBE_${provider.toUpperCase()}_BINARY`]: binary },
  };
const report = {
  provider,
  source,
  version: await versionOf(binary),
  checks: [],
  accounts: true,
  hardware: false,
  passed: false,
};
const marker = 'RIN-' + randomUUID();
let session;
const state = () => session.chat.evaluate('(async()=>(await companion.snapshot()).value)()');
async function idle() {
  await session.until(
    async () => {
      const s = await state();
      if (['error', 'authentication'].includes(s.connection) || s.status === 'error') throw Error(s.error);
      return s.connection === 'ready' && s.status === 'idle';
    },
    'idle Agent',
    90000,
  );
}
async function submit(text) {
  await session.until(
    () => session.chat.evaluate("!document.getElementById('send-button').disabled"),
    'ready chat form',
  );
  const before = (await state()).messages.filter((message) => message.role === 'user').length;
  await session.chat.evaluate(
    `(()=>{const field=document.getElementById('prompt');field.value=${JSON.stringify(text)};field.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('composer').requestSubmit();})()`,
  );
  await session.until(
    async () => (await state()).messages.filter((message) => message.role === 'user').length > before,
    'submitted task',
  );
}
async function approval() {
  await session.until(
    async () => {
      const s = await state();
      if (s.status === 'error' || s.connection === 'error') throw Error(s.error);
      if (s.status === 'idle' && !s.approvals.length)
        throw Error('Native CLI completed without the requested approval/form');
      return s.approvals.length > 0;
    },
    'native approval',
    90000,
  );
  await session.until(
    () => session.chat.evaluate("!document.getElementById('approval').hidden"),
    'rendered approval',
  );
  return (await state()).approvals[0];
}
async function button(label) {
  await session.chat.evaluate(
    `(()=>{const button=[...document.querySelectorAll('#approval button')].find(b=>b.textContent===${JSON.stringify(label)});if(!button||button.disabled)throw Error('Approval action unavailable');button.click();})()`,
  );
}
const exists = async (file) => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};
async function close() {
  assert.deepEqual(session.errors, []);
  await session.close();
  session = null;
}
console.log(JSON.stringify({ output, provider }));
try {
  session = await packagedSession(options);
  await idle();
  const models = (await state()).models;
  const model = option('model') || (provider === 'codex' ? models.find(item => /luna/i.test(item.model || item.id))?.model : null);
  if (model) {
    const choice = await session.chat.evaluate('companion.chooseModel(' + JSON.stringify(model) + ')');
    assert.equal(choice.ok, true, choice.error);
    assert.equal((await state()).model, model);
  }
  report.model = (await state()).model;
  await submit(`不要调用工具。记住会话标记 ${marker}，并原样回复它。\n`);
  await idle();
  const baseline = (await state()).messages.filter(message => message.role === 'assistant').at(-1)?.text;
  assert.ok(baseline?.includes(marker), 'The native CLI could not return the test marker: ' + (baseline || 'no reply').slice(0, 400));
  report.checks.push('native login supplies a model response in the Source/Packaged UI');
  for (const decision of ['allow', 'deny', 'stop']) {
    const file = join(output, decision + '.txt');
    const command = `Set-Content -LiteralPath '${file.replaceAll('\\', '/')}' -Value 'APPROVED'`;
    const prompt =
      provider === 'codex'
        ? `这是独立的临时文件测试。请只调用一次 exec_command，cmd 必须逐字为：${command}。sandbox_permissions 必须为 require_escalated，以便我看到审批。不要读文件、联网或调用其他工具。若被拒绝或停止，立即结束，不要绕行或重试。`
        : `这是独立的临时文件测试。只用文件写入工具在 ${file} 写入 APPROVED，等我审批；不要用 shell 或其他工具。若被拒绝或停止，立即结束，不要绕行或重试。`;
    await submit(prompt);
    const request = await approval();
    if (provider === 'codex') {
      assert.equal(request.kind, 'command');
      // The command is either bare or wrapped by the CLI's PowerShell binary.
      const raw = request.command.trim();
      const wrapped = raw.match(/^"[^"\r\n]+\\(?:pwsh|powershell)\.exe" -Command "([\s\S]*)"$/i);
      assert.equal(wrapped?.[1] || raw, command, 'only the exact isolated file write may be approved');
    } else {
      assert.equal(request.kind, 'files');
      assert.deepEqual(
        [...new Set((request.paths ?? []).map(path => resolve(project, path)))],
        [file],
        'approval must disclose exactly one fixture path across raw input, locations and diffs',
      );
      assert.equal(request.command, '', 'file fixture cannot approve shell commands');
      const firstLineObject = request.details.match(/^\{[\s\S]*?\n\}/)?.[0] || request.details;
      const data = JSON.parse(firstLineObject);
      const path = data.file_path || data.filePath || data.absolute_path || data.path || data.Path;
      if (path) assert.equal(resolve(project, path), file);
      assert.ok(!data.command && !data.cmd && !data.Command);
      if (provider === 'antigravity' && Object.hasOwn(data, 'Path')) {
        assert.deepEqual(Object.keys(data).sort(), ['Content', 'Overwrite', 'Path']);
      }
      const diff = request.details.slice(firstLineObject.length);
      const expectedChange = diff.split('\n+++\n');
      assert.ok(expectedChange.length <= 2, 'one fixture write at most');
      if (expectedChange.length === 2) assert.equal(expectedChange[1].trim(), 'APPROVED');
      else assert.equal((data.Content ?? data.content)?.trim(), 'APPROVED');
    }
    await button(decision === 'allow' ? '允许这次' : decision === 'deny' ? '拒绝' : '停止任务');
    await idle();
    assert.equal(await exists(file), decision === 'allow');
    if (decision === 'allow') assert.equal((await readFile(file, 'utf8')).trim(), 'APPROVED');
    report.checks.push('native ' + decision + ' permission through actual UI');
    console.log(JSON.stringify({ provider, check: report.checks.at(-1) }));
  }
  await submit(
    provider === 'grok'
      ? '不要读写文件、联网或调用其他工具。请使用 AskUserQuestion 工具，问我喜欢蓝色还是绿色，提供这两个单选项；等我选择后复述选择。'
      : provider === 'antigravity'
      ? '不要读写文件或联网。如果有提问工具，请用它问我喜欢蓝色还是绿色，提供两个单选项。等我选择后复述选择。'
      : '不要读写文件、联网或调用其他工具。请使用 request_user_input 工具，问我喜欢蓝色还是绿色，提供这两个单选项；等我选择后复述选择。',
  );
  try {
    const request = await approval();
    assert.equal(request.kind, 'questions');
    await session.chat.evaluate(
      "(()=>{for(const input of document.querySelectorAll('#approval input')){input.value='蓝色';input.dispatchEvent(new Event('input',{bubbles:true}));}})()",
    );
    await button('提交回答');
    await idle();
    assert.ok(
      (await state()).messages
        .filter((message) => message.role === 'assistant')
        .at(-1)
        ?.text.includes('蓝色'),
    );
    report.checks.push('native question card accepts free text and returns the answer');
  } catch (error) {
    if (error.message !== 'Native CLI completed without the requested approval/form') throw error;
    report.questionUnavailable = {
      reason: error.message,
      response: (await state()).messages.filter((message) => message.role === 'assistant').at(-1)?.text,
    };
  }

  await submit('不要调用工具。直接写一篇至少五千字的排序算法介绍，连续输出。');
  await session.until(
    async () => {
      const s = await state(),
        last = s.messages.at(-1);
      return s.status === 'working' && last?.role === 'assistant' && !last.complete && last.text.length > 30;
    },
    'stream before owned CLI disconnect',
    90000,
  );
  const owned = await ownedProcessTree(session.child.pid),
    cli = owned.filter((item) => item.name.toLowerCase() === basename(binary).toLowerCase());
  assert.ok(cli.length > 0, 'native CLI belongs to this app');
  await terminateOwnedProcesses(cli);
  await session.until(async () => (await state()).connection === 'error', 'actual CLI disconnection');
  assert.equal((await session.chat.evaluate('companion.reconnect()')).ok, true);
  await idle();
  report.checks.push(
    'actual owned CLI process loss shows disconnection and reconnects the same conversation',
  );
  const threadId = (await state()).threadId;
  await close();

  // Fault injection only into the closed QA journal. This verifies recovery
  // against real native history, not a claim of an observed network ack loss.
  const file = join(output, 'data/workspaces.json'),
    saved = JSON.parse(await readFile(file, 'utf8'));
  const receipt = saved.submissions[provider];
  assert.equal(receipt.status, 'confirmed');
  receipt.status = 'unknown';
  const { draftKey } = await import('../../prototypes/live2d-codex/backend/workspace-store.mjs');
  saved.drafts[draftKey(receipt.target)] = { text: receipt.text, updatedAt: Date.now() };
  await writeFile(file, JSON.stringify(saved, null, 2));
  session = await packagedSession(options);
  await idle();
  assert.equal((await state()).threadId, threadId);
  assert.equal((await state()).submission.status, 'unknown');
  await session.until(
    () =>
      session.chat.evaluate(
        "!document.getElementById('submission-panel').hidden && !document.getElementById('submission-check').disabled",
      ),
    'unresolved receipt UI',
  );
  const count = (await state()).messages.filter((message) => message.role === 'user').length;
  assert.equal(
    await session.chat.evaluate("document.getElementById('submission-copy').textContent"),
    receipt.text,
    'unresolved receipt UI restores the exact original text',
  );
  await session.chat.evaluate("document.getElementById('submission-check').click()");
  await session.until(
    async () => (await state()).submission.status === 'confirmed',
    'real native history reconciliation',
    60000,
  );
  assert.equal(
    (await state()).messages.filter((message) => message.role === 'user').length,
    count,
    'checking never resends',
  );
  report.checks.push(
    'injected unresolved journal restores original text and reconciles real CLI history without resending',
  );
  await submit('不要调用工具。请直接输出本会话开头请你记住的完整 RIN- 会话标记。');
  await idle();
  assert.ok((await state()).messages.filter(message => message.role === 'assistant').at(-1)?.text.includes(marker), 'The restarted app continues the original native context');
  report.checks.push('reply after application restart recalls original session context');
  await close();
  report.passed = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  if (session) {
    await session.chat.evaluate('companion.interrupt()').catch(() => {});
    await session.close().catch((error) => {
      report.cleanupError = error.message;
      process.exitCode = 1;
    });
  }
  await writeRunReport(output, report);
  console.log(
    JSON.stringify({
      output,
      provider,
      passed: report.passed,
      checks: report.checks.length,
      questionUnavailable: !!report.questionUnavailable,
      error: report.error,
    }),
  );
}
