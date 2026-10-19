// Presentation only: the complete conversation remains owned by Codex.
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
