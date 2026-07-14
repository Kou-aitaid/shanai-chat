import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 社内メールのドメイン制限
const ALLOWED_DOMAIN = '@aitaid.co.jp';
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // トークン有効期限：30日

const app = express();
app.set('trust proxy', 1); // Render/Cloudflare等のプロキシ経由で正しいIPを取得
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));

// ---- レート制限（#5） ----
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: '試行回数が多すぎます。しばらく待ってください' } });
app.use('/api/', apiLimiter);

// ---- ファイルアップロード設定（#2 種別チェック） ----
const BLOCKED_EXT = ['.exe', '.bat', '.cmd', '.com', '.msi', '.sh', '.app', '.scr', '.jar', '.vbs', '.ps1', '.dll', '.deb', '.dmg'];
const ALLOWED_MIME_PREFIX = ['image/', 'audio/', 'video/', 'text/'];
const ALLOWED_MIME = new Set([
  'application/pdf', 'application/zip', 'application/x-zip-compressed', 'application/json', 'application/rtf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (BLOCKED_EXT.includes(ext)) return cb(new Error('この種類のファイルはアップロードできません'));
  const mt = file.mimetype || '';
  const ok = ALLOWED_MIME_PREFIX.some((p) => mt.startsWith(p)) || ALLOWED_MIME.has(mt);
  if (!ok) return cb(new Error('この種類のファイルはアップロードできません'));
  cb(null, true);
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${nanoid()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 }, fileFilter }); // 50MBまで

// ==================== ヘルパー ====================
const avatarColors = ['#e91e63', '#9c27b0', '#3f51b5', '#009688', '#ff9800', '#795548', '#607d8b', '#f44336'];

function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// 現在オンライン中のユーザーID → 接続ソケット数
const online = new Map();
function isOnline(id) { return (online.get(id) || 0) > 0; }

// 在席状態: offline / away / active
function presenceOf(u) {
  if (!isOnline(u.id)) return 'offline';
  return u.away ? 'away' : 'active';
}

function publicUser(u) {
  return u ? {
    id: u.id, name: u.name, email: u.email,
    avatar: JSON.parse(u.avatar || '{}'),
    notifyPref: u.notify_pref || 'all',
    presence: presenceOf(u),
    role: u.role || 'member',
    disabled: !!u.disabled,
  } : null;
}

// ユーザーリストのメモリキャッシュ（#16）
let usersCache = null;
function allUsersLite() {
  if (!usersCache) usersCache = db.prepare('SELECT id, name FROM users').all();
  return usersCache;
}
function invalidateUsers() { usersCache = null; }

// メンション検出：完全一致を優先し、無ければ最長の前方一致（#17）
function findMentions(body) {
  if (!body) return [];
  const users = allUsersLite();
  const ids = new Set();
  const tokens = body.match(/@([^\s@、。！？]+)/g) || [];
  for (const t of tokens) {
    const name = t.slice(1);
    let hit = users.find((u) => u.name === name);
    if (!hit) {
      const prefixes = users.filter((u) => name.startsWith(u.name));
      if (prefixes.length) hit = prefixes.sort((a, b) => b.name.length - a.name.length)[0];
    }
    if (hit) ids.add(hit.id);
  }
  return [...ids];
}

// メッセージを整形（添付・リアクション・返信数・メンション付き）
function hydrateMessage(msg) {
  const user = getUser(msg.user_id);
  const attachments = msg.deleted ? [] : db.prepare('SELECT * FROM attachments WHERE message_id = ?').all(msg.id);
  const reactionRows = msg.deleted ? [] : db.prepare('SELECT emoji, user_id FROM reactions WHERE message_id = ?').all(msg.id);
  const reactions = {};
  for (const r of reactionRows) {
    (reactions[r.emoji] = reactions[r.emoji] || []).push(r.user_id);
  }
  const replyCount = db.prepare('SELECT COUNT(*) AS c FROM messages WHERE parent_id = ? AND deleted = 0').get(msg.id).c;
  const pinned = !!db.prepare('SELECT 1 FROM pins WHERE message_id = ?').get(msg.id);
  return {
    id: msg.id,
    channel_id: msg.channel_id,
    parent_id: msg.parent_id,
    created_at: msg.created_at,
    edited_at: msg.edited_at,
    deleted: !!msg.deleted,
    pinned,
    body: msg.deleted ? '' : msg.body,
    user: publicUser(user),
    mentions: msg.deleted ? [] : findMentions(msg.body),
    attachments: attachments.map((a) => ({
      id: a.id, filename: a.filename, url: `/uploads/${a.stored_name}`, mimetype: a.mimetype, size: a.size,
    })),
    reactions,
    replyCount,
  };
}

