// The anchor follows rendered character pixels, independent of canvas padding and DPI.
export function measureAvatarAnchor(pixels, width, height, view) {
  if (!width || !height || !view.windowWidth || !view.windowHeight) return null;
  let top = height, bottom = -1;
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) if (pixels[(y * width + x) * 4 + 3] > 24) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
  if (bottom <= top) return null;
  let left = width, right = -1;
  const headBottom = top + (bottom - top) * .2;
  for (let y = top; y <= headBottom; y += 2) for (let x = 0; x < width; x += 2) if (pixels[(y * width + x) * 4 + 3] > 24) { left = Math.min(left, x); right = Math.max(right, x); }
  if (right <= left) return null;
  const nx = x => (view.canvasLeft + x / width * view.canvasWidth) / view.windowWidth;
  const ny = y => (view.canvasTop + y / height * view.canvasHeight) / view.windowHeight;
  return { x: nx((left + right) / 2), y: ny(top + (bottom - top) * .12), left: nx(left), right: nx(right) };
}
