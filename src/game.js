// Hàm serverless (Vercel) lưu dữ liệu người chơi vào Neon. TỰ CHỨA: không import tương đối từ file khác,
// vì Vercel không đảm bảo đóng gói được file dùng chung trong thư mục api/.
//
// Biến môi trường (đặt trong Vercel, KHÔNG đưa vào mã client):
//   DATABASE_URL  chuỗi kết nối của Neon, dạng postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require
//   KEY_PEPPER    chuỗi bí mật ngẫu nhiên dài, trộn vào khi băm khoá người chơi
//
// Giao thức: mọi yêu cầu là POST JSON tới /api/game, có trường "action":
//   ping                                  -> { ok, db }
//   register { name }                     -> { ok, pid, key }          (cấp tài khoản ẩn danh; key chỉ hiện 1 lần)
//   load     { pid, key }                 -> { ok, data|null, version }
//   save     { pid, key, base, data, events } -> { ok, version } | 409 { ok:false, error:'conflict', version, data }
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

const MAX_DATA_CHARS = 120_000; // giới hạn kích thước 1 bản lưu
const MAX_EVENTS = 50; // số sự kiện tối đa mỗi lần lưu
const MAX_EVENT_CHARS = 1_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[0-9a-f]{64}$/i;
const TYPE_RE = /^[a-z_]{1,32}$/;
const ENV = process.env;
const NAME_A = ['May', 'Sao', 'Gio', 'Bien', 'Dao', 'Suong', 'Trang', 'Nang', 'Da', 'Rung'];
const NAME_B = ['Xanh', 'Bac', 'Vang', 'Tim', 'Hong', 'Nho', 'Cao', 'Xa', 'Sang', 'Lanh'];
const randomName = () => `${NAME_A[randomInt(NAME_A.length)]}${NAME_B[randomInt(NAME_B.length)]}${randomInt(1000, 10000)}`;

class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function parseBody(raw) {
  if (raw && typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  try {
    return JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw ?? ''));
  } catch {
    throw new ApiError(400, 'bad_json');
  }
}

/** Làm sạch danh sách sự kiện từ client (không tin dữ liệu gửi lên). */
function cleanEvents(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const e of list.slice(0, MAX_EVENTS)) {
    if (!e || typeof e.type !== 'string' || !TYPE_RE.test(e.type)) continue;
    const payload = e.payload && typeof e.payload === 'object' ? e.payload : {};
    const json = JSON.stringify(payload);
    if (json.length > MAX_EVENT_CHARS) continue;
    out.push({ type: e.type, json });
  }
  return out;
}

/**
 * createHandler({ getSql, env }): tách riêng để kiểm thử được bằng "sql giả".
 * getSql() trả về hàm sql dạng tagged template của @neondatabase/serverless.
 */
export function createHandler({ getSql, env = ENV }) {
  const hashKey = (key) => createHmac('sha256', env.KEY_PEPPER ?? '').update(key).digest('hex');

  async function authenticate(sql, body) {
    const { pid, key } = body;
    if (typeof pid !== 'string' || !UUID_RE.test(pid) || typeof key !== 'string' || !KEY_RE.test(key)) throw new ApiError(401, 'unauthorized');
    const rows = await sql`select key_hash from players where id = ${pid}`;
    if (rows.length === 0) throw new ApiError(401, 'unauthorized');
    const a = Buffer.from(rows[0].key_hash, 'hex');
    const b = Buffer.from(hashKey(key), 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError(401, 'unauthorized');
    return pid;
  }

  return async function handler(req, res) {
    try {
      if (req.method !== 'POST') throw new ApiError(405, 'method_not_allowed');
      const body = parseBody(req.body);

      if (body.action === 'ping') return send(res, 200, { ok: true, db: Boolean(env.DATABASE_URL) });
      if (!env.DATABASE_URL) throw new ApiError(503, 'db_not_configured');
      const sql = getSql();

      if (body.action === 'register') {
        const key = randomBytes(32).toString('hex');
        for (let i = 0; i < 10; i++) {
          const pid = randomUUID();
          const name = randomName();
          const rows = await sql`
            insert into players (id, name, key_hash)
            values (${pid}, ${name}, ${hashKey(key)})
            on conflict do nothing
            returning id`;
          if (rows.length > 0) return send(res, 200, { ok: true, pid, key, name });
        }
        throw new ApiError(503, 'name_unavailable');
      }

      if (body.action === 'load') {
        const pid = await authenticate(sql, body);
        const rows = await sql`select data, version, updated_at from saves where player_id = ${pid}`;
        if (rows.length === 0) return send(res, 200, { ok: true, data: null, version: 0 });
        return send(res, 200, { ok: true, data: rows[0].data, version: rows[0].version, updatedAt: rows[0].updated_at });
      }

      if (body.action === 'save') {
        const pid = await authenticate(sql, body);
        if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new ApiError(400, 'bad_data');
        const json = JSON.stringify(body.data);
        if (json.length > MAX_DATA_CHARS) throw new ApiError(413, 'too_large');
        const base = Number.isInteger(body.base) && body.base >= 0 ? body.base : 0;

        const rows = await sql`
          insert into saves (player_id, data, version)
          values (${pid}, ${json}::jsonb, 1)
          on conflict (player_id) do update
            set data = excluded.data, version = saves.version + 1, updated_at = now()
            where saves.version = ${base}
          returning version`;
        if (rows.length === 0) {
          const cur = await sql`select data, version from saves where player_id = ${pid}`;
          return send(res, 409, { ok: false, error: 'conflict', version: cur[0]?.version ?? 0, data: cur[0]?.data ?? null });
        }

        let eventsOk = true;
        const events = cleanEvents(body.events);
        if (events.length > 0) {
          try {
            await sql.transaction(
              events.map((e) => sql`insert into events (player_id, type, payload) values (${pid}, ${e.type}, ${e.json}::jsonb)`),
            );
          } catch (err) {
            console.error('[api/game] ghi sự kiện lỗi:', err?.message);
            eventsOk = false;
          }
        }
        return send(res, 200, { ok: true, version: rows[0].version, eventsOk });
      }

      throw new ApiError(400, 'unknown_action');
    } catch (err) {
      if (err instanceof ApiError) return send(res, err.status, { ok: false, error: err.code });
      console.error('[api/game]', err);
      return send(res, 500, { ok: false, error: 'server_error' });
    }
  };
}

let cachedHandler = null;

export default async function handler(req, res) {
  if (!cachedHandler) {
    let sql = null;
    if (ENV.DATABASE_URL) {
      const { neon } = await import('@neondatabase/serverless');
      sql = neon(ENV.DATABASE_URL);
    }
    cachedHandler = createHandler({ getSql: () => sql });
  }
  return cachedHandler(req, res);
}