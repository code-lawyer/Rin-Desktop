// Presentation and completion notifications use the same final-reply rule.
// The canonical conversation remains owned by the selected native Agent.
export function currentReply(messages = []) {
  let userIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') { userIndex = i; break; }
  const user = userIndex >= 0 ? messages[userIndex] : null;
  let candidates = messages.slice(userIndex + 1).filter(message => message.role === 'assistant');
  if (user?.turnId) candidates = candidates.filter(message => !message.turnId || message.turnId === user.turnId);
  const answer = candidates.findLast(message => message.phase === 'final_answer') ?? candidates.at(-1);
  return { key: user?.id ?? answer?.turnId ?? 'empty', userId: user?.id ?? null, turnId: user?.turnId ?? answer?.turnId ?? null,
    text: answer?.text ?? '', complete: answer?.complete ?? true, messageId: answer?.id ?? null,
    readable: !!answer?.complete && answer.phase !== 'commentary' && (answer.turnStatus === undefined || answer.turnStatus === 'completed') };
}

function groups(messages) {
  const result = [];
  for (const message of messages) {
    if (!result.length || message.role === 'user') result.push([]);
    result.at(-1).push(message);
  }
  return result;
}
// ACP can merge assistant chunks across tool calls and has no stable message
// IDs. Match whole turns, never an isolated repeated answer. Ambiguous or edited
// native history remains visible with an unknown outcome, not a guessed success.
const signature = group => JSON.stringify([
  group.filter(m => m.role === 'user').map(m => m.text),
  group.filter(m => m.role === 'assistant').map(m => m.text).join(''),
]);
export function restoreHistory(messages, cached = []) {
  const previous = groups(cached), incoming = groups(messages);
  return incoming.flatMap(group => {
    const key = signature(group), candidates = previous.filter(items => signature(items) === key);
    const identified = candidates.filter(items => group.some(m => items.some(old => old.id === m.id && old.role === m.role && old.text === m.text)));
    const known = identified.length === 1 ? identified[0]
      : candidates.length === 1 && incoming.filter(items => signature(items) === key).length === 1 ? candidates[0] : null;
    if (known && known.every(m => m.turnStatus)) return structuredClone(known);
    const turnId = group[0]?.turnId ?? group[0]?.id;
    return group.map(message => ({ ...message, turnId, complete: true, turnStatus: 'unknown' }));
  });
}
