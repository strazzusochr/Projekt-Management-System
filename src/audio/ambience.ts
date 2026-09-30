import { bell, midiToFreq, noise, noiseBuffer, thump, tone, type VoiceOut } from './synth';

export type AmbienceId = 'map' | 'forest' | 'temple' | 'neon' | 'harbor' | 'ice' | 'none';

interface LoopSpec {
  filter: BiquadFilterType;
  freq: number;
  q?: number;
  gain: number;
  /** Slow modulation of the filter frequency (Hz, depth in Hz). */
  lfo?: { rate: number; depth: number };
  /** Slow modulation of the gain (rate Hz, depth 0..1). */
  swell?: { rate: number; depth: number };
  playbackRate?: number;
  pan?: number;
}

interface EventSpec {
  /** Average seconds between events. */
  every: number;
  play: (ctx: AudioContext, out: VoiceOut, t: number) => void;
}

interface AmbienceDef {
  loops: LoopSpec[];
  events: EventSpec[];
}

const birdChirp = (ctx: AudioContext, out: VoiceOut, t: number) => {
  const base = 2400 + Math.random() * 1800;
  const n = 2 + Math.floor(Math.random() * 4);
  const pan = Math.random() * 1.6 - 0.8;
  for (let i = 0; i < n; i++) {
    tone(ctx, { ...out, pan }, { type: 'sine', freq: base * (1 + Math.random() * 0.2), freqEnd: base * (0.7 + Math.random() * 0.6), t: t + i * (0.08 + Math.random() * 0.05), dur: 0.05, attack: 0.005, release: 0.04, gain: 0.025 });
  }
};

