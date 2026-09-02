export type AudioSourceId = "mic" | "system";

const RAMP_SECONDS = 0.02;
const DISCONNECT_DELAY_MS = 60;

interface MixerSource {
  stream: MediaStream;
  node: MediaStreamAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
  buffer: Uint8Array<ArrayBuffer>;
  enabled: boolean;
  connected: boolean;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Mixes the microphone and system audio into a single output track that exists
 * for the whole recording. MediaRecorder cannot gain or drop tracks after
 * `start()`, so enabling/disabling a source is a 20 ms gain ramp (no click)
 * followed by a disconnect — the recorded track never changes identity.
 */
export class AudioMixer {
  private ctx: AudioContext;
  private destination: MediaStreamAudioDestinationNode;
  private sources = new Map<AudioSourceId, MixerSource>();

  readonly outputStream: MediaStream;
  readonly outputTrack: MediaStreamTrack;

  constructor(ctx?: AudioContext) {
    this.ctx =
      ctx ??
      new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext)();
    this.destination = this.ctx.createMediaStreamDestination();
    this.outputStream = this.destination.stream;
    this.outputTrack = this.destination.stream.getAudioTracks()[0];
  }

  /** Browsers require a user gesture; the hook calls this from the click. */
  async resume(): Promise<void> {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  addSource(
    id: AudioSourceId,
    stream: MediaStream,
    options: { enabled?: boolean } = {},
  ): void {
    if (this.sources.has(id)) this.removeSource(id);

    const enabled = options.enabled ?? true;
    const node = this.ctx.createMediaStreamSource(stream);
    const gain = this.ctx.createGain();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;

    node.connect(gain);
    // The analyser taps the raw source (pre-gain) so the meter keeps moving
    // while muted; the UI uses that to warn when you talk with the mic off.
    node.connect(analyser);
    gain.gain.value = enabled ? 1 : 0;
    if (enabled) gain.connect(this.destination);

    this.sources.set(id, {
      stream,
      node,
      gain,
      analyser,
      buffer: new Uint8Array(analyser.fftSize),
      enabled,
      connected: enabled,
      disconnectTimer: null,
    });
  }

  hasSource(id: AudioSourceId): boolean {
    return this.sources.has(id);
  }

  sourceIds(): AudioSourceId[] {
    return [...this.sources.keys()];
  }

  isEnabled(id: AudioSourceId): boolean {
    return this.sources.get(id)?.enabled ?? false;
  }

  setEnabled(id: AudioSourceId, on: boolean): void {
    const src = this.sources.get(id);
    if (!src || src.enabled === on) return;
    src.enabled = on;

    const now = this.ctx.currentTime;
    if (on) {
      if (src.disconnectTimer) {
        clearTimeout(src.disconnectTimer);
        src.disconnectTimer = null;
      }
      if (!src.connected) {
        src.gain.connect(this.destination);
        src.connected = true;
      }
      src.gain.gain.cancelScheduledValues(now);
      src.gain.gain.setValueAtTime(src.gain.gain.value, now);
      src.gain.gain.linearRampToValueAtTime(1, now + RAMP_SECONDS);
    } else {
      src.gain.gain.cancelScheduledValues(now);
      src.gain.gain.setValueAtTime(src.gain.gain.value, now);
      src.gain.gain.linearRampToValueAtTime(0, now + RAMP_SECONDS);
      src.disconnectTimer = setTimeout(() => {
        src.disconnectTimer = null;
        if (src.enabled || !src.connected) return;
        try {
          src.gain.disconnect(this.destination);
        } catch {
          // Already disconnected.
        }
        src.connected = false;
      }, DISCONNECT_DELAY_MS);
    }
  }

  /** RMS level 0..1 for a meter. Returns 0 for unknown sources; muted sources still report input. */
  getLevel(id: AudioSourceId): number {
    const src = this.sources.get(id);
    if (!src) return 0;
    src.analyser.getByteTimeDomainData(src.buffer);
    let sum = 0;
    for (let i = 0; i < src.buffer.length; i += 1) {
      const v = (src.buffer[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / src.buffer.length);
    // A little headroom so normal speech fills most of the meter.
    return Math.min(1, rms * 1.8);
  }

  removeSource(id: AudioSourceId): void {
    const src = this.sources.get(id);
    if (!src) return;
    if (src.disconnectTimer) clearTimeout(src.disconnectTimer);
    try {
      src.node.disconnect();
    } catch {
      /* already gone */
    }
    try {
      src.gain.disconnect();
    } catch {
      /* already gone */
    }
    try {
      src.analyser.disconnect();
    } catch {
      /* already gone */
    }
    this.sources.delete(id);
  }

  async close(): Promise<void> {
    for (const id of [...this.sources.keys()]) this.removeSource(id);
    try {
      await this.ctx.close();
    } catch {
      // Already closed.
    }
  }
}
