// Transition design previews only. Complete production pose textures are used
// as authored; none of these effects are installed into the running wallpaper.
const width = 1280,
  height = 800,
  header = 60;
const OPTIONS = [
  { id: 'a', name: '像素重组', out: 1.1, hold: 0.1, in: 1.6, note: '马赛克分解 · 方块重组' },
  { id: 'b', name: '竖条扫描', out: 1.1, hold: 0.1, in: 1.6, note: '青色竖线 · 条带展开' },
  { id: 'c', name: '点阵传输', out: 1.1, hold: 0.1, in: 1.6, note: '发光点阵 · 渐次聚合' },
  { id: 'd', name: '信号干扰', out: 1.1, hold: 0.1, in: 1.6, note: '轻度错行 · 青紫色差' },
];
const images = Object.fromEntries(
  await Promise.all(
    ['background', 'foreground', 'cup', 'attention', 'work'].map(async (name) => {
      const image = new Image();
      image.src = '/assets/' + name + '.png';
      await image.decode();
      if (image.naturalWidth !== 1586 || image.naturalHeight !== 992)
        throw Error('Unexpected pose texture size');
      return [name, image];
    }),
  ),
);
const output = document.querySelector('#output');
output.width = width;
output.height = height + header;
const context = output.getContext('2d', { alpha: false });
const surface = () => {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
};
const actor = surface(),
  mask = surface(),
  glow = surface(),
  tiny = surface();
const act = actor.getContext('2d'),
  stencil = mask.getContext('2d'),
  light = glow.getContext('2d'),
  sample = tiny.getContext('2d');
const clamp = (value) => Math.max(0, Math.min(1, value));
const smooth = (value) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(value));
const noise = (x, y) => {
  const n = Math.sin(x * 127.1 + y * 311.7 + 19.19) * 43758.5453;
  return n - Math.floor(n);
};

function stateAt(option, time) {
  if (time < 1.5) return { pose: 'cup', presence: 1, label: '持杯休息', phase: null };
  const second = time >= 6,
    elapsed = time - (second ? 6 : 1.5),
    from = second ? 'attention' : 'cup',
    to = second ? 'work' : 'attention';
  if (elapsed >= option.out + option.hold + option.in)
    return { pose: to, presence: 1, label: second ? '专注工作' : '看向你', phase: null };
  if (elapsed < option.out) {
    const phase = elapsed / option.out;
    return { pose: from, presence: 1 - smooth(phase), phase, label: '解构' };
  }
  if (elapsed < option.out + option.hold) return { pose: to, presence: 0, phase: 1, label: '切换姿态' };
  const phase = (elapsed - option.out - option.hold) / option.in;
  return { pose: to, presence: smooth(phase), phase, label: '重构' };
}
function reset() {
  for (const ctx of [act, stencil, light]) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.clearRect(0, 0, width, height);
  }
  act.imageSmoothingEnabled = true;
  stencil.fillStyle = '#fff';
}
function pixelated(image, block) {
  tiny.width = Math.max(1, Math.round(width / block));
  tiny.height = Math.max(1, Math.round(height / block));
  sample.imageSmoothingEnabled = true;
  sample.drawImage(image, 0, 0, tiny.width, tiny.height);
  act.imageSmoothingEnabled = false;
  act.drawImage(tiny, 0, 0, width, height);
  act.imageSmoothingEnabled = true;
}
function applyMask() {
  act.globalCompositeOperation = 'destination-in';
  act.drawImage(mask, 0, 0);
  act.globalCompositeOperation = 'source-over';
}
function clipGlow() {
  light.globalCompositeOperation = 'destination-in';
  light.drawImage(actor, 0, 0);
  light.globalCompositeOperation = 'source-over';
}

