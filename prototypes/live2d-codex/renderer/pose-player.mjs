import { POSE_IDS, POSE_SIZE, validatePoses } from './pose-assets.mjs';

const VERTEX = `#version 300 es
in vec2 position;in vec2 texcoord;out vec2 uv;uniform vec2 viewport;
void main(){uv=texcoord;vec2 size=vec2(3840.,2400.);vec2 p=position*size*max(viewport.x/size.x,viewport.y/size.y)/viewport;gl_Position=vec4(p.x,-p.y,0.,1.);}`;
const FRAGMENT = `#version 300 es
precision highp float;in vec2 uv;out vec4 color;
uniform sampler2D backgroundImage;uniform sampler2D foregroundImage;uniform sampler2D poseImage;
uniform sampler2D blinkImage;uniform sampler2D halfImage;uniform sampler2D mouthImage;
uniform vec4 face;uniform vec4 eye0;uniform vec4 eye1;uniform vec2 eyeAngles;uniform vec4 lips;
uniform float lipAngle;uniform float blink;uniform float mouth;uniform float opacity;uniform float hasHalf;uniform float hasMouth;uniform vec2 gaze;
uniform float pixelEffect;
float region(vec2 p,vec4 box,float angle){vec2 d=p-box.xy;float c=cos(angle),s=sin(angle);vec2 q=vec2(c*d.x+s*d.y,-s*d.x+c*d.y)/box.zw;return 1.-smoothstep(.55,1.,dot(q,q));}
float cellNoise(vec2 cell){return fract(sin(dot(cell,vec2(127.1,311.7))+19.19)*43758.5453);}
void main(){
 vec2 sourceUV=uv;
 float coverage=opacity,gridGlow=0.;
 if(pixelEffect>.5 && opacity<1.){
   // Match the selected 1280x800 audition at any window size. Only the intact
   // character texture is pixelated; room and foreground use their original UV.
   vec2 point=uv*vec2(1280.,800.);
   float block=1.+pow(1.-opacity,.75)*28.;
   vec2 samples=max(vec2(1.),floor(vec2(1280.,800.)/block+.5));
   sourceUV=(floor(uv*samples)+.5)/samples;
   coverage=clamp((opacity-cellNoise(floor(point/22.))*.72)/.28,0.,1.);
   vec2 edge=min(mod(point,22.),22.-mod(point,22.));
   gridGlow=sin(3.14159265*coverage)*(1.-smoothstep(.7,1.7,min(edge.x,edge.y)))*.7;
 }
 vec2 world=sourceUV*vec2(1586.,992.),f=(world-face.xy)/face.zw*512.;
 float eyes=max(region(f,eye0,eyeAngles.x),region(f,eye1,eyeAngles.y));
 vec4 iris0=vec4(eye0.xy,eye0.zw*.52),iris1=vec4(eye1.xy,eye1.zw*.52);
 float iris=max(region(f,iris0,eyeAngles.x),region(f,iris1,eyeAngles.y));
 vec4 person=texture(poseImage,(world-gaze*iris*(1.-blink))/vec2(1586.,992.));
 vec2 local=clamp(f/512.,0.,1.);
 if(blink>(hasHalf>.5?.16:.42)){
   vec3 lids=(hasHalf>.5&&blink<.72)?texture(halfImage,local).rgb:texture(blinkImage,local).rgb;
   person.rgb=mix(person.rgb,lids,eyes);
 }
 if(hasMouth>.5 && mouth>.03){
   float opening=mix(.35,1.,mouth),c=cos(lipAngle),s=sin(lipAngle);
   vec4 lipBox=vec4(lips.xy,lips.z,lips.w*opening);
   float area=region(f,lipBox,lipAngle);vec2 d=f-lips.xy,q=vec2(c*d.x+s*d.y,-s*d.x+c*d.y);q.y/=opening;
   vec2 sampleP=vec2(c*q.x-s*q.y,s*q.x+c*q.y)+lips.xy;
   person.rgb=mix(person.rgb,texture(mouthImage,clamp(sampleP/512.,0.,1.)).rgb,area*smoothstep(.03,.12,mouth));
 }
 // Facial patches and props share the same pixel mask. At both endpoints this
 // branch leaves the original artwork and empty-room pixels unchanged.
 person.rgb=1.-(1.-person.rgb)*(1.-vec3(.35,.98,1.)*gridGlow);
 vec3 scene=mix(texture(backgroundImage,uv).rgb,person.rgb,person.a*coverage);
 vec4 foreground=texture(foregroundImage,uv);color=vec4(mix(scene,foreground.rgb,foreground.a),1.);
}`;

