import { CloudError } from './cloud';

const LOCAL_KEY = 'dao-mod-save-v2';
const LEGACY_KEY = 'infinite-terrain-save-v1'; // bản lưu của phiên bản cũ
const AUTOSAVE_SECONDS = 6; // lưu tự động sau chừng này giây kể từ lần thay đổi cuối

/**
 * Lưu / nạp dữ liệu người chơi (GameState):
 *  - Chế độ 'local': chỉ lưu trong máy này (localStorage).
 *  - Chế độ 'cloud': vẫn ghi bản trong máy (dự phòng khi mất mạng) và đồng bộ lên máy chủ (Neon) kèm nhật ký sự kiện.
 *    Có kiểm tra phiên bản để tránh ghi đè nhầm khi chơi trên 2 máy / 2 tab: nếu lệch thì hỏi người chơi giữ bản nào.
 * Mất mạng thì tự chuyển sang "offline" và thử lại ở lần lưu kế tiếp, không mất dữ liệu.
 */
export class SaveManager {
  constructor({ state, cloud, storage = globalThis.localStorage, askConflict = null, onStatus = null, playerName = 'Người chơi' }) {
    this.state = state;
    this.cloud = cloud;
    this.storage = storage;
    this.askConflict = askConflict; // async (local, remote) => 'local' | 'remote'
    this.onStatus = onStatus; // (status, text) => void
    this.playerName = playerName;
    this.mode = 'local'; // 'local' | 'cloud'
    this.version = 0; // phiên bản bản lưu trên máy chủ mà ta đang dựa vào
    this.dirty = false;
    this.idle = 0; // giây kể từ lần thay đổi cuối
    this.busy = false;
    this.again = false;
    this.status = 'local'; // 'local' | 'saving' | 'cloud' | 'offline'
    this.lastSavedAt = 0;
    this.onRemoteApplied = null; // (data) => void: đã nạp bản của server vào state (main dựng lại đảo)
    state.onChange = () => this.markDirty();
  }

  // ---------------------------------------------------------------- máy này

  readLocal() {
    try {
      const raw = this.storage.getItem(LOCAL_KEY);
      if (raw) return JSON.parse(raw);
      const legacy = this.storage.getItem(LEGACY_KEY);
      if (legacy) return { ...JSON.parse(legacy), savedAt: 1 }; // cũ hơn mọi bản mới; hydrate sẽ đổi id mod cũ
    } catch {
      /* bỏ qua */
    }
    return null;
  }

  writeLocal(data) {
    try {
      this.storage.setItem(LOCAL_KEY, JSON.stringify(data));
    } catch {
      /* bỏ qua */
    }
  }

  // ---------------------------------------------------------------- trạng thái

  setStatus(status) {
    this.status = status;
    this.onStatus?.(status, this.statusText());
  }