function getMessage(id) {
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
}

// ユーザーがチャンネルにアクセスできるか
function canAccess(channel, userId) {
  if (!channel) return false;
  if (!channel.is_private) return true;
  return !!db.prepare('SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?').get(channel.id, userId);
}

// チャンネルをクライアント向けに整形（DMは相手ユーザー情報を付与）
function channelForClient(c, meId) {
  const members = c.is_private
    ? db.prepare('SELECT user_id FROM channel_members WHERE channel_id = ?').all(c.id).map((r) => r.user_id)
    : null;
  let dmPeer = null;
  if (c.is_dm && members) {
    const peerId = members.find((id) => id !== meId);
    dmPeer = publicUser(getUser(peerId));
  }
  return { id: c.id, name: c.name, topic: c.topic, is_private: !!c.is_private, is_dm: !!c.is_dm, created_by: c.created_by, members, dmPeer };
}

// ==================== 認証 ====================
function issueToken(userId) {
  const token = nanoid(32);
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)').run(token, userId, Date.now());
  return token;
}
function userIdFromToken(token) {
  if (!token) return null;
  const s = db.prepare('SELECT user_id, created_at FROM sessions WHERE token = ?').get(token);
  if (!s) return null;
  if (Date.now() - s.created_at > SESSION_TTL) { // #1 有効期限切れ
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return s.user_id;
}
// 期限切れセッションの定期削除（#1）
function cleanupSessions() {
  db.prepare('DELETE FROM sessions WHERE created_at < ?').run(Date.now() - SESSION_TTL);
}
cleanupSessions();
setInterval(cleanupSessions, 24 * 60 * 60 * 1000);
// REST用ミドルウェア
function requireAuth(req, res, next) {
  const token = req.headers['x-token'] || req.query.token;
  const uid = userIdFromToken(token);
  if (!uid) return res.status(401).json({ error: '認証が必要です' });
  req.userId = uid;
  next();
}

// 新規登録（@aitaid.co.jp のメールのみ）
app.post('/api/register', authLimiter, async (req, res) => {
  let { name, email, password } = req.body;
  name = (name || '').trim();
  email = (email || '').trim().toLowerCase();
  if (!name) return res.status(400).json({ error: '名前を入力してください' });
  if (!email.endsWith(ALLOWED_DOMAIN)) return res.status(400).json({ error: `メールアドレスは ${ALLOWED_DOMAIN} のみ登録できます` });
  if (!password || password.length < 6) return res.status(400).json({ error: 'パスワードは6文字以上にしてください' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'このメールアドレスは既に登録されています' });
  }
  const id = nanoid();
  const avatar = JSON.stringify({
    initial: name[0].toUpperCase(),
    color: avatarColors[Math.floor(Math.random() * avatarColors.length)],
  });
  const hash = await bcrypt.hash(password, 10);
  // 最初に登録したユーザーを管理者にする（#9）
  const isFirst = db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0;
  db.prepare('INSERT INTO users (id, name, email, avatar, password_hash, role, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, name, email, avatar, hash, isFirst ? 'admin' : 'member', Date.now());
  invalidateUsers();
  const token = issueToken(id);
  res.json({ token, user: publicUser(getUser(id)) });
});

// ログイン
app.post('/api/login', authLimiter, async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' });
  }
  if (user.disabled) return res.status(403).json({ error: 'このアカウントは無効化されています。管理者にお問い合わせください' });
  const token = issueToken(user.id);
  res.json({ token, user: publicUser(user) });
});

