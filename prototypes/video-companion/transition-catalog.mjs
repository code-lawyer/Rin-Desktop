const allowed = new Set(['work', 'window', 'user']);
export function validateTransitions(input) {
  if (input?.schema !== 'rin-three-state-transitions-v1' || !Array.isArray(input.states) || !Array.isArray(input.transitions)) throw new Error('Invalid transition manifest.');
  const states = input.states;
  if (states.length < 2 || states.length > 3 || states.some(state => !allowed.has(state.id) || typeof state.label !== 'string' || !state.label.trim()) || new Set(states.map(state => state.id)).size !== states.length) throw new Error('Invalid states.');
  if (!states.some(state => state.id === input.initial)) throw new Error('Invalid initial state.');
  if (!['source-720p', 'upscaled-4k'].includes(input.quality)) throw new Error('Specify the actual media quality.');
  const keys = new Set();
  const transitions = input.transitions.map(clip => {
    const key = clip.from + ':' + clip.to;
    if (clip.from === clip.to || !states.some(state => state.id === clip.from) || !states.some(state => state.id === clip.to) || keys.has(key)) throw new Error('Invalid or duplicate transition.');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.mp4$/.test(clip.file) || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 15) throw new Error('Invalid transition media.');
    keys.add(key);
    return { from: clip.from, to: clip.to, file: clip.file, duration: clip.duration, src: '/media/' + clip.file, loopStart: 0, loopEnd: clip.duration };
  });
  if (keys.size !== states.length * (states.length - 1)) throw new Error('Every directed transition must be present.');
  return { schema: input.schema, quality: input.quality, initial: input.initial, states: states.map(({ id, label }) => ({ id, label })), transitions };
}