  statusText() {
    const t = this.lastSavedAt ? new Date(this.lastSavedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
    const at = t ? ` · lúc ${t}` : '';
    switch (this.status) {
      case 'saving': return 'Đang lưu...';
      case 'cloud': return `Đã lưu lên server${at}`;
      case 'offline': return `Mất kết nối server — đã lưu trong máy${at}`;
      default: return `Đã lưu trong máy${at}`;
    }
  }

  markDirty() {
    this.dirty = true;
    this.idle = 0;
  }

  /** Gọi mỗi frame: lưu tự động khi đã yên lặng đủ lâu. */
  tick(dt) {
    if (!this.dirty || this.busy) return;
    this.idle += dt;
    if (this.idle >= AUTOSAVE_SECONDS) this.flush();
  }

  // ---------------------------------------------------------------- lưu

  /** Lưu ngay. Trả về trạng thái sau khi lưu. */
  async flush(force = false) {
    if (!this.dirty && !force) return this.status;
    if (this.busy) {
      this.again = true;
      return this.status;
    }
    this.busy = true;
    const data = this.state.serialize();
    this.writeLocal(data);
    this.dirty = false;
    this.lastSavedAt = data.savedAt;
    if (this.mode !== 'cloud') {
      this.setStatus('local');
      this.busy = false;
      return this.status;
    }

    const events = this.state.takeEvents();
    try {
      this.setStatus('saving');
      const r = await this.cloud.save({ data, base: this.version, events });
      if (r.conflict) {
        this.state.requeueEvents(events);
        await this.resolveConflict(data, r);
      } else {
        this.version = r.version;
        if (r.eventsOk === false) this.state.requeueEvents(events);
        this.setStatus('cloud');
      }
    } catch (err) {
      this.state.requeueEvents(events);
      this.dirty = true;
      this.setStatus('offline');
      if (err instanceof CloudError && err.status === 401) this.cloud.clearCreds(); // tài khoản không còn hợp lệ: đăng ký lại ở lần kết nối sau
    } finally {
      this.busy = false;
      if (this.again) {
        this.again = false;
        this.flush();
      }
    }
    return this.status;
  }

  async resolveConflict(local, r) {
    const choice = this.askConflict ? await this.askConflict(local, r.data) : 'local';
    this.version = r.version;
    if (choice === 'remote' && r.data) {
      this.state.hydrate(r.data);
      this.writeLocal(r.data);
      this.dirty = false;
      this.setStatus('cloud');
      this.onRemoteApplied?.(r.data);
    } else {
      this.dirty = true; // giữ bản trong máy, lần lưu kế tiếp sẽ ghi đè bản trên máy chủ
      this.flush();
    }
  }

  /** Gọi khi đóng tab / ẩn trang: ghi bản trong máy ngay và gửi nhanh lên máy chủ (nếu đang ở chế độ server). */
  beacon() {
    if (!this.dirty && this.mode !== 'cloud') return;
    const data = this.state.serialize();
    this.writeLocal(data);
    if (this.mode === 'cloud' && this.dirty) {
      const events = this.state.takeEvents();
      if (!this.cloud.beacon({ data, base: this.version, events })) this.state.requeueEvents(events);
    }
  }

  // ---------------------------------------------------------------- kết nối server

  /**
   * Kết nối server và chọn bản dữ liệu để dùng.
   * Trả về { source: 'cloud' | 'local', data } - data = bản cần nạp vào state, null = giữ nguyên state hiện tại.
   */
  async connect() {
    try {
      if (!this.cloud.hasCreds()) await this.cloud.register(this.playerName);
      let remote;
      try {
        remote = await this.cloud.load();
      } catch (err) {
        if (!(err instanceof CloudError) || err.status !== 401) throw err;
        this.cloud.clearCreds(); // tài khoản cũ không còn trên máy chủ: đăng ký lại
        await this.cloud.register(this.playerName);
        remote = await this.cloud.load();
      }
      this.mode = 'cloud';
      this.version = remote.version ?? 0;
      const local = this.readLocal();

      if (!remote.data) {
        this.markDirty(); // lần đầu: đẩy bản trong máy lên
        this.setStatus('cloud');
        return { source: 'local', data: null };
      }
      if (!local || !this.state.hasProgress()) {
        this.setStatus('cloud');
        return { source: 'cloud', data: remote.data };
      }
      if ((remote.data.savedAt ?? 0) >= (local.savedAt ?? 0)) {
        this.setStatus('cloud');
        return { source: 'cloud', data: remote.data }; // bản server mới hơn (hoặc bằng)
      }
      // Bản trong máy mới hơn bản server: hỏi để khỏi ghi đè nhầm
      const choice = this.askConflict ? await this.askConflict(local, remote.data) : 'local';
      this.setStatus('cloud');
      if (choice === 'remote') return { source: 'cloud', data: remote.data };
      this.markDirty();
      return { source: 'local', data: null };
    } catch (err) {
      this.mode = 'local';
      this.setStatus('offline');
      return { source: 'local', data: null, error: err };
    }
  }

  disconnect() {
    this.mode = 'local';
    this.setStatus('local');
  }
}