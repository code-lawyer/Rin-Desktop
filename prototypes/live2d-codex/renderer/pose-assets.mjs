export const POSE_IDS = Object.freeze(['attention', 'cup', 'work', 'thinking', 'window']);
export const POSE_SIZE = Object.freeze([1586, 992]);
export const POSE_FILES = Object.freeze([
  'background.png',
  'foreground.png',
  'scene.png',
  'cover.webp',
  'poses.json',
  ...POSE_IDS.flatMap((id) => [id + '.png', id + '-blink.png']),
  'attention-halfBlink.png',
  'attention-mouth.png',
]);

export function validatePoses(value) {
  const finite = (x) => typeof x === 'number' && Number.isFinite(x);
  const vector = (x, n) => Array.isArray(x) && x.length === n && x.every(finite);
  const fail = () => {
    throw new Error('人物姿态配置无效。');
  };
  if (
    !value ||
    value.format !== 1 ||
    JSON.stringify(value.size) !== JSON.stringify(POSE_SIZE) ||
    !Array.isArray(value.poses) ||
    value.poses.length !== POSE_IDS.length
  )
    fail();
  const seen = new Set();
  for (const pose of value.poses) {
    if (!pose || !POSE_IDS.includes(pose.id) || seen.has(pose.id)) fail();
    seen.add(pose.id);
    if (
      !vector(pose.face, 4) ||
      pose.face[0] < 0 ||
      pose.face[1] < 0 ||
      pose.face[2] <= 0 ||
      pose.face[3] <= 0 ||
      pose.face[0] + pose.face[2] > POSE_SIZE[0] ||
      pose.face[1] + pose.face[3] > POSE_SIZE[1]
    )
      fail();
    if (!Array.isArray(pose.eyes) || pose.eyes.length !== 2) fail();
    for (const eye of pose.eyes)
      if (
        !vector(eye, 5) ||
        eye.slice(0, 2).some((x) => x < 0 || x > 512) ||
        eye[2] <= 0 ||
        eye[3] <= 0 ||
        eye[2] > 100 ||
        eye[3] > 100 ||
        Math.abs(eye[4]) > Math.PI
      )
        fail();
    if (pose.id === 'attention') {
      if (
        !vector(pose.mouth, 5) ||
        pose.mouth.slice(0, 2).some((x) => x < 0 || x > 512) ||
        pose.mouth[2] <= 0 ||
        pose.mouth[3] <= 0 ||
        pose.mouth[2] > 100 ||
        pose.mouth[3] > 100 ||
        Math.abs(pose.mouth[4]) > Math.PI
      )
        fail();
    } else if (pose.mouth !== null) fail();
  }
  return value;
}
