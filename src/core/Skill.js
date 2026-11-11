// Skill dùng chung: thông số (cooldown, damage...) truyền qua config của từng prefab
export class Skill {
  static defaults = { name: 'Skill', cooldown: 1, range: 2 };
  constructor(owner, cfg = {}) {
    this.owner = owner;
    Object.assign(this, this.constructor.defaults, cfg);
    this.timer = 0;
  }
  get ready() { return this.timer <= 0; }
  update(dt) { if (this.timer > 0) this.timer -= dt; }
  tryUse(world) {
    if (!this.ready || !this.owner.alive) return false;
    this.timer = this.cooldown;
    this.use(world);
    return true;
  }
  use(world) {}
}
