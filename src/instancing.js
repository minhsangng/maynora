import * as THREE from 'three';

/** Báo cho three chỉ tải lên GPU phần đầu `floats` số của buffer (đỡ tải cả buffer dung lượng lớn mỗi lần). */
function markRange(attr, floats) {
  if (typeof attr.clearUpdateRanges === 'function') {
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, floats);
  } else if (attr.updateRange) {
    attr.updateRange.offset = 0;
    attr.updateRange.count = floats;
  }
  attr.needsUpdate = true;
}

/**
 * MỘT InstancedMesh dùng chung cho MỌI chunk (cùng model + cùng material) => số draw call không phụ thuộc số chunk.
 * Mỗi chunk đóng góp 1 "đoạn" ma trận (segment). Mỗi lần rebuild chỉ chép các đoạn đang nhìn thấy
 * (đủ gần + nằm trong khung hình) vào buffer, nên GPU không phải vẽ cây phía sau lưng.
 */
export class InstanceBatch {
  constructor(scene, geometry, material, capacity) {
    this.capacity = capacity;
    this.segs = new Map(); // key chunk -> { data, n, ...meta }
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false; // việc cắt theo khung hình đã làm ở mức chunk
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  set(key, data, n, meta) {
    this.segs.set(key, { data, n, ...meta });
  }

  remove(key) {
    return this.segs.delete(key);
  }

  /** isVisible(seg) quyết định đoạn nào được vẽ. Trả về số instance đang vẽ. */
  rebuild(isVisible) {
    const arr = this.mesh.instanceMatrix.array;
    const capFloats = this.capacity * 16;
    let off = 0;
    for (const seg of this.segs.values()) {
      if (seg.n <= 0 || !isVisible(seg)) continue;
      const floats = Math.min(seg.n * 16, capFloats - off);
      if (floats <= 0) break;
      arr.set(floats === seg.n * 16 ? seg.data : seg.data.subarray(0, floats), off);
      off += floats;
    }
    const count = off / 16;
    if (count !== this.mesh.count || count > 0) markRange(this.mesh.instanceMatrix, off);
    this.mesh.count = count;
    this.mesh.visible = count > 0; // không có gì để vẽ thì khỏi tốn draw call
    return count;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose(); // chỉ giải phóng buffer ma trận; geometry/material dùng chung nên giữ lại
    this.segs.clear();
  }
}