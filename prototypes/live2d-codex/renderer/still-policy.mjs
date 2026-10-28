import settings from '../backend/still-settings.cjs';
export const POSE_LABELS = settings.POSE_LABELS;
export const IDLE_POSES = Object.freeze(['work', 'cup', 'thinking', 'window']);
// Each quiet round covers all three resting poses, with work between them.
export function createIdleCycle(random = Math.random) {
  let remaining = [], previous;
  return current => {
    if (current !== 'work') return 'work';
    if (!remaining.length) {
      remaining = IDLE_POSES.slice(1);
      for (let i = remaining.length - 1; i > 0; i--) {
        const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
        [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
      }
      if (remaining[0] === previous) [remaining[0], remaining[1]] = [remaining[1], remaining[0]];
    }
    previous = remaining.shift();
    return previous;
  };
}
export function idleDuration(pose, random = Math.random) {
  const ranges = { work: [75, 120], cup: [45, 70], thinking: [40, 65], window: [45, 70] };
  const [low, high] = ranges[pose] ?? ranges.work;
  return (low + random() * (high - low)) * 1000;
}
export function stillActivity(state = {}, presentation = {}, hidden = false) {
  if (presentation.paused) return 'paused';
  if (hidden) return 'hidden';
  if (settings.stillSettings(presentation.stills).stillPose !== 'auto') return 'manual';
  if (presentation.capturing) return 'capturing';
  if (presentation.speaking) return 'speaking';
  if (state.status === 'waiting') return 'waiting';
  if (['starting', 'working', 'stopping'].includes(state.status)) return 'task';
  if (presentation.chatVisible) return 'chat';
  return presentation.character === 'male' ? 'male' : 'auto';
}
export function stillPose(state = {}, presentation = {}, idle = 'work') {
  const choice = settings.stillSettings(presentation.stills).stillPose;
  let pose;
  // A manual pose is an explicit audition. Audio safety still takes precedence.
  if (choice !== 'auto') pose = choice;
  else if (presentation.capturing || presentation.speaking || state.status === 'waiting') pose = 'attention';
  else if (['starting', 'working', 'stopping'].includes(state.status)) pose = 'work';
  else if (presentation.chatVisible) pose = 'attention';
  else pose = IDLE_POSES.includes(idle) ? idle : 'work';
  return presentation.character === 'male' && !['work', 'attention'].includes(pose)
    ? 'work' : pose;
}
