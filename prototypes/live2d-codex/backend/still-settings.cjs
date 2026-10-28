const POSE_LABELS = Object.freeze({ work: '伏案工作', cup: '捧杯休息', thinking: '托腮思考', window: '侧身看雨', attention: '转身陪伴' });
const POSES = Object.freeze(Object.keys(POSE_LABELS));
const ACTIVITY_LABELS = Object.freeze({ auto: '自动轮换', manual: '固定姿态', paused: '壁纸已暂停', hidden: '壁纸暂不可见', capturing: '正在听写', speaking: '正在朗读', task: '正在处理任务', waiting: '等待操作确认', chat: '正在陪伴对话', male: '男生待机' });
const STILL_DEFAULTS = Object.freeze({ stillPose: 'auto', wallpaperMotion: false, ambienceEnabled: false, rainVolume: .12, keyVolume: .08 });
function stillSettings(input = {}) {
  return {
    stillPose: ['auto', ...POSES].includes(input.stillPose) ? input.stillPose : 'auto',
    ambienceEnabled: input.ambienceEnabled === true,
    wallpaperMotion: input.wallpaperMotion === true,
    ...Object.fromEntries(['rainVolume', 'keyVolume'].map(key => [key,
      Number.isFinite(input[key]) && input[key] >= 0 && input[key] <= 1 ? input[key] : STILL_DEFAULTS[key]])),
  };
}
function validateStillPatch(patch) {
  if ('stillPose' in patch && !['auto', ...POSES].includes(patch.stillPose)) throw new Error('请选择已有静态姿态。');
  if ('ambienceEnabled' in patch && typeof patch.ambienceEnabled !== 'boolean') throw new Error('环境音开关无效。');
  if ('wallpaperMotion' in patch && typeof patch.wallpaperMotion !== 'boolean') throw new Error('动态壁纸开关无效。');
  for (const key of ['rainVolume', 'keyVolume']) if (key in patch && (!Number.isFinite(patch[key]) || patch[key] < 0 || patch[key] > 1)) throw new Error('环境音量应在 0–100% 之间。');
  return Object.fromEntries(Object.keys(STILL_DEFAULTS).filter(key => key in patch).map(key => [key, patch[key]]));
}
module.exports = { POSES, POSE_LABELS, ACTIVITY_LABELS, STILL_DEFAULTS, stillSettings, validateStillPatch };
