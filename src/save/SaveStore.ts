import type { QualityLevel } from '../render/quality';

/** Persisted progress and settings (localStorage, versioned). */
export interface LevelRecord {
  completed: boolean;
  /** Best result in the level metric (crossings or minutes). */
  bestCost: number | null;
  bestMoves: number | null;
  bestStars: number;
  /** Solved without using any hint at least once. */
  noHintClear: boolean;
  plays: number;
  completedAt: string | null;
}

export interface Settings {
  quality: QualityLevel;
  /** true while the quality was chosen automatically (may be adjusted by the benchmark). */
  qualityAuto: boolean;
  musicVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  muted: boolean;
  /** Reduce camera motion & screen shake. */
  reducedMotion: boolean;
  /** Skip intro camera flights after the first visit. */
  skipSeenIntros: boolean;
}

export interface SaveData {
  version: 1;
  unlocked: string[];
  levels: Record<string, LevelRecord>;
  seenIntros: string[];
  lastLevel: string | null;
  settings: Settings;
}

const KEY = 'riverbound.save.v1';

export const DEFAULT_SETTINGS: Settings = {
  quality: 'high',
  qualityAuto: true,
  musicVolume: 0.55,
  sfxVolume: 0.8,
  ambienceVolume: 0.7,
  muted: false,
  reducedMotion: false,
  skipSeenIntros: false,
};

function defaults(firstLevel: string): SaveData {
  return {
    version: 1,
    unlocked: [firstLevel],
    levels: {},
    seenIntros: [],
    lastLevel: null,
    settings: { ...DEFAULT_SETTINGS },
  };
}

function emptyRecord(): LevelRecord {
  return { completed: false, bestCost: null, bestMoves: null, bestStars: 0, noHintClear: false, plays: 0, completedAt: null };
}

/** Storage that survives reloads; falls back to memory if localStorage is unavailable. */
export class SaveStore {
  private data: SaveData;
  private memoryOnly = false;
  private listeners = new Set<(d: SaveData) => void>();

  constructor(private readonly levelOrder: readonly string[]) {
    this.data = this.load();
  }

  private load(): SaveData {
    const fallback = defaults(this.levelOrder[0]!);
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      if (parsed.version !== 1) return fallback;
      return {
        version: 1,
        unlocked: Array.isArray(parsed.unlocked) && parsed.unlocked.length ? parsed.unlocked.filter((id) => this.levelOrder.includes(id)) : fallback.unlocked,
        levels: typeof parsed.levels === 'object' && parsed.levels ? parsed.levels : {},
        seenIntros: Array.isArray(parsed.seenIntros) ? parsed.seenIntros : [],
        lastLevel: typeof parsed.lastLevel === 'string' ? parsed.lastLevel : null,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      };
    } catch {
      this.memoryOnly = true;
      return fallback;
    }
  }

  private persist(): void {
    if (!this.memoryOnly) {
      try {
        window.localStorage.setItem(KEY, JSON.stringify(this.data));
      } catch {
        this.memoryOnly = true;
      }
    }
    for (const l of this.listeners) l(this.data);
  }

  onChange(fn: (d: SaveData) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get snapshot(): Readonly<SaveData> {
    return this.data;
  }

  get settings(): Readonly<Settings> {
    return this.data.settings;
  }

  updateSettings(patch: Partial<Settings>): void {
    this.data.settings = { ...this.data.settings, ...patch };
    this.persist();
  }

  isUnlocked(id: string): boolean {
    return this.data.unlocked.includes(id);
  }

  record(id: string): LevelRecord {
    return this.data.levels[id] ?? emptyRecord();
  }

  markStarted(id: string): void {
    const r = { ...this.record(id) };
    r.plays++;
    this.data.levels[id] = r;
    this.data.lastLevel = id;
    this.persist();
  }

  markIntroSeen(id: string): void {
    if (!this.data.seenIntros.includes(id)) {
      this.data.seenIntros.push(id);
      this.persist();
    }
  }

  /** Stores a completed run; returns whether it improved the best result. */
  complete(id: string, result: { cost: number; moves: number; stars: number; hintsUsed: number }): { improved: boolean; unlockedNext: string | null } {
    const r = { ...this.record(id) };
    const improved = r.bestCost === null || result.cost < r.bestCost || (result.cost === r.bestCost && result.moves < (r.bestMoves ?? Infinity));
    r.completed = true;
    if (improved) {
      r.bestCost = result.cost;
      r.bestMoves = result.moves;
    }
    r.bestStars = Math.max(r.bestStars, result.stars);
    if (result.hintsUsed === 0) r.noHintClear = true;
    r.completedAt = r.completedAt ?? new Date().toISOString();
    this.data.levels[id] = r;
    let unlockedNext: string | null = null;
    const idx = this.levelOrder.indexOf(id);
    const next = this.levelOrder[idx + 1];
    if (next && !this.data.unlocked.includes(next)) {
      this.data.unlocked.push(next);
      unlockedNext = next;
    }
    this.persist();
    return { improved, unlockedNext };
  }

  unlockAll(): void {
    this.data.unlocked = [...this.levelOrder];
    this.persist();
  }

  resetProgress(): void {
    const settings = this.data.settings;
    this.data = defaults(this.levelOrder[0]!);
    this.data.settings = settings;
    this.persist();
  }
}
