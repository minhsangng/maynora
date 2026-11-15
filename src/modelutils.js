import * as THREE from 'three';

/** Đổi vật liệu PBR (MeshStandard...) sang Lambert: giữ màu/texture/alpha nhưng tính đèn nhẹ hơn nhiều. */
export function toLambert(m) {
  if (Array.isArray(m)) return m.map(toLambert);
  if (m.isMeshLambertMaterial || m.isMeshBasicMaterial) return m;
  return new THREE.MeshLambertMaterial({
    color: m.color ? m.color.clone() : 0xffffff,
    map: m.map ?? null,
    alphaTest: m.alphaTest ?? 0,
    transparent: m.transparent ?? false,
    opacity: m.opacity ?? 1,
    side: m.side,
    vertexColors: m.vertexColors ?? false,
    emissive: m.emissive ? m.emissive.clone() : 0x000000,
    emissiveMap: m.emissiveMap ?? null,
  });
}

/**
 * Gom mọi mesh trong GLB thành danh sách {geometry, material, materialSimple} đã "nướng" sẵn transform,
 * chuẩn hoá về CAO 1 MÉT, chân ở y = 0, căn giữa X/Z. Dùng chung cho cây/đá/cỏ và vật phẩm.
 * opts: { doubleSide, cutout } (cỏ, lá dạng tấm phẳng).
 */
export function extractParts(root, opts = {}) {
  root.updateMatrixWorld(true);
  const parts = [];
  const box = new THREE.Box3();

  root.traverse((o) => {
    if (!o.isMesh) return;
    const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox);
    for (const m of [].concat(o.material)) {
      if (opts.doubleSide) m.side = THREE.DoubleSide;
      if (opts.cutout) {
        m.alphaTest = opts.cutout;
        m.transparent = false;
        m.depthWrite = true;
      }
    }
    parts.push({ geometry, material: o.material });
  });

  if (parts.length === 0) throw new Error('GLB không có mesh nào');

  const size = box.getSize(new THREE.Vector3());
  const s = size.y > 1e-6 ? 1 / size.y : 1;
  const fit = new THREE.Matrix4()
    .makeScale(s, s, s)
    .multiply(
      new THREE.Matrix4().makeTranslation(
        -(box.min.x + box.max.x) / 2,
        -box.min.y,
        -(box.min.z + box.max.z) / 2,
      ),
    );

  let tris = 0;
  for (const p of parts) {
    p.geometry.applyMatrix4(fit);
    p.materialSimple = toLambert(p.material); // dùng ở mức chất lượng thấp / vừa
    const g = p.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
  // nửa bề ngang / chiều cao (sau chuẩn hoá) - dùng để tính bán kính va chạm của đá
  const halfW = size.y > 1e-6 ? Math.max(size.x, size.z) / 2 / size.y : 0.3;
  return { parts, tris, halfW };
}