// トークンで自分の情報を取得（再訪時のセッション確認）
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(getUser(req.userId)) });
});

// プロフィール更新（名前・アイコン・通知設定・在席）
app.post('/api/profile', requireAuth, (req, res) => {
  const u = getUser(req.userId);
  const name = (req.body.name ?? u.name).trim() || u.name;
  const notifyPref = ['all', 'mentions', 'none'].includes(req.body.notifyPref) ? req.body.notifyPref : u.notify_pref;
  const away = req.body.away === undefined ? u.away : (req.body.away ? 1 : 0);
  // アイコン: {image: url} か {initial,color}
  let avatar = JSON.parse(u.avatar || '{}');
  if (req.body.avatarImage !== undefined) {
    if (req.body.avatarImage) avatar.image = req.body.avatarImage;
    else delete avatar.image;
  }
  avatar.initial = name[0].toUpperCase();
  db.prepare('UPDATE users SET name = ?, notify_pref = ?, away = ?, avatar = ? WHERE id = ?')
    .run(name, notifyPref, away, JSON.stringify(avatar), req.userId);
  const updated = publicUser(getUser(req.userId));
  invalidateUsers();
  io.emit('user:update', updated); // 全員に反映（名前・アイコン・在席）
  res.json({ user: updated });
});

// 自分が参加しているスレッド一覧（親メッセージ）
app.get('/api/threads', requireAuth, (req, res) => {
  // 自分が親を書いた or 返信したスレッドの親IDを収集
  const parentIds = db.prepare(`
    SELECT DISTINCT p.id AS pid
    FROM messages p
    WHERE p.parent_id IS NULL AND p.deleted = 0 AND EXISTS (SELECT 1 FROM messages r WHERE r.parent_id = p.id)
      AND (
        p.user_id = ?
        OR EXISTS (SELECT 1 FROM messages r2 WHERE r2.parent_id = p.id AND r2.user_id = ?)
      )
  `).all(req.userId, req.userId).map((r) => r.pid);
  const result = parentIds
    .map((id) => getMessage(id))
    .filter((m) => m && canAccess(getChannel(m.channel_id), req.userId))
    .map((m) => ({ ...hydrateMessage(m), channelName: getChannel(m.channel_id)?.name, channelIsDm: !!getChannel(m.channel_id)?.is_dm }))
    .sort((a, b) => b.created_at - a.created_at);
  res.json(result);
});

// ==================== データAPI（要認証） ====================
app.get('/api/users', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY name').all();
  res.json(rows.map(publicUser));
});

app.get('/api/channels', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM channels ORDER BY is_private, name').all();
  const visible = rows.filter((c) => canAccess(c, req.userId));
  res.json(visible.map((c) => channelForClient(c, req.userId)));
});

app.post('/api/channels', requireAuth, (req, res) => {
  const { name, topic, isPrivate, members } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'チャンネル名が必要です' });
  const id = isPrivate ? nanoid() : name.trim().toLowerCase().replace(/\s+/g, '-');
  if (db.prepare('SELECT 1 FROM channels WHERE id = ?').get(id)) {
    return res.status(409).json({ error: '同名のチャンネルが既に存在します' });
  }
  db.prepare('INSERT INTO channels (id, name, topic, is_private, is_dm, created_by, created_at) VALUES (?,?,?,?,0,?,?)')
    .run(id, name.trim(), topic || null, isPrivate ? 1 : 0, req.userId, Date.now());
  if (isPrivate) {
    const memberSet = new Set([...(members || []), req.userId].filter(Boolean));
    const ins = db.prepare('INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?,?)');
    for (const m of memberSet) ins.run(id, m);
  }
  const channel = channelForClient(getChannel(id), req.userId);
  if (isPrivate) {
    for (const m of channel.members) io.to(`user:${m}`).emit('channel:new', channelForClient(getChannel(id), m));
  } else {
    io.emit('channel:new', channel);
  }
  res.json(channel);
});

