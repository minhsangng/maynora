import { definePrefab } from '../../core/Registry.js';
import { makeSlime } from '../../models/slime.js';
import { MeleeAttack } from '../../skills/MeleeAttack.js';

export default definePrefab({
  id: 'slime', type: 'enemy', height: 1.8,
  stats: { maxHp: 25, speed: 2 },
  skills: [{ skill: MeleeAttack, damage: 4, cooldown: 1.2, range: 1.4 }],
  model: () => makeSlime(),
});
