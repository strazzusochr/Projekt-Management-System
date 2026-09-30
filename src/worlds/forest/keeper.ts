import { HumanoidActor } from '../../characters/HumanoidActor';
import type { HumanoidSpec } from '../../characters/HumanoidBuilder';
import { bake, ellipsoid, merge, roundedBox, torus, tube } from '../../characters/geo';

/** Mira – young forest keeper (auburn braid, green hooded tunic with leaf trim, satchel, boots). */
export function createMira(): HumanoidActor {
  const spec: HumanoidSpec = {
    height: 1.62,
    build: { shoulders: 0.92, hips: 0.98, chest: 0.95, limbs: 0.95, head: 1.03, legs: 1.0 },
    skin: '#eab998',
    eyes: { iris: '#3f8f5a', size: 1.1 },
    hair: { style: 'braid', color: '#8e401e', accent: '#58ad5c' },
    brows: { color: '#6e3218', thickness: 0.9 },
    nose: 'button',
    ears: 'normal',
    lips: '#cc7069',
    blush: 0.32,
    freckles: true,
    outfit: {
      top: { kind: 'tunic', color: '#3d8149', accent: '#2b5d36', trim: '#bcd979', length: 0.3, collar: 'hood', sleeves: 'long' },
      bottom: { kind: 'leggings', color: '#7d5b3a' },
      shoes: { kind: 'boots', color: '#5b3c27', sole: '#2b1d14' },
      belt: '#6d4527',
    },
    idle: 'lookout',
  };
  const mira = new HumanoidActor({ id: 'keeper', name: 'Mira', spec, walkSpeed: 1.45, sitsInVehicle: true });
  const rig = mira.rig;
  const H = spec.height;
  const hipR = H * 0.085;
  const torsoLen = rig.dims.torsoLen;

  // satchel on the hip (hips space)
  const leather = { color: '#7a4a28', rough: 0.7 };
  const bag = [
    bake(roundedBox(0.075, 0.17, 0.2, 0.022), leather, { p: [hipR * 1.5, -0.02, -0.03] }),
    bake(roundedBox(0.085, 0.07, 0.215, 0.02), { color: '#8a5830', rough: 0.65 }, { p: [hipR * 1.5, 0.045, -0.03] }),
    bake(ellipsoid(0.008, 0.032, 0.02, 8, 6), { color: '#8fe0a0', rough: 0.3, emit: 1.2 }, { p: [hipR * 1.5 + 0.045, 0.045, -0.03], r: [0, 0, 0.0] }),
    bake(roundedBox(0.014, 0.03, 0.03, 0.005), { color: '#d0a850', rough: 0.3, metal: 0.9 }, { p: [hipR * 1.5 + 0.045, -0.01, -0.03] }),
  ];
  mira.attach(rig.hips, merge(bag), 'satchel');

  // hem leaf trim (hips space)
  const hemY = torsoLen * 0.12 - 0.3 * (rig.dims.legLen - H * 0.07);
  const leaves = [];
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    leaves.push(bake(ellipsoid(0.03, 0.06, 0.008, 8, 6), { color: k % 2 ? '#9fd05f' : '#7fb84f', rough: 0.6 }, { p: [Math.sin(a) * 0.212, hemY - 0.01, Math.cos(a) * 0.182], r: [0, a, 0] }));
  }
  mira.attach(rig.hips, merge(leaves), 'hemLeaves');

  // cross-body strap, leaf clasp and magic pendant (torso space)
  const T = torsoLen * 0.88;
  const chest = [
    bake(tube([[-0.1, T * 0.95, 0.0], [-0.04, T * 0.72, 0.11], [0.08, T * 0.36, 0.12], [0.19, T * 0.02, 0.06]], 0.012, 14, 6), leather),
    bake(ellipsoid(0.02, 0.028, 0.012, 8, 6), { color: '#9aff9f', rough: 0.25, emit: 2.6 }, { p: [0.0, T * 0.82, 0.118] }),
    bake(torus(0.026, 0.004, Math.PI * 2, 12, 4), { color: '#d0a850', rough: 0.3, metal: 0.9 }, { p: [0.0, T * 0.82, 0.116] }),
  ];
  mira.attach(rig.torso, merge(chest), 'strap');
  return mira;
}
