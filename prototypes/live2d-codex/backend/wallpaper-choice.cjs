const { isCharacter } = require('./character-profiles.cjs');
const isWallpaperKind = kind => kind === 'artwork';
function wallpaperChoice(patch, settings) {
  if (!('character' in patch) && !('wallpaperKind' in patch)) return null;
  const kind = patch.wallpaperKind ?? 'artwork';
  const character = patch.character ?? settings.character;
  if (!isWallpaperKind(kind) || !isCharacter(character)) throw new Error('请选择已支持的壁纸人物。');
  return { character, wallpaperKind: kind };
}
module.exports = { isWallpaperKind, wallpaperChoice };
