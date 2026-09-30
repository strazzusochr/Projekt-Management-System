/** Small WebAudio synthesis toolkit shared by SFX, music and ambience. */

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    const len = ctx.sampleRate * 3;
    b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export interface VoiceOut {
  dest: AudioNode;
  /** Optional reverb send and amount. */
  send?: AudioNode;
  sendAmt?: number;
  pan?: number;
}

function outChain(ctx: AudioContext, out: VoiceOut, end: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = 0;
  let node: AudioNode = g;
  if (out.pan !== undefined && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, out.pan));
    g.connect(p);
    node = p;
  }
  node.connect(out.dest);
  if (out.send && out.sendAmt) {
    const s = ctx.createGain();
    s.gain.value = out.sendAmt;
    node.connect(s).connect(out.send);
    setTimeout(() => s.disconnect(), (end - ctx.currentTime + 0.5) * 1000);
  }
  return g;
}

export interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  /** Frequency to glide to (optional). */
  freqEnd?: number;
  t: number;
  dur: number;
  attack?: number;
  release?: number;
  gain?: number;
  detune?: number;
  filter?: { type: BiquadFilterType; freq: number; q?: number; freqEnd?: number };
  vibrato?: { rate: number; depth: number };
}

/** Enveloped oscillator voice. */
export function tone(ctx: AudioContext, out: VoiceOut, o: ToneOpts): void {
  const attack = o.attack ?? 0.01;
  const release = o.release ?? 0.2;
  const end = o.t + o.dur + release;
  const g = outChain(ctx, out, end);
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, o.t);
  if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), o.t + o.dur);
  if (o.detune) osc.detune.value = o.detune;
  let src: AudioNode = osc;
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    f.type = o.filter.type;
    f.frequency.setValueAtTime(o.filter.freq, o.t);
    if (o.filter.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.filter.freqEnd), o.t + o.dur);
    f.Q.value = o.filter.q ?? 0.8;
    osc.connect(f);
    src = f;
  }
  if (o.vibrato) {
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = o.vibrato.rate;
    lg.gain.value = o.vibrato.depth;
    lfo.connect(lg).connect(osc.frequency);
    lfo.start(o.t);
    lfo.stop(end + 0.05);
  }
  src.connect(g);
  const peak = o.gain ?? 0.2;
  g.gain.setValueAtTime(0, o.t);
  g.gain.linearRampToValueAtTime(peak, o.t + attack);
  g.gain.setValueAtTime(peak, o.t + Math.max(attack, o.dur));
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.start(o.t);
  osc.stop(end + 0.05);
}

/** Plucked string / harp-like voice. */
export function pluck(ctx: AudioContext, out: VoiceOut, freq: number, t: number, gain = 0.18, decay = 1.4, bright = 3200): void {
  tone(ctx, out, { type: 'triangle', freq, t, dur: 0.01, attack: 0.004, release: decay, gain, filter: { type: 'lowpass', freq: bright, freqEnd: bright * 0.25 } });
  tone(ctx, out, { type: 'sine', freq: freq * 2, t, dur: 0.01, attack: 0.003, release: decay * 0.5, gain: gain * 0.35 });
}

/** FM bell (glass, temple bell, harbour chime depending on ratio). */
export function bell(ctx: AudioContext, out: VoiceOut, freq: number, t: number, gain = 0.14, decay = 2.2, ratio = 3.5, index = 2.2): void {
  const end = t + decay;
  const g = outChain(ctx, out, end);
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const mg = ctx.createGain();
  car.frequency.value = freq;
  mod.frequency.value = freq * ratio;
  mg.gain.setValueAtTime(freq * index, t);
  mg.gain.exponentialRampToValueAtTime(freq * 0.05, end);
  mod.connect(mg).connect(car.frequency);
  car.connect(g);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  car.start(t);
  mod.start(t);
  car.stop(end + 0.05);
  mod.stop(end + 0.05);
}

/** Mallet (marimba / kalimba). */
export function mallet(ctx: AudioContext, out: VoiceOut, freq: number, t: number, gain = 0.2, decay = 0.9): void {
  tone(ctx, out, { type: 'sine', freq, t, dur: 0.005, attack: 0.002, release: decay, gain });
  tone(ctx, out, { type: 'sine', freq: freq * 3.98, t, dur: 0.005, attack: 0.001, release: decay * 0.18, gain: gain * 0.4 });
}

/** Warm pad chord with slow attack (detuned saws through a low-pass). */
export function pad(ctx: AudioContext, out: VoiceOut, freqs: number[], t: number, dur: number, gain = 0.05, cutoff = 1400, type: OscillatorType = 'sawtooth'): void {
  for (const f of freqs) {
    for (const det of [-7, 6]) {
      tone(ctx, out, { type, freq: f, t, dur, attack: Math.min(1.8, dur * 0.4), release: 1.6, gain: gain / freqs.length, detune: det, filter: { type: 'lowpass', freq: cutoff, q: 0.5 } });
    }
  }
}

export interface NoiseOpts {
  t: number;
  dur: number;
  attack?: number;
  release?: number;
  gain?: number;
  filter: { type: BiquadFilterType; freq: number; q?: number; freqEnd?: number };
  playbackRate?: number;
}

/** Filtered noise burst (splash, wind gust, hi-hat, whoosh). */
export function noise(ctx: AudioContext, out: VoiceOut, o: NoiseOpts): void {
  const attack = o.attack ?? 0.005;
  const release = o.release ?? 0.1;
  const end = o.t + o.dur + release;
  const g = outChain(ctx, out, end);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.playbackRate.value = o.playbackRate ?? 1;
  const f = ctx.createBiquadFilter();
  f.type = o.filter.type;
  f.frequency.setValueAtTime(o.filter.freq, o.t);
  if (o.filter.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.filter.freqEnd), o.t + o.dur);
  f.Q.value = o.filter.q ?? 1;
  src.connect(f).connect(g);
  const peak = o.gain ?? 0.2;
  g.gain.setValueAtTime(0, o.t);
  g.gain.linearRampToValueAtTime(peak, o.t + attack);
  g.gain.setValueAtTime(peak, o.t + Math.max(attack, o.dur));
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  const offset = Math.random() * 2;
  src.start(o.t, offset);
  src.stop(end + 0.05);
}

/** Low drum thump. */
export function thump(ctx: AudioContext, out: VoiceOut, t: number, freq = 90, gain = 0.4, decay = 0.35): void {
  tone(ctx, out, { type: 'sine', freq: freq * 1.8, freqEnd: freq * 0.6, t, dur: decay * 0.5, attack: 0.002, release: decay, gain });
}

/** Deterministic PRNG for generative music. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
