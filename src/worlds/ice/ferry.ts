import * as THREE from 'three/webgpu';
import { Fn, color, exp, float, fract, mix, mx_noise_float, positionLocal, smoothstep, step, time, uniform, uv, vec2, vec3, length } from 'three/tsl';
import type { VehicleRig } from '../../world/types';
import { createParticles, glowMat } from '../../world/kit';
import type { QualityPreset } from '../../render/quality';
import { DOCK_X, FERRY_DECK, PropBuilder, S, createPropMaterial, type Disposer } from './common';

const GREEN = '#5dff9c';
const AMBER = '#ffc247';
const RED = '#ff4d3d';

interface Indicator {
  count: number;
  capacity: number;
  weight?: number;
  maxWeight?: number;
}

function dialAngle(r: number): number {
  // radians (CCW from up): +135° at ratio 0 → -135° at ratio 1
  return THREE.MathUtils.degToRad(135 - 270 * Math.min(1.12, Math.max(0, r)));
}

function drawDial(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2;
  const bg = g.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
  bg.addColorStop(0, '#16263d');
  bg.addColorStop(1, '#070d18');
  g.fillStyle = bg;
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fill();
  const pt = (r: number, rad: number): [number, number] => {
    const a = dialAngle(r);
    return [cx - Math.sin(a) * rad, cy - Math.cos(a) * rad];
  };
  // colour bands
  const band = (r0: number, r1: number, col: string) => {
    g.strokeStyle = col;
    g.lineWidth = R * 0.085;
    g.lineCap = 'butt';
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const [x, y] = pt(r0 + ((r1 - r0) * i) / 40, R * 0.8);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  };
  band(0, 0.75, '#2bd97a');
  band(0.75, 1.0, '#ffb62e');
  band(1.0, 1.12, '#ff3b30');
  // ticks
  g.strokeStyle = '#cfe6ff';
  for (let i = 0; i <= 20; i++) {
    const r = i / 20;
    const major = i % 5 === 0;
    g.lineWidth = major ? R * 0.028 : R * 0.014;
    const [x0, y0] = pt(r, R * (major ? 0.62 : 0.67));
    const [x1, y1] = pt(r, R * 0.71);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }
  g.fillStyle = '#e8f4ff';
  g.font = `bold ${Math.round(R * 0.15)}px sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const [r, label] of [[0, '0'], [0.25, '25'], [0.5, '50'], [0.75, '75'], [1, '100']] as const) {
    const [x, y] = pt(r, R * 0.48);
    g.fillText(label, x, y);
  }
  g.fillStyle = '#7fb6e6';
  g.font = `bold ${Math.round(R * 0.13)}px sans-serif`;
  g.fillText('kg', cx, cy + R * 0.42);
  g.font = `${Math.round(R * 0.09)}px sans-serif`;
  g.fillStyle = '#5f86ad';
  g.fillText('LAST', cx, cy - R * 0.3);
  return c;
}

export interface Ferry {
  vehicle: VehicleRig;
  /** Pointlight that follows the ferry (null when the quality budget has no room). */
  light: THREE.PointLight | null;
  dispose(): void;
}

export function createFerry(o: { quality: QualityPreset; allowLight: boolean; dispose: Disposer }): Ferry {
  const q = o.quality;
  const d = o.dispose;
  const root = new THREE.Group();
  root.name = 'ferry';
  const hull = new THREE.Group();
  hull.name = 'ferry:hull';
  root.add(hull);

  const propMat = d.add(createPropMaterial({ snow: 0.55 }));
  const B = new PropBuilder();
  const dk = FERRY_DECK;

  // ── pontoons (orange, rubber fenders) ──
  for (const z of [-1.28, 1.28]) {
    B.rbox(3.6, 0.66, 0.74, 0.3, S.orangeMetal, { p: [0, 0.02, z] });
    B.rbox(3.62, 0.08, 0.76, 0.03, { color: '#1a1e25', rough: 0.8 }, { p: [0, -0.17, z] });
    B.rbox(3.4, 0.05, 0.05, 0.02, { color: '#fff1d0', rough: 0.4, emit: 0.35 }, { p: [0, 0.2, z + Math.sign(z) * 0.375] });
    for (const sx of [-1, 1]) B.cyl(0.13, 0.13, 0.76, { color: '#101317', rough: 0.9 }, { p: [sx * 1.83, 0.05, z], r: [Math.PI / 2, 0, 0] }, 10);
  }
  // cross beams + frame
  for (const x of [-1.3, 0, 1.3]) B.box(0.16, 0.14, 3.3, S.darkSteel, { p: [x, 0.38, 0] });
  B.box(3.2, 0.14, 0.14, S.darkSteel, { p: [0, 0.41, 1.66] });
  B.box(3.2, 0.14, 0.14, S.darkSteel, { p: [0, 0.41, -1.66] });
  // deck rim
  B.box(3.2, 0.1, 0.1, S.steel, { p: [0, dk - 0.03, 1.72] });
  B.box(3.2, 0.1, 0.1, S.steel, { p: [0, dk - 0.03, -1.72] });
  for (const sx of [-1, 1]) B.box(0.1, 0.1, 3.5, S.steel, { p: [sx * 1.55, dk - 0.03, 0] });
  // heating strips on the rim (warm)
  for (const sx of [-1, 1]) B.box(0.035, 0.03, 3.3, S.warm(2.6), { p: [sx * 1.49, dk + 0.02, 0] });
  B.box(3.0, 0.03, 0.035, S.warm(2.6), { p: [0, dk + 0.02, 1.65] });
  B.box(3.0, 0.03, 0.035, S.warm(2.6), { p: [0, dk + 0.02, -1.65] });
  // ── rails ──
  const railZ = 1.75;
  const post = (x: number, z: number) => {
    B.cyl(0.03, 0.03, 1.0, S.yellow, { p: [x, dk + 0.5, z] }, 8);
  };
  for (let i = -5; i <= 5; i++) {
    const x = i * 0.29;
    post(x, railZ);
    post(x, -railZ);
  }
  B.cyl(0.032, 0.032, 3.1, S.yellow, { p: [0, dk + 1.0, railZ], r: [0, 0, Math.PI / 2] }, 8);
  B.cyl(0.032, 0.032, 3.1, S.yellow, { p: [0, dk + 1.0, -railZ], r: [0, 0, Math.PI / 2] }, 8);
  B.cyl(0.024, 0.024, 3.1, S.white, { p: [0, dk + 0.62, railZ], r: [0, 0, Math.PI / 2] }, 8);
  B.cyl(0.024, 0.024, 3.1, S.white, { p: [0, dk + 0.62, -railZ], r: [0, 0, Math.PI / 2] }, 8);
  // end rails with a boarding gap
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let k = 0; k < 3; k++) post(sx * 1.55, sz * (0.95 + k * 0.4));
      B.cyl(0.032, 0.032, 0.9, S.yellow, { p: [sx * 1.55, dk + 1.0, sz * 1.35], r: [Math.PI / 2, 0, 0] }, 8);
      B.cyl(0.024, 0.024, 0.9, S.white, { p: [sx * 1.55, dk + 0.62, sz * 1.35], r: [Math.PI / 2, 0, 0] }, 8);
    }
  }
  // ── winch console ──
  B.rbox(1.0, 0.62, 0.55, 0.05, S.darkSteel, { p: [0, dk + 0.31, -1.22] });
  B.rbox(0.96, 0.06, 0.6, 0.02, S.orangeMetal, { p: [0, dk + 0.64, -1.22] });
  B.box(0.62, 0.02, 0.36, { color: '#0a1a26', rough: 0.2, metal: 0.2 }, { p: [0, dk + 0.7, -1.17], r: [-0.45, 0, 0] });
  B.box(0.56, 0.01, 0.3, S.cyan(1.7), { p: [0, dk + 0.712, -1.17], r: [-0.45, 0, 0] });
  for (const sx of [-0.32, 0.32]) {
    B.cyl(0.012, 0.012, 0.24, S.steel, { p: [sx, dk + 0.8, -1.12], r: [-0.35, 0, 0] }, 6);
    B.ell(0.032, 0.032, 0.032, sx < 0 ? S.green(2) : S.red2(2), { p: [sx, dk + 0.92, -1.19] }, 8, 6);
  }
  for (let i = 0; i < 5; i++) B.box(0.05, 0.02, 0.02, i % 2 ? S.warm(2.2) : S.green(2.2), { p: [-0.36 + i * 0.09, dk + 0.5, -0.935] });
  // drum housing + guide rollers
  B.box(0.95, 0.1, 0.42, S.darkSteel, { p: [0, dk + 0.68, -1.22] });
  for (const sx of [-1, 1]) B.box(0.06, 0.5, 0.42, S.darkSteel, { p: [sx * 0.42, dk + 0.86, -1.22] });
  B.rod([0, dk + 1.0, -1.22], [0, dk + 2.0, -1.6], 0.012, { color: '#b7c2d0', rough: 0.35, metal: 0.9 }, 4);
  // ── mast with trolley (rides the fixed guide cable) ──
  B.cyl(0.05, 0.07, 2.0, S.steel, { p: [0, dk + 1.0, -1.62] }, 10);
  B.cyl(0.02, 0.02, 1.55, S.darkSteel, { p: [-0.5, dk + 1.05, -1.62], r: [0, 0, 0.45] }, 6);
  B.cyl(0.02, 0.02, 1.55, S.darkSteel, { p: [0.5, dk + 1.05, -1.62], r: [0, 0, -0.45] }, 6);
  B.rbox(0.42, 0.14, 0.2, 0.03, S.darkSteel, { p: [0, dk + 2.0, -1.62] });
  for (const sx of [-0.15, 0.15]) B.cyl(0.09, 0.09, 0.05, S.steel, { p: [sx, dk + 2.11, -1.62], r: [Math.PI / 2, 0, 0] }, 14);
  // ── floodlights on the front corners ──
  for (const sx of [-1, 1]) {
    B.cyl(0.035, 0.035, 0.55, S.darkSteel, { p: [sx * 1.5, dk + 1.27, railZ], r: [0, 0, 0] }, 8);
    B.rbox(0.22, 0.14, 0.12, 0.03, S.darkSteel, { p: [sx * 1.5, dk + 1.6, railZ], r: [0.3, 0, 0] });
    B.box(0.18, 0.1, 0.02, S.warmWhite(3.2), { p: [sx * 1.5, dk + 1.6, railZ + 0.07], r: [0.3, 0, 0] });
  }
  // ── seats (padded stools, orientation-neutral) ──
  const seatPos: Array<[number, number]> = [
    [0, -0.55],
    [-0.88, 0.45],
    [0.88, 0.45],
  ];
  for (const [x, z] of seatPos) {
    B.cyl(0.05, 0.08, 0.26, S.darkSteel, { p: [x, dk + 0.13, z] }, 8);
    B.cyl(0.34, 0.34, 0.03, S.steel, { p: [x, dk + 0.02, z] }, 18);
    B.cyl(0.29, 0.31, 0.11, { color: '#1c6f78', rough: 0.85 }, { p: [x, dk + 0.31, z] }, 20);
    B.cyl(0.3, 0.3, 0.02, S.warm(1.6), { p: [x, dk + 0.25, z] }, 20);
    // handhold
    B.cyl(0.018, 0.018, 0.35, S.yellow, { p: [x + (x >= 0 ? 0.36 : -0.36), dk + 0.45, z] }, 6);
  }
  // ── gauge post ──
  const gx = 1.22;
  const gz = 1.32;
  B.cyl(0.07, 0.09, 1.55, S.darkSteel, { p: [gx, dk + 0.78, gz] }, 10);
  B.rbox(0.34, 0.06, 0.34, 0.02, S.steel, { p: [gx, dk + 0.03, gz] });
  B.rbox(0.28, 0.3, 0.22, 0.05, S.darkSteel, { p: [gx, dk + 1.45, gz - 0.02] });
  for (let i = 0; i < 3; i++) B.cyl(0.018, 0.018, 0.16, S.steel, { p: [gx - 0.11 + i * 0.11, dk + 1.05, gz + 0.02], r: [0, 0, 0] }, 6);

  const hullGeo = d.add(B.build());
  const hullMesh = new THREE.Mesh(hullGeo, propMat);
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  hullMesh.name = 'ferry:static';
  hull.add(hullMesh);

  // ── deck grating (procedural, heated glow below) ──
  const heat = uniform(1);
  const moveU = uniform(0);
  const deckMat = d.add(new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.75 }));
  {
    const g = uv().mul(vec2(3.0 / 0.15, 3.44 / 0.15));
    const f = fract(g);
    const hole = step(0.2, f.x).mul(step(0.2, f.y));
    const breathe = float(0.8).add(mx_noise_float(vec3(uv().mul(6), time.mul(0.4))).mul(0.25));
    deckMat.colorNode = mix(color(new THREE.Color('#252d38')), color(new THREE.Color('#06090d')), hole);
    deckMat.emissiveNode = color(new THREE.Color('#ff7a1c')).mul(hole).mul(breathe).mul(heat).mul(0.55);
  }
  const deckGeo = d.add(new THREE.PlaneGeometry(3.0, 3.44));
  deckGeo.rotateX(-Math.PI / 2);
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.position.set(0, dk + 0.005, 0);
  deck.receiveShadow = true;
  deck.name = 'ferry:deck';
  hull.add(deck);

  // ── winch drum (rotates) ──
  const drumGroup = new THREE.Group();
  drumGroup.position.set(0, dk + 0.9, -1.22);
  const DB = new PropBuilder();
  DB.cyl(0.2, 0.2, 0.36, S.steel, { r: [Math.PI / 2, 0, 0] }, 18);
  for (const sz of [-1, 1]) DB.cyl(0.27, 0.27, 0.03, S.darkSteel, { p: [0, 0, sz * 0.19], r: [Math.PI / 2, 0, 0] }, 18);
  for (let i = 0; i < 6; i++) DB.add(new THREE.TorusGeometry(0.212, 0.014, 6, 20), { color: '#505a66', rough: 0.35, metal: 0.9 }, { p: [0, 0, -0.14 + i * 0.056] });
  DB.box(0.5, 0.045, 0.045, S.warm(2), { p: [0, 0, 0.2] });
  const drumGeo = d.add(DB.build());
  const drum = new THREE.Mesh(drumGeo, propMat);
  drum.castShadow = true;
  drumGroup.add(drum);
  hull.add(drumGroup);

  // ── beacon on the mast (amber, rotating beams) ──
  const beaconGroup = new THREE.Group();
  beaconGroup.position.set(0, dk + 2.28, -1.62);
  const beaconU = uniform(1);
  const beaconMat = d.add(new THREE.MeshBasicNodeMaterial());
  beaconMat.colorNode = color(new THREE.Color('#ffb020')).mul(beaconU);
  const beaconGeo = d.add(new THREE.SphereGeometry(0.1, 14, 10));
  beaconGroup.add(new THREE.Mesh(beaconGeo, beaconMat));
  const beamMat = d.add(new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  beamMat.fog = false;
  {
    const u = uv();
    beamMat.colorNode = color(new THREE.Color('#ffb84a')).mul(smoothstep(1.0, 0.0, u.x)).mul(smoothstep(0.0, 0.25, u.y)).mul(smoothstep(1.0, 0.75, u.y)).mul(beaconU).mul(0.45);
  }
  const beamGeo = d.add(new THREE.PlaneGeometry(2.6, 0.5));
  beamGeo.translate(1.3, 0, 0);
  for (const a of [0, Math.PI]) {
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.rotation.y = a;
    beam.rotation.x = -Math.PI / 2;
    beaconGroup.add(beam);
  }
  hull.add(beaconGroup);

  // ── gauge (dial + needle + readout) ──
  const gauge = new THREE.Group();
  gauge.position.set(gx, dk + 1.62, gz + 0.06);
  gauge.rotation.x = -0.42;
  hull.add(gauge);
  const dialTex = d.add(new THREE.CanvasTexture(drawDial(512)));
  dialTex.colorSpace = THREE.SRGBColorSpace;
  dialTex.anisotropy = 4;
  const dialMat = d.add(new THREE.MeshBasicNodeMaterial({ map: dialTex, color: new THREE.Color(1.15, 1.15, 1.15) }));
  const dialR = 0.64;
  const dialGeo = d.add(new THREE.CircleGeometry(dialR, 48));
  const dial = new THREE.Mesh(dialGeo, dialMat);
  dial.position.z = 0.0;
  gauge.add(dial);
  // bezel
  const ringColor = uniform(new THREE.Color(GREEN));
  const ringMat = d.add(new THREE.MeshBasicNodeMaterial());
  ringMat.colorNode = ringColor.mul(1.9);
  const ringGeo = d.add(new THREE.TorusGeometry(dialR + 0.035, 0.035, 8, 56));
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.z = 0.012;
  gauge.add(ring);
  const bezelGeo = d.add(new THREE.CylinderGeometry(dialR + 0.09, dialR + 0.1, 0.16, 40));
  bezelGeo.rotateX(Math.PI / 2);
  const bezel = new THREE.Mesh(bezelGeo, d.add(new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#2b3440'), roughness: 0.4, metalness: 0.85 })));
  bezel.position.z = -0.09;
  bezel.castShadow = true;
  gauge.add(bezel);
  // glass sheen
  const glassMat = d.add(new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  {
    const p = uv().sub(0.5);
    glassMat.colorNode = vec3(0.5, 0.75, 1.0).mul(smoothstep(0.55, 0.0, length(p.sub(vec2(-0.16, 0.2)))).mul(0.07));
  }
  const glass = new THREE.Mesh(dialGeo, glassMat);
  glass.position.z = 0.03;
  gauge.add(glass);
  // needle
  const needle = new THREE.Group();
  needle.position.z = 0.03;
  gauge.add(needle);
  {
    const nb = new PropBuilder();
    nb.box(0.045, 0.54, 0.015, { color: '#ff3b30', rough: 0.3, emit: 1.8 }, { p: [0, 0.2, 0] });
    nb.cone(0.035, 0.1, { color: '#ff3b30', rough: 0.3, emit: 1.8 }, { p: [0, 0.5, 0] }, 4);
    nb.box(0.03, 0.16, 0.012, { color: '#c8d4e2', rough: 0.4, emit: 0.4 }, { p: [0, -0.1, 0] });
    nb.cyl(0.07, 0.07, 0.04, { color: '#d9e4f2', rough: 0.3, metal: 0.8 }, { r: [Math.PI / 2, 0, 0], p: [0, 0, 0.01] }, 16);
    const ng = d.add(nb.build());
    needle.add(new THREE.Mesh(ng, d.add(createPropMaterial({ snow: 0 }))));
  }
  // readout plate below the dial
  const readCanvas = document.createElement('canvas');
  readCanvas.width = 512;
  readCanvas.height = 208;
  const readTex = d.add(new THREE.CanvasTexture(readCanvas));
  readTex.colorSpace = THREE.SRGBColorSpace;
  readTex.anisotropy = 4;
  const readMat = d.add(new THREE.MeshBasicNodeMaterial({ map: readTex, color: new THREE.Color(1.3, 1.3, 1.3) }));
  const readGeo = d.add(new THREE.PlaneGeometry(1.36, 0.55));
  const readout = new THREE.Mesh(readGeo, readMat);
  readout.position.set(0, -dialR - 0.42, 0.0);
  gauge.add(readout);
  const readFrameGeo = d.add(new THREE.BoxGeometry(1.44, 0.63, 0.06));
  const readFrame = new THREE.Mesh(readFrameGeo, d.add(new THREE.MeshStandardNodeMaterial({ color: new THREE.Color('#222b36'), roughness: 0.45, metalness: 0.8 })));
  readFrame.position.set(0, -dialR - 0.42, -0.045);
  gauge.add(readFrame);

  let shown = { text: '', state: '' };
  const drawReadout = (weight: number, maxW: number, count: number, cap: number, col: string) => {
    const key = `${weight}|${maxW}|${count}|${cap}|${col}`;
    if (key === shown.text) return;
    shown.text = key;
    const g = readCanvas.getContext('2d')!;
    const w = readCanvas.width;
    const h = readCanvas.height;
    g.clearRect(0, 0, w, h);
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0b1626');
    bg.addColorStop(1, '#050a12');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = col;
    g.globalAlpha = 0.45;
    g.lineWidth = 4;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.globalAlpha = 1;
    g.fillStyle = col;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 96px sans-serif';
    g.shadowColor = col;
    g.shadowBlur = 18;
    g.fillText(`${Math.round(weight)} / ${Math.round(maxW)} kg`, w / 2, h * 0.42);
    g.shadowBlur = 0;
    g.fillStyle = '#8fb8de';
    g.font = '600 40px sans-serif';
    const over = weight > maxW;
    g.fillText(over ? 'ÜBERLAST' : `${count} / ${cap} Plätze`, w / 2, h * 0.8);
    readTex.needsUpdate = true;
  };
  drawReadout(0, 100, 0, 3, GREEN);

  const ind = { ratio: 0, cur: dialAngle(0), vel: 0, target: dialAngle(0) };
  const setIndicator = (info: Indicator) => {
    const maxW = info.maxWeight ?? 100;
    const weight = info.weight ?? 0;
    const ratio = maxW > 0 ? weight / maxW : 0;
    ind.ratio = ratio;
    ind.target = dialAngle(ratio);
    const col = ratio > 1.0001 ? RED : ratio > 0.75 ? AMBER : GREEN;
    ringColor.value.set(col);
    drawReadout(weight, maxW, info.count, info.capacity, col);
  };
  setIndicator({ count: 0, capacity: 3, weight: 0, maxWeight: 100 });
  needle.rotation.z = ind.cur;

  // ── wake (foam that appears while moving) ──
  const wakeMat = d.add(new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false }));
  {
    const p = uv().sub(0.5).mul(2);
    const dist = length(p.mul(vec2(0.85, 1.0)));
    const n = mx_noise_float(vec3(uv().mul(vec2(9, 7)), time.mul(0.6))).mul(0.5).add(0.5);
    const foamRing = smoothstep(1.0, 0.35, dist);
    wakeMat.colorNode = color(new THREE.Color('#d7f1ff')).mul(1.1);
    wakeMat.opacityNode = foamRing.mul(n.mul(0.9)).mul(moveU).mul(0.55);
  }
  const wakeGeo = d.add(new THREE.PlaneGeometry(5.0, 5.6));
  wakeGeo.rotateX(-Math.PI / 2);
  const wake = new THREE.Mesh(wakeGeo, wakeMat);
  wake.position.y = 0.035;
  wake.renderOrder = 4;
  root.add(wake);

  // ── steam from the heated deck ──
  const steam = createParticles({
    count: 46,
    min: [-1.4, dk + 0.1, -1.6],
    max: [1.4, dk + 1.9, 1.6],
    color: '#bfe2ff',
    size: 0.5,
    motion: 'rise',
    speed: 0.5,
    wind: [0.6, 0],
    additive: false,
    opacity: 0.16,
    quality: q,
  });
  steam.renderOrder = 6;
  hull.add(steam);

  // ── light ──
  let light: THREE.PointLight | null = null;
  if (o.allowLight) {
    light = new THREE.PointLight(new THREE.Color('#ffb066'), 12, 10, 2);
    light.position.set(0, 1.9, 0.5);
    root.add(light);
  }

  // ── seats ──
  const seats: THREE.Object3D[] = seatPos.map(([x, z], i) => {
    const s = new THREE.Object3D();
    s.name = `seat:${i}`;
    s.position.set(x, dk + 0.02, z);
    root.add(s);
    return s;
  });

  // ── pick proxy ──
  const proxyGeo = d.add(new THREE.BoxGeometry(3.5, 2.6, 4.0));
  const proxy = new THREE.Mesh(proxyGeo, d.add(new THREE.MeshBasicNodeMaterial({ visible: false })));
  proxy.position.set(0, 1.0, 0);
  proxy.name = 'pick:vehicle';
  proxy.userData.pick = { kind: 'vehicle', id: 'vehicle' };
  root.add(proxy);

  const vehicle: VehicleRig = {
    root,
    seats,
    docks: [new THREE.Vector3(-DOCK_X, 0, 0), new THREE.Vector3(DOCK_X, 0, 0)],
    yaw: [0, 0],
    pickProxy: proxy,
    crossingTime: 3.4,
    update(dt, t, moving) {
      moveU.value += (moving - moveU.value) * (1 - Math.exp(-dt * 6));
      const mv = moveU.value;
      // bobbing on the swell (stronger while under way)
      const by = Math.sin(t * 1.3) * 0.022 + Math.sin(t * 2.3 + 1.0) * 0.012 - mv * 0.018;
      hull.position.y = by;
      hull.rotation.z = Math.sin(t * 0.9) * 0.012 + Math.sin(t * 3.1) * 0.004 * mv;
      hull.rotation.x = Math.sin(t * 1.1 + 2.0) * 0.009 + mv * 0.02 * Math.sin(t * 1.8);
      for (const s of seats) s.position.y = dk + 0.02 + by;
      // winch drum + gauge + lights
      drumGroup.rotation.z += dt * mv * 5.5;
      heat.value = 0.85 + 0.15 * Math.sin(t * 1.4) + mv * 0.25;
      beaconU.value = 0.55 + 0.45 * Math.sin(t * 6.0) * Math.sin(t * 6.0) + mv * 0.3;
      beaconGroup.rotation.y = t * (1.4 + mv * 3.5);
      const k = 60;
      const c = 9;
      ind.vel += (ind.target - ind.cur) * k * dt;
      ind.vel *= Math.exp(-c * dt);
      ind.cur += ind.vel * dt;
      needle.rotation.z = ind.cur + (mv > 0.05 ? Math.sin(t * 40) * 0.004 : 0);
      if (light) light.intensity = 9 + 10 * mv + Math.sin(t * 3) * 0.6;
    },
    setIndicator,
  };
  void exp;
  void positionLocal;
  void Fn;
  void glowMat;
  return {
    vehicle,
    light,
    dispose() {
      /* geometries/materials are tracked by the shared disposer */
    },
  };
}
