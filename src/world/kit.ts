import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  attribute,
  cameraNear,
  cameraFar,
  cameraPosition,
  cameraViewMatrix,
  clamp,
  color,
  cos,
  densityFogFactor,
  dot,
  exponentialHeightFogFactor,
  float,
  fog,
  fract,
  hash,
  instanceIndex,
  max,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalize,
  perspectiveDepthToViewZ,
  positionLocal,
  positionView,
  positionWorld,
  pow,
  screenUV,
  sin,
  smoothstep,
  time,
  transformNormalByViewMatrix,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  viewportDepthTexture,
  viewportSafeUV,
  viewportSharedTexture,
} from 'three/tsl';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { QualityPreset } from '../render/quality';

type C = THREE.ColorRepresentation;

// ───────────────────────── materials ─────────────────────────

/** Plain PBR node material helper. */
export function mat(col: C, rough = 0.8, metal = 0, opts: { emissive?: C; emissiveIntensity?: number; side?: THREE.Side; flat?: boolean; vertexColors?: boolean } = {}): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(col), roughness: rough, metalness: metal });
  if (opts.emissive !== undefined) {
    m.emissive = new THREE.Color(opts.emissive);
    m.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }
  if (opts.side !== undefined) m.side = opts.side;
  if (opts.flat) m.flatShading = true;
  if (opts.vertexColors) m.vertexColors = true;
  return m;
}

/** Unlit glowing material (neon, lanterns, crystals) – drives bloom. */
export function glowMat(col: C, intensity = 3, opacity = 1): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(col).multiplyScalar(intensity) });
  if (opacity < 1) {
    m.transparent = true;
    m.opacity = opacity;
    m.depthWrite = false;
  }
  return m;
}

/** Welds a geometry (removes uv/normal seams) so displacement does not tear it. */
export function weld(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const w = mergeVertices(g, 1e-4);
  w.computeVertexNormals();
  return w;
}

