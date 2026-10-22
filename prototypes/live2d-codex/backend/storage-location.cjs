const { existsSync, readFileSync, realpathSync, statSync } = require('node:fs');
const { join, resolve, isAbsolute } = require('node:path');

function dataHome(base, portable) {
  const home = join(base, 'VibeVoice');
  if (!portable?.testBuild) return home;
  const id = portable.testBuild.id;
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,90}$/.test(id)) throw new Error('测试包数据标识无效。');
  return join(home, 'test-builds', id);
}
function storageLocation({ defaultStorage, sourceStorage, packaged, override }) {
  if (override) return resolve(override);
  if (!packaged) return resolve(sourceStorage);
  const pointer = join(defaultStorage, 'data-location.json');
  if (!existsSync(pointer)) {
    if (existsSync(pointer + '.tmp') || existsSync(pointer + '.bak')) throw new Error('数据目录记录缺失，发现恢复副本；请先恢复目录记录或明确指定数据副本。');
    return defaultStorage;
  }
  try {
    const saved = JSON.parse(readFileSync(pointer, 'utf8'));
    if (saved.format !== 1 || typeof saved.directory !== 'string' || !isAbsolute(saved.directory) || !statSync(saved.directory).isDirectory()) throw new Error('数据目录不存在或记录无效。');
    return realpathSync.native(saved.directory);
  } catch (error) {
    throw new Error(`原数据目录无法访问，未切换到空白数据。请恢复目录或使用数据副本：${error.message}`);
  }
}
module.exports = { dataHome, storageLocation };
