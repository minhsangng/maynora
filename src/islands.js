import * as THREE from 'three';
import { hash2D, mulberry32 } from './noise';

/**
 * Danh sách đảo. Chỉ đảo hiện tại được nạp; hoàn thành HẾT nhiệm vụ của đảo thì được dịch chuyển sang đảo kế tiếp
 * (hết danh sách thì quay về đảo đầu).
 *
 *  seed, radius      hình dạng + kích thước đảo (bán kính danh nghĩa, mét). Đất liền đi được nhỏ hơn ~25%.
 *  relief            độ gồ ghề (0.8 = đồi thoải, 1.4 = núi cao)
 *  forestThreshold   ngưỡng rừng (thấp = nhiều cây hơn, cao = ít cây)
 *  wild              id các mod hoang dã xuất hiện trên đảo này (bỏ trống = tất cả)
 *  landmarks         số cột sáng (hải đăng) đặt trên đảo
 *  quests            nhiệm vụ của đảo (KHÁC nhiệm vụ tân thủ nhận mod). Mỗi nhiệm vụ xong: +1 Lv cho mod dẫn đầu.
 *      stat: 'landmarks' (số hải đăng đã chạm) | 'wins' (số trận thắng trên đảo) | 'meets' (số mod hoang dã đã gặp trên đảo)
 */
export const ISLAND_DEFS = [
  {
    id: 'khoi_dau',
    name: 'Đảo Khởi Đầu',
    seed: 12345,
    radius: 700,
    relief: 0.8,
    forestThreshold: 0.1,
    wild: ['quy_ti', 'ca_sau', 'quy_su', 'nhat_long'],
    landmarks: 3,
    quests: [
      { id: 'beacons', title: 'Thắp sáng hải đăng', desc: 'Chạm vào cả 3 cột sáng trên đảo', stat: 'landmarks', goal: 3 },
      { id: 'wins', title: 'Thợ săn mod', desc: 'Thắng 2 trận thách đấu', stat: 'wins', goal: 2 },
      { id: 'meets', title: 'Nhà thám hiểm', desc: 'Gặp 3 mod hoang dã', stat: 'meets', goal: 3 },
    ],
  },
  {
    id: 'rung_xanh',
    name: 'Đảo Rừng Xanh',
    seed: 777,
    radius: 800,
    relief: 1.0,
    forestThreshold: -0.15,
    wild: ['moc_ti', 'cu_dem', 'rua_co', 'soi_da'],
    landmarks: 4,
    quests: [
      { id: 'beacons', title: 'Thắp sáng hải đăng', desc: 'Chạm vào cả 4 cột sáng trên đảo', stat: 'landmarks', goal: 4 },
      { id: 'wins', title: 'Thợ săn mod', desc: 'Thắng 4 trận thách đấu', stat: 'wins', goal: 4 },
      { id: 'meets', title: 'Nhà thám hiểm', desc: 'Gặp 8 mod hoang dã', stat: 'meets', goal: 8 },
    ],
  },
  {
    id: 'da_xam',
    name: 'Đảo Đá Xám',
    seed: 4242,
    radius: 900,
    relief: 1.4,
    forestThreshold: 0.3,
    wild: ['soi_da', 'cu_dem', 'rua_co', 'hoa_ti'],
    landmarks: 5,
    quests: [
      { id: 'beacons', title: 'Thắp sáng hải đăng', desc: 'Chạm vào cả 5 cột sáng trên đảo', stat: 'landmarks', goal: 5 },
      { id: 'wins', title: 'Thợ săn mod', desc: 'Thắng 6 trận thách đấu', stat: 'wins', goal: 6 },
      { id: 'meets', title: 'Nhà thám hiểm', desc: 'Gặp 10 mod hoang dã', stat: 'meets', goal: 10 },
    ],
  },
];

const COLOR_NEW = 0xffc94d;
const COLOR_DONE = 0x59ff8a;
const TOUCH_RANGE = 6;

