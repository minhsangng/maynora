import { extendPrefab } from '../../core/Registry.js';
import goblin from './Goblin.js';
import { makeHumanoid } from '../../models/humanoid.js';
import { MeleeAttack } from '../../skills/MeleeAttack.js';

// Variant: kế thừa Goblin, chỉ đổi những gì khác
export default extendPrefab(goblin, {
  id: 'goblin_chief', height: 3.2, spawnWeight: 0.3,
  stats: { maxHp: 120, speed: 3.6 },
  skills: [{ skill: MeleeAttack, damage: 14, cooldown: 0.9, range: 2 }],
  model: () => makeHumanoid({ scale: 1.25, skin: 0x5f9e3a, body: 0x7f1d1d, legs: 0x3b0d0d, helmet: 0xd4a017, weapon: 'club' }),
});
