import catalog from '../backend/agent-catalog.cjs';

export function populateAgentPicker(select, { dots = false } = {}) {
  const choices = Object.entries(catalog.AGENTS).map(([id, spec]) => [id, spec.name + (spec.experimental ? '（实验）' : '')]);
  if (dots) choices.push(['dots', '凛（Dots）']);
  select.replaceChildren(...choices.map(([value, label]) => {
    const option = select.ownerDocument.createElement('option');
    option.value = value; option.textContent = label; return option;
  }));
}