// チャンネルの編集（作成者 or 管理者）＝#7
app.put('/api/channels/:id', requireAuth, (req, res) => {
  const ch = getChannel(req.params.id);
  if (!ch || ch.is_dm) return res.status(400).json({ error: '編集できません' });
  const u = getUser(req.userId);
  if (ch.created_by !== req.userId && u.role !== 'admin') return res.status(403).json({ error: '権限がありません' });
  const name = (req.body.name ?? ch.name).trim() || ch.name;
  const topic = req.body.topic !== undefined ? req.body.topic : ch.topic;
  db.prepare('UPDATE channels SET name = ?, topic = ? WHERE id = ?').run(name, topic, ch.id);
  const updated = channelForClient(getChannel(ch.id), req.userId);
  io.emit('channel:updated', updated);
  res.json(updated);
});

// チャンネルの削除（作成者 or 管理者。general/randomは保護）＝#7
app.delete('/api/channels/:id', requireAuth, (req, res) => {
  const ch = getChannel(req.params.id);
  if (!ch) return res.status(404).json({ error: 'not found' });
  if (ch.id === 'general' || ch.id === 'random') return res.status(400).json({ error: 'このチャンネルは削除できません' });
  const u = getUser(req.userId);
  if (ch.created_by !== req.userId && u.role !== 'admin') return res.status(403).json({ error: '権限がありません' });
  db.prepare('DELETE FROM channels WHERE id = ?').run(ch.id); // messages/attachments/membersはCASCADE
  db.prepare('DELETE FROM pins WHERE channel_id = ?').run(ch.id);
  db.prepare('DELETE FROM channel_reads WHERE channel_id = ?').run(ch.id);
  io.emit('channel:deleted', { id: ch.id });
  res.json({ ok: true });
});

// ==================== 管理者API（#9/#10） ====================
function requireAdmin(req, res, next) {
  const u = getUser(req.userId);
  if (!u || u.role !== 'admin') return res.status(403).json({ error: '管理者のみ実行できます' });
  next();
}
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM users ORDER BY created_at').all().map(publicUser));
});
app.post('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const target = getUser(req.params.id);
  if (!target) return res.status(404).json({ error: 'not found' });
  const role = ['admin', 'member'].includes(req.body.role) ? req.body.role : target.role;
  const disabled = req.body.disabled === undefined ? target.disabled : (req.body.disabled ? 1 : 0);
  // 自分自身の管理者権限剥奪・無効化は防ぐ
  if (target.id === req.userId && (role !== 'admin' || disabled)) {
    return res.status(400).json({ error: '自分自身は変更できません' });
  }
  db.prepare('UPDATE users SET role = ?, disabled = ? WHERE id = ?').run(role, disabled, target.id);
  if (disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id); // 無効化で強制ログアウト
  const updated = publicUser(getUser(target.id));
  io.emit('user:update', updated);
  res.json({ user: updated });
});
app.post('/api/admin/reset-password', requireAuth, requireAdmin, async (req, res) => {
  const target = getUser(req.body.userId);
  if (!target) return res.status(404).json({ error: 'not found' });
  const pw = req.body.password || '';
  if (pw.length < 6) return res.status(400).json({ error: 'パスワードは6文字以上にしてください' });
  const hash = await bcrypt.hash(pw, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, target.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id); // 再ログインを促す
  res.json({ ok: true });
});

// DMを開始（無ければ作成）
app.post('/api/dm', requireAuth, (req, res) => {
  const targetId = req.body.targetUserId;
  if (!targetId || targetId === req.userId) return res.status(400).json({ error: '相手を指定してください' });
  if (!getUser(targetId)) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  const id = 'dm_' + [req.userId, targetId].sort().join('_');
  if (!getChannel(id)) {
    db.prepare('INSERT INTO channels (id, name, topic, is_private, is_dm, created_by, created_at) VALUES (?,?,?,1,1,?,?)')
      .run(id, 'DM', null, req.userId, Date.now());
    const ins = db.prepare('INSERT OR IGNORE INTO channel_members (channel_id, user_id) VALUES (?,?)');
    ins.run(id, req.userId);
    ins.run(id, targetId);
    // 双方に通知
    io.to(`user:${req.userId}`).emit('channel:new', channelForClient(getChannel(id), req.userId));
    io.to(`user:${targetId}`).emit('channel:new', channelForClient(getChannel(id), targetId));
  }
  res.json(channelForClient(getChannel(id), req.userId));
});

