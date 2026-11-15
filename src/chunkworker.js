import { TerrainGenerator } from './terraingen';
import { buildChunk, transferList } from './chunkbuild';

// Web Worker: dựng chunk ở luồng riêng. Luồng chính chỉ việc tạo mesh từ dữ liệu trả về.
let gen = null;
let cfg = null;
let propInfo = [];
let epoch = 0;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    gen = new TerrainGenerator(m.island);
    cfg = m.cfg;
    propInfo = m.propInfo;
    epoch = m.epoch;
  } else if (m.type === 'build') {
    if (!gen || m.epoch !== epoch) return; // yêu cầu của đảo / cấu hình cũ
    const r = buildChunk(gen, cfg, propInfo, m.cx, m.cz);
    r.type = 'chunk';
    r.epoch = epoch;
    self.postMessage(r, transferList(r));
  }
};