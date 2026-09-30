import { bell, mallet, midiToFreq, noise, pluck, thump, tone, type VoiceOut } from './synth';

export type SfxName =
  | 'hover'
  | 'click'
  | 'ui'
  | 'select'
  | 'board'
  | 'unboard'
  | 'valid'
  | 'invalid'
  | 'depart'
  | 'arrive'
  | 'success'
  | 'levelComplete'
  | 'hint'
  | 'undo'
  | 'reset'
  | 'transition'
  | 'unlock'
  | 'tick';

type WorldTimbre = 'forest' | 'temple' | 'neon' | 'harbor' | 'ice' | 'map';

/**
 * All sound effects are synthesised. Each world tints the timbre (wood/harp, stone/marimba,
 * synth, bells, glass) so feedback matches the visual identity.
 */
export class SfxBank {
  constructor(
    private readonly ctx: AudioContext,
    private readonly dest: AudioNode,
    private readonly send: AudioNode,
  ) {}

  private out(pan = 0, sendAmt = 0.25): VoiceOut {
    return { dest: this.dest, send: this.send, sendAmt, pan };
  }

  play(name: SfxName, opts: { pan?: number; pitch?: number; world?: string }): void {
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005;
    const w = (opts.world ?? 'map') as WorldTimbre;
    const p = opts.pitch ?? 1;
    const pan = opts.pan ?? 0;
    const o = this.out(pan);
    switch (name) {
      case 'hover':
        tone(ctx, this.out(pan, 0.1), { type: 'sine', freq: 1320 * p, t, dur: 0.012, attack: 0.002, release: 0.05, gain: 0.035 });
        break;
      case 'tick':
        tone(ctx, this.out(pan, 0.05), { type: 'triangle', freq: 1800 * p, t, dur: 0.005, attack: 0.001, release: 0.03, gain: 0.03 });
        break;
      case 'ui':
      case 'click':
        noise(ctx, this.out(pan, 0.08), { t, dur: 0.01, release: 0.04, gain: 0.08, filter: { type: 'bandpass', freq: 2400 * p, q: 3 } });
        tone(ctx, this.out(pan, 0.08), { type: 'sine', freq: 660 * p, t, dur: 0.01, attack: 0.002, release: 0.07, gain: 0.05 });
        break;
      case 'select':
        this.timbreNote(w, 76, t, 0.12, pan);
        break;
      case 'board':
        this.timbreNote(w, 72, t, 0.12, pan);
        this.timbreNote(w, 79, t + 0.07, 0.1, pan);
        if (w === 'forest' || w === 'temple' || w === 'harbor') noise(ctx, o, { t, dur: 0.05, release: 0.12, gain: 0.05, filter: { type: 'lowpass', freq: 900 } });
        break;
      case 'unboard':
        this.timbreNote(w, 79, t, 0.1, pan);
        this.timbreNote(w, 72, t + 0.07, 0.1, pan);
        break;
      case 'valid':
        this.timbreNote(w, 72, t, 0.13, pan);
        this.timbreNote(w, 76, t + 0.08, 0.12, pan);
        this.timbreNote(w, 79, t + 0.16, 0.12, pan);
        break;
      case 'invalid':
        // soft, understandable – two falling notes a tritone apart, muffled
        tone(ctx, this.out(pan, 0.15), { type: 'triangle', freq: 311, freqEnd: 290, t, dur: 0.14, attack: 0.01, release: 0.18, gain: 0.12, filter: { type: 'lowpass', freq: 1200 } });
        tone(ctx, this.out(pan, 0.15), { type: 'triangle', freq: 220, freqEnd: 205, t: t + 0.13, dur: 0.2, attack: 0.01, release: 0.25, gain: 0.12, filter: { type: 'lowpass', freq: 900 } });
        break;
      case 'depart':
        this.depart(w, t, pan);
        break;
      case 'arrive':
        this.arrive(w, t, pan);
        break;
      case 'success':
        [0, 4, 7, 12].forEach((s, i) => this.timbreNote(w, 72 + s, t + i * 0.09, 0.13, pan));
        break;
      case 'levelComplete':
        this.fanfare(w, t);
        break;
      case 'hint':
        [88, 91, 95, 100].forEach((m, i) => bell(ctx, this.out(pan, 0.5), midiToFreq(m), t + i * 0.06, 0.05, 1.2, 2.01, 1.2));
        break;
      case 'undo':
        noise(ctx, this.out(pan, 0.2), { t, dur: 0.25, attack: 0.2, release: 0.05, gain: 0.08, filter: { type: 'bandpass', freq: 600, freqEnd: 2400, q: 1.5 } });
        this.timbreNote(w, 67, t + 0.18, 0.08, pan);
        break;
      case 'reset':
        noise(ctx, this.out(0, 0.3), { t, dur: 0.5, attack: 0.3, release: 0.3, gain: 0.08, filter: { type: 'bandpass', freq: 2400, freqEnd: 400, q: 1.2 } });
        break;
      case 'transition':
        noise(ctx, this.out(0, 0.5), { t, dur: 0.9, attack: 0.5, release: 0.6, gain: 0.07, filter: { type: 'bandpass', freq: 300, freqEnd: 3000, q: 0.9 } });
        bell(ctx, this.out(0, 0.6), midiToFreq(84), t + 0.5, 0.04, 2.5, 2.01, 1.5);
        break;
      case 'unlock':
        [79, 84, 88, 91, 96].forEach((m, i) => bell(ctx, this.out(0, 0.6), midiToFreq(m), t + i * 0.08, 0.06, 1.8, 3.01, 1.6));
        break;
    }
  }

