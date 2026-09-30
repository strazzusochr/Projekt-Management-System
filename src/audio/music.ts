import { bell, mallet, midiToFreq, mulberry32, noise, pad, pluck, thump, tone, type VoiceOut } from './synth';

export type MusicId = 'map' | 'forest' | 'temple' | 'neon' | 'harbor' | 'ice';

type Voice = 'pluck' | 'mallet' | 'bell' | 'glass' | 'synth' | 'flute' | 'horn';

interface MusicDef {
  bpm: number;
  root: number;
  scale: number[];
  /** Chords as scale-degree triads/tetrads, one per bar. */
  progression: number[][];
  pad?: { octave: number; gain: number; cutoff: number; type: OscillatorType; bars: number };
  arp?: { octave: number; pattern: number[]; voice: Voice; gain: number; probability: number };
  bass?: { octave: number; pattern: number[]; gain: number; type: 'sub' | 'saw' };
  drums?: { kick: number[]; hat: number[]; frame?: number[]; gain: number };
  lead?: { octave: number; voice: Voice; density: number; gain: number };
  drone?: { midi: number; gain: number };
}

const S = (s: string) => s.split('').map((c) => (c === '.' ? 0 : Number(c)));

const DEFS: Record<MusicId, MusicDef> = {
  map: {
    bpm: 76,
    root: 60,
    scale: [0, 2, 4, 5, 7, 9, 11],
    progression: [[0, 2, 4], [5, 7, 9], [3, 5, 7], [4, 6, 8]],
    pad: { octave: -1, gain: 0.05, cutoff: 1500, type: 'triangle', bars: 1 },
    arp: { octave: 1, pattern: [0, -1, 1, -1, 2, -1, 1, -1, 3, -1, 2, -1, 1, -1, 2, -1], voice: 'bell', gain: 0.045, probability: 0.9 },
    lead: { octave: 1, voice: 'flute', density: 0.18, gain: 0.03 },
  },
  forest: {
    bpm: 72,
    root: 62, // D
    scale: [0, 2, 4, 6, 7, 9, 11], // lydian – bright, magical
    progression: [[0, 2, 4], [4, 6, 8], [5, 7, 9], [3, 5, 7]],
    pad: { octave: -1, gain: 0.05, cutoff: 1300, type: 'sawtooth', bars: 2 },
    arp: { octave: 0, pattern: [0, 1, 2, 3, 2, 1, -1, 2, 0, 1, 2, 3, 4, 3, 2, -1], voice: 'pluck', gain: 0.07, probability: 0.85 },
    bass: { octave: -2, pattern: S('1.......2.......'), gain: 0.09, type: 'sub' },
    lead: { octave: 1, voice: 'flute', density: 0.22, gain: 0.035 },
  },
  temple: {
    bpm: 62,
    root: 50, // D
    scale: [0, 1, 4, 5, 7, 8, 10], // phrygian dominant – ancient, mysterious
    progression: [[0, 2, 4], [0, 2, 4], [1, 3, 5], [6, 8, 10]],
    pad: { octave: 0, gain: 0.04, cutoff: 900, type: 'sawtooth', bars: 2 },
    arp: { octave: 1, pattern: [0, -1, -1, 2, -1, 1, -1, -1, 0, -1, 3, -1, -1, 2, -1, -1], voice: 'mallet', gain: 0.09, probability: 0.8 },
    drums: { kick: S('1.......1..1....'), hat: S('................'), frame: S('..1...1...1.1.1.'), gain: 0.16 },
    drone: { midi: 38, gain: 0.05 },
    lead: { octave: 1, voice: 'flute', density: 0.12, gain: 0.03 },
  },
  neon: {
    bpm: 100,
    root: 57, // A minor
    scale: [0, 2, 3, 5, 7, 8, 10],
    progression: [[0, 2, 4], [5, 7, 9], [2, 4, 6], [6, 8, 10]],
    pad: { octave: 0, gain: 0.035, cutoff: 1800, type: 'sawtooth', bars: 1 },
    arp: { octave: 1, pattern: [0, 1, 2, 1, 0, 1, 2, 3, 0, 1, 2, 1, 0, 2, 3, 2], voice: 'synth', gain: 0.045, probability: 1 },
    bass: { octave: -2, pattern: S('1.1.1.1.1.1.1.1.'), gain: 0.07, type: 'saw' },
    drums: { kick: S('1...1...1...1...'), hat: S('..1...1...1...11'), gain: 0.12 },
  },
  harbor: {
    bpm: 84,
    root: 60, // C lydian – bright, epic
    scale: [0, 2, 4, 6, 7, 9, 11],
    progression: [[0, 2, 4], [1, 3, 5], [4, 6, 8], [0, 2, 4, 6]],
    pad: { octave: 0, gain: 0.05, cutoff: 2200, type: 'sawtooth', bars: 1 },
    arp: { octave: 1, pattern: [0, -1, 2, -1, 4, -1, 2, -1, 0, -1, 2, -1, 4, 3, 2, -1], voice: 'bell', gain: 0.05, probability: 0.8 },
    bass: { octave: -2, pattern: S('1.......1...2...'), gain: 0.08, type: 'sub' },
    lead: { octave: 1, voice: 'horn', density: 0.14, gain: 0.03 },
  },
  ice: {
    bpm: 56,
    root: 52, // E
    scale: [0, 2, 3, 5, 7, 9, 10], // dorian – cold, curious
    progression: [[0, 2, 4, 6], [3, 5, 7], [5, 7, 9], [4, 6, 8]],
    pad: { octave: 0, gain: 0.04, cutoff: 1600, type: 'triangle', bars: 2 },
    arp: { octave: 2, pattern: [0, -1, -1, -1, 2, -1, -1, 4, -1, -1, 3, -1, -1, -1, 1, -1], voice: 'glass', gain: 0.05, probability: 0.75 },
    drone: { midi: 40, gain: 0.035 },
    lead: { octave: 1, voice: 'glass', density: 0.1, gain: 0.03 },
  },
};

