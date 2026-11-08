import assert from 'node:assert/strict';
import { mkdir, readFile, access, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { packagedSession } from './packaged-session.mjs';
import { createRunDirectory, requireLiveRun, writeRunReport } from './run-output.mjs';
import { findAgent, versionOf } from '../../prototypes/live2d-codex/backend/agent-process.mjs';

requireLiveRun(
  'npm run qa:agent-desktop -- --run --package=<test package> --provider=codex|grok [--turns=20]',
  'real CLI account use through the packaged chat UI; fixed test text, cancellation, history and isolated file approvals; no user projects',
);
const args = process.argv.slice(2),
  option = (key) => args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
if (
  !option('package') ||
  !['codex', 'grok'].includes(option('provider')) ||
  args.some((arg) => arg !== '--run' && !/^--(package|provider|turns)=./.test(arg))
)
  throw Error('Use --run, --package, --provider and optionally --turns');
const provider = option('provider'),
  turns = Number(option('turns') || 20);
if (!Number.isInteger(turns) || turns < 10 || turns > 30) throw Error('Use 10–30 bounded test tasks');
const output = await createRunDirectory('agent-desktop'),
  project = join(output, '中文 验收项目');
await mkdir(project);
const binary = findAgent(provider),
  nonce = '雨夜书屋';
const report = {
  provider,
  cliVersion: await versionOf(binary),
  checks: [],
  tasks: [],
  accounts: true,
  hardware: false,
  passed: false,
};
const options = {
  directory: resolve(option('package')),
  output,
  project,
  provider,
  env: { [`VIBE_${provider.toUpperCase()}_BINARY`]: binary },
};
let session;
const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};
console.log(JSON.stringify({ output, provider, turns }));
const state = () => session.chat.evaluate('(async()=> (await companion.snapshot()).value)()');
async function ready() {
  await session.until(
    async () => {
      const s = await state();
      if (s.connection === 'error' || s.status === 'error') throw Error(s.error || 'Agent connection failed');
      return s.connection === 'ready' && s.status === 'idle';
    },
    'authenticated idle Agent',
    60000,
  );
}
async function input(text) {
  await session.until(
    () => session.chat.evaluate("!document.getElementById('send-button').disabled"),
    'ready chat form',
  );
  await session.chat.evaluate(
    `(()=>{const field=document.getElementById('prompt');field.value=${JSON.stringify(text)};field.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('composer').requestSubmit();})()`,
  );
}
function firstObject(text) {
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return JSON.parse(text.slice(0, i + 1));
  }
  throw Error('Approval has no inspectable tool input');
}
try {
  session = await packagedSession(options);
  await ready();
  if (provider === 'codex') {
    const s = await state(),
      model = s.models.find((model) => /luna/i.test(model.model || model.id));
    if (model)
      assert.equal(
        (
          await session.chat.evaluate(
            'companion.chooseModel(' + JSON.stringify(model.model || model.id) + ')',
          )
        ).ok,
        true,
      );
  }
  report.model = (await state()).model;
  const tasks = [
    ['请记住这段会话的项目代号：雨夜书屋。只回复“记住了”。', '记住'],
    ['2 加 3 等于多少？只输出数字。', '5'],
    ['请原样回复这句话：中文验收通过。', '中文验收通过'],
    ['用 Markdown 列表写出两个水果：苹果和梨。', '苹果'],
    ['', ''],
    ['将 9、2、5 从小到大排列，只输出结果。', '2'],
    ['将英文 hello 翻译成中文，只输出译文。', '你好'],
    ['一句话解释电脑里的文件夹是什么。', '文件'],
    ['输出一个 JSON 对象，唯一字段 ready 的值为 true。', 'true'],
    ['用一句中文解释 git status 命令，不要执行它。', /状态|修改|变更|跟踪|暂存/],
    ['请原样输出数学式：8 < 10 且 12 > 7。', '8'],
    ['写一个包含三行的 Markdown 表格，表头是项目和数量，数据为书 2、笔 3。', '数量'],
    ['把 ABC 转成小写，只输出结果。', 'abc'],
    ['给“今天下雨了”加上句号，只输出结果。', '今天下雨了'],
    ['一个小时有多少分钟？只输出数字。', '60'],
    ['把“安静的夜晚”翻译成英文。', 'night'],
    ['按原样输出文件名：中文 空格.txt。', '中文 空格.txt'],
    ['用一句话说明为什么保存文件很重要。', '保存'],
    ['请原样回复：这是一段可以朗读的完整回答。', '完整回答'],
    ['这段会话开始时约定的项目代号是什么？只输出代号。', nonce],
  ];
  const completedPrompts = [];
  for (let i = 0; i < turns; i++) {
    const [task, expected] = tasks[i % tasks.length];
    const cancellation = i === 4;
    const permission = provider === 'grok' && [6, 7].includes(i);
    const file = permission ? join(project, i === 6 ? 'approved.txt' : 'denied.txt') : null;
    let prompt = '不要调用工具、读写文件或联网。' + task;
    if (cancellation)
      prompt =
        'Do not use tools. Write a very long explanation of sorting algorithms, at least 5000 words. This test will interrupt you.';
    if (permission)
      prompt = `请只用文件写入工具，在 ${file} 创建内容为 APPROVED 的文件。只操作这一个文件并等待审批，不要用 shell。${i === 6 ? '我会允许这次写入。' : '我会拒绝这次写入；被拒绝后直接停止，不要换工具或重试。'}`;
    const before = (await state()).messages.filter((message) => message.role === 'user').length;
    await input(prompt);
    await session.until(
      async () => (await state()).messages.filter((message) => message.role === 'user').length > before,
      'UI submit receipt',
      30000,
    );
    if (cancellation) {
      await session.until(
        async () => {
          const s = await state(),
            last = s.messages.at(-1);
          return (
            s.status === 'working' && last?.role === 'assistant' && !last.complete && last.text.length > 30
          );
        },
        'actual streamed reply before cancellation',
        90000,
      );
      assert.equal((await session.chat.evaluate('companion.interrupt()')).ok, true);
    }
    if (permission) {
      await session.until(async () => (await state()).approvals.length > 0, 'visible tool approval', 90000);
      const approval = (await state()).approvals[0],
        data = firstObject(approval.details);
      assert.equal(approval.kind, 'files');
      assert.ok(!data.command && !data.cmd);
      assert.equal(
        resolve(data.file_path || data.filePath || data.path),
        file,
        'approval is exactly the dedicated fixture file',
      );
      await session.until(
        () =>
          session.chat.evaluate(
            "!document.getElementById('approval').hidden && document.getElementById('approval').dataset.kind==='files'",
          ),
        'rendered approval card',
      );
      const label = i === 6 ? '允许这次' : '拒绝';
      await session.chat.evaluate(
        `(()=>{const button=[...document.querySelectorAll('#approval button')].find(button=>button.textContent===${JSON.stringify(label)});if(!button||button.disabled)throw Error('Approval button unavailable');button.click();})()`,
      );
    }
    await session.until(
      async () => {
        const s = await state();
        if (s.status === 'error' || s.connection === 'error') throw Error(s.error || 'Real task failed');
        return s.status === 'idle' && s.submission?.status === 'confirmed';
      },
      'completed task ' + i,
      120000,
    );
    const s = await state();
    if (!cancellation) {
      const last = s.messages.filter((message) => message.role === 'assistant').at(-1);
      assert.ok(last?.complete, 'final reply is complete');
      if (!permission)
        assert.ok(
          expected instanceof RegExp
            ? expected.test(last.text)
            : last.text.toLowerCase().includes(expected.toLowerCase()),
          'expected reply returned to chat',
        );
    }
    if (permission) {
      assert.equal(await exists(file), i === 6, 'real approval decision controls the write');
      if (i === 6) assert.equal((await readFile(file, 'utf8')).trim(), 'APPROVED');
    }
    assert.equal(s.approvals.length, 0);
    assert.equal(s.submission?.status, 'confirmed');
    if (!cancellation) completedPrompts.push(prompt);
    report.tasks.push({
      number: i + 1,
      cancellation,
      permission: permission ? (i === 6 ? 'allow' : 'deny') : null,
      passed: true,
    });
    console.log(JSON.stringify({ provider, completedTasks: report.tasks.length }));
    await writeFile(join(output, 'progress.json'), JSON.stringify(report, null, 2));
  }
  const completed = await state(),
    threadId = completed.threadId;
  const history = await session.workspace.evaluate(
    'companion.history(' + JSON.stringify(threadId) + ',null,' + JSON.stringify(provider) + ')',
  );
  assert.equal(history.ok, true);
  assert.ok(JSON.stringify(history.value).includes(nonce));
  report.checks.push(
    'actual packaged UI sends all tasks, renders complete replies, cancels and reads native history',
  );
  const draft = 'UNSENT_' + nonce;
  await session.chat.evaluate(
    `(()=>{const field=document.getElementById('prompt');field.value=${JSON.stringify(draft)};field.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await delay(500);
  assert.deepEqual(session.errors, []);
  await session.close();
  session = null;
  session = await packagedSession(options);
  await ready();
  await session.until(
    () => session.chat.evaluate('document.getElementById("prompt").value===' + JSON.stringify(draft)),
    'restored unsent draft',
  );
  assert.equal((await state()).threadId, threadId);
  const restoredUsers = (await state()).messages
    .filter((message) => message.role === 'user')
    .map((message) => message.text);
  assert.ok(!restoredUsers.includes(draft), 'restart never submits the unsent draft');
  for (const prompt of completedPrompts)
    assert.equal(
      restoredUsers.filter((text) => text === prompt).length,
      completedPrompts.filter((text) => text === prompt).length,
      'every completed task restores exactly once',
    );
  report.checks.push(
    'normal exit and restart preserve native conversation and unsent draft without duplicate submission',
  );
  assert.deepEqual(session.errors, []);
  await session.close();
  session = null;
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
      completedTasks: report.tasks.length,
      error: report.error,
    }),
  );
}
