import catalog from '../backend/agent-catalog.cjs';

export function populateAgentPicker(select, { dots = false, annotate = true } = {}) {
  const choices = Object.entries(catalog.AGENTS).map(([id, spec]) => {
    const label = !annotate || !spec.experimental ? '' : id === 'claude' ? '（仅 API · 实验）' : '（实验）';
    return [id, spec.name + label];
  });
  if (dots) choices.push(['dots', '凛（Dots）']);
  const key = JSON.stringify(choices);
  if (select.dataset.agentChoices === key) return false;
  const previous = select.value;
  select.replaceChildren(...choices.map(([value, label]) => {
    const option = select.ownerDocument.createElement('option');
    option.value = value; option.textContent = label; return option;
  }));
  if (choices.some(([id]) => id === previous)) select.value = previous;
  select.dataset.agentChoices = key;
  return true;
}
