/**
 * Placeholder sound effects synthesised with WebAudio, so the MVP ships with no audio files.
 * Every sound is throttled so a crowd of hits does not turn into noise.
 */

export type SfxName =
  | 'throw'
  | 'whip'
  | 'hit'
  | 'kill'
  | 'gem'
  | 'levelup'
  | 'hurt'
  | 'select'
  | 'hover'
  | 'swarm'
  | 'victory'
  | 'death'
  | 'pause';

const THROTTLE_MS: Partial<Record<SfxName, number>> = {
  throw: 60,
  whip: 80,
  hit: 35,
  kill: 40,
  gem: 28,
  hover: 40,
};

class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last: Partial<Record<SfxName, number>> = {};
  private gemStreak = 0;
  private gemLast = 0;
  muted = false;

  /** Must be called from a user gesture (click or key) before any sound can play. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.22;
        this.master.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.5);
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) this.master.gain.setValueAtTime(this.muted ? 0 : 0.22, this.ctx.currentTime);
    return this.muted;
  }

  play(name: SfxName): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const nowMs = performance.now();
    const gap = THROTTLE_MS[name];
    if (gap !== undefined) {
      const prev = this.last[name] ?? -1e9;
      if (nowMs - prev < gap) return;
    }
    this.last[name] = nowMs;
    const t = ctx.currentTime;
    switch (name) {
      case 'throw':
        this.noiseBurst(t, 0.07, 0.07, 'bandpass', 2200, 900);
        this.tone(t, 520, 300, 0.05, 'triangle', 0.035);
        break;
      case 'whip':
        this.noiseBurst(t, 0.12, 0.12, 'highpass', 1500, 4000);
        break;
      case 'hit':
        this.tone(t, 240, 120, 0.045, 'square', 0.035);
        break;
      case 'kill':
        this.noiseBurst(t, 0.1, 0.09, 'lowpass', 1400, 300);
        this.tone(t, 180, 60, 0.09, 'sine', 0.08);
        break;
      case 'gem': {
        if (nowMs - this.gemLast > 500) this.gemStreak = 0;
        this.gemLast = nowMs;
        const step = Math.min(this.gemStreak++, 14);
        const f = 880 * Math.pow(2, step / 24);
        this.tone(t, f, f * 1.02, 0.06, 'sine', 0.07);
        break;
      }
      case 'levelup':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(t + i * 0.07, f, f, 0.12, 'square', 0.05));
        break;
      case 'hurt':
        this.tone(t, 150, 70, 0.18, 'sawtooth', 0.1);
        this.noiseBurst(t, 0.1, 0.1, 'lowpass', 800, 200);
        break;
      case 'select':
        this.tone(t, 660, 660, 0.06, 'square', 0.05);
        this.tone(t + 0.06, 990, 990, 0.08, 'square', 0.05);
        break;
      case 'hover':
        this.tone(t, 440, 440, 0.03, 'square', 0.025);
        break;
      case 'swarm':
        this.tone(t, 110, 55, 0.7, 'sawtooth', 0.08);
        this.tone(t + 0.05, 116, 58, 0.7, 'sawtooth', 0.06);
        break;
      case 'victory':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(t + i * 0.12, f, f, 0.3, 'triangle', 0.08));
        break;
      case 'death':
        [392, 330, 262, 196].forEach((f, i) => this.tone(t + i * 0.16, f, f * 0.97, 0.3, 'triangle', 0.08));
        break;
      case 'pause':
        this.tone(t, 330, 330, 0.05, 'square', 0.04);
        break;
    }
  }

  private tone(t: number, f0: number, f1: number, dur: number, type: OscillatorType, vol: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(t: number, dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(f0, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}

export const sfx = new SfxEngine();