/** Các cột sáng trên đảo: vị trí cố định theo seed của đảo, chạm vào để "thắp sáng". */
export class Landmarks {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.items = [];
    this.time = 0;
    this.onVisit = null;
    this.beamGeo = new THREE.CylinderGeometry(0.5, 0.9, 50, 14, 1, true).translate(0, 25, 0);
    this.gemGeo = new THREE.OctahedronGeometry(0.9);
    this.baseGeo = new THREE.CylinderGeometry(2.2, 2.6, 0.5, 20).translate(0, 0.25, 0);
  }

  get count() {
    return this.items.length;
  }

  /** Dựng lại hải đăng cho đảo `def`. `visited` = danh sách chỉ số hải đăng đã chạm (từ file lưu). */
  build(def, visited = [], onVisit = null) {
    this.clear();
    this.onVisit = onVisit;
    const rand = mulberry32(hash2D(def.seed, 99, 7));
    const pts = [];
    const n = def.landmarks ?? 0;
    const minSep = Math.max(100, def.radius * 0.2);

    const tryPlace = (attempts, minH, maxSlope, sep) => {
      for (let t = 0; t < attempts; t++) {
        const a = rand() * Math.PI * 2;
        const r = (0.1 + rand() * 0.5) * def.radius;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const h = this.terrain.height(x, z);
        if (h < minH) continue;
        const slope = Math.abs(this.terrain.height(x + 2, z) - h) + Math.abs(this.terrain.height(x, z + 2) - h);
        if (slope > maxSlope) continue;
        if (sep && pts.some((p) => Math.hypot(p.x - x, p.z - z) < sep)) continue;
        return { x, z, h };
      }
      return null;
    };

    for (let i = 0; i < n; i++) {
      // Nới dần điều kiện để chắc chắn luôn đặt đủ số hải đăng (nhiệm vụ cần đủ)
      const p = tryPlace(300, 4, 3, minSep) ?? tryPlace(600, 2, 6, 40) ?? tryPlace(2000, 0.5, 99, 0) ?? { x: 20 * i, z: 0, h: this.terrain.height(20 * i, 0) };
      pts.push(p);
    }

    pts.forEach((p, i) => {
      const group = new THREE.Group();
      group.position.set(p.x, p.h, p.z);
      const color = visited.includes(i) ? COLOR_DONE : COLOR_NEW;
      const baseMat = new THREE.MeshLambertMaterial({ color });
      const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
      const gemMat = new THREE.MeshBasicMaterial({ color });
      const base = new THREE.Mesh(this.baseGeo, baseMat);
      const beam = new THREE.Mesh(this.beamGeo, beamMat);
      const gem = new THREE.Mesh(this.gemGeo, gemMat);
      gem.position.y = 3;
      group.add(base, beam, gem);
      this.scene.add(group);
      this.items.push({ index: i, x: p.x, z: p.z, group, gem, mats: [baseMat, beamMat, gemMat], visited: visited.includes(i), phase: i });
    });
  }

  update(dt, pos) {
    this.time += dt;
    for (const it of this.items) {
      it.gem.rotation.y += dt * 1.5;
      it.gem.position.y = 3 + Math.sin(this.time * 2 + it.phase) * 0.3;
      if (!it.visited && Math.hypot(pos.x - it.x, pos.z - it.z) < TOUCH_RANGE) {
        it.visited = true;
        for (const m of it.mats) m.color.setHex(COLOR_DONE);
        this.onVisit?.(it.index);
      }
    }
  }

  /** Hải đăng chưa chạm gần nhất: { x, z, dist } hoặc null. */
  nearestUnvisited(pos) {
    let best = null;
    for (const it of this.items) {
      if (it.visited) continue;
      const dist = Math.hypot(pos.x - it.x, pos.z - it.z);
      if (!best || dist < best.dist) best = { x: it.x, z: it.z, dist };
    }
    return best;
  }

  clear() {
    for (const it of this.items) {
      it.group.removeFromParent();
      for (const m of it.mats) m.dispose();
    }
    this.items = [];
  }
}