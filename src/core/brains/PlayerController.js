import { Input } from '../Input.js';
export class PlayerController {
  constructor(e) { this.e = e; }
  update(dt, world) {
    const e = this.e, k = c => (Input.down(c) ? 1 : 0);
    e.moveDir.set(k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft'), 0, k('KeyS') + k('ArrowDown') - k('KeyW') - k('ArrowUp'));
    if (Input.pressed('Space')) e.jump();
    // emotes: { KeyZ: 'tên animation' } khai báo trong prefab
    for (const [key, anim] of Object.entries(e.prefab.emotes ?? {})) if (Input.pressed(key)) e.playAnim(anim);
    // skill thứ i trong prefab gắn với phím skillKeys[i]
    e.skills.forEach((s, i) => { const key = e.prefab.skillKeys?.[i]; if (key && Input.down(key)) s.tryUse(world); });
  }
}