function getChannel(id) {
  return db.prepare('SELECT * FROM channels WHERE id = ?').get(id);
}

const PAGE_SIZE = 50;
app.get('/api/channels/:id/messages', requireAuth, (req, res) => {
  const channel = getChannel(req.params.id);
  if (!canAccess(channel, req.userId)) return res.status(403).json({ error: 'アクセス権がありません' });
  const { parentId, before } = req.query;
  if (parentId) {
    // スレッド返信は件数が少ないので全件
    const rows = db.prepare('SELECT * FROM messages WHERE parent_id = ? ORDER BY created_at ASC').all(parentId);
    return res.json(rows.map(hydrateMessage));
  }
  // トップレベルは新しい順にPAGE_SIZE件（before指定でそれ以前を追加取得）＝#6
  const params = [req.params.id];
  let sql = 'SELECT * FROM messages WHERE channel_id = ? AND parent_id IS NULL';
  if (before) { sql += ' AND created_at < ?'; params.push(Number(before)); }
  sql += ' ORDER BY created_at DESC LIMIT ?'; params.push(PAGE_SIZE);
  const rows = db.prepare(sql).all(...params).reverse(); // 昇順に戻す
  res.json(rows.map(hydrateMessage));
});

// 単一メッセージ取得（返信数の更新などに使用）
app.get('/api/messages/:id', requireAuth, (req, res) => {
  const m = getMessage(req.params.id);
  if (!m || !canAccess(getChannel(m.channel_id), req.userId)) return res.status(404).json({ error: 'not found' });
  res.json(hydrateMessage(m));
});

// チャンネルのピン留め一覧
app.get('/api/channels/:id/pins', requireAuth, (req, res) => {
  const channel = getChannel(req.params.id);
  if (!canAccess(channel, req.userId)) return res.status(403).json({ error: 'アクセス権がありません' });
  const rows = db.prepare(`
    SELECT m.* FROM pins p JOIN messages m ON m.id = p.message_id
    WHERE p.channel_id = ? AND m.deleted = 0 ORDER BY p.created_at DESC
  `).all(req.params.id);
  res.json(rows.map(hydrateMessage));
});

// 自分のブックマーク一覧
app.get('/api/bookmarks', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT m.* FROM bookmarks b JOIN messages m ON m.id = b.message_id
    WHERE b.user_id = ? AND m.deleted = 0 ORDER BY b.created_at DESC
  `).all(req.userId);
  const result = rows
    .filter((m) => canAccess(getChannel(m.channel_id), req.userId))
    .map((m) => ({ ...hydrateMessage(m), channelName: getChannel(m.channel_id)?.name, channelIsDm: !!getChannel(m.channel_id)?.is_dm }));
  res.json(result);
});

// ファイル一覧（アクセス可能なチャンネルの添付すべて）
app.get('/api/files', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, m.channel_id AS ch, m.user_id AS uid, m.created_at AS created, m.id AS mid
    FROM attachments a JOIN messages m ON m.id = a.message_id
    WHERE m.deleted = 0 ORDER BY m.created_at DESC LIMIT 300
  `).all();
  const result = rows
    .filter((a) => canAccess(getChannel(a.ch), req.userId))
    .map((a) => ({
      id: a.id, filename: a.filename, url: `/uploads/${a.stored_name}`, mimetype: a.mimetype, size: a.size,
      channelId: a.ch, channelName: getChannel(a.ch)?.name, channelIsDm: !!getChannel(a.ch)?.is_dm,
      user: publicUser(getUser(a.uid)), created_at: a.created, messageId: a.mid,
    }));
  res.json(result);
});

