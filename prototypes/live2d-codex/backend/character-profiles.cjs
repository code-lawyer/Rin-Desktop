// Shared by settings, the wallpaper renderer and the synthesis boundary.
const DEFAULT_CHARACTER = 'female';
const ANIME_MALE_CHARACTER = 'anime-male';
const CHARACTERS = Object.freeze({
  female: Object.freeze({
    id: 'female', label: '窗边女生', model: 'rainy-window-v2-4k', poseDirectory: 'rin-poses',
    sourceWidth: 3840, sourceHeight: 2400, qwenVoice: 'Serena', voice: 3,
  }),
  [ANIME_MALE_CHARACTER]: Object.freeze({
    id: ANIME_MALE_CHARACTER, label: '窗边男生', poseDirectory: 'rin-male-poses',
    sourceWidth: 3840, sourceHeight: 2400, qwenVoice: 'Serena', voice: 3,
  }),
});
const POSE_DIRECTORIES = Object.freeze(Object.values(CHARACTERS).map(profile => profile.poseDirectory));
const QWEN_VOICES = Object.freeze({
  Serena: { label: 'Serena · 温柔女声', gender: 'female' },
  Vivian: { label: 'Vivian · 明亮女声', gender: 'female' },
  Dylan: { label: 'Dylan · 清朗男声', gender: 'male' },
  Uncle_Fu: { label: 'Uncle Fu · 醇厚男声', gender: 'male' },
});
const has = (items, key) => Object.hasOwn(items, key);
const characterProfile = id => CHARACTERS[has(CHARACTERS, id) ? id : DEFAULT_CHARACTER];
const isCharacter = id => typeof id === 'string' && has(CHARACTERS, id);
const isQwenVoice = id => typeof id === 'string' && has(QWEN_VOICES, id);
// Kokoro v1.1-zh: Chinese female IDs 3–57, male IDs 58–102.
// https://k2-fsa.github.io/sherpa/onnx/tts/all/Chinese-English/kokoro-multi-lang-v1_1.html
const isChineseVoice = id => Number.isInteger(id) && id >= 3 && id <= 102;
function qwenSynthesisVoice(settings = {}) {
  const speaker = isQwenVoice(settings.qwenVoice) ? settings.qwenVoice : characterProfile(settings.character).qwenVoice;
  const persona = QWEN_VOICES[speaker].gender === 'male'
    ? '年轻成年男性，声音清朗沉稳，语气平静克制、自然自信'
    : '年轻成年女性，声音清澈，语气平静克制、清冷自信';
  return { speaker, instruct: `用标准普通话自然地交谈。${persona}，语速适中，随语意自然停顿，句尾放松。` };
}
module.exports = { DEFAULT_CHARACTER, ANIME_MALE_CHARACTER, CHARACTERS, POSE_DIRECTORIES, QWEN_VOICES, characterProfile, isCharacter, isQwenVoice, isChineseVoice, qwenSynthesisVoice };
