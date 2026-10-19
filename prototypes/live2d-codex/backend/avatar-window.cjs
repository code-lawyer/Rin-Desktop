const BASE_AVATAR = Object.freeze({ width: 300, height: 420 });
function avatarScale(value) { return Number.isFinite(value) ? Math.round(Math.max(.6, Math.min(1.5, value)) * 100) / 100 : 1; }
function avatarBounds(position, area, scale = 1) {
  const margin = 8;
  const fit = Math.min(avatarScale(scale), (area.width - margin * 2) / BASE_AVATAR.width, (area.height - margin * 2) / BASE_AVATAR.height);
  const width = Math.max(1, Math.round(BASE_AVATAR.width * fit)), height = Math.max(1, Math.round(BASE_AVATAR.height * fit));
  const x = Number.isFinite(position?.x) ? position.x : area.x + area.width - width - 20;
  const y = Number.isFinite(position?.y) ? position.y : area.y + area.height - height - 20;
  return { x: Math.round(Math.max(area.x + margin, Math.min(x, area.x + area.width - width - margin))), y: Math.round(Math.max(area.y + margin, Math.min(y, area.y + area.height - height - margin))), width, height };
}
module.exports = { BASE_AVATAR, avatarScale, avatarBounds };
