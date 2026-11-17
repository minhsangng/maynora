const CRED_KEY = 'dao-mod-cloud-v1';

export class CloudError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status; // 0 = lỗi mạng / không tới được máy chủ
  }
}

/**
 * Client gọi máy chủ lưu trữ (api/game.js, chạy serverless và nói chuyện với Neon). Trình duyệt KHÔNG nối thẳng
 * vào Postgres được: chuỗi kết nối phải nằm trong biến môi trường của máy chủ.
 * Danh tính người chơi: pid + key ngẫu nhiên do máy chủ cấp lúc đăng ký (tài khoản ẩn danh), cất trong localStorage.
 */
export class CloudClient {
  constructor({ endpoint = '/api/game', timeoutMs = 8000, storage = globalThis.localStorage, fetchFn = null } = {}) {
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
    this.storage = storage;
    this.fetchFn = fetchFn;
  }

  get creds() {
    try {
      const c = JSON.parse(this.storage.getItem(CRED_KEY));
      return c?.pid && c?.key ? c : null;
    } catch {
      return null;
    }
  }

  hasCreds() {
    return this.creds !== null;
  }

  clearCreds() {
    try {
      this.storage.removeItem(CRED_KEY);
    } catch {
      /* bỏ qua */
    }
  }

  async call(body) {
    const doFetch = this.fetchFn ?? globalThis.fetch;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl?.abort(), this.timeoutMs);
    try {
      const res = await doFetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl?.signal,
      });
      let json = null;
      try {
        json = await res.json();
      } catch {
        /* không phải JSON */
      }
      if (res.status === 409) return { ...(json ?? {}), conflict: true };
      if (!res.ok || !json?.ok) throw new CloudError(json?.error ?? `HTTP ${res.status}`, res.status);
      return json;
    } catch (err) {
      if (err instanceof CloudError) throw err;
      throw new CloudError(err?.name === 'AbortError' ? 'hết thời gian chờ' : 'không kết nối được máy chủ', 0);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Kiểm tra máy chủ có chạy không và đã cấu hình cơ sở dữ liệu chưa. */
  ping() {
    return this.call({ action: 'ping' });
  }

  async register(name = 'Người chơi') {
    const r = await this.call({ action: 'register', name });
    this.storage.setItem(CRED_KEY, JSON.stringify({ pid: r.pid, key: r.key }));
    return r;
  }

  /** => { data: bản lưu | null, version } */
  load() {
    const c = this.creds;
    if (!c) throw new CloudError('chưa đăng ký', 401);
    return this.call({ action: 'load', ...c });
  }

  /** base = phiên bản bản lưu mà client đang dựa trên. Trả { version } hoặc { conflict: true, version, data } */
  save({ data, base, events = [] }) {
    const c = this.creds;
    if (!c) throw new CloudError('chưa đăng ký', 401);
    return this.call({ action: 'save', ...c, base, data, events });
  }

  /** Gửi bản lưu lúc đóng tab (sendBeacon không chờ phản hồi, không đọc được kết quả). */
  beacon({ data, base, events = [] }) {
    const c = this.creds;
    if (!c || typeof navigator === 'undefined' || !navigator.sendBeacon) return false;
    const blob = new Blob([JSON.stringify({ action: 'save', ...c, base, data, events })], { type: 'application/json' });
    return navigator.sendBeacon(this.endpoint, blob);
  }
}