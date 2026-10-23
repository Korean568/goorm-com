// 구름닷컴 API (Cloudflare Worker + D1)
// 초대코드를 맞힌 기기에 토큰을 주고, 토큰이 있는 요청만 게시판을 읽고 쓰게 한다.

const ALLOWED_ORIGINS = ["https://korean568.github.io", "http://localhost:5173"];
const CATS = ["notice", "hw", "free", "qa"];
const MAX_FAILS = 10;              // 10분 안에 코드를 이만큼 틀리면 잠깐 막는다
const FAIL_WINDOW = 10 * 60 * 1000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let res;
    try {
      res = await route(req, env);
    } catch (e) {
      if (e instanceof HttpError) res = json({ error: e.message }, e.status);
      else { console.error(e); res = json({ error: "server_error" }, 500); }
    }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};

async function route(req, env) {
  const { pathname: p } = new URL(req.url);
  const m = req.method;
  let r;

  if (p === "/api/join" && m === "POST") return join(req, env);

  const me = await auth(req, env);
  if (p === "/api/me" && m === "GET") return json({ userId: me.id, admin: !!me.admin });
  if (p === "/api/board" && m === "GET") return board(env, me);
  if (p === "/api/admin" && m === "POST") return claimAdmin(req, env, me);
  if (p === "/api/settings" && m === "PUT") return putSettings(req, env, me);
  if (p === "/api/posts" && m === "POST") return createPost(req, env, me);
  if ((r = p.match(/^\/api\/posts\/([\w-]+)$/))) {
    if (m === "PATCH") return editPost(req, env, me, r[1]);
    if (m === "DELETE") return deletePost(env, me, r[1]);
  }
  if ((r = p.match(/^\/api\/posts\/([\w-]+)\/like$/)) && m === "POST") return like(req, env, me, r[1]);
  if ((r = p.match(/^\/api\/posts\/([\w-]+)\/comments$/)) && m === "POST") return createComment(req, env, me, r[1]);
  if ((r = p.match(/^\/api\/comments\/([\w-]+)$/)) && m === "DELETE") return deleteComment(env, me, r[1]);
  throw new HttpError(404, "not_found");
}

// ---------- 도우미 ----------
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}
async function readBody(req) {
  try { const b = await req.json(); return b && typeof b === "object" ? b : {}; } catch { throw new HttpError(400, "bad_json"); }
}
function text(v, max, name) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.length > max) throw new HttpError(400, "invalid_" + name);
  return s;
}
function optText(v, max, name) {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length > max) throw new HttpError(400, "invalid_" + name);
  return s;
}
function cat(v, me) {
  if (!CATS.includes(v)) throw new HttpError(400, "invalid_cat");
  if (v === "notice" && !me.admin) throw new HttpError(403, "notice_admin_only");
  return v;
}
async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function auth(req, env) {
  const h = req.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) throw new HttpError(401, "no_token");
  const me = await env.DB.prepare("SELECT id, admin FROM members WHERE token_hash = ?").bind(await sha256(token)).first();
  if (!me) throw new HttpError(401, "bad_token");
  return me;
}

// 코드를 너무 많이 틀린 IP는 잠깐 막는다
async function checkCode(req, env, kind, given, expected) {
  const ip = req.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  await env.DB.prepare("DELETE FROM attempts WHERE at < ?").bind(now - 24 * 60 * 60 * 1000).run();
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM attempts WHERE ip = ? AND kind = ? AND at > ?")
    .bind(ip, kind, now - FAIL_WINDOW).first();
  if (n >= MAX_FAILS) throw new HttpError(429, "too_many_attempts");
  if (!expected || String(given ?? "").trim() !== expected) {
    await env.DB.prepare("INSERT INTO attempts (ip, kind, at) VALUES (?, ?, ?)").bind(ip, kind, now).run();
    throw new HttpError(403, "wrong_code");
  }
}

// ---------- 입장 / 관리자 ----------
async function join(req, env) {
  const { code } = await readBody(req);
  await checkCode(req, env, "invite", code, env.INVITE_CODE);
  const token = newToken();
  const id = "u_" + crypto.randomUUID().replace(/-/g, "");
  await env.DB.prepare("INSERT INTO members (id, token_hash, admin, created_at) VALUES (?, ?, 0, ?)")
    .bind(id, await sha256(token), Date.now()).run();
  return json({ token, userId: id, admin: false });
}

