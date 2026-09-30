import * as THREE from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  color,
  float,
  mix,
  normalWorld,
  positionWorld,
  pow,
  sin,
  time,
  uniform,
  vec3,
  vertexColor,
} from 'three/tsl';

/**
 * Per-character material: colours and PBR parameters are baked into vertex attributes so that
 * all parts of one rig segment can be merged into a single draw call.
 * `aPbr` = (roughness, metalness, emissive strength), `aSheen` = cloth sheen amount.
 */
const mkFloat = () => uniform(0);
const mkColor = () => uniform(new THREE.Color());
type FloatU = ReturnType<typeof mkFloat>;
type ColorU = ReturnType<typeof mkColor>;

export interface CharacterMaterialHandles {
  material: THREE.MeshStandardNodeMaterial;
  /** 0 = none, 1 = hover, 2 = selected. Smoothly animated by the actor. */
  highlight: FloatU;
  highlightColor: ColorU;
  /** Pulsing warning glow (rule violation involvement). */
  alert: FloatU;
  /** Short positive flash (successful action). */
  flash: FloatU;
  /** Fade-out for spirits / teleports (1 = fully visible). */
  presence: FloatU;
}

export function createCharacterMaterial(opts: { translucent?: boolean; ghostColor?: THREE.Color } = {}): CharacterMaterialHandles {
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true });
  const highlight = uniform(0);
  const highlightColor = uniform(new THREE.Color(1.0, 0.86, 0.45));
  const alert = uniform(0);
  const flash = uniform(0);
  const presence = uniform(1);

  const pbr = attribute('aPbr', 'vec3');
  material.roughnessNode = pbr.x;
  material.metalnessNode = pbr.y;

  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const fres = pow(float(1).sub(normalWorld.dot(viewDir).abs().clamp(0, 1)), 2.2);
  const pulse = sin(time.mul(7)).mul(0.5).add(0.5);
  const hl = fres.mul(highlight.mul(0.55)).add(highlight.mul(0.06));
  const alertGlow = fres.mul(alert).mul(pulse.mul(0.9).add(0.35));
  const baseEmissive = vertexColor().rgb.mul(pbr.z);
  // subtle rim + self light so figures stay readable in dark worlds (night city, polar night)
  const rim = pow(fres, 1.6).mul(0.22).add(0.035);
  let emissive = baseEmissive
    .add(vertexColor().rgb.mul(rim))
    .add(highlightColor.mul(hl))
    .add(vec3(1.0, 0.22, 0.12).mul(alertGlow))
    .add(color(0.7, 1.0, 0.75).mul(flash.mul(fres.add(0.25)).mul(0.8)));

  if (opts.translucent) {
    material.transparent = true;
    material.depthWrite = false;
    const ghost = opts.ghostColor ?? new THREE.Color(0.6, 0.9, 1.0);
    material.opacityNode = mix(float(0.25), float(0.8), fres).mul(presence);
    emissive = emissive.add(color(ghost).mul(fres.mul(1.2).add(0.15)));
  } else {
    material.opacityNode = presence;
  }
  material.emissiveNode = emissive;
  return { material, highlight, highlightColor, alert, flash, presence };
}
