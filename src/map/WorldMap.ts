import * as THREE from 'three/webgpu';
import { attribute, fract, positionLocal, smoothstep, sin, time, uv, vec3 } from 'three/tsl';
import { applyEnvironment, createLightRig, createParticles, createSkyDome, createWater, glowMat, mat, rng, setupFog } from '../world/kit';
import type { QualityPreset } from '../render/quality';
import type { WorldLook } from '../render/PostFX';
import type { CameraKeyframe, CameraLimits, CameraView } from '../camera/CameraRig';
import { TOP, makeMaterials, ringMaterial, starGeo, type IslandMats } from './mapKit';
import { ISLAND_BUILDERS, type IslandBuild } from './islands';

export interface MapNodeInfo {
  id: string;
  name: string;
  unlocked: boolean;
  completed: boolean;
  stars: number;
}

interface Layout {
  pos: [number, number, number];
  radius: number;
}

const LAYOUT: Record<string, Layout> = {
  forest: { pos: [-20.5, 0, 6.5], radius: 4.4 },
  temple: { pos: [-10.2, 0, -5.5], radius: 4.5 },
  neon: { pos: [0, 0, 4.5], radius: 4.5 },
  harbor: { pos: [10.4, 4.8, -6.5], radius: 4.4 },
  ice: { pos: [20.6, 0, 5.5], radius: 4.4 },
};
const ORDER = ['forest', 'temple', 'neon', 'harbor', 'ice'];

interface Badge {
  group: THREE.Group;
  lit: THREE.Mesh[];
  dim: THREE.Mesh[];
}

interface Island {
  id: string;
  index: number;
  info: MapNodeInfo;
  pos: THREE.Vector3;
  radius: number;
  root: THREE.Group;
  inner: THREE.Group;
  mats: IslandMats;
  built: IslandBuild;
  pick: THREE.Mesh;
  hover: number;
  hoverT: number;
  lock: number;
  lockT: number;
  sel: number;
  selT: number;
  phase: number;
  ring: THREE.Mesh;
  halo: THREE.Mesh;
  ringGroup: THREE.Group;
  lockGroup: THREE.Group;
  badge: Badge;
  badgeAmt: number;
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** 3D level-select map: five dioramas on a golden-hour sea, connected by a glowing route. */
export class WorldMap {
  readonly scene = new THREE.Scene();
  readonly look: WorldLook = {
    toneMapping: 'aces',
    exposure: 1.05,
    bloom: { strength: 0.5, radius: 0.5, threshold: 0.85 },
    ao: { radius: 0.5, intensity: 0.8 },
    vignette: 0.35,
    saturation: 1.08,
    gain: [1.04, 1.0, 0.96],
    lift: [0.01, 0.008, 0],
    contrast: 1.04,
  };
  readonly camera: { home: CameraView; limits: CameraLimits; intro: CameraKeyframe[] } = {
    home: { target: new THREE.Vector3(0, 0, 0), radius: 46, polar: 0.95, azimuth: 0 },
    limits: {
      minRadius: 20,
      maxRadius: 70,
      minPolar: 0.35,
      maxPolar: 1.3,
      targetMin: new THREE.Vector3(-25, -5, -25),
      targetMax: new THREE.Vector3(25, 10, 25),
    },
    intro: [
      { position: new THREE.Vector3(-38, 8, 24), target: new THREE.Vector3(-22, 1.5, 6.5), duration: 0 },
      { position: new THREE.Vector3(-12, 9, 15), target: new THREE.Vector3(-8, 1.5, -2), duration: 1.7 },
      { position: new THREE.Vector3(21, 12, 22), target: new THREE.Vector3(14, 3, -3), duration: 1.8 },
      { position: new THREE.Vector3(0, 26.8, 37.4), target: new THREE.Vector3(0, 0, 0), duration: 2.0 },
    ],
  };