// 自分のブックマーク済みメッセージID一覧（クライアント状態用）
app.get('/api/bookmark-ids', requireAuth, (req, res) => {
  const ids = db.prepare('SELECT message_id FROM bookmarks WHERE user_id = ?').all(req.userId).map((r) => r.message_id);
  res.json(ids);
});

// チャンネルの既読状況（userId→最終既読時刻）
app.get('/api/channels/:id/reads', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT user_id, last_read_at FROM channel_reads WHERE channel_id = ?').all(req.params.id);
  const map = {};
  for (const r of rows) map[r.user_id] = r.last_read_at;
  res.json(map);
});

app.get('/api/search', requireAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  const { channel, user, from, to } = req.query;
  if (!q && !channel && !user) return res.json([]);
  let sql = 'SELECT * FROM messages WHERE deleted = 0';
  const params = [];
  if (q) {
    const escaped = q.replace(/[%_\\]/g, (c) => '\\' + c); // #20 ワイルドカードをエスケープ
    sql += " AND body LIKE ? ESCAPE '\\'";
    params.push(`%${escaped}%`);
  }
  if (channel) { sql += ' AND channel_id = ?'; params.push(channel); }
  if (user) { sql += ' AND user_id = ?'; params.push(user); }
  if (from) { sql += ' AND created_at >= ?'; params.push(Number(from)); }
  if (to) { sql += ' AND created_at <= ?'; params.push(Number(to)); }
  sql += ' ORDER BY created_at DESC LIMIT 100';
  const rows = db.prepare(sql).all(...params);
  const result = rows
    .filter((m) => canAccess(getChannel(m.channel_id), req.userId))
    .map((m) => ({ ...hydrateMessage(m), channelName: getChannel(m.channel_id)?.name, channelIsDm: !!getChannel(m.channel_id)?.is_dm }));
  res.json(result);
});

app.post('/api/upload', requireAuth, (req, res) => {
  // multerのエラー（種別・サイズ超過）をJSONで返す（#2）
  upload.array('files', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'アップロードに失敗しました' });
    const files = (req.files || []).map((f) => ({
      stored_name: f.filename,
      filename: Buffer.from(f.originalname, 'latin1').toString('utf8'),
      mimetype: f.mimetype,
      size: f.size,
      url: `/uploads/${f.filename}`,
    }));
    res.json({ files });
  });
});

// 添付ファイルの配信（#3 認証必須＋チャンネルのアクセス権チェック）
function serveUpload(req, res, asDownload) {
  const uid = userIdFromToken(req.query.token || req.headers['x-token']);
  if (!uid) return res.status(401).end();
  const name = path.basename(req.params.name || '');
  const att = db.prepare(
    'SELECT a.filename, m.channel_id FROM attachments a JOIN messages m ON m.id = a.message_id WHERE a.stored_name = ?'
  ).get(name);
  // メッセージ確定前（プレビュー中）はattがnull。確定済みならチャンネル権限を確認。
  if (att && !canAccess(getChannel(att.channel_id), uid)) return res.status(403).end();
  const full = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(full)) return res.status(404).end();
  if (asDownload) res.download(full, att?.filename || name);
  else res.sendFile(full);
}
app.get('/uploads/:name', (req, res) => serveUpload(req, res, false));

app.get('/api/download/:id', (req, res) => {
  const uid = userIdFromToken(req.query.token || req.headers['x-token']);
  if (!uid) return res.status(401).end();
  const a = db.prepare('SELECT a.*, m.channel_id FROM attachments a JOIN messages m ON m.id = a.message_id WHERE a.id = ?').get(req.params.id);
  if (!a) return res.status(404).end();
  if (!canAccess(getChannel(a.channel_id), uid)) return res.status(403).end();
  res.download(path.join(UPLOAD_DIR, a.stored_name), a.filename);
});

