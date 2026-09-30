import type { QualityLevel } from '../render/quality';

/** Runtime configuration derived from URL parameters (see docs/QA-CONTRACT.md). */
export interface AppConfig {
  forceWebGL: boolean;
  quality: QualityLevel | null;
  debug: boolean;
  qa: boolean;
  level: string | null;
  /** Disable adaptive resolution (useful for deterministic screenshots). */
  adaptive: boolean;
  /** Mute audio from the start (automation). */
  mute: boolean;
}

const QUALITY_VALUES: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

export function readConfig(search: string = window.location.search): AppConfig {
  const p = new URLSearchParams(search);
  const q = p.get('quality');
  return {
    forceWebGL: p.get('renderer') === 'webgl',
    quality: q && (QUALITY_VALUES as string[]).includes(q) ? (q as QualityLevel) : null,
    debug: p.get('debug') === '1',
    qa: p.get('qa') === '1',
    level: p.get('level'),
    adaptive: p.get('adaptive') !== '0',
    mute: p.get('mute') === '1',
  };
}