const DEFS: Record<Exclude<AmbienceId, 'none'>, AmbienceDef> = {
  map: {
    loops: [{ filter: 'bandpass', freq: 500, q: 0.6, gain: 0.05, lfo: { rate: 0.05, depth: 250 }, swell: { rate: 0.08, depth: 0.5 } }],
    events: [{ every: 7, play: (ctx, out, t) => bell(ctx, { ...out, pan: Math.random() - 0.5 }, midiToFreq(84 + [0, 4, 7, 11][Math.floor(Math.random() * 4)]!), t, 0.015, 3, 2.01, 1) }],
  },
  forest: {
    loops: [
      { filter: 'lowpass', freq: 520, q: 0.4, gain: 0.14, lfo: { rate: 0.13, depth: 140 } }, // river
      { filter: 'bandpass', freq: 2600, q: 0.7, gain: 0.035, swell: { rate: 0.09, depth: 0.8 }, pan: 0.4 }, // leaves
      { filter: 'bandpass', freq: 1400, q: 0.5, gain: 0.04, pan: -0.6 }, // small waterfall
    ],
    events: [
      { every: 3.2, play: birdChirp },
      {
        every: 11,
        play: (ctx, out, t) => {
          // cuckoo-like call in the distance
          const pan = Math.random() - 0.5;
          tone(ctx, { ...out, pan, sendAmt: 0.8 }, { type: 'sine', freq: 740, t, dur: 0.18, attack: 0.02, release: 0.15, gain: 0.02 });
          tone(ctx, { ...out, pan, sendAmt: 0.8 }, { type: 'sine', freq: 587, t: t + 0.3, dur: 0.24, attack: 0.02, release: 0.2, gain: 0.02 });
        },
      },
    ],
  },
  temple: {
    loops: [
      { filter: 'lowpass', freq: 380, q: 0.3, gain: 0.16, pan: 0.5 }, // waterfalls
      { filter: 'bandpass', freq: 5200, q: 8, gain: 0.02, swell: { rate: 1.7, depth: 0.9 }, pan: -0.3 }, // insects
      { filter: 'lowpass', freq: 160, q: 0.8, gain: 0.08, swell: { rate: 0.03, depth: 0.6 } }, // cavern rumble
    ],
    events: [
      {
        every: 2.4,
        play: (ctx, out, t) => {
          const f = 1400 + Math.random() * 1600;
          tone(ctx, { ...out, pan: Math.random() * 1.6 - 0.8, sendAmt: 0.9 }, { type: 'sine', freq: f, freqEnd: f * 0.55, t, dur: 0.04, attack: 0.002, release: 0.08, gain: 0.03 });
        },
      },
      {
        every: 22,
        play: (ctx, out, t) => {
          noise(ctx, { ...out, sendAmt: 0.6 }, { t, dur: 2.5, attack: 0.3, release: 2.5, gain: 0.18, filter: { type: 'lowpass', freq: 220, freqEnd: 90 } });
          thump(ctx, out, t + 0.1, 45, 0.2, 1.6);
        },
      },
    ],
  },
  neon: {
    loops: [
      { filter: 'highpass', freq: 2500, q: 0.3, gain: 0.07 }, // rain
      { filter: 'bandpass', freq: 900, q: 0.4, gain: 0.05, lfo: { rate: 0.2, depth: 300 } }, // rain on surfaces
      { filter: 'lowpass', freq: 120, q: 1.2, gain: 0.1, swell: { rate: 0.05, depth: 0.4 } }, // city rumble
    ],
    events: [
      {
        every: 6,
        play: (ctx, out, t) => {
          const pan = Math.random() * 2 - 1;
          noise(ctx, { ...out, pan, sendAmt: 0.3 }, { t, dur: 1.4, attack: 0.7, release: 0.8, gain: 0.05, filter: { type: 'bandpass', freq: 400, freqEnd: 1200, q: 1.2 } });
        },
      },
      {
        every: 9,
        play: (ctx, out, t) => {
          // neon buzz flicker
          tone(ctx, { ...out, pan: Math.random() - 0.5 }, { type: 'sawtooth', freq: 120, t, dur: 0.25 + Math.random() * 0.4, attack: 0.01, release: 0.05, gain: 0.012, filter: { type: 'bandpass', freq: 1800, q: 3 } });
        },
      },
    ],
  },
  harbor: {
    loops: [
      { filter: 'bandpass', freq: 650, q: 0.5, gain: 0.08, lfo: { rate: 0.06, depth: 350 }, swell: { rate: 0.07, depth: 0.7 } }, // wind
      { filter: 'lowpass', freq: 300, q: 0.4, gain: 0.05, swell: { rate: 0.04, depth: 0.5 } },
    ],
    events: [
      {
        every: 7,
        play: (ctx, out, t) => {
          const pan = Math.random() * 1.6 - 0.8;
          for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
            tone(ctx, { ...out, pan, sendAmt: 0.6 }, { type: 'triangle', freq: 1500, freqEnd: 900, t: t + i * 0.28, dur: 0.18, attack: 0.02, release: 0.1, gain: 0.018, vibrato: { rate: 18, depth: 40 } });
          }
        },
      },
      {
        every: 5,
        play: (ctx, out, t) => {
          const notes = [79, 83, 86, 88, 91];
          for (let i = 0; i < 3; i++) bell(ctx, { ...out, pan: Math.random() - 0.5, sendAmt: 0.7 }, midiToFreq(notes[Math.floor(Math.random() * notes.length)]!), t + i * (0.12 + Math.random() * 0.2), 0.012, 2.5, 3.01, 1.2);
        },
      },
      {
        every: 13,
        play: (ctx, out, t) => noise(ctx, { ...out, pan: Math.random() - 0.5 }, { t, dur: 0.6, attack: 0.1, release: 0.3, gain: 0.03, filter: { type: 'bandpass', freq: 220, freqEnd: 160, q: 9 } }),
      },
    ],
  },
  ice: {
    loops: [
      { filter: 'bandpass', freq: 900, q: 0.8, gain: 0.09, lfo: { rate: 0.11, depth: 600 }, swell: { rate: 0.13, depth: 0.85 } }, // blizzard
      { filter: 'highpass', freq: 4500, q: 0.3, gain: 0.025, swell: { rate: 0.2, depth: 0.7 } }, // snow hiss
      { filter: 'lowpass', freq: 90, q: 1, gain: 0.06 },
    ],
    events: [
      {
        every: 8,
        play: (ctx, out, t) => {
          noise(ctx, { ...out, pan: Math.random() * 2 - 1, sendAmt: 0.8 }, { t, dur: 0.03, release: 0.25, gain: 0.08, filter: { type: 'bandpass', freq: 2200 + Math.random() * 2000, q: 2 } });
          thump(ctx, { ...out, sendAmt: 0.8 }, t + 0.02, 55, 0.08, 0.8);
        },
      },
      {
        every: 10,
        play: (ctx, out, t) => {
          tone(ctx, { ...out, pan: 0.6 }, { type: 'sine', freq: 1760, t, dur: 0.06, attack: 0.003, release: 0.05, gain: 0.012 });
          tone(ctx, { ...out, pan: 0.6 }, { type: 'sine', freq: 1760, t: t + 0.18, dur: 0.06, attack: 0.003, release: 0.05, gain: 0.012 });
        },
      },
    ],
  },
};

