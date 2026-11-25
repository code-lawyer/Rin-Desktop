const { DEFAULT_CHARACTER, ANIME_MALE_CHARACTER, isCharacter } = require('./character-profiles.cjs');
const isWallpaperKind = kind => kind === 'artwork';
function wallpaperChoice(patch, settings) {
  if (!('character' in patch) && !('wallpaperKind' in patch) && !('wallpaperMotion' in patch) && !('animePlayback' in patch)) return null;
  const kind = 'wallpaperKind' in patch ? patch.wallpaperKind : 'artwork';
  const character = 'character' in patch ? patch.character : settings.character;
  if (!isWallpaperKind(kind) || !isCharacter(character)) throw new Error('请选择已支持的壁纸人物。');
  const selectMale = patch.character === ANIME_MALE_CHARACTER;
  const wallpaperMotion = 'wallpaperMotion' in patch ? patch.wallpaperMotion : !selectMale && settings.wallpaperMotion === true;
  if (typeof wallpaperMotion !== 'boolean') throw new Error('壁纸风格无效。');
  const animePlayback = 'animePlayback' in patch ? patch.animePlayback : settings.animePlayback ?? 'poses';
  if (!['video', 'poses'].includes(animePlayback)) throw new Error('动漫播放方式无效。');
  return { character: wallpaperMotion ? DEFAULT_CHARACTER : character, wallpaperKind: kind, wallpaperMotion, animePlayback: 'poses' };
}
module.exports = { isWallpaperKind, wallpaperChoice };