function pixels(image, v) {
  pixelated(image, 1 + Math.pow(1 - v, 0.75) * 28);
  const cell = 22;
  for (let y = 0; y < height; y += cell)
    for (let x = 0; x < width; x += cell) {
      const amount = clamp((v - noise(x / cell, y / cell) * 0.72) / 0.28);
      if (amount <= 0) continue;
      stencil.globalAlpha = amount;
      stencil.fillRect(x, y, cell, cell);
      if (amount < 0.98) {
        light.strokeStyle = `rgba(90,250,255,${Math.sin(Math.PI * amount) * 0.7})`;
        light.lineWidth = 1;
        light.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
      }
    }
  stencil.globalAlpha = 1;
  applyMask();
  clipGlow();
}
function stripes(image, v) {
  act.drawImage(image, 0, 0, width, height);
  const cell = 12;
  for (let x = 0; x < width; x += cell) {
    const rank = 0.55 * noise(x / cell, 7) + 0.45 * (x / width),
      amount = clamp((v - rank * 0.22) / 0.78);
    if (amount <= 0) continue;
    const inset = (cell * (1 - amount)) / 2;
    stencil.fillRect(x + inset, 0, cell * amount, height);
    light.fillStyle = `rgba(93,247,255,${Math.sin(Math.PI * amount) * 0.9})`;
    light.fillRect(x + inset, 0, 1.6, height);
    light.fillRect(x + cell - inset - 1.6, 0, 1.6, height);
  }
  applyMask();
  clipGlow();
}
function dots(image, v) {
  pixelated(image, 1 + (1 - v) * 9);
  const cell = 10;
  stencil.beginPath();
  for (let y = 0; y < height; y += cell)
    for (let x = 0; x < width; x += cell) {
      const rank = 0.7 * noise(x / cell, y / cell) + 0.3 * (y / height),
        amount = clamp((v - rank * 0.3) / 0.7);
      if (amount <= 0) continue;
      const radius = cell * 0.75 * Math.sqrt(amount);
      stencil.moveTo(x + cell / 2 + radius, y + cell / 2);
      stencil.arc(x + cell / 2, y + cell / 2, radius, 0, Math.PI * 2);
    }
  stencil.fill();
  applyMask();
  act.globalCompositeOperation = 'source-atop';
  act.fillStyle = `rgba(55,240,245,${0.42 * (1 - v)})`;
  act.fillRect(0, 0, width, height);
  act.globalCompositeOperation = 'source-over';
  light.drawImage(actor, 0, 0);
  light.globalCompositeOperation = 'source-in';
  light.fillStyle = `rgba(75,238,255,${0.23 * (1 - v)})`;
  light.fillRect(0, 0, width, height);
  light.globalCompositeOperation = 'source-over';
}
function glitch(image, v, phase, time) {
  const band = 12,
    energy = (1 - v) * (0.25 + 0.75 * Math.sin(phase * Math.PI * 3) ** 2);
  for (let y = 0; y < height; y += band) {
    const amount = clamp((v - noise(y / band, 11) * 0.45) / 0.55);
    if (amount <= 0) continue;
    const offset = Math.sin(y * 0.27 + time * 5) * 9 * energy,
      h = Math.min(band, height - y);
    act.globalAlpha = amount;
    act.drawImage(
      image,
      0,
      (y / height) * image.naturalHeight,
      image.naturalWidth,
      (h / height) * image.naturalHeight,
      offset,
      y,
      width,
      h,
    );
  }
  act.globalAlpha = 1;
  light.drawImage(actor, 0, 0);
  light.globalCompositeOperation = 'source-in';
  light.fillStyle = `rgba(70,250,255,${0.4 * energy})`;
  light.fillRect(0, 0, width, height);
  light.globalCompositeOperation = 'source-over';
  // Fringes use one pose's alpha only; they never mix old and new characters.
  act.save();
  act.globalCompositeOperation = 'screen';
  act.drawImage(glow, 3 + 5 * energy, 0);
  act.restore();
  light.globalCompositeOperation = 'source-in';
  light.fillStyle = `rgba(255,77,204,${0.26 * energy})`;
  light.fillRect(0, 0, width, height);
  light.globalCompositeOperation = 'source-over';
  act.save();
  act.globalCompositeOperation = 'screen';
  act.drawImage(glow, -3 - 5 * energy, 0);
  act.restore();
  light.clearRect(0, 0, width, height);
}

window.audition = {
  options: OPTIONS,
  health() {
    return {
      backend: 'Canvas2D transition prototype',
      contextLost: context.isContextLost?.() ?? false,
      assets: Object.keys(images).length,
    };
  },
  render(id, time) {
    const option = OPTIONS.find((value) => value.id === id);
    if (!option || !Number.isFinite(time) || time < 0) throw Error('Invalid audition frame');
    const frame = stateAt(option, time);
    reset();
    if (frame.presence >= 1) act.drawImage(images[frame.pose], 0, 0, width, height);
    else if (frame.presence > 0)
      ({ a: pixels, b: stripes, c: dots, d: glitch })[id](
        images[frame.pose],
        frame.presence,
        frame.phase,
        time,
      );
    context.fillStyle = '#0c1520';
    context.fillRect(0, 0, width, height + header);
    context.drawImage(images.background, 0, header, width, height);
    context.drawImage(actor, 0, header);
    if (id !== 'd') {
      context.save();
      context.globalCompositeOperation = 'screen';
      context.filter = 'blur(2px)';
      context.drawImage(glow, 0, header);
      context.filter = 'none';
      context.drawImage(glow, 0, header);
      context.restore();
    }
    context.drawImage(images.foreground, 0, header, width, height);
    context.fillStyle = '#a8f4ff';
    context.font = 'bold 24px "Microsoft YaHei",sans-serif';
    context.fillText(`${id.toUpperCase()}  ${option.name}`, 24, 39);
    context.fillStyle = '#a9bccd';
    context.font = '18px "Microsoft YaHei",sans-serif';
    context.fillText(`2.8 秒  ·  ${option.note}`, 250, 38);
    context.textAlign = 'right';
    context.fillText(frame.label, width - 24, 38);
    context.textAlign = 'left';
    return { frame, jpeg: output.toDataURL('image/jpeg', 0.94).split(',')[1] };
  },
};