export class PosePlayer {
  constructor(canvas, { lost = () => {} } = {}) {
    this.canvas = canvas;
    this.textures = new Map();
    this.closed = false;
    this.ready = false;
    const gl = (this.gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    }));
    if (!gl) throw Error('当前绘图环境不支持动态角色。');
    this.onLost = (event) => {
      event.preventDefault();
      this.contextLost = true;
      if (!this.closed) lost();
    };
    canvas.addEventListener('webglcontextlost', this.onLost);
    const shaders = [];
    try {
      this.program = gl.createProgram();
      for (const [type, source] of [
        [gl.VERTEX_SHADER, VERTEX],
        [gl.FRAGMENT_SHADER, FRAGMENT],
      ]) {
        const shader = gl.createShader(type);
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw Error('人物绘图编译失败：' + gl.getShaderInfoLog(shader));
        gl.attachShader(this.program, shader);
      }
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw Error('人物绘图连接失败。');
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1]),
        gl.STATIC_DRAW,
      );
      for (const [i, name] of ['position', 'texcoord'].entries()) {
        const a = gl.getAttribLocation(this.program, name);
        gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 16, i * 8);
      }
      this.u = Object.fromEntries(
        [
          'viewport',
          'backgroundImage',
          'foregroundImage',
          'poseImage',
          'blinkImage',
          'halfImage',
          'mouthImage',
          'face',
          'eye0',
          'eye1',
          'eyeAngles',
          'lips',
          'lipAngle',
          'blink',
          'mouth',
          'opacity',
          'pixelEffect',
          'hasHalf',
          'hasMouth',
          'gaze',
        ].map((key) => [key, gl.getUniformLocation(this.program, key)]),
      );
    } catch (error) {
      this.dispose();
      throw error;
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
  }
  async load(root, signal) {
    const response = await fetch(root + 'poses.json', { signal });
    if (!response.ok) throw Error('人物姿态配置未能载入。');
    this.config = validatePoses(await response.json());
    const files = [
      'background',
      'foreground',
      ...POSE_IDS.flatMap((id) => [id, id + '-blink']),
      'attention-halfBlink',
      'attention-mouth',
    ];
    const outcomes = await Promise.allSettled(
      files.map(async (file) => {
        const r = await fetch(root + file + '.png', { signal });
        if (!r.ok) throw Error('人物素材未能载入：' + file);
        return createImageBitmap(await r.blob(), { premultiplyAlpha: 'none' });
      }),
    );
    try {
      const failed = outcomes.find((r) => r.status === 'rejected');
      if (failed) throw failed.reason;
      if (this.closed || this.contextLost || signal?.aborted) throw Error('人物素材准备已取消。');
      const gl = this.gl;
      for (let i = 0; i < files.length; i++) {
        const file = files[i],
          bitmap = outcomes[i].value,
          size = file.includes('-') ? [512, 512] : POSE_SIZE;
        if (bitmap.width !== size[0] || bitmap.height !== size[1]) throw Error('人物素材尺寸无效：' + file);
        const texture = gl.createTexture();
        this.textures.set(file, texture);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      }
      if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) throw Error('人物贴图准备失败。');
      this.ready = true;
    } finally {
      for (const result of outcomes) if (result.status === 'fulfilled') result.value.close();
    }
  }
  render(state = {}) {
    if (!this.ready || this.closed || this.contextLost) return;
    this.state = state;
    const frame = state.frame || { pose: 'attention', opacity: 1 };
    const pose = this.config.poses.find((p) => p.id === frame.pose);
    if (!pose) throw Error('未知人物姿态。');
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    const files = [
      'background',
      'foreground',
      pose.id,
      pose.id + '-blink',
      pose.id === 'attention' ? 'attention-halfBlink' : pose.id + '-blink',
      'attention-mouth',
    ];
    for (const [i, name] of [
      'backgroundImage',
      'foregroundImage',
      'poseImage',
      'blinkImage',
      'halfImage',
      'mouthImage',
    ].entries()) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.textures.get(files[i]));
      gl.uniform1i(this.u[name], i);
    }
    gl.uniform2f(this.u.viewport, this.canvas.width, this.canvas.height);
    gl.uniform4fv(this.u.face, pose.face);
    gl.uniform4fv(this.u.eye0, pose.eyes[0].slice(0, 4));
    gl.uniform4fv(this.u.eye1, pose.eyes[1].slice(0, 4));
    gl.uniform2f(this.u.eyeAngles, pose.eyes[0][4], pose.eyes[1][4]);
    gl.uniform4fv(this.u.lips, pose.mouth?.slice(0, 4) || [0, 0, 1, 1]);
    gl.uniform1f(this.u.lipAngle, pose.mouth?.[4] || 0);
    const bounded = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
    gl.uniform1f(this.u.blink, bounded(state.blink));
    gl.uniform1f(this.u.mouth, bounded(state.mouth));
    gl.uniform1f(this.u.opacity, bounded(frame.opacity));
    gl.uniform1f(this.u.pixelEffect, frame.effect === 'pixels' ? 1 : 0);
    gl.uniform1f(this.u.hasHalf, pose.id === 'attention' ? 1 : 0);
    gl.uniform1f(this.u.hasMouth, pose.mouth ? 1 : 0);
    const gaze = (state.gaze || [0, 0]).map((x) => Math.max(-2, Math.min(2, Number.isFinite(x) ? x : 0)));
    gl.uniform2fv(this.u.gaze, gaze);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  resize(width, height, density = window.devicePixelRatio || 1) {
    const d = Math.min(2, density),
      w = Math.max(1, Math.round(width * d)),
      h = Math.max(1, Math.round(height * d));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (this.state) this.render(this.state);
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    const gl = this.gl;
    if (!gl) return;
    for (const texture of this.textures.values()) gl.deleteTexture(texture);
    this.textures.clear();
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
