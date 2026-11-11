import { definePrefab } from '../../core/Registry.js';
import { glbModel } from '../../core/assets.js';
import { MeleeAttack } from '../../skills/MeleeAttack.js';
import { Fireball } from '../../skills/Fireball.js';
import { Dash } from '../../skills/Dash.js';

const FILE = '/src/models/player/player.glb';          // đổi thành tên file .glb của bạn

// Khi tải thêm animation từ Mixamo, bỏ comment 3 dòng "EXTRA" bên dưới
// const EXTRA = { idle: '/models/idle.fbx', attack: '/models/attack.fbx' };

export default definePrefab({
  id: 'knight', type: 'player', respawn: true, height: 2.2,
  stats: { maxHp: 120, speed: 5.5 },
  assets: [FILE /*, ...Object.values(EXTRA)*/],
  skills: [
    { skill: MeleeAttack, damage: 15, cooldown: 0.45, range: 2.2 },
    { skill: Fireball, damage: 22 },
    { skill: Dash },
  ],
  skillKeys: ['KeyJ', 'KeyK', 'KeyL'],
  emotes: { KeyZ: 'Tender Placement', KeyX: 'Sleeping Idle' },   // phím -> tên animation trong file
  model: () => glbModel(FILE, {
    height: 1.8,                           // chiều cao nhân vật (mét), tự tính scale
    clips: { walk: 'Walking' },            // gán clip vào trạng thái: idle / walk / attack
    // anims: EXTRA,                       // EXTRA
  }),
});