export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  level: QualityLevel;
  label: string;
  /** Upper bound for the device pixel ratio. */
  maxPixelRatio: number;
  /** Lower bound the adaptive resolution may fall to. */
  minPixelRatio: number;
  msaa: boolean;
  shadows: boolean;
  shadowMapSize: number;
  softShadows: boolean;
  post: {
    enabled: boolean;
    bloom: boolean;
    ao: boolean;
    godrays: boolean;
    dof: boolean;
    grading: boolean;
  };
  /** Multiplier for particle counts. */
  particles: number;
  /** Multiplier for scattered vegetation / props. */
  density: number;
  /** 0 = simple shaded water, 1 = + depth colour & foam, 2 = + refraction. */
  water: 0 | 1 | 2;
  /** Max. number of dynamic local lights a world should enable. */
  localLights: number;
  /** Distance multiplier for LOD switches (higher = keep detail longer). */
  lodScale: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    level: 'low',
    label: 'Niedrig',
    maxPixelRatio: 1,
    minPixelRatio: 0.6,
    msaa: false,
    shadows: true,
    shadowMapSize: 1024,
    softShadows: false,
    post: { enabled: false, bloom: false, ao: false, godrays: false, dof: false, grading: false },
    particles: 0.35,
    density: 0.45,
    water: 0,
    localLights: 2,
    lodScale: 0.6,
  },
  medium: {
    level: 'medium',
    label: 'Mittel',
    maxPixelRatio: 1.25,
    minPixelRatio: 0.75,
    msaa: true,
    shadows: true,
    shadowMapSize: 2048,
    softShadows: true,
    post: { enabled: true, bloom: true, ao: false, godrays: false, dof: false, grading: true },
    particles: 0.65,
    density: 0.7,
    water: 1,
    localLights: 4,
    lodScale: 0.85,
  },
  high: {
    level: 'high',
    label: 'Hoch',
    maxPixelRatio: 1.75,
    minPixelRatio: 0.85,
    msaa: true,
    shadows: true,
    shadowMapSize: 2048,
    softShadows: true,
    post: { enabled: true, bloom: true, ao: true, godrays: false, dof: false, grading: true },
    particles: 1,
    density: 1,
    water: 2,
    localLights: 6,
    lodScale: 1,
  },
  ultra: {
    level: 'ultra',
    label: 'Ultra',
    maxPixelRatio: 2,
    minPixelRatio: 1,
    msaa: true,
    shadows: true,
    shadowMapSize: 4096,
    softShadows: true,
    post: { enabled: true, bloom: true, ao: true, godrays: true, dof: true, grading: true },
    particles: 1.5,
    density: 1.35,
    water: 2,
    localLights: 10,
    lodScale: 1.4,
  },
};

export const QUALITY_ORDER: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

export function lowerQuality(q: QualityLevel): QualityLevel {
  const i = QUALITY_ORDER.indexOf(q);
  return QUALITY_ORDER[Math.max(0, i - 1)]!;
}
