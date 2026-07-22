/**
 * 提示铃声偏好（本机缓存 + 账号级同步）
 * 所有消息共用同一铃声；仅保留总开关。
 */

export interface SoundPrefs {
  enabled: boolean;
}

const STORAGE_KEY = "snailchem_sound_prefs";
const DEFAULT: SoundPrefs = { enabled: true };

let cached: SoundPrefs = { ...DEFAULT };
let audioCtx: AudioContext | null = null;
let unlocked = false;

export function normalizeSoundPrefs(raw: unknown): SoundPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT };
  const o = raw as Record<string, unknown>;
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : DEFAULT.enabled,
  };
}

export function getSoundPrefs(): SoundPrefs {
  return { ...cached };
}

export function hydrateSoundPrefs(raw: unknown) {
  cached = normalizeSoundPrefs(raw);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("sound-prefs-changed", { detail: cached }));
  }
}

export function loadSoundPrefsFromLocal(): SoundPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      cached = normalizeSoundPrefs(JSON.parse(raw));
      return { ...cached };
    }
  } catch {
    /* ignore */
  }
  cached = { ...DEFAULT };
  return { ...cached };
}

/** 首次用户手势后解锁 AudioContext（浏览器自动播放策略） */
export function unlockAudio() {
  if (unlocked && audioCtx?.state === "running") return;
  try {
    if (!audioCtx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
    }
    void audioCtx.resume().then(() => {
      unlocked = true;
    });
  } catch {
    /* ignore */
  }
}

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!audioCtx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

function beep(
  ctx: AudioContext,
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType,
  gainPeak: number,
) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gainPeak, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** 播放统一消息铃声（总开关关闭时不播） */
export function playNotificationSound() {
  const prefs = getSoundPrefs();
  if (!prefs.enabled) return;

  const ctx = ensureCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  // 统一双音上升
  beep(ctx, 880, t0, 0.12, "sine", 0.18);
  beep(ctx, 1320, t0 + 0.11, 0.16, "sine", 0.16);
}
