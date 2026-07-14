import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'data.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// スキーマ定義（起動時に無ければ作成）
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  email     TEXT,
  avatar    TEXT,          -- 表示用の頭文字・色などをJSONで
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  topic       TEXT,
  is_private  INTEGER NOT NULL DEFAULT 0,   -- 0:公開チャンネル 1:プライベートグループ
  created_by  TEXT,
  created_at  INTEGER NOT NULL
);

-- プライベートグループのメンバー管理
CREATE TABLE IF NOT EXISTS channel_members (
  channel_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  PRIMARY KEY (channel_id, user_id),
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  channel_id  TEXT NOT NULL,
  parent_id   TEXT,          -- スレッド返信の場合は親メッセージID
  user_id     TEXT NOT NULL,
  body        TEXT,
  created_at  INTEGER NOT NULL,
  edited_at   INTEGER,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, parent_id, created_at);

-- 添付ファイル（画像・その他ファイル）
CREATE TABLE IF NOT EXISTS attachments (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL,
  filename    TEXT NOT NULL,   -- 元のファイル名
  stored_name TEXT NOT NULL,   -- 保存名
  mimetype    TEXT,
  size        INTEGER,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- 絵文字リアクション
CREATE TABLE IF NOT EXISTS reactions (
  message_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- ログインセッション（トークン→ユーザー）
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 既読管理：各ユーザーのチャンネルごとの最終既読時刻
CREATE TABLE IF NOT EXISTS channel_reads (
  channel_id   TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  last_read_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);

-- チャンネルへのピン留め（チャンネル全員に共有）
CREATE TABLE IF NOT EXISTS pins (
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  pinned_by  TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, message_id)
);

-- ブックマーク（各ユーザー個人の「あとで」）
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id    TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, message_id)
);
`);

// ---- 既存DBへのマイグレーション（列が無ければ追加） ----
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('users', 'password_hash', 'password_hash TEXT');
ensureColumn('users', 'away', 'away INTEGER NOT NULL DEFAULT 0');            // 手動の離席フラグ
ensureColumn('users', 'notify_pref', "notify_pref TEXT NOT NULL DEFAULT 'all'"); // all | mentions | none
ensureColumn('users', 'role', "role TEXT NOT NULL DEFAULT 'member'");        // admin | member
ensureColumn('users', 'disabled', 'disabled INTEGER NOT NULL DEFAULT 0');    // アカウント無効化

// 管理者が一人もいなければ、最古参ユーザーを管理者に昇格（既存DB向けの初期化）
const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
if (adminCount === 0) {
  const first = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get();
  if (first) db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(first.id);
}
ensureColumn('messages', 'deleted', 'deleted INTEGER NOT NULL DEFAULT 0');
ensureColumn('channels', 'is_dm', 'is_dm INTEGER NOT NULL DEFAULT 0');

// 初回起動時に既定の公開チャンネルを用意
const channelCount = db.prepare('SELECT COUNT(*) AS c FROM channels').get().c;
if (channelCount === 0) {
  const now = Date.now();
  const insert = db.prepare(
    'INSERT INTO channels (id, name, topic, is_private, created_by, created_at) VALUES (?,?,?,?,?,?)'
  );
  insert.run('general', 'general', '全社の雑談・お知らせ', 0, null, now);
  insert.run('random', 'random', '雑談・なんでも', 0, null, now);
}

export default db;
