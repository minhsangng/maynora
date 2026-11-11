// Tìm mục tiêu thù địch trong tầm (bỏ qua cùng team và neutral)
export function hostilesInRange(entities, src, range, { front = false } = {}) {
  const out = [], f = src.forward;
  for (const e of entities) {
    if (e === src || !e.alive || e.team === 'neutral' || e.team === src.team) continue;
    const dx = e.position.x - src.position.x, dz = e.position.z - src.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > range + e.radius) continue;
    if (front && dist > 0.001 && (dx * f.x + dz * f.z) / dist < 0) continue;
    out.push(e);
  }
  return out;
}