/** Organic rock / boulder: welded icosphere with layered displacement. */
export function rockGeometry(radius: number, seed = 1, detail = 2, squash = 0.7): THREE.BufferGeometry {
  const g = weld(new THREE.IcosahedronGeometry(radius, detail));
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n =
      Math.sin(v.x * 2.1 / radius + seed * 3.1) * 0.12 +
      Math.sin(v.y * 3.3 / radius + seed * 1.7) * 0.08 +
      Math.sin((v.z + v.x) * 5.1 / radius + seed) * 0.05;
    v.multiplyScalar(1 + n);
    v.y *= v.y > 0 ? squash : 0.45;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// ───────────────────────── sky ─────────────────────────

export interface SkyOptions {
  zenith: C;
  horizon: C;
  ground?: C;
  sunDir?: THREE.Vector3;
  sunColor?: C;
  /** Angular radius of the sun disc in radians. */
  sunSize?: number;
  /** Intensity multiplier of the sun glow halo. */
  sunGlow?: number;
  /** 0..1 star density (night skies). */
  stars?: number;
  clouds?: { color: C; shadow?: C; coverage: number; speed: number; scale?: number; opacity?: number };
  horizonGlow?: { color: C; strength: number; height?: number };
  /** Horizon line sharpness exponent (default 0.5). */
  curve?: number;
}

/** Procedural sky dome that follows the camera. Add the returned mesh to the scene. */
export function createSkyDome(o: SkyOptions): THREE.Mesh {
  const geo = new THREE.SphereGeometry(900, 48, 24);
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  m.fog = false;
  const dir = normalize(positionLocal);
  const up = dir.y;
  const zen = color(new THREE.Color(o.zenith));
  const hor = color(new THREE.Color(o.horizon));
  const gnd = color(new THREE.Color(o.ground ?? o.horizon));
  let col = mix(hor, zen, pow(clamp(up, 0, 1), o.curve ?? 0.5));
  col = mix(col, gnd, smoothstep(0.0, -0.18, up));
  if (o.horizonGlow) {
    const hg = pow(float(1).sub(abs(up)), float(1 / Math.max(0.05, o.horizonGlow.height ?? 0.15)));
    col = col.add(color(new THREE.Color(o.horizonGlow.color)).mul(hg.mul(o.horizonGlow.strength)));
  }
  if (o.sunDir) {
    const sd = vec3(o.sunDir.x, o.sunDir.y, o.sunDir.z).normalize();
    const cosA = dot(dir, sd).max(0);
    const size = o.sunSize ?? 0.03;
    const disc = smoothstep(Math.cos(size), Math.cos(size * 0.7), cosA);
    const glow = pow(cosA, 12).mul(0.6).add(pow(cosA, 180).mul(1.5)).mul(o.sunGlow ?? 1);
    const sc = color(new THREE.Color(o.sunColor ?? '#fff2d6'));
    col = col.add(sc.mul(glow)).add(sc.mul(disc.mul(18)));
  }
  if (o.clouds) {
    const cl = o.clouds;
    const pUV = dir.xz.div(up.max(0.04).add(0.12)).mul(cl.scale ?? 0.9);
    const n = mx_fractal_noise_float(vec3(pUV.x.add(time.mul(cl.speed)), pUV.y, time.mul(cl.speed * 0.3)), 4, 2.0, 0.5, 1.0);
    const cover = smoothstep(1 - cl.coverage - 0.15, 1 - cl.coverage + 0.35, n.mul(0.5).add(0.5)).mul(smoothstep(0.0, 0.18, up));
    const cc = mix(color(new THREE.Color(cl.shadow ?? cl.color)), color(new THREE.Color(cl.color)), smoothstep(0.3, 0.9, n.mul(0.5).add(0.5)));
    col = mix(col, cc, cover.mul(cl.opacity ?? 0.9));
  }
  if (o.stars) {
    const cell = dir.mul(260).floor();
    const h = hash(cell.x.add(cell.y.mul(157)).add(cell.z.mul(113)));
    const tw = sin(time.mul(2.3).add(h.mul(40))).mul(0.35).add(0.65);
    const star = smoothstep(1 - o.stars * 0.012, 1, h).mul(tw).mul(smoothstep(0.02, 0.25, up)).mul(3);
    col = col.add(vec3(star, star, star.mul(1.1)));
  }
  m.colorNode = col;
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.onBeforeRender = (_r, _s, cam) => {
    mesh.position.copy(cam.position);
    mesh.updateMatrixWorld();
  };
  return mesh;
}

/** Bakes the sky into a PMREM environment map (image-based lighting for all PBR materials). */
export function applyEnvironment(renderer: THREE.WebGPURenderer, scene: THREE.Scene, sky: THREE.Mesh, intensity = 1): () => void {
  const envScene = new THREE.Scene();
  const dome = new THREE.Mesh(sky.geometry, sky.material);
  dome.frustumCulled = false;
  envScene.add(dome);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.02, 0.1, 1000);
  scene.environment = rt.texture;
  scene.environmentIntensity = intensity;
  pmrem.dispose();
  return () => rt.dispose();
}

// ───────────────────────── fog ─────────────────────────

/** Distance fog + optional ground-hugging height fog (mist over water). */
export function setupFog(scene: THREE.Scene, o: { color: C; density: number; heightDensity?: number; height?: number }): void {
  const c = color(new THREE.Color(o.color));
  const dist = densityFogFactor(float(o.density));
  if (o.heightDensity && o.height !== undefined) {
    const hf = exponentialHeightFogFactor(float(o.heightDensity), float(o.height));
    scene.fogNode = fog(c, max(dist, hf as ReturnType<typeof float>));
  } else {
    scene.fogNode = fog(c, dist);
  }
  scene.background = new THREE.Color(o.color);
}

// ───────────────────────── lights ─────────────────────────

export interface LightRigOptions {
  hemiSky: C;
  hemiGround: C;
  hemiIntensity: number;
  sunColor: C;
  sunIntensity: number;
  /** Direction the light comes FROM (normalised internally). */
  sunDir: THREE.Vector3;
  /** Half extent (m) of the shadow frustum around `shadowCenter`. */
  shadowArea: number;
  shadowCenter?: THREE.Vector3;
  fillColor?: C;
  fillIntensity?: number;
  fillDir?: THREE.Vector3;
  rimColor?: C;
  rimIntensity?: number;
  rimDir?: THREE.Vector3;
  quality: QualityPreset;
}

