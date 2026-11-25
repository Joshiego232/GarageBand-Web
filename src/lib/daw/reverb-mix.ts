export interface ReverbMixGains {
  dry: number;
  send: number;
}

export function normalizeReverbSend(
  send: number,
  returnGain = 0.8,
): ReverbMixGains {
  const boundedSend = Math.max(0, Math.min(1, send));
  const wetLevel = boundedSend * Math.max(0, returnGain);
  const normalization = 1 / Math.sqrt(1 + wetLevel * wetLevel);

  return {
    dry: normalization,
    send: boundedSend * normalization,
  };
}
