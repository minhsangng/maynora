import * as THREE from 'three';
import { hostilesInRange } from './combat.js';
export class Projectile {
  constructor({ owner, pos, dir, speed = 12, damage = 10, life = 1.5, radius = 0.35, color = 0xff7a18 }) {
    Object.assign(this, { owner, damage, life, radius, dead: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), new THREE.MeshBasicMaterial({ color }));
    this.mesh.position.copy(pos);
    this.vel = dir.clone().normalize().multiplyScalar(speed);
  }
  update(dt, world) {
    this.mesh.position.addScaledVector(this.vel, dt);
    const hit = hostilesInRange(world.entities, { position: this.mesh.position, team: this.owner.team }, this.radius)[0];
    if (hit) { hit.takeDamage(this.damage, this.owner); this.dead = true; }
    if ((this.life -= dt) <= 0) this.dead = true;
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
