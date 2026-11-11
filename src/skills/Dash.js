import { Skill } from '../core/Skill.js';
export class Dash extends Skill {
  static defaults = { name: 'Dash', cooldown: 2, range: 0, speed: 16, duration: 0.18 };
  use() { this.owner.dash(this.owner.forward, this.speed, this.duration); }
}