export function createLightRig(scene: THREE.Scene, o: LightRigOptions): { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; fill?: THREE.DirectionalLight; rim?: THREE.DirectionalLight } {
  const hemi = new THREE.HemisphereLight(new THREE.Color(o.hemiSky), new THREE.Color(o.hemiGround), o.hemiIntensity);
  scene.add(hemi);
  const center = o.shadowCenter ?? new THREE.Vector3();
  const sun = new THREE.DirectionalLight(new THREE.Color(o.sunColor), o.sunIntensity);
  const d = o.sunDir.clone().normalize();
  sun.position.copy(center).addScaledVector(d, 60);
  sun.target.position.copy(center);
  scene.add(sun, sun.target);
  if (o.quality.shadows) {
    sun.castShadow = true;
    const s = sun.shadow;
    s.mapSize.set(o.quality.shadowMapSize, o.quality.shadowMapSize);
    const cam = s.camera as THREE.OrthographicCamera;
    cam.left = -o.shadowArea;
    cam.right = o.shadowArea;
    cam.top = o.shadowArea;
    cam.bottom = -o.shadowArea;
    cam.near = 1;
    cam.far = 160;
    s.bias = -0.0006;
    s.normalBias = 0.03;
    s.radius = o.quality.softShadows ? 3 : 1;
  }
  let fill: THREE.DirectionalLight | undefined;
  if (o.fillColor && o.fillIntensity) {
    fill = new THREE.DirectionalLight(new THREE.Color(o.fillColor), o.fillIntensity);
    fill.position.copy(o.fillDir ?? new THREE.Vector3(-d.x, 0.6, -d.z)).multiplyScalar(50);
    scene.add(fill);
  }
  let rim: THREE.DirectionalLight | undefined;
  if (o.rimColor && o.rimIntensity) {
    rim = new THREE.DirectionalLight(new THREE.Color(o.rimColor), o.rimIntensity);
    rim.position.copy(o.rimDir ?? new THREE.Vector3(-d.x * 0.3, 0.4, -1)).multiplyScalar(50);
    scene.add(rim);
  }
  return { sun, hemi, fill, rim };
}

// ───────────────────────── water ─────────────────────────

export interface WaterOptions {
  /** Size along X and Z (the plane lies in XZ, centred on `position`). */
  width: number;
  length: number;
  position?: THREE.Vector3;
  rotationY?: number;
  shallow: C;
  deep: C;
  foam?: C;
  /** Colour reflected at grazing angles. */
  sky?: C;
  /** Flow direction × speed (world XZ). */
  flow?: [number, number];
  waveAmp?: number;
  waveLen?: number;
  roughness?: number;
  /** Metres until the deep colour is reached. */
  depthFade?: number;
  /** Foam band width at intersections (m). */
  foamWidth?: number;
  refraction?: number;
  normalStrength?: number;
  minOpacity?: number;
  /** Extra emissive tint (e.g. neon canal glow, lava, aurora reflections). */
  glow?: C;
  glowStrength?: number;
  quality: QualityPreset;
}

/**
 * Stylised physically-inspired water (TSL): vertex waves, noise normals following the flow,
 * depth colour & intersection foam (MEDIUM+), screen-space refraction (HIGH+), fresnel sky tint.
 */
