/**
 * Game soundtrack. Track 0 always plays first (title screen and the start of play); after that the
 * player rotates through the rest with crossfades, looping for ever.
 *
 * Each track either streams a licensed audio file (`src`, served from /music/) or, until real
 * tracks are licensed, plays an original placeholder groove synthesised here (no licence needed).
 * Never commit licensed audio to the public repo: add the files at deploy time instead.
 */

export interface Track {
  title: string;
  /** File under packages/client/public/music/, e.g. 'intro.mp3'. Omit to use the placeholder groove. */
  src?: string;
  /** Placeholder groove settings, used when there is no src. */
  groove: Groove;
}

interface Groove {
  bpm: number;
  /** MIDI note of the key root (e.g. 57 = A3). */
  root: number;
  /** Chords as semitone offsets from the root, one per bar, cycled. */
  chords: number[][];
}

const MINOR = [0, 3, 7];
const MAJOR = [0, 4, 7];
const at = (offset: number, shape: number[]) => shape.map((n) => n + offset);

export const TRACKS: Track[] = [
  // i - VI - III - VII in A minor: the title / start-of-game groove.
  { title: 'Gidi Morning (placeholder)', groove: { bpm: 104, root: 57, chords: [at(0, MINOR), at(-4, MAJOR), at(3, MAJOR), at(-2, MAJOR)] } },
  { title: 'Danfo Run (placeholder)', groove: { bpm: 110, root: 62, chords: [at(0, MINOR), at(-4, MAJOR), at(-9, MAJOR), at(-2, MAJOR)] } },
  { title: 'Owambe (placeholder)', groove: { bpm: 100, root: 53, chords: [at(0, MAJOR), at(-3, MINOR), at(-7, MAJOR), at(-5, MAJOR)] } },
  { title: 'Go-Slow (placeholder)', groove: { bpm: 96, root: 52, chords: [at(0, MINOR), at(-4, MAJOR), at(3, MAJOR), at(-2, MAJOR)] } },
];

const STORE_KEY = '9ja-music';
const FADE = 3; // seconds
const BARS = 32; // one pass of a placeholder groove
const PASSES = 2; // how many passes before moving on

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Afrobeats-ish 16-step patterns (3-3-2 kick, claps on 2 and 4, busy shaker, clave). */
const KICK = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0];
const CLAP = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
const CLAVE = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
const BASS = [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0];
const BASS_NOTE = [0, 0, 0, 12, 0, 0, 7, 0, 0, 0, 0, 0, 7, 0, 0, 0];
const GUITAR = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0];
const DRUM_FILL = [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0];

/** Synthesised placeholder groove: schedules notes slightly ahead on the audio clock. */
class Synth {
  private step = 0;
  private bar = 0;
  private nextTime = 0;
  private timer = 0;
  private noise: AudioBuffer;
  onEnd: () => void = () => {};

  constructor(
    private ctx: AudioContext,
    private out: GainNode,
    private g: Groove,
  ) {
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  start(): void {
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private schedule(): void {
    const sixteenth = 60 / this.g.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      const swing = this.step % 2 === 1 ? sixteenth * 0.12 : 0; // the little Afrobeats lilt
      this.play(this.step, this.bar, this.nextTime + swing);
      this.nextTime += sixteenth;
      if (++this.step === 16) {
        this.step = 0;
        if (++this.bar >= BARS * PASSES) {
          this.stop();
          this.onEnd();
          return;
        }
      }
    }
  }

  private play(s: number, bar: number, t: number): void {
    const section = bar % BARS;
    const intro = section < 4;
    const breakdown = section >= 24 && section < 28;
    const chord = this.g.chords[Math.floor(bar / 2) % this.g.chords.length]!;
    this.shaker(t, s % 4 === 2 ? 0.09 : 0.045);
    if (CLAVE[s]) this.click(t);
    if (intro) return;
    if (KICK[s] && !breakdown) this.kick(t);
    if (CLAP[s]) this.clap(t);
    if (BASS[s] && !breakdown) this.bass(t, this.g.root - 24 + chord[0]! + BASS_NOTE[s]!);
    if (GUITAR[s]) this.pluck(t, this.g.root + 12 + chord[(s * 2) % 3]! + (s % 8 === 7 ? 12 : 0));
    if (section % 4 === 3 && DRUM_FILL[s]) this.talkingDrum(t);
    if (s === 0 && section % 2 === 0) this.pad(t, chord.map((n) => this.g.root + n), (60 / this.g.bpm) * 8);
  }

  private env(t: number, peak: number, decay: number): GainNode {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    gain.connect(this.out);
    return gain;
  }

  private kick(t: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    o.connect(this.env(t, 0.9, 0.35));
    o.start(t);
    o.stop(t + 0.4);
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, peak: number, decay: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    src.connect(f).connect(this.env(t, peak, decay));
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.02);
  }

  private shaker(t: number, peak: number): void {
    this.noiseHit(t, 'highpass', 7000, peak, 0.05);
  }

  private clap(t: number): void {
    this.noiseHit(t, 'bandpass', 1500, 0.35, 0.16);
  }

  private click(t: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.value = 1700;
    o.connect(this.env(t, 0.08, 0.04));
    o.start(t);
    o.stop(t + 0.05);
  }

