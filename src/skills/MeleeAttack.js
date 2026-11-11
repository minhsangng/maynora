import { Skill } from '../core/Skill.js';
import { hostilesInRange } from '../core/combat.js';
export class MeleeAttack extends Skill {
  static defaults = { name: 'Melee', cooldown: 0.6, range: 1.8, damage: 10 };
  use(world) {
    const o = this.owner;
    o.playAnim('attack');
    for (const t of hostilesInRange(world.entities, o, this.range, { front: true })) t.takeDamage(this.damage, o);
  }
}