  private readonly quality: QualityPreset;
  private readonly renderer: THREE.WebGPURenderer;
  private nodes: MapNodeInfo[];
  private readonly islands: Island[] = [];
  private readonly byId = new Map<string, Island>();
  private readonly pickMeshes: THREE.Mesh[] = [];
  private disposeEnv: (() => void) | null = null;
  private built = false;
  // path
  private pathStones: THREE.InstancedMesh | null = null;
  private pathOrbs: THREE.InstancedMesh | null = null;
  private orbBase: THREE.Vector3[] = [];
  private pathGlow: THREE.Mesh | null = null;
  private pathGlowSeg: Float32Array | null = null;
  // birds
  private birdL: THREE.InstancedMesh | null = null;
  private birdR: THREE.InstancedMesh | null = null;
  private birds: Array<{ cx: number; cz: number; rad: number; alt: number; speed: number; phase: number; flap: number; size: number }> = [];
  private cloudGroup = new THREE.Group();
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQ2 = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private readonly tmpC = new THREE.Color();
  private readonly yAxis = new THREE.Vector3(0, 1, 0);
  private readonly zAxis = new THREE.Vector3(0, 0, 1);

  constructor(ctx: { quality: QualityPreset; renderer: THREE.WebGPURenderer }, nodes: MapNodeInfo[]) {
    this.quality = ctx.quality;
    this.renderer = ctx.renderer;
    this.nodes = nodes.map((n) => ({ ...n }));
    this.scene.name = 'worldmap';
  }

  // ───────────────────────── build ─────────────────────────

  async build(): Promise<void> {
    if (this.built) return;
    const q = this.quality;
    const scene = this.scene;

    // sky, fog, light
    const sunDir = new THREE.Vector3(-0.62, 0.34, -0.55).normalize();
    const sky = createSkyDome({
      zenith: '#5d7fb8',
      horizon: '#f4c890',
      ground: '#d9a878',
      sunDir,
      sunColor: '#ffd9a0',
      sunSize: 0.05,
      sunGlow: 1.3,
      clouds: { color: '#fff0dc', shadow: '#d8a9a0', coverage: 0.42, speed: 0.006, scale: 0.8, opacity: 0.75 },
      horizonGlow: { color: '#ffb46e', strength: 0.55, height: 0.22 },
      curve: 0.55,
    });
    scene.add(sky);
    try {
      await this.renderer.init();
      this.disposeEnv = applyEnvironment(this.renderer, scene, sky, 0.9);
    } catch {
      /* environment is optional */
    }
    setupFog(scene, { color: '#efc697', density: 0.0064 });
    createLightRig(scene, {
      hemiSky: '#a9c4ee',
      hemiGround: '#e8b98a',
      hemiIntensity: 0.9,
      sunColor: '#ffcf94',
      sunIntensity: 3.1,
      sunDir,
      shadowArea: 36,
      shadowCenter: new THREE.Vector3(0, 0, 0),
      fillColor: '#9db9ea',
      fillIntensity: 0.7,
      fillDir: new THREE.Vector3(0.5, 0.5, 1),
      rimColor: '#ffb27a',
      rimIntensity: 0.8,
      rimDir: new THREE.Vector3(0.7, 0.3, -1),
      quality: q,
    });

    // sea
    const sea = createWater({
      width: 260,
      length: 260,
      shallow: '#6fe6cf',
      deep: '#087c98',
      foam: '#fff4e2',
      sky: '#ffd6a6',
      flow: [0.12, 0.05],
      waveAmp: 0.06,
      waveLen: 7,
      roughness: 0.07,
      depthFade: 4.5,
      foamWidth: 0.55,
      refraction: 0.02,
      normalStrength: 0.2,
      minOpacity: 0.86,
      glow: '#ffa860',
      glowStrength: 0.06,
      quality: q,
    });
    sea.position.y = -0.3;
    scene.add(sea);
    await tick();

    // islands
    for (let i = 0; i < this.nodes.length; i++) {
      this.buildIsland(this.nodes[i]!, i);
      await tick();
    }
    this.buildPath();
    this.buildBirds();
    this.buildAmbience();
    scene.add(this.cloudGroup);
    this.built = true;
    this.updateNodes(this.nodes);
    for (const isl of this.islands) {
      isl.lock = isl.lockT;
      isl.badgeAmt = isl.info.completed ? 1 : 0;
      isl.mats.lock.value = isl.lock;
    }
    this.scene.updateMatrixWorld(true);
  }

  private layoutFor(id: string, index: number): Layout {
    const l = LAYOUT[id];
    if (l) return l;
    const t = index / Math.max(1, this.nodes.length - 1);
    return { pos: [-22 + t * 45, 0, Math.sin(t * 6) * 6], radius: 4.4 };
  }

