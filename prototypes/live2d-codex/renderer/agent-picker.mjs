import catalog from '../backend/agent-catalog.cjs';

export function populateAgentPicker(select, { dots = false, customAgents } = {}) {
  if (customAgents) catalog.setCustomAgents(customAgents);
  const choices = Object.entries(catalog.AGENTS).map(([id, spec]) => [id, spec.name + (spec.custom ? '（自定义 · 实验）' : spec.experimental ? '（实验）' : '')]);
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