// SPAフォールバック
app.get('*', (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

// ==================== Socket.IO（リアルタイム） ====================
function joinAccessibleRooms(socket, userId) {
  socket.data.userId = userId;
  socket.join(`user:${userId}`);
  for (const c of db.prepare('SELECT * FROM channels').all()) {
    if (canAccess(c, userId)) socket.join(`channel:${c.id}`);
  }
}

function broadcastPresence(userId) {
  const u = getUser(userId);
  if (u) io.emit('presence', { userId, presence: presenceOf(u) });
}

io.on('connection', (socket) => {
  // 認証（トークン→userId）
  socket.on('auth', ({ token }) => {
    const uid = userIdFromToken(token);
    if (!uid) return;
    // 同一ソケットの二重authを防ぐ
    if (socket.data.userId === uid) return;
    joinAccessibleRooms(socket, uid);
    online.set(uid, (online.get(uid) || 0) + 1);
    broadcastPresence(uid);
  });

  socket.on('disconnect', () => {
    const uid = socket.data.userId;
    if (!uid) return;
    const n = (online.get(uid) || 1) - 1;
    if (n <= 0) online.delete(uid); else online.set(uid, n);
    broadcastPresence(uid);
  });

  const me = () => socket.data.userId;

  // 全ソケットイベント共通のエラーハンドラ（#4）
  const on = (event, handler) => socket.on(event, (payload, ack) => {
    try { handler(payload, ack); }
    catch (e) { console.error(`[socket:${event}]`, e); if (typeof ack === 'function') ack({ error: 'サーバーエラー' }); }
  });

  on('message:send', (payload, ack) => {
    const userId = me();
    if (!userId) return ack?.({ error: '未認証です' });
    // 送信レート制限：10秒あたり20件まで（#5）
    const t = Date.now();
    socket.data.msgTimes = (socket.data.msgTimes || []).filter((x) => t - x < 10000);
    if (socket.data.msgTimes.length >= 20) return ack?.({ error: '送信が多すぎます。少し待ってください' });
    socket.data.msgTimes.push(t);
    {
      const { channelId, parentId, body, attachments } = payload;
      const channel = getChannel(channelId);
      if (!canAccess(channel, userId)) return ack?.({ error: 'アクセス権がありません' });
      if ((!body || !body.trim()) && (!attachments || attachments.length === 0)) {
        return ack?.({ error: '本文か添付が必要です' });
      }
      const id = nanoid();
      const now = Date.now();
      db.prepare('INSERT INTO messages (id, channel_id, parent_id, user_id, body, created_at) VALUES (?,?,?,?,?,?)')
        .run(id, channelId, parentId || null, userId, body?.trim() || '', now);
      if (attachments?.length) {
        const ins = db.prepare('INSERT INTO attachments (id, message_id, filename, stored_name, mimetype, size) VALUES (?,?,?,?,?,?)');
        for (const a of attachments) ins.run(nanoid(), id, a.filename, a.stored_name, a.mimetype, a.size);
      }
      // 送信者自身は既読にしておく
      db.prepare('INSERT INTO channel_reads (channel_id, user_id, last_read_at) VALUES (?,?,?) ON CONFLICT(channel_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at')
        .run(channelId, userId, now);
      const msg = hydrateMessage(getMessage(id));
      io.to(`channel:${channelId}`).emit('message:new', { channelId, parentId: parentId || null, message: msg });
      ack?.({ ok: true, message: msg });
    }
  });

  // メッセージ編集（本人のみ）
  on('message:edit', ({ messageId, body }, ack) => {
    const userId = me();
    const msg = getMessage(messageId);
    if (!msg || msg.user_id !== userId || msg.deleted) return ack?.({ error: '編集できません' });
    if (!body || !body.trim()) return ack?.({ error: '本文が必要です' });
    db.prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?').run(body.trim(), Date.now(), messageId);
    const updated = hydrateMessage(getMessage(messageId));
    io.to(`channel:${msg.channel_id}`).emit('message:update', { channelId: msg.channel_id, parentId: msg.parent_id, message: updated });
    ack?.({ ok: true });
  });

  // メッセージ削除（本人のみ・ソフト削除）
  on('message:delete', ({ messageId }, ack) => {
    const userId = me();
    const msg = getMessage(messageId);
    const isAdmin = getUser(userId)?.role === 'admin';
    if (!msg || (msg.user_id !== userId && !isAdmin)) return ack?.({ error: '削除できません' });
    db.prepare('UPDATE messages SET deleted = 1, body = ? WHERE id = ?').run('', messageId);
    db.prepare('DELETE FROM reactions WHERE message_id = ?').run(messageId);
    const updated = hydrateMessage(getMessage(messageId));
    io.to(`channel:${msg.channel_id}`).emit('message:update', { channelId: msg.channel_id, parentId: msg.parent_id, message: updated });
    ack?.({ ok: true });
  });

  on('reaction:toggle', ({ messageId, emoji }) => {
    const userId = me();
    if (!userId) return;
    const msg = getMessage(messageId);
    if (!msg || msg.deleted || !canAccess(getChannel(msg.channel_id), userId)) return;
    const existing = db.prepare('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(messageId, userId, emoji);
    if (existing) {
      db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(messageId, userId, emoji);
    } else {
      db.prepare('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?,?,?)').run(messageId, userId, emoji);
    }
    io.to(`channel:${msg.channel_id}`).emit('message:update', { channelId: msg.channel_id, parentId: msg.parent_id, message: hydrateMessage(getMessage(messageId)) });
  });

  // ピン留めのトグル（チャンネル全員に共有）
  on('pin:toggle', ({ messageId }, ack) => {
    const userId = me();
    const msg = getMessage(messageId);
    if (!msg || !canAccess(getChannel(msg.channel_id), userId)) return ack?.({ error: 'できません' });
    const exists = db.prepare('SELECT 1 FROM pins WHERE channel_id = ? AND message_id = ?').get(msg.channel_id, messageId);
    if (exists) db.prepare('DELETE FROM pins WHERE channel_id = ? AND message_id = ?').run(msg.channel_id, messageId);
    else db.prepare('INSERT INTO pins (channel_id, message_id, pinned_by, created_at) VALUES (?,?,?,?)').run(msg.channel_id, messageId, userId, Date.now());
    io.to(`channel:${msg.channel_id}`).emit('message:update', { channelId: msg.channel_id, parentId: msg.parent_id, message: hydrateMessage(getMessage(messageId)) });
    io.to(`channel:${msg.channel_id}`).emit('pins:changed', { channelId: msg.channel_id });
    ack?.({ ok: true, pinned: !exists });
  });

  // ブックマークのトグル（個人）
  on('bookmark:toggle', ({ messageId }, ack) => {
    const userId = me();
    const msg = getMessage(messageId);
    if (!msg) return ack?.({ error: 'できません' });
    const exists = db.prepare('SELECT 1 FROM bookmarks WHERE user_id = ? AND message_id = ?').get(userId, messageId);
    if (exists) db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND message_id = ?').run(userId, messageId);
    else db.prepare('INSERT INTO bookmarks (user_id, message_id, created_at) VALUES (?,?,?)').run(userId, messageId, Date.now());
    ack?.({ ok: true, bookmarked: !exists });
  });

  // 未読にする（このメッセージ以降を未読扱い）
  on('markUnread', ({ channelId, beforeTs }) => {
    const userId = me();
    if (!userId || !canAccess(getChannel(channelId), userId)) return;
    const at = Math.max(0, (beforeTs || Date.now()) - 1);
    db.prepare('INSERT INTO channel_reads (channel_id, user_id, last_read_at) VALUES (?,?,?) ON CONFLICT(channel_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at')
      .run(channelId, userId, at);
  });

  // 既読を記録
  on('read', ({ channelId }) => {
    const userId = me();
    if (!userId || !canAccess(getChannel(channelId), userId)) return;
    const now = Date.now();
    db.prepare('INSERT INTO channel_reads (channel_id, user_id, last_read_at) VALUES (?,?,?) ON CONFLICT(channel_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at')
      .run(channelId, userId, now);
    io.to(`channel:${channelId}`).emit('read:update', { channelId, userId, at: now });
  });

  on('typing', (payload) => {
    if (payload?.channelId) socket.to(`channel:${payload.channelId}`).emit('typing', payload);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`社内チャットツール起動: http://localhost:${PORT}`));
