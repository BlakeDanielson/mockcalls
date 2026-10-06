// Makes the prospect sound like a landline call: 8 kHz audio, the 300 to
// 3,300 Hz phone band, 8-bit mu-law codec grit and faint line hiss. Runs in
// the rep's browser only, on the prospect's voice only. The rep's microphone,
// the ElevenLabs recording, the transcript and the scoring are untouched.
//
// How it hooks in: the ElevenLabs SDK plays the prospect through a hidden
// <audio> element that LiveKit appends to <body> (see webAudioAdapter.js in
// @elevenlabs/client). PhoneLine notices that element and feeds its stream
// into the filter chain in its own AudioContext. The element keeps playing
// normally until the filter has actually heard the prospect; only then does
// PhoneLine switch over (element volume 0, filtered path on). So if the
// browser never passes call audio to Web Audio, the rep simply hears the
// normal audio, never silence. Volume rather than `muted`, because LiveKit
// resets `muted` on re-attach.

export type PhonePreset = {
  /** Context sample rate; 8000 is real telephone bandwidth. */
  sampleRate: number;
  /** Phone band edges in Hz. */
  low: number;
  high: number;
  /** Stacked 12 dB/octave filters per band edge. */
  poles: number;
  /** Peaking boost at 1.8 kHz, the "phone" presence. */
  presenceDb: number;
  /** 8-bit mu-law quantization, as on a real landline. */
  mulaw: boolean;
  /** Line hiss level in dBFS, or null for none. */
  hissDb: number | null;
};

export const LANDLINE: PhonePreset = {
  sampleRate: 8000,
  low: 300,
  high: 3300,
  poles: 2,
  presenceDb: 2,
  mulaw: true,
  hissDb: -54,
};

/**
 * A WaveShaper curve that encodes to 8-bit mu-law and decodes back, giving
 * the quantization grit of a G.711 phone codec.
 */
export function mulawCurve(points = 65536, mu = 255): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  const ln = Math.log1p(mu);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    const encoded = (Math.sign(x) * Math.log1p(mu * Math.abs(x))) / ln;
    const q = Math.round(encoded * 127) / 127;
    curve[i] = (Math.sign(q) * (Math.pow(1 + mu, Math.abs(q)) - 1)) / mu;
  }
  return curve;
}

/** Wires `input` through the phone chain and returns the last node. */
export function buildPhoneChain(
  ctx: BaseAudioContext,
  input: AudioNode,
  preset: PhonePreset,
): AudioNode {
  let node = input;
  const add = (next: AudioNode) => {
    node.connect(next);
    node = next;
  };
  const biquad = (type: BiquadFilterType, frequency: number, q: number, gain = 0) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    f.gain.value = gain;
    return f;
  };
  for (let i = 0; i < preset.poles; i++) add(biquad("highpass", preset.low, 0.707));
  for (let i = 0; i < preset.poles; i++) add(biquad("lowpass", preset.high, 0.707));
  if (preset.presenceDb) add(biquad("peaking", 1800, 1, preset.presenceDb));

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -26;
  comp.knee.value = 6;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.12;
  add(comp);

  // Makes up the level the band cut removed, so the toggle does not change loudness much.
  const makeup = ctx.createGain();
  makeup.gain.value = 1.8;
  add(makeup);

  if (preset.mulaw) {
    const codec = ctx.createWaveShaper();
    codec.curve = mulawCurve();
    add(codec);
  }

  if (preset.hissDb != null) {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const level = ctx.createGain();
    level.gain.value = Math.pow(10, preset.hissDb / 20);
    const mix = ctx.createGain();
    noise.connect(biquad("bandpass", 1500, 0.5)).connect(level).connect(mix);
    node.connect(mix);
    node = mix;
    noise.start();
  }
  return node;
}

/** RMS above this (about -60 dBFS) counts as hearing the prospect. */
const SIGNAL_RMS = 0.001;

/** Browser-only controller for one call. Create it inside the Call click. */
export class PhoneLine {
  private ctx: AudioContext | null = null;
  private input: GainNode | null = null;
  private output: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private observer: MutationObserver | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private readonly elements = new Set<HTMLAudioElement>();
  private readonly sources = new Map<HTMLAudioElement, MediaStreamAudioSourceNode>();
  private enabled: boolean;
  private bypassed = false;
  /** True once the filter has carried audible prospect audio. */
  heardSignal = false;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /** Builds the audio graph and starts watching for the SDK's audio element. */
  start() {
    try {
      this.ctx = new AudioContext({ sampleRate: LANDLINE.sampleRate });
    } catch {
      try {
        // Some browsers refuse 8 kHz; the filters still give the phone band.
        this.ctx = new AudioContext();
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx) {
      const ctx = this.ctx;
      this.input = ctx.createGain();
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.input.connect(this.analyser);
      this.output = ctx.createGain();
      buildPhoneChain(ctx, this.input, LANDLINE).connect(this.output).connect(ctx.destination);
      ctx.resume().catch(() => {});
      this.poll = setInterval(() => this.sample(), 50);
    }
    this.observer = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (n instanceof HTMLAudioElement) this.adopt(n);
        });
      }
    });
    this.observer.observe(document.body, { childList: true });
    this.apply();
  }

  /** Turns the phone sound on or off mid-call. */
  setEnabled(on: boolean) {
    this.enabled = on;
    this.apply();
  }

  /** Gives up on the filter for this call and plays the plain audio. */
  bypass() {
    this.bypassed = true;
    this.apply();
  }

  /** Whether the phone sound is actually what the rep hears right now. */
  get active() {
    return this.enabled && !this.bypassed && this.heardSignal && this.sources.size > 0;
  }

  /** On, but still playing normal audio because the filter has heard nothing yet. */
  get waiting() {
    return this.enabled && !this.bypassed && !this.heardSignal;
  }

  close() {
    this.observer?.disconnect();
    if (this.poll) clearInterval(this.poll);
    this.sources.forEach((s) => s.disconnect());
    this.elements.forEach((el) => (el.volume = 1));
    this.ctx?.close().catch(() => {});
    this.sources.clear();
    this.elements.clear();
  }

  private adopt(el: HTMLAudioElement) {
    if (this.elements.has(el)) return;
    this.elements.add(el);
    const stream = el.srcObject;
    if (this.ctx && this.input && stream instanceof MediaStream && stream.getAudioTracks().length) {
      try {
        const source = this.ctx.createMediaStreamSource(stream);
        source.connect(this.input);
        this.sources.set(el, source);
      } catch {
        // leave this element playing normally
      }
    }
    this.apply();
  }

  private apply() {
    const on = this.enabled && !this.bypassed && this.heardSignal;
    if (this.output) this.output.gain.value = on ? 1 : 0;
    for (const el of this.elements) {
      el.volume = on && this.sources.has(el) ? 0 : 1;
    }
  }

  private sample() {
    if (!this.analyser || this.heardSignal) return;
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    if (Math.sqrt(sum / buf.length) > SIGNAL_RMS) {
      this.heardSignal = true;
      if (this.poll) clearInterval(this.poll);
      this.poll = null;
      this.apply();
    }
  }
}
