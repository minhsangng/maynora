import { TYPE_DEFAULTS } from './types.js';
const prefabs = new Map();

export function definePrefab(def) {
  const base = TYPE_DEFAULTS[def.type];
  if (!base) throw new Error(`Loại không hợp lệ: ${def.type}`);
  const full = { height: 3, spawnWeight: 1, assets: [], skills: [], ...base, ...def, stats: { ...base.stats, ...def.stats } };
  prefabs.set(full.id, full);
  return full;
}
// Prefab variant: kế thừa prefab khác, ghi đè một phần
export const extendPrefab = (base, patch) => definePrefab({ ...base, ...patch, stats: { ...base.stats, ...patch.stats } });

export function getPrefab(id) { const p = prefabs.get(id); if (!p) throw new Error(`Không có prefab: ${id}`); return p; }
export const listPrefabs = type => [...prefabs.values()].filter(p => !type || p.type === type);
export const allAssets = () => [...new Set([...prefabs.values()].flatMap(p => p.assets))];
