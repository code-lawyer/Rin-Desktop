// Expression crops use the original full painting. The arm rig separately
// handles hand contacts; the lower body, seat and furniture stay fixed.
export const SCENE = Object.freeze({ width: 3840, height: 2400, face: [2494, 300, 512, 512], contactY: 1450 });
export const SCENE_GAZE = Object.freeze({ work: [-4, 6], cup: [0, 1], thinking: [1, -2], window: [-7, 0], attention: [0, 0] });

const smooth = value => { const x = Math.max(0, Math.min(1, value)); return x*x*(3-2*x); };
export function blinkAt(time) {
  // Unequal gaps and an occasional second blink avoid a mechanical beat.
  const t=((time % 17.4)+17.4)%17.4;
  for(const start of [2.2,6.7,11.4,11.85,16.0]) {
    const elapsed=t-start;
    if(elapsed>=0 && elapsed<.24) {
      if(elapsed<.075)return smooth(elapsed/.075);
      if(elapsed<.115)return 1;
      return 1-smooth((elapsed-.115)/.125);
    }
  }
  return 0;
}

export function sceneMotion(time, { pose='attention', mouth=0, reduced=false }={}) {
  const gaze=SCENE_GAZE[pose] || SCENE_GAZE.attention;
  return {
    blink: reduced ? 0 : blinkAt(time), mouth: Math.max(0,Math.min(1,Number.isFinite(mouth)?mouth:0)),
    breath: reduced ? 0 : Math.sin(time*Math.PI*2/5.8)*2.1,
    hair: reduced ? 0 : Math.sin(time*1.07)*1.2+Math.sin(time*.47)*.45,
    nod: reduced ? 0 : Math.sin(time*.51)*.0022,
    gaze,
  };
}
