import { AmbienceBed, type AmbienceId } from './ambience';
import { MusicPlayer, type MusicId } from './music';
import { SfxBank, type SfxName } from './sfx';

export interface AudioVolumes {
  music: number;
  sfx: number;
  ambience: number;
  muted: boolean;
}

/**
 * Procedural audio: everything is synthesised with WebAudio at runtime (no audio files).
 * The AudioContext is created lazily on the first user gesture (autoplay policy).
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private duckGain!: GainNode;
  reverbSend!: GainNode;
  private sfx: SfxBank | null = null;
  private music: MusicPlayer | null = null;
  private ambience: AmbienceBed | null = null;
  private volumes: AudioVolumes;
  private pendingMusic: MusicId | null = null;
  private pendingAmbience: AmbienceId | null = null;
  private lastHover = 0;
  private unlockHandler = () => this.unlock();

  constructor(volumes: AudioVolumes) {
    this.volumes = { ...volumes };
    window.addEventListener('pointerdown', this.unlockHandler, { capture: true });
    window.addEventListener('keydown', this.unlockHandler, { capture: true });
  }

  get started(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Creates/resumes the AudioContext; safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      this.buildGraph();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.pendingMusic) {
      this.playMusic(this.pendingMusic);
      this.pendingMusic = null;
    }
    if (this.pendingAmbience) {
      this.playAmbience(this.pendingAmbience);
      this.pendingAmbience = null;
    }
  }

  private buildGraph(): void {
    const ctx = this.ctx!;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    this.master = ctx.createGain();
    this.master.connect(comp).connect(ctx.destination);

    // generated stereo impulse response → lush but short reverb
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(ctx, 2.6, 2.2);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.55;
    convolver.connect(reverbReturn).connect(this.master);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.reverbSend.connect(convolver);

    this.duckGain = ctx.createGain();
    this.duckGain.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.duckGain);
    this.ambBus = ctx.createGain();
    this.ambBus.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);

    this.sfx = new SfxBank(ctx, this.sfxBus, this.reverbSend);
    this.music = new MusicPlayer(ctx, this.musicBus, this.reverbSend);
    this.ambience = new AmbienceBed(ctx, this.ambBus, this.reverbSend);
    this.applyVolumes();
  }

  setVolumes(v: Partial<AudioVolumes>): void {
    this.volumes = { ...this.volumes, ...v };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.volumes.muted ? 0 : 1;
    this.master.gain.setTargetAtTime(m, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.volumes.music * 0.55, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx * 0.9, t, 0.05);
    this.ambBus.gain.setTargetAtTime(this.volumes.ambience * 0.6, t, 0.1);
  }

  /** Lowers the music briefly so an important sound can be heard. */
  duck(amount = 0.35, seconds = 1.6): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duckGain.gain.cancelScheduledValues(t);
    this.duckGain.gain.setTargetAtTime(amount, t, 0.08);
    this.duckGain.gain.setTargetAtTime(1, t + seconds, 0.6);
  }

  play(name: SfxName, opts: { pan?: number; pitch?: number; world?: string } = {}): void {
    if (!this.sfx || !this.started) return;
    if (name === 'hover') {
      const now = performance.now();
      if (now - this.lastHover < 70) return;
      this.lastHover = now;
    }
    this.sfx.play(name, opts);
    if (name === 'levelComplete') this.duck(0.2, 3.2);
  }

  playMusic(id: MusicId): void {
    if (!this.music || !this.started) {
      this.pendingMusic = id;
      return;
    }
    this.music.play(id);
  }

  playAmbience(id: AmbienceId): void {
    if (!this.ambience || !this.started) {
      this.pendingAmbience = id;
      return;
    }
    this.ambience.play(id);
  }

  /** Scripted ambient event synced to visuals (lightning → thunder, ice crack …). */
  ambientEvent(kind: 'thunder' | 'crack' | 'gust'): void {
    if (this.started) this.ambience?.trigger(kind);
  }

  /** Per-frame hook for ambience randomisation (birds, thunder …). */
  update(dt: number): void {
    this.ambience?.update(dt);
    this.music?.update();
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.unlockHandler, { capture: true });
    window.removeEventListener('keydown', this.unlockHandler, { capture: true });
    this.music?.stop();
    this.ambience?.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}

function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // low-passed noise with exponential decay, slight early reflections
      lp = lp * 0.55 + (Math.random() * 2 - 1) * 0.45;
      const early = i < rate * 0.08 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 0.8 : 0;
      d[i] = (lp + early) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}