/** Look-ahead step sequencer that plays one generative piece at a time with crossfades. */
export class MusicPlayer {
  private current: { id: MusicId; def: MusicDef; gain: GainNode; step: number; nextTime: number; rng: () => number; droneStop?: () => void } | null = null;
  private readonly lookahead = 0.3;

  constructor(
    private readonly ctx: AudioContext,
    private readonly dest: AudioNode,
    private readonly send: AudioNode,
  ) {}

  play(id: MusicId): void {
    if (this.current?.id === id) return;
    this.stop(1.8);
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, this.ctx.currentTime + 0.1, 1.2);
    gain.connect(this.dest);
    const def = DEFS[id];
    this.current = { id, def, gain, step: 0, nextTime: this.ctx.currentTime + 0.2, rng: mulberry32(id.length * 7919 + 17) };
    if (def.drone) this.current.droneStop = this.startDrone(def.drone.midi, def.drone.gain, gain);
  }

  stop(fade = 1): void {
    const c = this.current;
    if (!c) return;
    const t = this.ctx.currentTime;
    c.gain.gain.cancelScheduledValues(t);
    c.gain.gain.setTargetAtTime(0, t, fade / 3);
    c.droneStop?.();
    setTimeout(() => c.gain.disconnect(), (fade + 0.5) * 1000);
    this.current = null;
  }

  private startDrone(midi: number, gainAmt: number, bus: AudioNode): () => void {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(gainAmt, ctx.currentTime, 2);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain).connect(f.frequency);
    const oscs = [0, 7, 12].map((iv, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sawtooth' : 'triangle';
      o.frequency.value = midiToFreq(midi + iv);
      o.detune.value = (i - 1) * 5;
      o.connect(f);
      o.start();
      return o;
    });
    f.connect(g).connect(bus);
    lfo.start();
    return () => {
      const t = ctx.currentTime;
      g.gain.setTargetAtTime(0, t, 0.6);
      setTimeout(() => {
        oscs.forEach((o) => o.stop());
        lfo.stop();
        g.disconnect();
      }, 3000);
    };
  }

  /** Schedules all steps inside the look-ahead window. Call every frame. */
  update(): void {
    const c = this.current;
    if (!c) return;
    const stepDur = 60 / c.def.bpm / 4;
    // if the tab was hidden for a while, skip ahead instead of bursting notes
    if (c.nextTime < this.ctx.currentTime - 0.5) c.nextTime = this.ctx.currentTime + 0.05;
    while (c.nextTime < this.ctx.currentTime + this.lookahead) {
      this.scheduleStep(c, c.step, c.nextTime);
      c.step++;
      c.nextTime += stepDur;
    }
  }

  private scheduleStep(c: NonNullable<MusicPlayer['current']>, step: number, t: number): void {
    const d = c.def;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = d.progression[bar % d.progression.length]!;
    const out: VoiceOut = { dest: c.gain, send: this.send, sendAmt: 0.45 };
    const note = (degree: number, octave: number) => {
      const len = d.scale.length;
      const oct = Math.floor(degree / len);
      const idx = ((degree % len) + len) % len;
      return d.root + d.scale[idx]! + 12 * (oct + octave);
    };
    const beat = 60 / d.bpm;

    if (d.pad && s === 0 && bar % d.pad.bars === 0) {
      pad(this.ctx, { ...out, sendAmt: 0.6 }, chord.map((deg) => midiToFreq(note(deg, d.pad!.octave))), t, beat * 4 * d.pad.bars - 0.2, d.pad.gain, d.pad.cutoff, d.pad.type);
    }
    if (d.arp) {
      const idx = d.arp.pattern[s]!;
      if (idx >= 0 && c.rng() < d.arp.probability) {
        const deg = chord[idx % chord.length]! + (idx >= chord.length ? d.scale.length : 0);
        this.voice(d.arp.voice, midiToFreq(note(deg, d.arp.octave)), t, d.arp.gain * (0.8 + c.rng() * 0.3), out, (c.rng() - 0.5) * 0.6);
      }
    }
    if (d.bass) {
      const hit = d.bass.pattern[s]!;
      if (hit) {
        const deg = hit === 2 ? chord[0]! + 4 : chord[0]!;
        const f = midiToFreq(note(deg, d.bass.octave));
        if (d.bass.type === 'sub') tone(this.ctx, { dest: c.gain }, { type: 'sine', freq: f, t, dur: beat * 1.5, attack: 0.02, release: 0.4, gain: d.bass.gain });
        else tone(this.ctx, { dest: c.gain }, { type: 'sawtooth', freq: f, t, dur: beat * 0.35, attack: 0.005, release: 0.12, gain: d.bass.gain, filter: { type: 'lowpass', freq: 900, freqEnd: 220, q: 6 } });
      }
    }
    if (d.drums) {
      if (d.drums.kick[s]) thump(this.ctx, { dest: c.gain }, t, 70, d.drums.gain * 1.4, 0.35);
      if (d.drums.hat[s]) noise(this.ctx, { dest: c.gain }, { t, dur: 0.01, release: 0.05, gain: d.drums.gain * 0.25, filter: { type: 'highpass', freq: 7000 } });
      if (d.drums.frame?.[s]) {
        noise(this.ctx, { dest: c.gain, send: this.send, sendAmt: 0.4 }, { t, dur: 0.02, release: 0.18, gain: d.drums.gain * 0.5, filter: { type: 'bandpass', freq: 380, q: 2 } });
      }
    }
    if (d.lead && s % 2 === 0 && c.rng() < d.lead.density) {
      const deg = chord[Math.floor(c.rng() * chord.length)]! + (c.rng() < 0.3 ? 1 : 0);
      this.voice(d.lead.voice, midiToFreq(note(deg, d.lead.octave)), t, d.lead.gain, { ...out, sendAmt: 0.7 }, (c.rng() - 0.5) * 0.8, beat * (1 + Math.floor(c.rng() * 3)));
    }
  }

  private voice(v: Voice, f: number, t: number, gain: number, out: VoiceOut, pan: number, dur = 0.4): void {
    const o = { ...out, pan };
    switch (v) {
      case 'pluck':
        pluck(this.ctx, o, f, t, gain, 1.6, 2800);
        break;
      case 'mallet':
        mallet(this.ctx, o, f, t, gain, 1.1);
        break;
      case 'bell':
        bell(this.ctx, o, f, t, gain, 2.4, 2.0, 1.3);
        break;
      case 'glass':
        bell(this.ctx, o, f, t, gain, 3.2, 3.5, 0.9);
        break;
      case 'synth':
        tone(this.ctx, o, { type: 'sawtooth', freq: f, t, dur: 0.08, attack: 0.004, release: 0.2, gain, filter: { type: 'lowpass', freq: 3200, freqEnd: 600, q: 5 } });
        break;
      case 'flute':
        tone(this.ctx, o, { type: 'sine', freq: f, t, dur, attack: 0.12, release: 0.5, gain, vibrato: { rate: 5, depth: f * 0.008 } });
        break;
      case 'horn':
        tone(this.ctx, o, { type: 'sawtooth', freq: f / 2, t, dur, attack: 0.25, release: 0.7, gain, filter: { type: 'lowpass', freq: 900, q: 0.7 } });
        break;
    }
  }
}