  private buildIsland(info: MapNodeInfo, index: number): void {
    const lay = this.layoutFor(info.id, index);
    const builderIdx = ORDER.indexOf(info.id) >= 0 ? ORDER.indexOf(info.id) : index % ORDER.length;
    const builder = ISLAND_BUILDERS[ORDER[builderIdx]!]!;
    const mats = makeMaterials();
    const built = builder({ quality: this.quality, mats });
    const root = new THREE.Group();
    root.name = `island:${info.id}`;
    root.position.set(...lay.pos);
    const inner = new THREE.Group();
    inner.add(built.root);
    root.add(inner);

    // selection ring + halo (in root so it does not bob)
    const ringGroup = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(lay.radius + 0.55, lay.radius + 0.95, 96, 1);
    const ring = new THREE.Mesh(ringGeo, ringMaterial('#ffd27a'));
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 5;
    const haloMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    haloMat.blending = THREE.AdditiveBlending;
    const hv = uv().sub(0.5).length();
    haloMat.colorNode = vec3(1.0, 0.72, 0.3).mul(1.4);
    haloMat.opacityNode = smoothstep(0.5, 0.3, hv).mul(smoothstep(0.24, 0.42, hv)).mul(0.5);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry((lay.radius + 1.6) * 2, (lay.radius + 1.6) * 2), haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.05;
    halo.renderOrder = 4;
    ringGroup.add(ring, halo);
    ringGroup.position.y = lay.pos[1] > 1 ? 0.25 : -0.2;
    ringGroup.visible = false;
    root.add(ringGroup);

    // lock emblem
    const lockGroup = new THREE.Group();
    const lockMat = mat('#c9def8', 0.22, 0.75, { emissive: '#79a9ff', emissiveIntensity: 0.55 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.72, 0.38), lockMat);
    const sh = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.075, 8, 20, Math.PI), lockMat);
    sh.position.y = 0.36;
    const keyhole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.42, 10), glowMat('#8fc4ff', 2.5));
    keyhole.rotation.x = Math.PI / 2;
    lockGroup.add(body, sh, keyhole);
    lockGroup.position.y = TOP + (built.top ?? 4.2) - 0.7;
    lockGroup.scale.setScalar(1.15);
    root.add(lockGroup);

    // completion badge (billboard): flag + stars
    const badge = this.makeBadge();
    badge.group.position.y = TOP + (built.top ?? 4.2) + 0.6;
    root.add(badge.group);

    // pick sphere lives in the scene (does not move when the island lifts)
    const pick = new THREE.Mesh(new THREE.SphereGeometry(lay.radius + 0.4, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    pick.position.set(lay.pos[0], lay.pos[1] + 1.2, lay.pos[2]);
    pick.name = `pick:${info.id}`;
    pick.userData.levelId = info.id;
    this.pickMeshes.push(pick);
    this.scene.add(pick);

    this.scene.add(root);
    const isl: Island = {
      id: info.id,
      index,
      info,
      pos: new THREE.Vector3(...lay.pos),
      radius: lay.radius,
      root,
      inner,
      mats,
      built,
      pick,
      hover: 0,
      hoverT: 0,
      lock: info.unlocked ? 0 : 1,
      lockT: info.unlocked ? 0 : 1,
      sel: 0,
      selT: 0,
      phase: index * 1.7,
      ring,
      halo,
      ringGroup,
      lockGroup,
      badge,
      badgeAmt: 0,
    };
    this.islands.push(isl);
    this.byId.set(info.id, isl);
  }

  private makeBadge(): Badge {
    const group = new THREE.Group();
    const gold = mat('#ffcf5a', 0.25, 0.9, { emissive: '#ff9c1a', emissiveIntensity: 0.35 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.5, 8), gold);
    pole.position.y = 0.2;
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), gold);
    finial.position.y = 0.98;
    const clothGeo = new THREE.PlaneGeometry(1.0, 0.62, 14, 4);
    clothGeo.translate(0.5, 0, 0);
    const cloth = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#ffc23a'), roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide });
    cloth.emissive = new THREE.Color('#ff8a10');
    cloth.emissiveIntensity = 0.45;
    const wave = sin(positionLocal.x.mul(6).sub(time.mul(4.2))).mul(0.07);
    cloth.positionNode = vec3(positionLocal.x, positionLocal.y, wave.mul(positionLocal.x));
    const flag = new THREE.Mesh(clothGeo, cloth);
    flag.position.set(0.04, 0.68, 0);
    const emblem = new THREE.Mesh(starGeo(0.17, 0.075, 0.03), glowMat('#fff2c0', 2.2));
    emblem.position.set(0.5, 0.68, 0.02);
    group.add(pole, finial, flag, emblem);
    const lit: THREE.Mesh[] = [];
    const dim: THREE.Mesh[] = [];
    const litMat = glowMat('#ffcb45', 3.4);
    const dimMat = mat('#39445e', 0.6, 0.2);
    const sGeo = starGeo(0.3, 0.135, 0.1);
    for (let i = 0; i < 3; i++) {
      const a = (i - 1) * 0.62;
      const x = Math.sin(a) * 1.05 + 0.4;
      const y = -0.62 + Math.cos(a) * 0.18 - Math.abs(i - 1) * 0.18 + 0.1;
      const l = new THREE.Mesh(sGeo, litMat);
      const d = new THREE.Mesh(sGeo, dimMat);
      for (const s of [l, d]) {
        s.position.set(x, y, 0);
        s.rotation.z = -a * 0.6;
        group.add(s);
      }
      lit.push(l);
      dim.push(d);
    }
    group.visible = false;
    return { group, lit, dim };
  }

  // ───────────────────────── route ─────────────────────────

  private buildPath(): void {
    if (this.islands.length < 2) return;
    const ctrl: THREE.Vector3[] = [];
    const sorted = this.islands;
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i]!;
      const ay = a.pos.y;
      ctrl.push(new THREE.Vector3(a.pos.x, ay > 1 ? ay - 0.4 : 0.1, a.pos.z));
      const b = sorted[i + 1];
      if (b) {
        const mid = a.pos.clone().add(b.pos).multiplyScalar(0.5);
        const dir = b.pos.clone().sub(a.pos);
        const nx = -dir.z;
        const nz = dir.x;
        const l = Math.hypot(nx, nz) || 1;
        const side = i % 2 === 0 ? 1 : -1;
        const sw = 3.2;
        const my = (a.pos.y + b.pos.y) * 0.5;
        ctrl.push(new THREE.Vector3(mid.x + (nx / l) * sw * side, my + 0.2, mid.z + (nz / l) * sw * side));
      }
    }
    const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
    const total = curve.getLength();
    const N = Math.round(total / 0.12);
    const samples = curve.getSpacedPoints(N);
    // t of each island along the curve
    const nodeT: number[] = sorted.map((isl) => {
      let best = 0;
      let bd = 1e9;
      for (let k = 0; k <= N; k++) {
        const p = samples[k]!;
        const d = (p.x - isl.pos.x) ** 2 + (p.z - isl.pos.z) ** 2;
        if (d < bd) {
          bd = d;
          best = k / N;
        }
      }
      return best;
    });
    const segOf = (t: number): number => {
      let s = 0;
      for (let i = 0; i < nodeT.length - 1; i++) if (t >= nodeT[i]! - 1e-4) s = i;
      return s;
    };
    const outside = (p: THREE.Vector3, pad: number): boolean => {
      for (const isl of sorted) {
        const dy = Math.abs(p.y - isl.pos.y);
        if (dy < 3 && Math.hypot(p.x - isl.pos.x, p.z - isl.pos.z) < isl.radius + pad) return false;
      }
      return true;
    };

    const stones: Array<{ p: THREE.Vector3; seg: number; rot: number; s: number }> = [];
    const orbs: Array<{ p: THREE.Vector3; seg: number }> = [];
    const posts: Array<{ p: THREE.Vector3; seg: number }> = [];
    let acc = 0;
    let accPost = 0;
    const R = rng(77);
    let side = 1;
    for (let k = 1; k <= N; k++) {
      const p = samples[k]!;
      const prev = samples[k - 1]!;
      const step = p.distanceTo(prev);
      acc += step;
      accPost += step;
      const t = k / N;
      if (!outside(p, 0.5)) {
        acc = 0.6;
        accPost = 1.2;
        continue;
      }
      if (acc >= 1.05) {
        acc = 0;
        stones.push({ p: p.clone(), seg: segOf(t), rot: R() * Math.PI, s: 0.85 + R() * 0.4 });
      }
      if (accPost >= 3.1) {
        accPost = 0;
        const tg = curve.getTangent(t);
        const nx = -tg.z;
        const nz = tg.x;
        const l = Math.hypot(nx, nz) || 1;
        side = -side;
        const q = new THREE.Vector3(p.x + (nx / l) * 1.15 * side, p.y, p.z + (nz / l) * 1.15 * side);
        if (p.y < 0.6) posts.push({ p: q, seg: segOf(t) });
        else orbs.push({ p: q.setY(q.y + 0.7), seg: segOf(t) });
      }
    }
    // stones
    const stoneGeo = new THREE.CylinderGeometry(0.4, 0.5, 0.2, 9, 1);
    const stoneMat = mat('#bfae96', 0.85, 0.05);
    const stoneMesh = new THREE.InstancedMesh(stoneGeo, stoneMat, Math.max(1, stones.length));
    stoneMesh.castShadow = true;
    stoneMesh.receiveShadow = true;
    const capGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.05, 12, 1);
    const capMat = glowMat('#ffffff', 1);
    const capMesh = new THREE.InstancedMesh(capGeo, capMat, Math.max(1, stones.length));
    stones.forEach((s, i) => {
      this.tmpQ.setFromAxisAngle(this.yAxis, s.rot);
      this.tmpM.compose(this.tmpV.set(s.p.x, s.p.y - 0.02, s.p.z), this.tmpQ, this.tmpS.set(s.s, 1, s.s));
      stoneMesh.setMatrixAt(i, this.tmpM);
      this.tmpM.compose(this.tmpV.set(s.p.x, s.p.y + 0.1, s.p.z), this.tmpQ, this.tmpS.set(s.s, 1, s.s));
      capMesh.setMatrixAt(i, this.tmpM);
    });
    stoneMesh.instanceMatrix.needsUpdate = true;
    capMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(stoneMesh, capMesh);
    this.pathStones = capMesh;
    // posts + lanterns
    const postGeo = new THREE.CylinderGeometry(0.05, 0.08, 1.5, 6, 1);
    postGeo.translate(0, 0.55, 0);
    const postMesh = new THREE.InstancedMesh(postGeo, mat('#4a3a30', 0.8), Math.max(1, posts.length));
    postMesh.castShadow = true;
    posts.forEach((s, i) => {
      this.tmpM.makeTranslation(s.p.x, s.p.y - 0.2, s.p.z);
      postMesh.setMatrixAt(i, this.tmpM);
    });
    postMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(postMesh);
    const all = [...posts.map((p) => ({ p: p.p.clone().setY(p.p.y + 1.45), seg: p.seg })), ...orbs];
    const orbGeo = new THREE.SphereGeometry(0.2, 12, 8);
    const orbMesh = new THREE.InstancedMesh(orbGeo, glowMat('#ffffff', 1), Math.max(1, all.length));
    all.forEach((s, i) => {
      this.orbBase.push(s.p.clone());
      this.tmpM.makeTranslation(s.p.x, s.p.y, s.p.z);
      orbMesh.setMatrixAt(i, this.tmpM);
    });
    orbMesh.instanceMatrix.needsUpdate = true;
    this.pathOrbs = orbMesh;
    this.scene.add(orbMesh);
    (stoneMesh.userData as { n: number }).n = stones.length;
    (orbMesh.userData as { n: number }).n = all.length;
    (capMesh.userData as { n: number }).n = stones.length;
    (capMesh.userData as { segs: number[] }).segs = stones.map((s) => s.seg);
    (orbMesh.userData as { segs: number[] }).segs = all.map((s) => s.seg);

    // glowing route ribbon on the water with flowing dashes
    const rs = 220;
    const pos: number[] = [];
    const uvs: number[] = [];
    const segAttr: number[] = [];
    const idx: number[] = [];
    let len = 0;
    for (let i = 0; i <= rs; i++) {
      const t = i / rs;
      const p = curve.getPoint(t);
      const tg = curve.getTangent(t);
      if (i > 0) len += p.distanceTo(curve.getPoint((i - 1) / rs));
      const nx = -tg.z;
      const nz = tg.x;
      const l = Math.hypot(nx, nz) || 1;
      const w = 0.12;
      pos.push(p.x + (nx / l) * w, p.y + 0.03, p.z + (nz / l) * w, p.x - (nx / l) * w, p.y + 0.03, p.z - (nz / l) * w);
      uvs.push(len, 0, len, 1);
      const inside = outside(p, 0.2) ? 1 : 0;
      segAttr.push(segOf(t), inside, segOf(t), inside);
      if (i < rs) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array((rs + 1) * 2 * 3), 3));
    g.setIndex(idx);
    this.pathGlowSeg = new Float32Array(segAttr);
    const rm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    rm.blending = THREE.AdditiveBlending;
    const u = uv().x;
    const dash = smoothstep(0.25, 0.55, fract(u.mul(0.7).sub(time.mul(0.55))));
    rm.colorNode = attribute('color', 'vec3').mul(dash.mul(0.9).add(0.35));
    rm.opacityNode = smoothstep(0.0, 1.0, dash.mul(0.7).add(0.3));
    this.pathGlow = new THREE.Mesh(g, rm);
    this.pathGlow.frustumCulled = false;
    this.pathGlow.renderOrder = 3;
    this.scene.add(this.pathGlow);
  }

  private pathColor(seg: number, out: THREE.Color): THREE.Color {
    const a = this.islands[seg];
    const b = this.islands[seg + 1];
    if (a && a.info.completed) return out.set('#ffc652'); // travelled
    if (a && a.info.unlocked && b && b.info.unlocked) return out.set('#7fe6ff'); // open
    if (a && a.info.unlocked) return out.set('#9ab8ff'); // frontier
    return out.set('#5a6a8c'); // locked
  }

  private refreshPath(): void {
    const tint = (m: THREE.InstancedMesh | null, mul: number): void => {
      if (!m) return;
      const segs = (m.userData as { segs?: number[] }).segs;
      if (!segs) return;
      segs.forEach((s, i) => {
        this.pathColor(s, this.tmpC);
        const a = this.islands[s];
        const dim = a && !a.info.unlocked ? 0.3 : 1;
        this.tmpC.multiplyScalar(mul * dim);
        m.setColorAt(i, this.tmpC);
      });
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
    tint(this.pathStones, 2.4);
    tint(this.pathOrbs, 3.2);
    if (this.pathGlow && this.pathGlowSeg) {
      const col = this.pathGlow.geometry.getAttribute('color') as THREE.BufferAttribute;
      const s = this.pathGlowSeg;
      for (let i = 0; i < col.count; i++) {
        this.pathColor(s[i * 2]!, this.tmpC);
        const k = (s[i * 2 + 1] ?? 1) * 1.5;
        col.setXYZ(i, this.tmpC.r * k, this.tmpC.g * k, this.tmpC.b * k);
      }
      col.needsUpdate = true;
    }
  }

  // ───────────────────────── ambience ─────────────────────────

  private buildBirds(): void {
    const n = Math.max(4, Math.round(12 * this.quality.density));
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.12, 0, 0, 0.22, 0.75, 0.02, 0.05], 3));
    wing.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    wing.setIndex([0, 1, 2]);
    const wm = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color('#fff6e6'), side: THREE.DoubleSide });
    this.birdL = new THREE.InstancedMesh(wing, wm, n);
    this.birdR = new THREE.InstancedMesh(wing, wm, n);
    this.birdL.frustumCulled = false;
    this.birdR.frustumCulled = false;
    const R = rng(5);
    for (let i = 0; i < n; i++) {
      this.birds.push({
        cx: (R() - 0.5) * 50,
        cz: (R() - 0.5) * 24 + 2,
        rad: 4 + R() * 7,
        alt: 5.5 + R() * 6,
        speed: (0.22 + R() * 0.2) * (R() > 0.5 ? 1 : -1),
        phase: R() * 6.28,
        flap: 5 + R() * 3,
        size: 0.55 + R() * 0.35,
      });
    }
    this.scene.add(this.birdL, this.birdR);
  }

  private buildAmbience(): void {
    const q = this.quality;
    const dust = createParticles({
      count: 140,
      min: [-30, 0.4, -16],
      max: [30, 9, 16],
      color: '#ffe0a0',
      color2: '#fff6d8',
      size: 0.11,
      motion: 'float',
      speed: 0.45,
      opacity: 0.55,
      twinkle: 0.6,
      quality: q,
    });
    this.scene.add(dust);
    // distant clouds drifting low over the horizon
    const cm = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#fff1e0'), roughness: 1, metalness: 0 });
    cm.emissive = new THREE.Color('#ffb98a');
    cm.emissiveIntensity = 0.32;
    const R = rng(21);
    const geos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) geos.push(new THREE.IcosahedronGeometry(1, 1));
    const count = Math.max(6, Math.round(26 * q.density));
    const cloud = new THREE.InstancedMesh(geos[0]!, cm, count);
    for (let i = 0; i < count; i++) {
      const a = R() * Math.PI * 2;
      const d = 50 + R() * 40;
      const s = 2.5 + R() * 5;
      this.tmpQ.setFromAxisAngle(this.yAxis, R() * 6);
      this.tmpM.compose(this.tmpV.set(Math.cos(a) * d, 4 + R() * 9 - 2, Math.sin(a) * d - 20), this.tmpQ, this.tmpS.set(s * 1.7, s * 0.55, s));
      cloud.setMatrixAt(i, this.tmpM);
    }
    cloud.instanceMatrix.needsUpdate = true;
    cloud.frustumCulled = false;
    this.cloudGroup.add(cloud);
  }

  // ───────────────────────── API ─────────────────────────

  pick(raycaster: THREE.Raycaster): string | null {
    const hits = raycaster.intersectObjects(this.pickMeshes, false);
    const h = hits[0];
    if (!h) return null;
    return (h.object.userData.levelId as string | undefined) ?? null;
  }

  nodePosition(id: string): THREE.Vector3 {
    const isl = this.byId.get(id);
    if (isl) return isl.pos.clone();
    const l = LAYOUT[id];
    return l ? new THREE.Vector3(...l.pos) : new THREE.Vector3();
  }

  setHover(id: string | null): void {
    for (const isl of this.islands) isl.hoverT = isl.id === id ? 1 : 0;
  }

  setSelected(id: string | null): void {
    for (const isl of this.islands) isl.selT = isl.id === id ? 1 : 0;
  }

  updateNodes(nodes: MapNodeInfo[]): void {
    this.nodes = nodes.map((n) => ({ ...n }));
    for (const n of nodes) {
      const isl = this.byId.get(n.id);
      if (!isl) continue;
      isl.info = { ...n };
      isl.lockT = n.unlocked ? 0 : 1;
      const b = isl.badge;
      b.group.visible = n.completed;
      isl.badgeAmt = n.completed ? Math.max(isl.badgeAmt, 0.001) : 0;
      for (let i = 0; i < 3; i++) {
        const on = n.stars > i;
        b.lit[i]!.visible = on;
        b.dim[i]!.visible = !on;
      }
    }
    if (this.built) this.refreshPath();
  }

  update(dt: number, t: number, camera: THREE.PerspectiveCamera): void {
    if (!this.built) return;
    const k = 1 - Math.exp(-9 * dt);
    const kl = 1 - Math.exp(-3.2 * dt);
    for (const isl of this.islands) {
      isl.hover += (isl.hoverT - isl.hover) * k;
      isl.sel += (isl.selT - isl.sel) * k;
      isl.lock += (isl.lockT - isl.lock) * kl;
      isl.mats.hover.value = isl.hover;
      isl.mats.lock.value = isl.lock;
      const bob = Math.sin(t * 0.7 + isl.phase) * 0.09 + Math.sin(t * 1.3 + isl.phase * 2.1) * 0.03;
      isl.inner.position.y = bob + isl.hover * 0.5;
      isl.inner.rotation.y = Math.sin(t * 0.2 + isl.phase) * 0.02;
      const sc = 1 + isl.hover * 0.02;
      isl.inner.scale.setScalar(sc);
      // selection ring
      isl.ringGroup.visible = isl.sel > 0.01;
      if (isl.ringGroup.visible) {
        isl.ring.rotation.z = t * 0.55;
        const s = 0.9 + isl.sel * 0.1;
        isl.ringGroup.scale.set(s, 1, s);
        isl.ringGroup.position.y = (isl.pos.y > 1 ? 0.25 : -0.2) + Math.sin(t * 1.6) * 0.03;
      }
      // lock emblem
      const lockAmt = smoothStep01(isl.lock);
      isl.lockGroup.visible = lockAmt > 0.02;
      if (isl.lockGroup.visible) {
        isl.lockGroup.scale.setScalar(1.15 * lockAmt);
        isl.lockGroup.rotation.y = Math.sin(t * 0.8 + isl.phase) * 0.5;
        isl.lockGroup.position.y = TOP + (isl.built.top ?? 4.2) - 0.7 + Math.sin(t * 1.4 + isl.phase) * 0.16 + isl.hover * 0.5;
      }
      // badge: billboard to the camera + grow in
      if (isl.info.completed) {
        isl.badgeAmt = Math.min(1, isl.badgeAmt + dt * 1.5);
        const b = isl.badge.group;
        b.visible = true;
        const pop = easeOutBack(isl.badgeAmt);
        b.scale.setScalar(Math.max(0.001, pop) * 1.2);
        b.position.y = TOP + (isl.built.top ?? 4.2) + 0.6 + Math.sin(t * 1.1 + isl.phase) * 0.14 + isl.hover * 0.5;
        this.tmpV.copy(camera.position).sub(isl.root.position);
        b.rotation.y = Math.atan2(this.tmpV.x, this.tmpV.z);
        for (let i = 0; i < 3; i++) {
          const s = isl.badge.lit[i]!;
          if (s.visible) s.scale.setScalar(1 + Math.sin(t * 3 + i * 1.3) * 0.08);
        }
      }
      // diorama animation
      for (const a of isl.built.anim) a(dt, t, isl.hover);
    }
    // route lanterns bob
    if (this.pathOrbs) {
      const m = this.pathOrbs;
      for (let i = 0; i < this.orbBase.length; i++) {
        const b = this.orbBase[i]!;
        this.tmpM.makeTranslation(b.x, b.y + Math.sin(t * 1.6 + i * 1.9) * 0.07, b.z);
        m.setMatrixAt(i, this.tmpM);
      }
      m.instanceMatrix.needsUpdate = true;
    }
    // birds
    if (this.birdL && this.birdR) {
      for (let i = 0; i < this.birds.length; i++) {
        const b = this.birds[i]!;
        const a = t * b.speed + b.phase;
        const x = b.cx + Math.cos(a) * b.rad;
        const z = b.cz + Math.sin(a) * b.rad * 0.7;
        const y = b.alt + Math.sin(t * 0.5 + b.phase) * 0.6;
        const dirx = -Math.sin(a) * Math.sign(b.speed);
        const dirz = Math.cos(a) * 0.7 * Math.sign(b.speed);
        const yaw = Math.atan2(-dirz, dirx);
        const flap = Math.sin(t * b.flap + b.phase) * 0.55;
        this.tmpQ.setFromAxisAngle(this.yAxis, yaw);
        this.tmpQ2.setFromAxisAngle(this.zAxis, flap);
        this.tmpQ.multiply(this.tmpQ2);
        this.tmpM.compose(this.tmpV.set(x, y, z), this.tmpQ, this.tmpS.set(b.size, b.size, b.size));
        this.birdR.setMatrixAt(i, this.tmpM);
        this.tmpQ.setFromAxisAngle(this.yAxis, yaw);
        this.tmpQ2.setFromAxisAngle(this.zAxis, -flap);
        this.tmpQ.multiply(this.tmpQ2);
        this.tmpM.compose(this.tmpV.set(x, y, z), this.tmpQ, this.tmpS.set(-b.size, b.size, b.size));
        this.birdL.setMatrixAt(i, this.tmpM);
      }
      this.birdL.instanceMatrix.needsUpdate = true;
      this.birdR.instanceMatrix.needsUpdate = true;
    }
    this.cloudGroup.position.x = Math.sin(t * 0.01) * 6;
  }

  dispose(): void {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mt = (m as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(mt)) mt.forEach((x) => x.dispose());
      else if (mt) mt.dispose();
    });
    this.disposeEnv?.();
    this.disposeEnv = null;
    this.scene.environment = null;
    this.scene.clear();
    this.islands.length = 0;
    this.pickMeshes.length = 0;
    this.byId.clear();
    this.built = false;
  }
}

function smoothStep01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const t = Math.min(1, Math.max(0, x));
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
