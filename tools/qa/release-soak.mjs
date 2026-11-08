import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createRunDirectory, requireLiveRun, writeRunReport } from './run-output.mjs';
import { packagedSession } from './packaged-session.mjs';

requireLiveRun(
  'npm run qa:release-soak -- --run --package=<test package> [--seconds=1800]',
  'continuous actual packaged rendering, pose/style changes and pause/resume; isolated storage, no accounts or hardware',
);
const args = process.argv.slice(2),
  option = (key) => args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
if (!option('package') || args.some((arg) => arg !== '--run' && !/^--(package|seconds)=./.test(arg)))
  throw Error('Use --run, --package and optionally --seconds');
const seconds = Number(option('seconds') || 1800);
if (!Number.isInteger(seconds) || seconds < 60 || seconds > 14400)
  throw Error('Soak duration must be 60–14400 seconds');
const directory = resolve(option('package')),
  output = await createRunDirectory('release-soak');
const report = {
  package: directory,
  requestedSeconds: seconds,
  startedAt: new Date().toISOString(),
  samples: [],
  accounts: false,
  hardware: false,
  passed: false,
};
console.log(JSON.stringify({ output, seconds }));
let session;
try {
  session = await packagedSession({ directory, output });
  const { workspace, wallpaper, until } = session;
  const puppet = "document.querySelector('.wallpaper-puppet[data-active=true]')";
  const settings = (patch) => workspace.evaluate('companion.saveSettings(' + JSON.stringify(patch) + ')');
  const start = Date.now();
  let cycle = 0;
  while (Date.now() - start < seconds * 1000) {
    const pose = ['work', 'cup', 'attention', 'thinking', 'window'][cycle % 5];
    assert.equal((await settings({ stillPose: pose })).ok, true);
    await until(
      () =>
        wallpaper.evaluate(
          `${puppet}?.dataset.actualPose==='${pose}' && ${puppet}?.dataset.transitionPhase==='steady'`,
        ),
      'settled pose ' + pose,
    );
    if (cycle % 10 === 9) {
      assert.equal((await settings({ wallpaperMotion: true })).ok, true);
      await until(
        async () =>
          (await workspace.evaluate('companion.workspace()')).value.wallpaper.model === 'motion-clips',
        'video style',
      );
      await delay(4000);
      assert.equal((await settings({ wallpaperMotion: false })).ok, true);
      await until(
        () =>
          wallpaper.evaluate(
            `${puppet}?.dataset.actualPose==='${pose}' && ${puppet}?.dataset.transitionPhase==='steady'`,
          ),
        'restored anime style',
      );
    }
    if (cycle % 15 === 14) {
      await workspace.evaluate("companion.wallpaperControl('pause',true)");
      await delay(100);
      const frozen = await wallpaper.evaluate(`${puppet}.querySelector('canvas').toDataURL()`);
      await delay(350);
      assert.equal(
        await wallpaper.evaluate(`${puppet}.querySelector('canvas').toDataURL()`),
        frozen,
        'pause freezes actual pixels',
      );
      await workspace.evaluate("companion.wallpaperControl('pause',false)");
    }
    const state = await wallpaper.evaluate(
      `(()=>{const e=${puppet},c=e.querySelector('canvas'),gl=c.getContext('webgl2'),p=gl.getParameter(gl.CURRENT_PROGRAM);return {pose:e.dataset.actualPose,scenes:document.querySelectorAll('.wallpaper-puppet').length,canvas:[c.width,c.height],effect:gl.getUniform(p,gl.getUniformLocation(p,'pixelEffect')),glError:gl.getError()};})()`,
    );
    assert.equal(state.scenes, 1);
    assert.equal(state.effect, 1);
    assert.equal(state.glError, 0);
    const memory = await wallpaper.send('Runtime.getHeapUsage');
    const dom = await wallpaper.send('Memory.getDOMCounters');
    report.samples.push({
      elapsedSeconds: (Date.now() - start) / 1000,
      cycle,
      ...state,
      heapBytes: memory.usedSize,
      dom,
    });
    await writeFile(
      join(output, 'progress.json'),
      JSON.stringify(
        {
          elapsedSeconds: report.samples.at(-1).elapsedSeconds,
          cycles: cycle + 1,
          latest: report.samples.at(-1),
        },
        null,
        2,
      ),
    );
    if (cycle % 10 === 0)
      console.log(
        JSON.stringify({
          cycle,
          elapsedSeconds: report.samples.at(-1).elapsedSeconds,
          heapMB: Math.round(memory.usedSize / 1048576),
        }),
      );
    cycle++;
    await delay(3000);
  }
  assert.deepEqual(session.errors, []);
  const afterWarmup = report.samples.filter((sample) => sample.elapsedSeconds >= Math.min(120, seconds / 3));
  const windowSize = Math.min(10, Math.floor(afterWarmup.length / 2));
  assert.ok(windowSize >= 2, 'too few non-overlapping samples to assess memory stability');
  const beginning = afterWarmup.slice(0, windowSize);
  const ending = afterWarmup.slice(-windowSize);
  const mean = (values) => values.reduce((sum, value) => sum + value.heapBytes, 0) / values.length;
  report.heapGrowthBytes = mean(ending) - mean(beginning);
  assert.ok(report.heapGrowthBytes < 100 * 1048576, 'renderer heap must not grow by 100 MB after warmup');
  assert.ok(ending.at(-1).dom.nodes < 1000, 'no accumulated renderer DOM');
  report.elapsedSeconds = (Date.now() - start) / 1000;
  report.cycles = cycle;
  await session.close();
  session = null;
  report.passed = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  if (session)
    await session.close().catch((error) => {
      report.cleanupError = error.message;
      process.exitCode = 1;
    });
  report.finishedAt = new Date().toISOString();
  await writeRunReport(output, report);
  console.log(JSON.stringify({ output, passed: report.passed, cycles: report.cycles, error: report.error }));
}
