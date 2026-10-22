// RC003 ATVV: 16 kHz IMA ADPCM, high nibble first. Same protocol as the
// preserved diagnostic, now owned by the application; raw audio stays in RAM.
const STEPS = [7,8,9,10,11,12,13,14,16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,73,80,88,97,107,118,130,143,157,173,190,209,230,253,279,307,337,371,408,449,494,544,598,658,724,796,876,963,1060,1166,1282,1411,1552,1707,1878,2066,2272,2499,2749,3024,3327,3660,4026,4428,4871,5358,5894,6484,7132,7845,8630,9493,10442,11487,12635,13899,15289,16818,18500,20350,22385,24623,27086,29794,32767];
const INDEX = [-1,-1,-1,-1,2,4,6,8];
export const GET_CAPS = Buffer.from([0x0a,1,0,0,3,3]);
export function capabilities(data) {
  if (data.length !== 9 || data[0] !== 11 || data[1] !== 1 || data[2] !== 0) throw new Error('遥控器的语音协议不受支持。');
  let mask = data[3]; if (!mask && data[4] >= 1 && data[4] <= 3) mask = data[4];
  const frameSize = data.readUInt16BE(5);
  if (mask > 3 || !(mask & 2) || !frameSize || frameSize > 512) throw new Error('遥控器不支持所需的语音格式。');
  return { frameSize, sampleRate:16000, codec:2 };
}
export class RemoteAudio {
  constructor(frameSize) { this.frameSize=frameSize; this.samples=new Float32Array(16000*60); this.length=0; this.frames=0; this.peak=0; this.sync(0,0); }
  sync(predictor,index) {
    if (!Number.isInteger(predictor) || predictor < -32768 || predictor > 32767 || !Number.isInteger(index) || index < 0 || index > 88) throw new Error('遥控器音频同步异常，请松开重试。');
    this.predictor=predictor; this.index=index;
  }
  feed(data) {
    if (!data.length || data.length > this.frameSize || this.length + data.length*2 > this.samples.length) throw new Error('录音达到上限或音频包异常，请松开重试。');
    for (const byte of data) for (const nibble of [byte >> 4,byte & 15]) {
      const step=STEPS[this.index]; let delta=step >> 3;
      if(nibble&1) delta+=step >> 2; if(nibble&2) delta+=step >> 1; if(nibble&4) delta+=step;
      this.predictor=Math.max(-32768,Math.min(32767,this.predictor+(nibble&8?-delta:delta)));
      this.index=Math.max(0,Math.min(88,this.index+INDEX[nibble&7]));
      this.samples[this.length++]=this.predictor/32768;
      this.peak=Math.max(this.peak,Math.abs(this.predictor/32768));
    }
    this.frames++;
  }
  snapshot() { return {frames:this.frames,durationMs:Math.round(this.length/16),peak:this.peak}; }
  finish() {
    if (this.length < 3200) throw new Error('没有收到足够的声音，请按住语音键说话后再松开。');
    return { samples:this.samples.slice(0,this.length), sampleRate:16000 };
  }
}
