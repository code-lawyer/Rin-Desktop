import { rigPose } from './action-motion.mjs';
import { buildBodyMesh, bodyPoint, spinePoint, headDisplacement } from './rig-warp.mjs';
import { validateRig, textureLayers } from './action-assets.mjs';
const W = 1586,
  H = 992;
const SIMPLE_VERTEX = `#version 300 es
in vec2 position;in vec2 texcoord;out vec2 uv;
void main(){uv=texcoord;gl_Position=vec4(position,0.,1.);}`;
const SIMPLE_FRAGMENT = `#version 300 es
precision highp float;in vec2 uv;out vec4 color;uniform sampler2D image;uniform float opacity;
void main(){color=texture(image,uv);color.a*=opacity;}`;
const BODY_VERTEX = `#version 300 es
in vec2 source;in vec2 target;out vec2 frontUV;
uniform vec2 viewport;uniform float yaw;uniform float pitch;uniform float roll;uniform float spine;uniform float breath;uniform float hair;uniform float time;
float ease(float x){x=clamp(x,0.,1.);return x*x*(3.-2.*x);}
vec2 rotateAt(vec2 p,vec2 origin,float angle){float c=cos(angle),s=sin(angle);vec2 d=p-origin;return origin+vec2(c*d.x-s*d.y,s*d.x+c*d.y);}
void main(){
 frontUV=source;vec2 original=source*vec2(1586.,992.),p=original+(target-source)*vec2(1586.,992.)*yaw;
 float head=1.-ease((original.y-290.)/82.),radius=pow((original.x-1180.)/130.,2.)+pow((original.y-220.)/165.,2.),z=max(0.,1.-radius)*32.;
 p.y+=(sin(pitch)*30.+(1.-cos(pitch))*(326.-original.y)+sin(pitch)*z)*head;p=rotateAt(p,vec2(1195.,326.),roll*head);
 p.x+=sin(time*1.13+(original.y-280.)*.008)*hair*ease((original.y-250.)/90.)*(abs(original.x-1190.)>115.?1.:0.);p.y-=breath*(1.-ease((original.y-490.)/120.));
 p=rotateAt(p,vec2(1195.,585.),spine*(1.-ease((p.y-520.)/100.)));
 float scale=max(viewport.x/3840.,viewport.y/2400.);vec2 screen=p/vec2(1586.,992.)*vec2(3840.,2400.)*scale+(viewport-vec2(3840.,2400.)*scale)*.5;
 gl_Position=vec4(screen.x/viewport.x*2.-1.,1.-screen.y/viewport.y*2.,0.,1.);
}`;
const BODY_FRAGMENT = `#version 300 es
precision highp float;in vec2 frontUV;out vec4 color;
uniform sampler2D frontImage;uniform sampler2D blinkImage;uniform sampler2D halfBlinkImage;uniform sampler2D mouthImage;
uniform float blink;uniform float mouth;uniform float hairPass;uniform vec2 gaze;
float region(vec2 p,vec2 center,vec2 radius,float angle){vec2 d=p-center;float c=cos(angle),s=sin(angle);vec2 q=vec2(c*d.x+s*d.y,-s*d.x+c*d.y)/radius;return 1.-smoothstep(.55,1.,dot(q,q));}
vec4 expressions(vec2 p){
 vec2 f=(p-vec2(1030.6,124.))/vec2(211.47,211.63)*512.;
 float iris=max(region(f,vec2(275.,246.),vec2(40.,22.),-.25),region(f,vec2(426.,201.),vec2(41.,22.),-.25));
 vec4 base=texture(frontImage,(p-gaze*iris*(1.-blink))/vec2(1586.,992.));
 vec2 local=f/512.;float eyes=max(region(f,vec2(272.,246.),vec2(67.,38.),-.25),region(f,vec2(425.,200.),vec2(66.,36.),-.25));
 if(blink>.16){vec3 lids=blink>.72?texture(blinkImage,clamp(local,0.,1.)).rgb:texture(halfBlinkImage,clamp(local,0.,1.)).rgb;base.rgb=mix(base.rgb,lids,eyes);}
 float opening=mix(.35,1.,mouth),angle=-.25;vec2 center=vec2(378.,341.),radius=vec2(65.,37.*opening);
 float lips=region(f,center,radius,angle);vec2 md=f-center;float c=cos(angle),s=sin(angle);vec2 q=vec2(c*md.x+s*md.y,-s*md.x+c*md.y);q.y/=opening;vec2 sampleP=vec2(c*q.x-s*q.y,s*q.x+c*q.y)+center;
 vec3 spoken=texture(mouthImage,clamp(sampleP/512.,0.,1.)).rgb;
 base.rgb=mix(base.rgb,spoken,lips*smoothstep(.03,.12,mouth));return base;
}
void main(){color=expressions(frontUV*vec2(1586.,992.));if(hairPass>.5){vec2 p=frontUV*vec2(1586.,992.);float area=max(region(p,vec2(1062.,436.),vec2(65.,144.),.28),region(p,vec2(1270.,432.),vec2(50.,135.),-.1));color.a*=area*(1.-smoothstep(.035,.09,color.r-color.g));}}`;

