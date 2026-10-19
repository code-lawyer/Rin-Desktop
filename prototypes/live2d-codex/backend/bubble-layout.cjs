// Coordinates are Electron device-independent pixels, including non-primary displays.
function bubbleLayout(avatar, area, desired = {}, anchor = null, position = null) {
  const margin = 14, gap = 12;
  const detached = Number.isFinite(position?.x) && Number.isFinite(position?.y);
  const head = anchor ? { x: avatar.x + avatar.width * anchor.x, y: avatar.y + avatar.height * anchor.y } : { x: avatar.x + avatar.width / 2, y: avatar.y + avatar.height * .2 };
  const leftEdge = avatar.x + avatar.width * (anchor?.left ?? .28), rightEdge = avatar.x + avatar.width * (anchor?.right ?? .72);
  const leftRoom = leftEdge - gap - area.x - margin;
  const rightRoom = area.x + area.width - margin - rightEdge - gap;
  const side = leftRoom >= Math.min(desired.width ?? 440, 360) || leftRoom >= rightRoom ? 'right' : 'left';
  const room = detached ? area.width - margin * 2 : side === 'right' ? leftRoom : rightRoom;
  const width = Math.min(Math.max(280, desired.width ?? 440), Math.max(280, room), area.width - margin * 2);
  const height = Math.min(Math.max(190, desired.height ?? 220), area.height - margin * 2);
  const candidateX = detached ? position.x : side === 'right' ? leftEdge - gap - width : rightEdge + gap;
  const x = Math.round(Math.max(area.x + margin, Math.min(candidateX, area.x + area.width - width - margin)));
  const candidateY = detached ? position.y : head.y - Math.min(78, height / 3);
  const y = Math.round(Math.max(area.y + margin, Math.min(candidateY, area.y + area.height - height - margin)));
  const tailY = Math.round(Math.max(42, Math.min(head.y - y, height - 42)));
  return { x, y, width: Math.round(width), height: Math.round(height), side, tailY, detached, overflowing: (desired.height ?? 220) > height + 2, fullscreen: false };
}
module.exports = { bubbleLayout };