  private timbreNote(w: WorldTimbre, midi: number, t: number, gain: number, pan: number): void {
    const ctx = this.ctx;
    const f = midiToFreq(midi);
    const o = this.out(pan, 0.3);
    switch (w) {
      case 'forest':
        pluck(ctx, o, f, t, gain, 1.1, 2600);
        break;
      case 'temple':
        mallet(ctx, o, f / 2, t, gain * 1.2, 0.8);
        break;
      case 'neon':
        tone(ctx, o, { type: 'square', freq: f, t, dur: 0.05, attack: 0.003, release: 0.18, gain: gain * 0.45, filter: { type: 'lowpass', freq: 5200, freqEnd: 900, q: 4 } });
        break;
      case 'harbor':
        bell(ctx, o, f, t, gain * 0.7, 1.6, 2.0, 1.4);
        break;
      case 'ice':
        bell(ctx, o, f * 2, t, gain * 0.55, 2.2, 3.5, 1.1);
        break;
      default:
        bell(ctx, o, f, t, gain * 0.6, 1.2, 2.0, 1.0);
    }
  }

  private depart(w: WorldTimbre, t: number, pan: number): void {
    const ctx = this.ctx;
    const o = this.out(pan, 0.3);
    switch (w) {
      case 'neon':
        tone(ctx, o, { type: 'sawtooth', freq: 80, freqEnd: 240, t, dur: 0.8, attack: 0.1, release: 0.4, gain: 0.08, filter: { type: 'lowpass', freq: 400, freqEnd: 2400, q: 6 } });
        noise(ctx, o, { t, dur: 0.6, attack: 0.2, release: 0.4, gain: 0.05, filter: { type: 'highpass', freq: 3000 } });
        break;
      case 'harbor':
        noise(ctx, o, { t, dur: 1.1, attack: 0.5, release: 0.6, gain: 0.1, filter: { type: 'bandpass', freq: 500, freqEnd: 1400, q: 0.7 } });
        bell(ctx, o, midiToFreq(79), t + 0.1, 0.06, 2.2, 2.0, 1.2);
        break;
      case 'ice':
        tone(ctx, o, { type: 'sawtooth', freq: 55, freqEnd: 70, t, dur: 1.0, attack: 0.25, release: 0.5, gain: 0.07, filter: { type: 'lowpass', freq: 300 } });
        noise(ctx, o, { t, dur: 0.4, attack: 0.02, release: 0.4, gain: 0.08, filter: { type: 'bandpass', freq: 3500, q: 3 } });
        break;
      default:
        // splash + wooden creak
        noise(ctx, o, { t, dur: 0.18, attack: 0.02, release: 0.5, gain: 0.16, filter: { type: 'lowpass', freq: 1800, freqEnd: 500 } });
        tone(ctx, o, { type: 'triangle', freq: w === 'temple' ? 140 : 190, freqEnd: w === 'temple' ? 110 : 150, t: t + 0.05, dur: 0.15, attack: 0.02, release: 0.2, gain: 0.05, filter: { type: 'bandpass', freq: 600, q: 5 } });
    }
  }

  private arrive(w: WorldTimbre, t: number, pan: number): void {
    const ctx = this.ctx;
    const o = this.out(pan, 0.25);
    if (w === 'neon') {
      tone(ctx, o, { type: 'sine', freq: 880, t, dur: 0.05, attack: 0.002, release: 0.15, gain: 0.07 });
      tone(ctx, o, { type: 'sine', freq: 1320, t: t + 0.08, dur: 0.05, attack: 0.002, release: 0.2, gain: 0.06 });
      thump(ctx, o, t, 70, 0.2, 0.25);
      return;
    }
    thump(ctx, o, t, w === 'ice' ? 60 : 85, 0.25, 0.3);
    noise(ctx, o, { t, dur: 0.08, release: 0.3, gain: 0.08, filter: { type: 'lowpass', freq: 1200 } });
    this.timbreNote(w, 84, t + 0.1, 0.07, pan);
  }

  private fanfare(w: WorldTimbre, t: number): void {
    const ctx = this.ctx;
    const o = this.out(0, 0.45);
    const chords = [
      [60, 64, 67, 72],
      [65, 69, 72, 77],
      [67, 71, 74, 79],
      [72, 76, 79, 84],
    ];
    chords.forEach((c, i) => {
      const tt = t + i * 0.32;
      c.forEach((m, j) => this.timbreNote(w, m, tt + j * 0.025, 0.1, (j - 1.5) * 0.3));
      tone(ctx, o, { type: 'sawtooth', freq: midiToFreq(c[0]! - 12), t: tt, dur: 0.3, attack: 0.03, release: 0.4, gain: 0.05, filter: { type: 'lowpass', freq: 900 } });
    });
    [96, 100, 103, 108].forEach((m, i) => bell(ctx, this.out(0, 0.7), midiToFreq(m), t + 1.3 + i * 0.07, 0.04, 2.5, 2.01, 1.2));
    noise(ctx, this.out(0, 0.6), { t: t + 1.2, dur: 1.2, attack: 0.4, release: 1.2, gain: 0.03, filter: { type: 'highpass', freq: 6000 } });
  }
}