export class ActionRig {
  constructor(canvas, { lost = () => {} } = {}) {
    this.canvas = canvas;
    this.closed = false;
    this.ready = false;
    this.textures = [];
    this.layers = {};
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
    try {
      this.simple = this.program(
        SIMPLE_VERTEX,
        SIMPLE_FRAGMENT,
        ['position', 'texcoord'],
        ['image', 'opacity']
      );
      this.body = this.program(
        BODY_VERTEX,
        BODY_FRAGMENT,
        ['source', 'target'],
        [
          'frontImage',
          'blinkImage',
          'halfBlinkImage',
          'mouthImage',
          'blink',
          'mouth',
          'hairPass',
          'gaze',
          'viewport',
          'yaw',
          'pitch',
          'roll',
          'spine',
          'breath',
          'hair',
          'time',
        ]
      );
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    } catch (e) {
      this.dispose();
      throw e;
    }
  }
  program(vertex, fragment, attributes, uniforms) {
    const gl = this.gl,
      shaders = [];
    let program, buffer, vao;
    try {
      for (const [type, source] of [
        [gl.VERTEX_SHADER, vertex],
        [gl.FRAGMENT_SHADER, fragment],
      ]) {
        const shader = gl.createShader(type);
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw Error('角色着色器编译失败：' + gl.getShaderInfoLog(shader));
      }
      program = gl.createProgram();
      for (const s of shaders) gl.attachShader(program, s);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('角色着色器连接失败。');
      buffer = gl.createBuffer();
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      attributes.forEach((name, i) => {
        const a = gl.getAttribLocation(program, name);
        gl.enableVertexAttribArray(a);
        gl.vertexAttribPointer(a, 2, gl.FLOAT, false, attributes.length * 8, i * 8);
      });
      return {
        program,
        buffer,
        vao,
        u: Object.fromEntries(uniforms.map((name) => [name, gl.getUniformLocation(program, name)])),
      };
    } catch (e) {
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      throw e;
    } finally {
      for (const s of shaders) gl.deleteShader(s);
    }
  }
  async load(root, signal) {
    const response = await fetch(root + 'rig.json', { signal });
    if (!response.ok) throw Error('角色动作配置未能载入。');
    const rig = await response.json();
    this.rig = validateRig(rig);
    this.bodyMesh = buildBodyMesh();
    const bodyData = new Float32Array(this.bodyMesh.length * 4);
    for (let i = 0; i < this.bodyMesh.length; i++) {
      const { p, d } = this.bodyMesh[i];
      bodyData.set([p[0] / W, p[1] / H, (p[0] + d[0]) / W, (p[1] + d[1]) / H], i * 4);
    }
    this.gl.bindVertexArray(this.body.vao);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.body.buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, bodyData, this.gl.STATIC_DRAW);
    const items = textureLayers(rig);
    const outcomes = await Promise.allSettled(
      items.map(async (layer) => {
        if (!/^[a-zA-Z]+$/.test(layer.name)) throw Error('角色素材名称无效。');
        const r = await fetch(root + layer.name + '.png', { signal });
        if (!r.ok) throw Error('角色素材未能载入：' + layer.name);
        return createImageBitmap(await r.blob(), { premultiplyAlpha: 'none' });
      })
    );
    try {
      const failed = outcomes.find((x) => x.status === 'rejected');
      if (failed) throw failed.reason;
      if (this.closed || this.contextLost || signal?.aborted) throw Error('角色准备已取消。');
      const gl = this.gl;
      for (let i = 0; i < items.length; i++) {
        const layer = items[i],
          bitmap = outcomes[i].value;
        if (bitmap.width !== layer.size[0] || bitmap.height !== layer.size[1])
          throw Error('角色素材尺寸无效：' + layer.name);
        const texture = gl.createTexture();
        this.textures.push(texture);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        this.layers[layer.name] = { ...layer, texture };
      }
      if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) throw Error('角色动作贴图准备失败。');
      this.ready = true;
    } finally {
      for (const x of outcomes) if (x.status === 'fulfilled') x.value.close();
    }
  }
  clip(p) {
    const scale = Math.max(this.canvas.width / 3840, this.canvas.height / 2400),
      x = (p[0] / W) * 3840 * scale + (this.canvas.width - 3840 * scale) / 2,
      y = (p[1] / H) * 2400 * scale + (this.canvas.height - 2400 * scale) / 2;
    return [(x / this.canvas.width) * 2 - 1, 1 - (y / this.canvas.height) * 2];
  }
  draw(name, bone = null, { opacity = 1, widthScale = 1, point = null } = {}) {
    if (opacity <= 0) return;
    const layer = this.layers[name];
    if (!layer) return;
    const gl = this.gl,
      p = this.simple;
    const transform = (x, y) => {
      let result = [x, y];
      if (bone) {
        const [a, b] = layer.bone,
          [c, d] = bone,
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          len = Math.hypot(dx, dy),
          ex = d[0] - c[0],
          ey = d[1] - c[1],
          target = Math.hypot(ex, ey);
        const along = ((x - a[0]) * dx + (y - a[1]) * dy) / (len * len),
          across = ((-(x - a[0]) * dy + (y - a[1]) * dx) / len) * widthScale;
        result = [c[0] + along * ex - (across * ey) / target, c[1] + along * ey + (across * ex) / target];
      }
      return point ? point(result) : result;
    };
    const [x, y, w, h] = layer.rect,
      vertices = [];
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [0, 1],
      [1, 0],
      [1, 1],
    ]) {
      const q = this.clip(transform(x + u * w, y + v * h));
      vertices.push(...q, u, v);
    }
    gl.useProgram(p.program);
    gl.bindVertexArray(p.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, p.buffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, layer.texture);
    gl.uniform1i(p.u.image, 0);
    gl.uniform1f(p.u.opacity, opacity);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  drawBody(state, hairPass = false) {
    const gl = this.gl,
      p = this.body;
    gl.useProgram(p.program);
    gl.bindVertexArray(p.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, p.buffer);
    for (const [i, [name, key]] of [
      ['bodyFront', 'frontImage'],
      ['blink', 'blinkImage'],
      ['halfBlink', 'halfBlinkImage'],
      ['mouth', 'mouthImage'],
    ].entries()) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.layers[name].texture);
      gl.uniform1i(p.u[key], i);
    }
    gl.uniform2f(p.u.viewport, this.canvas.width, this.canvas.height);
    for (const key of ['yaw', 'pitch', 'roll', 'spine', 'breath', 'hair', 'time'])
      gl.uniform1f(p.u[key], state[key]);
    gl.uniform2fv(p.u.gaze, state.gaze);
    gl.uniform1f(p.u.blink, state.blink);
    gl.uniform1f(p.u.mouth, state.mouth);
    gl.uniform1f(p.u.hairPass, hairPass ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, this.bodyMesh.length);
  }
  render(input = {}) {
    if (!this.ready || this.closed || this.contextLost) return;
    this.state = input;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const state = rigPose(input.frame || { pose: input.pose || 'attention', amount: 1 }, input);
    state.gaze = (input.gaze || [0, 0]).map((v) => v * 0.413);
    this.rigState = state;
    const s = state,
      near = s.near.map((p, i) =>
        s.pose === 'cup' && i > 0 ? p : s.pose === 'work' && i > 1 ? p : spinePoint(p, s)
      ),
      far = s.far.map((p, i) => (s.pose === 'work' && i > 1 ? p : spinePoint(p, s)));
    if (s.nearHand === 'chinHand') {
      const contact = [1217, 284],
        moved = bodyPoint(contact, s, headDisplacement(contact)),
        delta = [moved[0] - contact[0], moved[1] - contact[1]];
      for (const i of [2, 3]) near[i] = [s.near[i][0] + delta[0], s.near[i][1] + delta[1]];
    }
    this.draw('base');
    this.drawBody(s);
    this.draw('farUpper', [far[0], far[1]]);
    this.draw('upper', [near[0], near[1]]);
    this.drawBody(s, true);
    this.draw('waveFore', [far[1], far[2]], { widthScale: 0.86 });
    this.draw(s.farHand, [far[2], far[3]], { widthScale: s.pose === 'work' ? s.handTurn : 1 });
    this.draw(s.nearFore, [near[1], near[2]]);
    const cupPosition = s.cupHeld ? s.cupPosition : [1537, 718];
    this.draw('cup', null, {
      point: (p) => [
        (p[0] - 1537) * (1 - s.cupLift * 0.18) + cupPosition[0],
        (p[1] - 718) * (1 - s.cupLift * 0.1) + cupPosition[1],
      ],
    });
    this.draw(s.nearHand, [near[2], near[3]], { widthScale: s.handTurn });
    this.draw('foreground');
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
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    const gl = this.gl;
    for (const t of this.textures) gl?.deleteTexture(t);
    for (const p of [this.simple, this.body])
      if (p) {
        gl?.deleteBuffer(p.buffer);
        gl?.deleteVertexArray(p.vao);
        gl?.deleteProgram(p.program);
      }
    this.textures = [];
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
