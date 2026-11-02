const { isCharacter } = require('./character-profiles.cjs');
const isWallpaperKind = kind => kind === 'artwork';
function wallpaperChoice(patch, settings) {
  if (!('character' in patch) && !('wallpaperKind' in patch) && !('wallpaperMotion' in patch)) return null;
  const kind = patch.wallpaperKind ?? 'artwork';
  const character = patch.character ?? settings.character;
  if (!isWallpaperKind(kind) || !isCharacter(character)) throw new Error('请选择已支持的壁纸人物。');
  const wallpaperMotion = 'wallpaperMotion' in patch ? patch.wallpaperMotion : settings.wallpaperMotion ?? false;
  if (typeof wallpaperMotion !== 'boolean') throw new Error('壁纸风格无效。');
  return { character, wallpaperKind: kind, wallpaperMotion };
}
module.exports = { isWallpaperKind, wallpaperChoice };
