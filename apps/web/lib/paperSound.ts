/**
 * The paper sound, synthesized: filtered noise shaped into a short tear and a
 * longer slide. No audio file, so nothing to license or credit.
 */
export function playPaper() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const len = Math.floor(ctx.sampleRate * 2.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Crackly noise: mostly quiet with random bursts, like paper fibres.
    let v = 0;
    for (let i = 0; i < len; i++) {
      const burst = Math.random() < 0.02 ? Math.random() : 0;
      v = v * 0.6 + (Math.random() * 2 - 1) * (0.35 + burst * 2);
      data[i] = v * 0.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2400;
    band.Q.value = 0.7;
    const high = ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 500;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    // Flap lifts at 1.0 s, letter slides 1.6-2.4 s (the same timeline as the GIF).
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.0001, t + 0.95);
    gain.gain.linearRampToValueAtTime(0.5, t + 1.05);
    gain.gain.exponentialRampToValueAtTime(0.08, t + 1.5);
    gain.gain.linearRampToValueAtTime(0.32, t + 1.7);
    gain.gain.exponentialRampToValueAtTime(0.02, t + 2.4);
    band.frequency.setValueAtTime(2800, t + 1.0);
    band.frequency.linearRampToValueAtTime(1600, t + 2.3);
    src.connect(band).connect(high).connect(gain).connect(ctx.destination);
    src.start();
    src.onended = () => ctx.close();
  } catch {
    // Sound is a nicety; never let it break opening the letter.
  }
}
