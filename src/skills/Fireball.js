import * as THREE from 'three';
import { Skill } from '../core/Skill.js';
import { Projectile } from '../core/Projectile.js';
export class Fireball extends Skill {
  static defaults = { name: 'Fireball', cooldown: 1.2, range: 10, damage: 20, speed: 12 };
  use(world) {
    const o = this.owner;
    const pos = o.position.clone().add(new THREE.Vector3(0, 1.5, 0)).addScaledVector(o.forward, 0.8);
    world.addProjectile(new Projectile({ owner: o, pos, dir: o.forward, speed: this.speed, damage: this.damage }));
    o.playAnim('attack');
  }
}
