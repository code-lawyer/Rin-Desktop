import { stillPose, stillActivity } from './still-policy.mjs';

function attentionActivity(backend, presentation) {
  if (presentation.capturing) return 'capturing';
  if (presentation.speaking) return 'speaking';
  if (backend.status === 'waiting') return 'waiting';
  if (presentation.chatVisible) return 'chat';
  return null;
}

export function puppetPose(backend, presentation, idle) {
  if (attentionActivity(backend, presentation)) return 'attention';
  return stillPose(backend, presentation, idle);
}

export function puppetActivity(backend, presentation, hidden = false) {
  if (presentation.paused || hidden) return stillActivity(backend, presentation, hidden);
  return attentionActivity(backend, presentation) || stillActivity(backend, presentation, hidden);
}

// Precompute the voice envelope once, then sample it against the audio clock.
// No microphone, recognizer, or extra playback is needed for lip sync.
export function speechEnvelope(samples, sampleRate, step = .04) {
  if (!samples?.length || !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) return { step, levels: new Float32Array() };
  const stride = Math.max(1, Math.round(sampleRate * step)), levels = new Float32Array(Math.ceil(samples.length / stride));
  for (let start = 0, frame = 0; start < samples.length; start += stride, frame++) {
    const end = Math.min(samples.length, start + stride); let sum = 0;
    for (let i = start; i < end; i++) { const value = Number.isFinite(samples[i]) ? samples[i] : 0; sum += value * value; }
    const rms = Math.sqrt(sum / (end - start));
    levels[frame] = Math.min(1, Math.max(0, (rms - .006) * 9));
  }
  return { step, levels };
}

export function mouthAt(envelope, seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return envelope.levels[Math.floor(seconds / envelope.step)] ?? 0;
}