/** Continuous ambient beds (filtered noise loops) plus randomised one-shot events. */
export class AmbienceBed {
  private current: { id: AmbienceId; gain: GainNode; sources: AudioScheduledSourceNode[]; timers: number[] } | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly dest: AudioNode,
    private readonly send: AudioNode,
  ) {}

  play(id: AmbienceId): void {
    if (this.current?.id === id) return;
    this.stop();
    if (id === 'none') return;
    const ctx = this.ctx;
    const def = DEFS[id];
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, ctx.currentTime + 0.1, 1.5);
    gain.connect(this.dest);
    const sources: AudioScheduledSourceNode[] = [];
    for (const l of def.loops) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      src.loop = true;
      src.playbackRate.value = l.playbackRate ?? 1;
      const f = ctx.createBiquadFilter();
      f.type = l.filter;
      f.frequency.value = l.freq;
      f.Q.value = l.q ?? 0.7;
      const g = ctx.createGain();
      g.gain.value = l.gain;
      let node: AudioNode = g;
      if (l.pan !== undefined) {
        const p = ctx.createStereoPanner();
        p.pan.value = l.pan;
        g.connect(p);
        node = p;
      }
      src.connect(f).connect(g);
      node.connect(gain);
      if (l.lfo) {
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = l.lfo.rate;
        lg.gain.value = l.lfo.depth;
        lfo.connect(lg).connect(f.frequency);
        lfo.start();
        sources.push(lfo);
      }
      if (l.swell) {
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = l.swell.rate;
        lg.gain.value = l.gain * l.swell.depth * 0.5;
        g.gain.value = l.gain * (1 - l.swell.depth * 0.5);
        lfo.connect(lg).connect(g.gain);
        lfo.start();
        sources.push(lfo);
      }
      src.start(0, Math.random() * 2);
      sources.push(src);
    }
    this.current = { id, gain, sources, timers: def.events.map((e) => e.every * (0.3 + Math.random())) };
  }

  update(dt: number): void {
    const c = this.current;
    if (!c || c.id === 'none') return;
    const def = DEFS[c.id as Exclude<AmbienceId, 'none'>];
    const out: VoiceOut = { dest: c.gain, send: this.send, sendAmt: 0.35 };
    def.events.forEach((e, i) => {
      c.timers[i]! -= dt;
      if (c.timers[i]! <= 0) {
        c.timers[i] = e.every * (0.5 + Math.random());
        e.play(this.ctx, out, this.ctx.currentTime + 0.02);
      }
    });
  }

  /** Lets a world trigger a scripted ambient event (e.g. thunder synced to lightning). */
  trigger(kind: 'thunder' | 'crack' | 'gust'): void {
    const c = this.current;
    if (!c) return;
    const t = this.ctx.currentTime + 0.05;
    const out: VoiceOut = { dest: c.gain, send: this.send, sendAmt: 0.7 };
    if (kind === 'thunder') {
      noise(this.ctx, out, { t: t + 0.6, dur: 3, attack: 0.2, release: 3, gain: 0.22, filter: { type: 'lowpass', freq: 260, freqEnd: 80 } });
      thump(this.ctx, out, t + 0.65, 40, 0.25, 2);
    } else if (kind === 'crack') {
      noise(this.ctx, out, { t, dur: 0.05, release: 0.4, gain: 0.12, filter: { type: 'bandpass', freq: 3000, q: 1.5 } });
    } else {
      noise(this.ctx, out, { t, dur: 1.5, attack: 0.6, release: 1, gain: 0.08, filter: { type: 'bandpass', freq: 700, freqEnd: 1600, q: 0.6 } });
    }
  }

  stop(): void {
    const c = this.current;
    if (!c) return;
    const t = this.ctx.currentTime;
    c.gain.gain.cancelScheduledValues(t);
    c.gain.gain.setTargetAtTime(0, t, 0.5);
    setTimeout(() => {
      c.sources.forEach((s) => {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      });
      c.gain.disconnect();
    }, 2500);
    this.current = null;
  }
}