export function createWater(o: WaterOptions): THREE.Mesh {
  const tier: 'low' | 'mid' | 'high' = o.quality.water === 0 ? 'low' : o.quality.water === 1 ? 'mid' : 'high';
  const segX = Math.max(8, Math.round(o.width * (tier === 'low' ? 1 : 2)));
  const segZ = Math.max(8, Math.round(o.length * (tier === 'low' ? 1 : 2)));
  const geo = new THREE.PlaneGeometry(o.width, o.length, Math.min(segX, 220), Math.min(segZ, 220));
  geo.rotateX(-Math.PI / 2);
  // distance-to-edge attribute (0 at the long edges → shore foam on LOW)
  const pos = geo.getAttribute('position');
  const shore = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const dx = o.width / 2 - Math.abs(x);
    const dz = o.length / 2 - Math.abs(z);
    shore[i] = Math.min(1, Math.min(dx, dz) / 3);
  }
  geo.setAttribute('shore', new THREE.BufferAttribute(shore, 1));

  const waveAmp = o.waveAmp ?? 0.05;
  const waveLen = o.waveLen ?? 3.5;
  const flow = vec2(...(o.flow ?? [0.25, 0]));
  const k1 = (2 * Math.PI) / waveLen;
  const k2 = k1 / 0.63;
  const m = new THREE.MeshStandardNodeMaterial({ transparent: tier !== 'low', roughness: o.roughness ?? 0.08, metalness: 0 });
  m.depthWrite = tier === 'low';
  m.positionNode = Fn(() => {
    const p = positionLocal.toVar();
    p.y.addAssign(
      sin(p.x.mul(k1).add(time.mul(1.1)))
        .mul(waveAmp)
        .add(sin(p.x.mul(k2 * 0.7).add(p.z.mul(k2)).sub(time.mul(1.7))).mul(waveAmp * 0.5)),
    );
    return p;
  })();
  const shoreV = varying(attribute('shore', 'float'));
  const P = positionWorld.xz;
  // gradient noise on every tier (sine-only normals produce visible corrugation at distance)
  const n1 = mx_noise_float(P.mul(0.9).sub(flow.mul(time)));
  const n2 = mx_noise_float(P.mul(1.7).sub(flow.mul(time.mul(1.4))).add(17));
  // fade normal detail with distance to avoid aliasing shimmer far away
  const distFade = smoothstep(90, 12, cameraPosition.sub(positionWorld).length());
  const ns = float(o.normalStrength ?? 0.35).mul(distFade.mul(0.8).add(0.2));
  const nW = normalize(vec3(n1.mul(ns), 1, n2.mul(ns)));
  m.normalNode = transformNormalByViewMatrix(nW, cameraViewMatrix);
  const fres = pow(float(1).sub(max(dot(nW, normalize(cameraPosition.sub(positionWorld))), 0)), 5).mul(0.98).add(0.02);
  const shallow = color(new THREE.Color(o.shallow));
  const deep = color(new THREE.Color(o.deep));
  const foamCol = color(new THREE.Color(o.foam ?? '#f2f6f4'));
  const skyCol = color(new THREE.Color(o.sky ?? '#bcd6e6'));
  const foamWidthNorm = 0.35;
  let depth01;
  let foamMask;
  if (tier === 'low') {
    depth01 = shoreV;
    foamMask = smoothstep(foamWidthNorm, 0, shoreV);
  } else {
    const d = positionView.z.sub(perspectiveDepthToViewZ(viewportDepthTexture(), cameraNear, cameraFar)).max(0);
    depth01 = d.div(o.depthFade ?? 2.5).clamp(0, 1);
    foamMask = smoothstep(o.foamWidth ?? 0.35, 0, d).max(smoothstep(foamWidthNorm, 0, shoreV).mul(0.4));
  }
  const foam = foamMask.mul(smoothstep(-0.1, 0.5, n1.add(n2.mul(0.5)))).clamp(0, 1);
  let body = mix(shallow, deep, depth01);
  if (tier === 'high') {
    const behind = viewportSharedTexture(viewportSafeUV(screenUV.add(vec2(n1, n2).mul(o.refraction ?? 0.02)))).rgb;
    body = mix(behind.mul(shallow), deep, depth01);
  }
  m.colorNode = mix(body, foamCol, foam);
  let emissive = skyCol.mul(fres).mul(tier === 'low' ? 0.6 : 0.25);
  if (o.glow) emissive = emissive.add(color(new THREE.Color(o.glow)).mul(o.glowStrength ?? 0.5).mul(n1.mul(0.5).add(0.75)));
  m.emissiveNode = emissive;
  m.roughnessNode = float(o.roughness ?? 0.08).add(foam.mul(0.6));
  if (tier !== 'low') m.opacityNode = mix(float(o.minOpacity ?? 0.55), float(1), depth01.max(foam));
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = 'water';
  mesh.receiveShadow = true;
  if (o.position) mesh.position.copy(o.position);
  if (o.rotationY) mesh.rotation.y = o.rotationY;
  return mesh;
}

// ───────────────────────── particles ─────────────────────────

export interface ParticleOptions {
  count: number;
  min: [number, number, number];
  max: [number, number, number];
  color: C;
  /** Second colour: each particle picks a random mix between color and color2. */
  color2?: C;
  size: number;
  /** float = drift in place, fall = rain/snow/leaves, rise = embers/bubbles. */
  motion: 'float' | 'fall' | 'rise';
  speed: number;
  /** Horizontal drift (wind) in m/s. */
  wind?: [number, number];
  additive?: boolean;
  opacity?: number;
  /** Blink/pulse amount 0..1 (fireflies). */
  twinkle?: number;
  /** Stretch along the fall direction (rain streaks). */
  stretch?: number;
  quality: QualityPreset;
}

/**
 * GPU particles without compute shaders: one instanced sprite draw call, every particle's
 * position is an analytic function of its index and time (works on WebGPU and WebGL2).
 */
