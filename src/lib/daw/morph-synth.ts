/** Pure spectral-shape helpers used by the original Morph Synth engine. */
export function buildMorphSpectrum(
  morph: number,
  harmonics: number,
  partialCount = 64
): Float32Array {
  const m = Math.max(0, Math.min(1, Number.isFinite(morph) ? morph : 0));
  const h = Math.max(0.1, Math.min(1, Number.isFinite(harmonics) ? harmonics : 0.1));
  const count = Math.max(4, Math.min(128, Math.floor(partialCount)));
  const spectrum = new Float32Array(count);

  for (let partial = 1; partial < count; partial++) {
    const n = partial;
    const saw = 1 / n;
    const oddOrgan = n % 2 === 1 ? 1 / n : 0;
    const bell = Math.exp(-Math.pow((Math.log(n) - 1.35) / 0.78, 2)) / Math.sqrt(n);
    const glass = Math.exp(-Math.pow((n - (2 + m * 25)) / (1.4 + m * 2.8), 2)) / Math.sqrt(n);
    const organBell = oddOrgan * (1 - m) + bell * m;
    const spectral = organBell * (1 - m * 0.55) + glass * m * 0.55;
    const body = saw * (1 - m) + spectral * m;
    const rolloff = Math.pow(1 - (n - 1) / count, 0.3 + (1 - h) * 2.4);
    spectrum[partial] = body * rolloff * (0.35 + h * 1.65);
  }

  return spectrum;
}