async function claimAdmin(req, env, me) {
  const { code } = await readBody(req);
  await checkCode(req, env, "admin", code, env.ADMIN_CODE);
  await env.DB.prepare("UPDATE members SET admin = 1 WHERE id = ?").bind(me.id).run();
  return json({ admin: true });
}

// ---------- 게시판 ----------
async function board(env, me) {
  const [posts, comments, settings] = await env.DB.batch([
    env.DB.prepare(`SELECT p.id, p.cat, p.title, p.body, p.nick, p.author_id, p.created_at, p.edited_at,
        (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
        EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked
      FROM posts p ORDER BY p.created_at DESC LIMIT 500`).bind(me.id),
    env.DB.prepare("SELECT id, post_id, nick, body, author_id, created_at FROM comments ORDER BY created_at LIMIT 5000"),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'class'"),
  ]);
  let cls = {};
  try { cls = settings.results[0] ? JSON.parse(settings.results[0].value) : {}; } catch {}
  return json({
    posts: posts.results.map((p) => ({
      id: p.id, cat: p.cat, title: p.title, body: p.body, nick: p.nick, authorId: p.author_id,
      createdAt: p.created_at, editedAt: p.edited_at || 0, likeCount: p.like_count, liked: !!p.liked,
    })),
    comments: comments.results.map((c) => ({
      id: c.id, postId: c.post_id, nick: c.nick, body: c.body, authorId: c.author_id, createdAt: c.created_at,
    })),
    settings: cls,
  });
}

async function createPost(req, env, me) {
  const b = await readBody(req);
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO posts (id, cat, title, body, nick, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, cat(b.cat, me), text(b.title, 80, "title"), text(b.body, 5000, "body"), text(b.nick, 12, "nick"), me.id, Date.now())
    .run();
  return json({ id }, 201);
}

async function getPost(env, id) {
  const p = await env.DB.prepare("SELECT id, cat, author_id FROM posts WHERE id = ?").bind(id).first();
  if (!p) throw new HttpError(404, "post_not_found");
  return p;
}

async function editPost(req, env, me, id) {
  const p = await getPost(env, id);
  if (p.author_id !== me.id) throw new HttpError(403, "not_author");
  const b = await readBody(req);
  const c = b.cat === p.cat ? p.cat : cat(b.cat, me);
  await env.DB.prepare("UPDATE posts SET cat = ?, title = ?, body = ?, edited_at = ? WHERE id = ?")
    .bind(c, text(b.title, 80, "title"), text(b.body, 5000, "body"), Date.now(), id).run();
  return json({ ok: true });
}

async function deletePost(env, me, id) {
  const p = await getPost(env, id);
  if (p.author_id !== me.id && !me.admin) throw new HttpError(403, "not_allowed");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM comments WHERE post_id = ?").bind(id),
    env.DB.prepare("DELETE FROM likes WHERE post_id = ?").bind(id),
    env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
}

async function like(req, env, me, id) {
  await getPost(env, id);
  const { on } = await readBody(req);
  const stmt = on
    ? env.DB.prepare("INSERT OR IGNORE INTO likes (post_id, user_id) VALUES (?, ?)")
    : env.DB.prepare("DELETE FROM likes WHERE post_id = ? AND user_id = ?");
  await stmt.bind(id, me.id).run();
  return json({ ok: true });
}

async function createComment(req, env, me, postId) {
  await getPost(env, postId);
  const b = await readBody(req);
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO comments (id, post_id, nick, body, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, postId, text(b.nick, 12, "nick"), text(b.body, 1000, "body"), me.id, Date.now()).run();
  return json({ id }, 201);
}

// 댓글 쓴 사람, 글쓴이, 관리자가 지울 수 있다
async function deleteComment(env, me, id) {
  const c = await env.DB.prepare(
    "SELECT c.author_id, p.author_id AS post_author FROM comments c LEFT JOIN posts p ON p.id = c.post_id WHERE c.id = ?"
  ).bind(id).first();
  if (!c) throw new HttpError(404, "comment_not_found");
  if (c.author_id !== me.id && c.post_author !== me.id && !me.admin) throw new HttpError(403, "not_allowed");
  await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

async function putSettings(req, env, me) {
  if (!me.admin) throw new HttpError(403, "admin_only");
  const b = await readBody(req);
  const value = JSON.stringify({ name: optText(b.name, 20, "name"), motto: optText(b.motto, 40, "motto") });
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('class', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(value).run();
  return json({ ok: true });
}