export function createParticles(o: ParticleOptions): THREE.Sprite {
  const count = Math.max(1, Math.round(o.count * o.quality.particles));
  const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  if (o.additive !== false) m.blending = THREE.AdditiveBlending;
  const i = instanceIndex.toFloat();
  const r1 = hash(i.add(1.3));
  const r2 = hash(i.add(7.7));
  const r3 = hash(i.add(13.1));
  const r4 = hash(i.add(21.9));
  const mn = vec3(...o.min);
  const size3 = vec3(o.max[0] - o.min[0], o.max[1] - o.min[1], o.max[2] - o.min[2]);
  const speed = float(o.speed);
  const wind = vec2(...(o.wind ?? [0, 0]));
  const t = time.add(r4.mul(100));
  let p;
  if (o.motion === 'float') {
    const base = mn.add(vec3(r1, r2, r3).mul(size3));
    p = base.add(vec3(sin(t.mul(speed).mul(0.7).add(r1.mul(6.28))), sin(t.mul(speed).mul(0.9).add(r2.mul(6.28))).mul(0.5), cos(t.mul(speed).mul(0.6).add(r3.mul(6.28)))).mul(0.6));
  } else {
    const dirSign = o.motion === 'fall' ? -1 : 1;
    const phase = fract(t.mul(speed).div(size3.y).mul(r4.mul(0.4).add(0.8)).add(r2));
    const y = o.motion === 'fall' ? float(1).sub(phase) : phase;
    const wx = fract(r1.add(wind.x.mul(t).div(size3.x)));
    const wz = fract(r3.add(wind.y.mul(t).div(size3.z)));
    p = mn.add(vec3(wx, y, wz).mul(size3)).add(vec3(sin(t.mul(1.3).add(r1.mul(9))).mul(0.15), 0, cos(t.mul(1.1).add(r3.mul(9))).mul(0.15)));
    void dirSign;
  }
  m.positionNode = p;
  const tw = o.twinkle ? sin(t.mul(3).add(r1.mul(30))).mul(0.5).add(0.5).mul(o.twinkle).add(1 - o.twinkle) : float(1);
  const sz = float(o.size).mul(r2.mul(0.6).add(0.7));
  m.scaleNode = o.stretch ? vec2(sz, sz.mul(o.stretch)) : vec2(sz, sz);
  const d = uv().sub(0.5).length();
  const soft = smoothstep(0.5, 0.0, d);
  const c1 = color(new THREE.Color(o.color));
  const col = o.color2 ? mix(c1, color(new THREE.Color(o.color2)), r3) : c1;
  m.colorNode = col;
  m.opacityNode = soft.mul(tw).mul(o.opacity ?? 1);
  const sprite = new THREE.Sprite(m);
  sprite.count = count;
  sprite.frustumCulled = false;
  sprite.name = `particles:${o.motion}`;
  return sprite;
}

// ───────────────────────── misc helpers ─────────────────────────

/** Soft fake light shaft (cone) – cheap volumetric impression. */
export function lightShaft(col: C, length: number, radiusTop: number, radiusBottom: number, strength = 0.35): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 24, 1, true);
  geo.translate(0, -length / 2, 0);
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.blending = THREE.AdditiveBlending;
  m.fog = false;
  const v = uv();
  const edge = smoothstep(0.0, 0.35, v.x).mul(smoothstep(1.0, 0.65, v.x));
  const fade = smoothstep(0.0, 0.6, v.y);
  const flick = mx_noise_float(vec3(v.x.mul(8), v.y.mul(2), time.mul(0.3))).mul(0.25).add(0.75);
  m.colorNode = color(new THREE.Color(col));
  m.opacityNode = edge.mul(fade).mul(flick).mul(strength);
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = 'lightShaft';
  return mesh;
}

/** Scatter helper: deterministic pseudo-random generator. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wind sway for vegetation: returns a positionNode displacing vertices by height (local y). */
export function windSway(strength = 0.08, speed = 1.3, heightScale = 1): ReturnType<typeof Fn> {
  return Fn(() => {
    const p = positionLocal.toVar();
    const h = p.y.mul(heightScale).max(0);
    const w = sin(time.mul(speed).add(positionWorld.x.mul(0.35)).add(positionWorld.z.mul(0.27)));
    p.x.addAssign(w.mul(strength).mul(h.mul(h)));
    p.z.addAssign(cos(time.mul(speed * 0.8).add(positionWorld.x.mul(0.21))).mul(strength * 0.5).mul(h.mul(h)));
    return p;
  });
}

/** Uniform time value that worlds can drive themselves if needed. */
export const worldTime = uniform(0);
