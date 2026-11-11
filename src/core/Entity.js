import * as THREE from 'three';
const GRAVITY = -25;
const angleLerp = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
const _v = new THREE.Vector3();

// Một "instance" được tạo từ prefab: logic chung, phần riêng nằm ở dữ liệu của prefab
export class Entity {
  constructor(prefab, overrides = {}) {
    this.prefab = prefab; this.id = prefab.id; this.type = prefab.type;
    this.stats = { ...prefab.stats, ...overrides.stats };
    this.hp = this.stats.maxHp;
    this.skills = prefab.skills.map(cfg => new cfg.skill(this, cfg));
    this.model = prefab.model(this);            // { root, animate?, play? }
    this.object = this.model.root;
    this.brain = prefab.brain ? new prefab.brain(this) : null;

    this.moveDir = new THREE.Vector3();
    this.vy = 0; this.onGround = true; this.isMoving = false;
    this.targetFacing = 0; this.impulse = null;
    this.alive = true; this.removed = false; this.deathT = 0.25; this.flashT = 0;

    this.materials = [];
    this.object.traverse(o => { if (o.isMesh && o.material?.emissive) this.materials.push(o.material); });
    this._makeHpBar();
  }
  get position() { return this.object.position; }
  get team() { return this.stats.team; }
  get radius() { return this.stats.radius; }
  get forward() { const y = this.object.rotation.y; return new THREE.Vector3(Math.sin(y), 0, Math.cos(y)); }

  jump() { if (this.onGround && this.stats.jump > 0) this.vy = this.stats.jump; }
  dash(dir, speed, t) { this.impulse = { dir: dir.clone().normalize(), speed, t }; }
  faceToward(v) { this.targetFacing = Math.atan2(v.x, v.z); }
  playAnim(name) { this.model.play?.(name); }

  takeDamage(n) {
    if (!this.alive) return;
    this.hp -= n; this.flashT = 0.1;
    for (const m of this.materials) m.emissive.setHex(0xff3333);
    if (this.hp <= 0) this.die();
  }
  die() {
    if (this.prefab.respawn) { this.hp = this.stats.maxHp; this.position.set(0, 0, 0); return; }
    this.alive = false; this.hpBar.visible = false;
  }

  update(dt, world) {
    if (!this.alive) {
      this.deathT -= dt;
      this.object.scale.setScalar(Math.max(this.deathT / 0.25, 0));
      if (this.deathT <= 0) this.removed = true;
      return;
    }
    this.brain?.update(dt, world);
    for (const s of this.skills) s.update(dt);

    const pos = this.position;
    if (this.impulse) {
      pos.addScaledVector(this.impulse.dir, this.impulse.speed * dt);
      if ((this.impulse.t -= dt) <= 0) this.impulse = null;
      this.isMoving = true;
    } else {
      this.isMoving = this.moveDir.lengthSq() > 0;
      if (this.isMoving) {
        _v.copy(this.moveDir).normalize();
        pos.addScaledVector(_v, this.stats.speed * dt);
        this.faceToward(_v);
      }
    }
    this.vy += GRAVITY * dt; pos.y += this.vy * dt;
    if (pos.y <= 0) { pos.y = 0; this.vy = 0; this.onGround = true; } else this.onGround = false;

    this.object.rotation.y = angleLerp(this.object.rotation.y, this.targetFacing, Math.min(1, dt * 15));
    this.model.animate?.(dt, this);

    if (this.flashT > 0 && (this.flashT -= dt) <= 0) for (const m of this.materials) m.emissive.setHex(0x000000);
    this.hpBar.position.set(pos.x, pos.y + this.prefab.height, pos.z);
    this.barFg.scale.x = Math.max(0.0001, 1.2 * this.hp / this.stats.maxHp);
  }

  _makeHpBar() {
    const mk = c => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ color: c, depthTest: false })); s.center.set(0, 0.5); s.renderOrder = 10; s.scale.set(1.2, 0.14, 1); s.position.x = -0.6; return s; };
    this.barBg = mk(0x222222); this.barFg = mk(this.team === 'player' ? 0x4ade80 : 0xef4444);
    this.hpBar = new THREE.Group(); this.hpBar.add(this.barBg, this.barFg);
  }
}
