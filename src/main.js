import * as THREE from 'three';
import { World } from './core/World.js';
import { Input } from './core/Input.js';
import { allAssets, listPrefabs } from './core/Registry.js';
import { preload } from './core/assets.js';

// Tự động nạp mọi file trong /prefabs: thêm file mới = có prefab mới
import.meta.glob('./prefabs/**/*.js', { eager: true });

async function main() {
  const world = new World(document.getElementById('c'));
  await preload(allAssets());
  world.spawn('knight', [0, 0, 0]);

  const enemies = listPrefabs('enemy');
  const pick = () => {
    let r = Math.random() * enemies.reduce((s, p) => s + p.spawnWeight, 0);
    return enemies.find(p => (r -= p.spawnWeight) <= 0) ?? enemies[0];
  };
  const spawnNear = id => {
    const a = Math.random() * Math.PI * 2, p = world.player.position;
    world.spawn(id, [p.x + Math.cos(a) * 12, 0, p.z + Math.sin(a) * 12]);
  };

  const clock = new THREE.Clock(); let spawnT = 0, animI = 0;
  (function loop() {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (Input.pressed('KeyC')) world.rig.toggle();
    if (Input.pressed('KeyP')) {   // thử lần lượt từng animation của player
      const m = world.player.model;
      if (m.names?.length) { const n = m.names[animI++ % m.names.length]; console.log('▶ animation:', n); world.player.playAnim(n); }
    }
    enemies.forEach((p, i) => { if (Input.pressed(`Digit${i + 1}`)) spawnNear(p.id); });
    if ((spawnT -= dt) <= 0 && world.entities.filter(e => e.type === 'enemy').length < 5) { spawnT = 3; spawnNear(pick().id); }
    world.update(dt); Input.endFrame(); world.render();
    requestAnimationFrame(loop);
  })();
}
main();