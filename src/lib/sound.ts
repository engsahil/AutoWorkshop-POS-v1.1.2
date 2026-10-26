/**
 * Local notification sounds.
 *
 * A short, bundled WAV chime (`public/audio/notify-tone.wav`) is used when the
 * browser can decode it, which keeps the tone identical across devices. If the
 * asset is unavailable the same two-note figure is synthesised with WebAudio,
 * so muting/volume still behave correctly offline and in tests.
 */
const TONE_SRC = '/audio/notify-tone.wav';
let toneEl: HTMLAudioElement | null = null;
let toneBroken = false;

function bundledTone(volume: number): boolean {
  if (toneBroken || typeof Audio === 'undefined') return false;
  try {
    if (!toneEl) {
      toneEl = new Audio(TONE_SRC);
      toneEl.preload = 'auto';
    }
    toneEl.volume = Math.max(0, Math.min(1, volume));
    toneEl.currentTime = 0;
    const played = toneEl.play();
    if (played && typeof played.catch === 'function') {
      played.catch(() => { toneBroken = true; });
    }
    return true;
  } catch {
    toneBroken = true;
    return false;
  }
}

let ctx: AudioContext | null = null;

export function primeAudio(): void {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* audio is optional */
  }
}

function tone(freq: number, start: number, duration: number, gain: number, type: OscillatorType = 'sine') {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(0, ctx.currentTime + start);
  amp.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
  osc.connect(amp);
  amp.connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + duration + 0.02);
}

/** Soft two-note confirmation for completed sales/payments. */
export function playChime(volume = 0.7): void {
  primeAudio();
  if (bundledTone(volume)) return;
  const vol = Math.max(0, Math.min(1, volume)) * 0.12;
  tone(784, 0, 0.16, vol);
  tone(1046.5, 0.11, 0.22, vol * 0.8);
}

/** Lower, more urgent tone for warnings (low stock, shift variance). */
export function playAlert(volume = 0.7): void {
  primeAudio();
  const vol = Math.max(0, Math.min(1, volume)) * 0.1;
  tone(392, 0, 0.18, vol, 'triangle');
  tone(330, 0.16, 0.26, vol, 'triangle');
}

export function playSuccess(): void {
  playChime(0.8);
}
