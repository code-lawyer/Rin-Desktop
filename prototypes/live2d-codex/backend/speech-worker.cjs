const { join } = require('node:path');
const sherpa = require('sherpa-onnx-node');
let recognizer, tts;
const models = process.argv[2];
process.on('message', async ({ id, kind, data }) => {
  try {
    let result;
    if (kind === 'transcribe' || kind === 'load-asr') {
      const dir = join(models, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17');
      recognizer ??= new sherpa.OfflineRecognizer({ featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig: { senseVoice: { model: join(dir, 'model.int8.onnx'), useInverseTextNormalization: 1 }, tokens: join(dir, 'tokens.txt'), numThreads: 2, provider: 'cpu', debug: 0 } });
      if (kind === 'load-asr') result = { loaded: true };
      else {
      const stream = recognizer.createStream();
      const bytes = Buffer.from(data.samplesBase64,'base64');
      stream.acceptWaveform({ sampleRate: data.sampleRate, samples: new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)) });
      recognizer.decode(stream); result = { text: recognizer.getResult(stream).text.replace(/<\|.*?\|>/g, '').trim() };
      }
    } else if (kind === 'synthesize' || kind === 'load-tts') {
      const dir = join(models, 'kokoro-int8-multi-lang-v1_1');
      tts ??= new sherpa.OfflineTts({ model: { kokoro: { model: join(dir, 'model.int8.onnx'), voices: join(dir, 'voices.bin'), tokens: join(dir, 'tokens.txt'), dataDir: join(dir, 'espeak-ng-data'), dictDir: join(dir,'dict'), lexicon: join(dir, 'lexicon-zh.txt') + ',' + join(dir, 'lexicon-us-en.txt'), lang: 'zh' }, numThreads: 2, provider: 'cpu', debug: 0 }, ruleFsts: ['date-zh.fst','number-zh.fst','phone-zh.fst'].map(file=>join(dir,file)).join(','), maxNumSentences: 1 });
      if (kind === 'load-tts') result = { loaded: true };
      else {
        const audio = tts.generate({ text: data.text, sid: data.voice, speed: data.speed });
        result = { samplesBase64: Buffer.from(audio.samples.buffer,audio.samples.byteOffset,audio.samples.byteLength).toString('base64'), sampleRate: audio.sampleRate };
      }
    } else throw new Error('未知语音操作。');
    process.send({ id, ok: true, value: result });
  } catch (error) { process.send({ id, ok: false, error: error.message }); }
});
