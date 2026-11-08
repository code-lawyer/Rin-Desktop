import { rotate, smooth } from './action-motion.mjs';
// Matched landmarks define a bounded turn of the original face texture.
// We stop before hidden-side geometry would fold; no second face is blended.
const landmarks = [
  [990, 40, 0, 0],
  [1190, 40, 0, 0],
  [1390, 40, 0, 0],
  [990, 220, 0, 0],
  [1390, 220, 0, 0],
  [1010, 370, 0, 0],
  [1370, 370, 0, 0],
  [1110, 390, 0, 0],
  [1240, 390, 0, 0],
  [1053.5, 118, 56, -29.5],
  [1098.5, 92, 64.5, -23],
  [1087, 131, 46.5, -34.5],
  [1068.5, 175.5, 28.5, -35.5],
  [1175, 73, 27.5, 2],
  [1231.5, 64, 23, 3.5],
  [1279.5, 62.5, 19.5, 9],
  [1252.5, 99, 12, 11],
  [1147.5, 128.5, -3, -13.5],
  [1165, 170, -26, -15],
  [1145, 226.5, -19, -14.5],
  [1209, 206.5, -40, 2],
  [1121.5, 228, 0, -14],
  [1158.5, 224.5, -26.5, -14.5],
  [1188, 212, -34, -0.5],
  [1227.5, 197.5, -32, 4.5],
  [1141, 209, -13, -16],
  [1202, 189, -38, 0],
  [1177, 247, -49.5, -8],
  [1177.5, 235, -47.5, -6.5],
  [1187.5, 265, -44, -5],
  [1173, 266, -38, -7.5],
  [1205, 257, -44, -0.5],
  [1196, 290.5, -46.5, -1.5],
  [1141.5, 265.5, -5, 6.5],
  [1228.5, 267, -23.5, -2.5],
  [1259, 209.5, -17, 9.5],
  [1233, 239, -19, 1.5],
  [1131.5, 243.5, -4.5, 5],
];
const kernel = (r) => (r < 1e-12 ? 0 : r * Math.log(r));
function solve(matrix, values) {
  const a = matrix.map((row, i) => [...row, values[i]]),
    n = values.length;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(a[i][c]) > Math.abs(a[pivot][c])) pivot = i;
    [a[c], a[pivot]] = [a[pivot], a[c]];
    const div = a[c][c];
    if (Math.abs(div) < 1e-12) throw Error('Degenerate head landmarks');
    for (let j = c; j <= n; j++) a[c][j] /= div;
    for (let i = 0; i < n; i++)
      if (i !== c) {
        const k = a[i][c];
        for (let j = c; j <= n; j++) a[i][j] -= k * a[c][j];
      }
  }
  return a.map((row) => row[n]);
}
const points = landmarks.map(([x, y, dx, dy]) => [(x - 1180) / 150, (y - 220) / 150, dx, dy]),
  n = points.length;
const matrix = Array.from({ length: n + 3 }, () => Array(n + 3).fill(0));
for (let i = 0; i < n; i++) {
  for (let j = 0; j < n; j++)
    matrix[i][j] = kernel((points[i][0] - points[j][0]) ** 2 + (points[i][1] - points[j][1]) ** 2);
  matrix[i][n] = matrix[n][i] = 1;
  matrix[i][n + 1] = matrix[n + 1][i] = points[i][0];
  matrix[i][n + 2] = matrix[n + 2][i] = points[i][1];
}
const coefficients = [2, 3].map((axis) => solve(matrix, [...points.map((p) => p[axis]), 0, 0, 0]));
export function headDisplacement(p) {
  if (p[1] > 390 || p[0] < 990 || p[0] > 1390) return [0, 0];
  const x = (p[0] - 1180) / 150,
    y = (p[1] - 220) / 150;
  const blend =
    (1 - smooth((p[1] - 340) / 50)) * smooth((p[0] - 990) / 30) * (1 - smooth((p[0] - 1360) / 30));
  return coefficients.map((c) => {
    let value = c[n] + c[n + 1] * x + c[n + 2] * y;
    for (let i = 0; i < n; i++) value += c[i] * kernel((x - points[i][0]) ** 2 + (y - points[i][1]) ** 2);
    return value * blend;
  });
}
export function bodyPoint(point, state, delta = [0, 0]) {
  let p = [point[0] + delta[0] * state.yaw, point[1] + delta[1] * state.yaw];
  const head = 1 - smooth((point[1] - 290) / 82),
    radius = ((point[0] - 1180) / 130) ** 2 + ((point[1] - 220) / 165) ** 2;
  const z = Math.max(0, 1 - radius) * 32;
  p[1] +=
    (Math.sin(state.pitch) * 30 +
      (1 - Math.cos(state.pitch)) * (326 - point[1]) +
      Math.sin(state.pitch) * z) *
    head;
  const r = rotate(p, [1195, 326], state.roll * head);
  p = r;
  p[0] +=
    Math.sin(state.time * 1.13 + (point[1] - 280) * 0.008) *
    state.hair *
    smooth((point[1] - 250) / 90) *
    (Math.abs(point[0] - 1190) > 115 ? 1 : 0);
  p[1] -= state.breath * (1 - smooth((point[1] - 490) / 120));
  return spinePoint(p, state);
}
export function spinePoint(point, state) {
  return rotate(point, [1195, 585], state.spine * (1 - smooth((point[1] - 520) / 100)));
}
export function buildBodyMesh() {
  const vertices = [];
  const step = 8;
  for (let y = 32; y < 640; y += step)
    for (let x = 920; x < 1480; x += step) {
      for (const [u, v] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [0, 1],
        [1, 0],
        [1, 1],
      ]) {
        const p = [x + u * step, y + v * step];
        vertices.push({ p, d: headDisplacement(p) });
      }
    }
  return vertices;
}
