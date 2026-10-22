export function installSettingsNavigation(document) {
  const buttons = [...document.querySelectorAll('[data-setting-target]')];
  const sections = [...document.querySelectorAll('[data-settings-group]')];
  function show(id, { focus = false } = {}) {
    const target = document.getElementById(id);
    if (!target?.dataset.settingsGroup) return;
    const group = target.dataset.settingsGroup;
    let selectedButton;
    for (const section of sections) section.hidden = section.dataset.settingsGroup !== group;
    for (const button of buttons) {
      const selected = document.getElementById(button.dataset.settingTarget)?.dataset.settingsGroup === group;
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-controls', button.dataset.settingTarget);
      if (selected) selectedButton = button;
    }
    target.scrollIntoView({ block: 'start' });
    // Keep a focusable navigation anchor: headings are outside the remote's
    // control order and would send the next direction back to the title bar.
    if (focus) selectedButton?.focus({preventScroll:true});
  }
  for (const button of buttons) button.onclick = () => show(button.dataset.settingTarget, {focus:true});
  return { show };
}
