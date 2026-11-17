const KEY = 'dao-mod-settings-v1';
const OLD_TIER_KEY = 'infinite-terrain-quality';

/** Cài đặt RIÊNG CỦA MÁY NÀY (không đưa lên đám mây): chất lượng đồ hoạ, độ nhạy chuột, bảng thông số hiệu năng. */
export const DEFAULT_SETTINGS = { tier: 1, sens: 1, debug: false };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function loadSettings(storage = globalThis.localStorage, maxTier = 3) {
  const s = { ...DEFAULT_SETTINGS };
  try {
    const raw = storage.getItem(KEY);
    if (raw) {
      Object.assign(s, JSON.parse(raw));
    } else {
      const old = storage.getItem(OLD_TIER_KEY); // cài đặt chất lượng của bản cũ
      if (old !== null && Number.isInteger(Number(old))) s.tier = Number(old);
    }
  } catch {
    /* bỏ qua */
  }
  s.tier = clamp(Math.floor(Number(s.tier)) || 0, 0, maxTier);
  s.sens = clamp(Number(s.sens) || 1, 0.3, 2.5);
  s.debug = Boolean(s.debug);
  return s;
}

export function saveSettings(s, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* bỏ qua */
  }
}