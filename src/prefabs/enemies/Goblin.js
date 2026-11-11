import { definePrefab } from '../../core/Registry.js';
import { makeHumanoid } from '../../models/humanoid.js';
import { MeleeAttack } from '../../skills/MeleeAttack.js';

export default definePrefab({
  id: 'goblin', type: 'enemy', height: 2.5,
  stats: { maxHp: 40, speed: 3.2 },
  skills: [{ skill: MeleeAttack, damage: 6, cooldown: 1, range: 1.6 }],
  model: () => makeHumanoid({ scale: 0.8, skin: 0x86c25b, body: 0x7c4a1e, legs: 0x4a2c10, weapon: 'club' }),
});