  private bass(t: number, note: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = midiHz(note);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    o.connect(f).connect(this.env(t, 0.5, 0.32));
    o.start(t);
    o.stop(t + 0.35);
  }

  /** Highlife-style guitar pluck. */
  private pluck(t: number, note: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = midiHz(note);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.15);
    o.connect(f).connect(this.env(t, 0.12, 0.18));
    o.start(t);
    o.stop(t + 0.2);
  }

  /** Talking drum: a pitched hit that bends down, like the squeeze of the strings. */
  private talkingDrum(t: number): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(260, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.16);
    o.connect(this.env(t, 0.3, 0.22));
    o.start(t);
    o.stop(t + 0.25);
  }

  private pad(t: number, notes: number[], len: number): void {
    for (const n of notes) {
      for (const detune of [-6, 6]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiHz(n);
        o.detune.value = detune;
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 900;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.025, t + 0.6);
        gain.gain.linearRampToValueAtTime(0.0001, t + len);
        o.connect(f).connect(gain).connect(this.out);
        o.start(t);
        o.stop(t + len + 0.1);
      }
    }
  }
}

interface Playing {
  gain: GainNode;
  stop: () => void;
}

/**
 * Optional local track list at /music/tracks.json (git-ignored, never deployed): lets you try real
 * songs on your own machine without their names or files ever entering the public repo.
 * When present it replaces the whole soundtrack (first entry plays first); without it the
 * placeholder grooves play.
 */
interface LocalTrack {
  title: string;
  src: string;
}

export class Music {
  private ctx: AudioContext | null = null;
  private tracks: Track[] = [...TRACKS];
  private ready: Promise<void>;
  private master: GainNode | null = null;
  private current: Playing | null = null;
  private index = -1;
  private settings = { volume: 0.55, muted: false };
  onTrack: (title: string) => void = () => {};

  constructor(private base = import.meta.env.BASE_URL) {
    try {
      Object.assign(this.settings, JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}'));
    } catch {
      // Storage blocked or corrupt: keep defaults.
    }
    this.ready = fetch(`${base}music/tracks.json`)
      .then((r) => (r.ok ? (r.json() as Promise<LocalTrack[]>) : []))
      .then((local) => {
        if (local.length) this.tracks = local.map((lt, i) => ({ title: lt.title, src: lt.src, groove: TRACKS[i % TRACKS.length]!.groove }));
      })
      .catch(() => {
        // No local list (the normal case on the public site).
      });
  }

  get muted(): boolean {
    return this.settings.muted;
  }

  /** Browsers only allow audio after a user gesture: call from a click or key press. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    const comp = this.ctx.createDynamicsCompressor();
    this.master = this.ctx.createGain();
    this.master.connect(comp).connect(this.ctx.destination);
    this.applyVolume();
    void this.ready.then(() => this.play(0));
  }

  toggleMute(): void {
    this.settings.muted = !this.settings.muted;
    this.applyVolume();
    this.save();
  }

  private applyVolume(): void {
    if (!this.master || !this.ctx) return;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.volume, this.ctx.currentTime, 0.1);
  }

  private save(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.settings));
    } catch {
      // Ignore: the setting just won't persist.
    }
  }

  /** After track 0, pick any other track (never the same one twice in a row). */
  private nextIndex(): number {
    if (this.tracks.length < 2) return 0;
    let i = this.index;
    while (i === this.index || i === 0) i = 1 + Math.floor(Math.random() * (this.tracks.length - 1));
    // Now and then the starting groove comes back round.
    return Math.random() < 0.2 && this.index !== 0 ? 0 : i;
  }

  private play(i: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    this.index = i;
    const track = this.tracks[i]!;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE);
    gain.connect(this.master);

    const advance = () => this.crossfadeTo(this.nextIndex());
    let stop: () => void;
    if (track.src) {
      const el = new Audio(`${this.base}music/${track.src}`);
      el.crossOrigin = 'anonymous';
      ctx.createMediaElementSource(el).connect(gain);
      el.addEventListener('ended', advance);
      el.addEventListener('error', () => {
        // Missing file: fall back to the placeholder groove for this slot.
        const synth = new Synth(ctx, gain, track.groove);
        synth.onEnd = advance;
        synth.start();
        stop = () => synth.stop();
      });
      void el.play();
      stop = () => el.pause();
    } else {
      const synth = new Synth(ctx, gain, track.groove);
      synth.onEnd = advance;
      synth.start();
      stop = () => synth.stop();
    }
    this.current = { gain, stop: () => stop() };
    this.onTrack(track.title);
  }

  private crossfadeTo(i: number): void {
    if (!this.ctx) return;
    const old = this.current;
    if (old) {
      old.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      old.gain.gain.setValueAtTime(old.gain.gain.value, this.ctx.currentTime);
      old.gain.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + FADE);
      setTimeout(() => old.stop(), FADE * 1000 + 100);
    }
    this.play(i);
  }

  /** Jump to a specific track by index. */
  playIndex(i: number): void {
    if (this.ctx && i >= 0 && i < this.tracks.length) this.crossfadeTo(i);
  }

  /** Next track in list order (the button and N key), wrapping round; auto-rotation stays varied. */
  skip(): void {
    if (this.ctx) this.crossfadeTo((this.index + 1) % this.tracks.length);
  }
}
