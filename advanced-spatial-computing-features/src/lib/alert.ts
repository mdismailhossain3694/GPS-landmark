// Web Audio API — Boundary Deviation Alert beeps + Vibration API

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Sharp dual-tone "বিপ-বিপ" siren */
export function playDeviationAlarm(repeat = 2) {
  const ac = getCtx();
  if (!ac) return;
  const t0 = ac.currentTime;
  for (let r = 0; r < repeat; r++) {
    for (const [f, dt] of [[880, 0], [660, 0.16]] as const) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "square";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, t0 + r * 0.42 + dt);
      gain.gain.exponentialRampToValueAtTime(0.22, t0 + r * 0.42 + dt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + r * 0.42 + dt + 0.15);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0 + r * 0.42 + dt);
      osc.stop(t0 + r * 0.42 + dt + 0.18);
    }
  }
  // Vibration pattern: vibrate-pause-vibrate
  try {
    if ("vibrate" in navigator) navigator.vibrate([220, 120, 220, 120, 340]);
  } catch { /* noop */ }
}

/** Soft confirmation blip */
export function playBlip(freq = 740) {
  const ac = getCtx();
  if (!ac) return;
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.25);
}

/** Warning triple-beep for overlap detection */
export function playOverlapWarning() {
  const ac = getCtx();
  if (!ac) return;
  const t0 = ac.currentTime;
  [520, 520, 780].forEach((f, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = f;
    const t = t0 + i * 0.2;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  });
}
