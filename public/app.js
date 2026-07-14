// ==================== 状態 ====================
let me = null;
let token = localStorage.getItem('token') || null;
let currentChannel = null;
let channels = [];
let users = [];
let channelReads = {};            // 現在のチャンネルの {userId: 最終既読時刻}
let pendingAttachments = [];
let pendingThreadAttachments = [];
let currentThreadParent = null;
let bookmarkedIds = new Set();   // 自分がブックマークしたメッセージID
let unreadChannels = new Set();  // 未読があるチャンネルID
const socket = io();

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const esc = (s) => (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// /uploads は認証必須なので、トークンをクエリで付与する
function withToken(url) {
  if (!url) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
}

// アイコン描画（画像 or 頭文字＋色）
function applyAvatar(node, avatar) {
  node.innerHTML = '';
  node.style.background = '';
  if (avatar?.image) {
    const img = document.createElement('img');
    img.src = withToken(avatar.image);
    img.className = 'avatar-img';
    node.append(img);
  } else {
    node.style.background = avatar?.color || '#888';
    node.textContent = avatar?.initial || '?';
  }
}
function avatarNode(user, sm) {
  const node = el('div', 'avatar' + (sm ? ' sm' : ''));
  applyAvatar(node, user?.avatar);
  return node;
}
function presenceClass(p) { return p === 'active' ? 'on' : p === 'away' ? 'away' : 'off'; }
function findUser(id) { return users.find((u) => u.id === id); }

// ==================== SVGアイコン（Lucide風・ストローク） ====================
const ICONS = {
  paperclip: "<path d='M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'/>",
  smile: "<circle cx='12' cy='12' r='10'/><path d='M8 14s1.5 2 4 2 4-2 4-2'/><line x1='9' y1='9' x2='9.01' y2='9'/><line x1='15' y1='9' x2='15.01' y2='9'/>",
  send: "<path d='M22 2L11 13'/><path d='M22 2l-7 20-4-9-9-4 20-7z'/>",
  message: "<path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'/>",
  reply: "<polyline points='9 17 4 12 9 7'/><path d='M20 18v-2a4 4 0 0 0-4-4H4'/>",
  pencil: "<path d='M12 20h9'/><path d='M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z'/>",
  trash: "<polyline points='3 6 5 6 21 6'/><path d='M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'/>",
  hash: "<line x1='4' y1='9' x2='20' y2='9'/><line x1='4' y1='15' x2='20' y2='15'/><line x1='10' y1='3' x2='8' y2='21'/><line x1='16' y1='3' x2='14' y2='21'/>",
  lock: "<rect x='3' y='11' width='18' height='11' rx='2'/><path d='M7 11V7a5 5 0 0 1 10 0v4'/>",
  atSign: "<circle cx='12' cy='12' r='4'/><path d='M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94'/>",
  bell: "<path d='M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9'/><path d='M13.73 21a2 2 0 0 1-3.46 0'/>",
  search: "<circle cx='11' cy='11' r='8'/><line x1='21' y1='21' x2='16.65' y2='16.65'/>",
  plus: "<line x1='12' y1='5' x2='12' y2='19'/><line x1='5' y1='12' x2='19' y2='12'/>",
  settings: "<circle cx='12' cy='12' r='3'/><path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'/>",
  x: "<line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/>",
  check: "<polyline points='20 6 9 17 4 12'/>",
  more: "<circle cx='12' cy='5' r='1.4' fill='currentColor' stroke='none'/><circle cx='12' cy='12' r='1.4' fill='currentColor' stroke='none'/><circle cx='12' cy='19' r='1.4' fill='currentColor' stroke='none'/>",
  pin: "<path d='M12 17v5'/><path d='M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'/>",
  bookmark: "<path d='M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'/>",
  copy: "<rect x='9' y='9' width='13' height='13' rx='2'/><path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'/>",
  link: "<path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'/><path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'/>",
  forward: "<polyline points='15 14 20 9 15 4'/><path d='M20 9H9.5A5.5 5.5 0 0 0 4 14.5 5.5 5.5 0 0 0 9.5 20H13'/>",
  file: "<path d='M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z'/><polyline points='13 2 13 9 20 9'/>",
  image: "<rect x='3' y='3' width='18' height='18' rx='2'/><circle cx='8.5' cy='8.5' r='1.5'/><polyline points='21 15 16 10 5 21'/>",
  download: "<path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/><polyline points='7 10 12 15 17 10'/><line x1='12' y1='15' x2='12' y2='3'/>",
  mailOpen: "<path d='M21 8.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8.5l9-6 9 6z'/><polyline points='3 8.5 12 14 21 8.5'/>",
  bold: "<path d='M6 4h8a4 4 0 0 1 0 8H6z'/><path d='M6 12h9a4 4 0 0 1 0 8H6z'/>",
  italic: "<line x1='19' y1='4' x2='10' y2='4'/><line x1='14' y1='20' x2='5' y2='20'/><line x1='15' y1='4' x2='9' y2='20'/>",
  strike: "<path d='M16 4H9a3 3 0 0 0-2.83 4'/><path d='M14 12a4 4 0 0 1 0 8H6'/><line x1='4' y1='12' x2='20' y2='12'/>",
  list: "<line x1='8' y1='6' x2='21' y2='6'/><line x1='8' y1='12' x2='21' y2='12'/><line x1='8' y1='18' x2='21' y2='18'/><line x1='3' y1='6' x2='3.01' y2='6'/><line x1='3' y1='12' x2='3.01' y2='12'/><line x1='3' y1='18' x2='3.01' y2='18'/>",
  listOrdered: "<line x1='10' y1='6' x2='21' y2='6'/><line x1='10' y1='12' x2='21' y2='12'/><line x1='10' y1='18' x2='21' y2='18'/><path d='M4 6h1v4'/><path d='M4 10h2'/><path d='M6 18H4c0-1 2-2 2-3s-1-1.5-2-1'/>",
  code: "<polyline points='16 18 22 12 16 6'/><polyline points='8 6 2 12 8 18'/>",
  codeBlock: "<rect x='3' y='3' width='18' height='18' rx='2'/><path d='M10 10l-2 2 2 2'/><path d='M14 10l2 2-2 2'/>",
  home: "<path d='M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/><polyline points='9 22 9 12 15 12 15 22'/>",
  moon: "<path d='M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'/>",
  menu: "<line x1='3' y1='6' x2='21' y2='6'/><line x1='3' y1='12' x2='21' y2='12'/><line x1='3' y1='18' x2='21' y2='18'/>",
  sun: "<circle cx='12' cy='12' r='5'/><line x1='12' y1='1' x2='12' y2='3'/><line x1='12' y1='21' x2='12' y2='23'/><line x1='4.22' y1='4.22' x2='5.64' y2='5.64'/><line x1='18.36' y1='18.36' x2='19.78' y2='19.78'/><line x1='1' y1='12' x2='3' y2='12'/><line x1='21' y1='12' x2='23' y2='12'/><line x1='4.22' y1='19.78' x2='5.64' y2='18.36'/><line x1='18.36' y1='5.64' x2='19.78' y2='4.22'/>",
};
function icon(name, size = 18) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}

// 絵文字ピッカー用（リアクション用の小セットとは別に広め）
const EMOJIS = ['👍', '❤️', '😄', '😊', '🎉', '🙏', '👀', '✅', '🔥', '😂', '😍', '🤔', '😎', '😢', '😅', '🙌',
  '👏', '💪', '🚀', '✨', '⭐', '💯', '🆗', '❌', '⚠️', '📌', '📝', '💡', '☕', '🍺', '🍰', '🐶'];
const REACTION_EMOJIS = ['👍', '❤️', '😄', '🎉', '🙏', '👀', '✅', '🔥'];

// ==================== 認証 ====================
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.json) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.json);
    delete opts.json;
  }
  if (token) headers['x-token'] = token;
  return fetch(path, { ...opts, headers });
}

let authMode = 'login'; // 'login' | 'register'

function setAuthMode(mode) {
  authMode = mode;
  const isReg = mode === 'register';
  $('#auth-name').classList.toggle('hidden', !isReg);
  $('#auth-sub').textContent = isReg ? '新規アカウントを作成' : 'メールアドレスでログイン';
  $('#auth-btn').textContent = isReg ? '登録する' : 'ログイン';
  $('#auth-toggle-text').textContent = isReg ? 'すでにアカウントをお持ちの方は' : 'アカウントをお持ちでない方は';
  $('#auth-toggle-link').textContent = isReg ? 'ログイン' : '新規登録';
  $('#auth-error').classList.add('hidden');
}

function showAuthError(msg) {
  const e = $('#auth-error');
  e.textContent = msg;
  e.classList.remove('hidden');
}

async function submitAuth() {
  const email = $('#auth-email').value.trim();
  const password = $('#auth-password').value;
  const name = $('#auth-name').value.trim();
  const path = authMode === 'register' ? '/api/register' : '/api/login';
  const json = authMode === 'register' ? { name, email, password } : { email, password };
  const res = await api(path, { method: 'POST', json });
  const data = await res.json();
  if (!res.ok) return showAuthError(data.error || 'エラーが発生しました');
  token = data.token;
  me = data.user;
  localStorage.setItem('token', token);
  showApp();
}

$('#auth-btn').onclick = submitAuth;
$('#auth-toggle-link').onclick = () => setAuthMode(authMode === 'login' ? 'register' : 'login');
$('#auth-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAuth(); });

// 起動時：トークンがあればセッション確認
(async function init() {
  if (token) {
    const res = await api('/api/me');
    if (res.ok) {
      me = (await res.json()).user;
      showApp();
      return;
    }
    localStorage.removeItem('token');
    token = null;
  }
  $('#login').classList.remove('hidden');
})();

// ==================== アプリ起動 ====================
async function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  renderMe();
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  socket.emit('auth', { token });
  setupConnection();
  applyStaticIcons();
  bookmarkedIds = new Set(await (await api('/api/bookmark-ids')).json());
  await loadUsers();
  await loadChannels();
  if (channels.length) selectChannel(channels.find((c) => c.id === 'general') || channels[0]);
  setupComposer();
  $('#me-footer').onclick = openProfileModal;
  $('#nav-threads').onclick = showThreadsView;
  $('#nav-activity').onclick = showActivityView;
  $('#nav-bookmarks').onclick = showBookmarksView;
  $('#pin-btn').onclick = showPinnedView;
  setupRail();
}

// UI各所の絵文字をSVGアイコンへ差し替え（リアクション・絵文字ピッカーの中身は絵文字のまま）
function applyStaticIcons() {
  const set = (sel, name, size) => { const n = $(sel); if (n) n.innerHTML = icon(name, size); };
  set('#attach-btn', 'paperclip', 20);
  set('#emoji-btn', 'smile', 20);
  set('#thread-attach-btn', 'paperclip', 20);
  set('#thread-emoji-btn', 'smile', 20);
  set('#thread-close', 'x', 18);
  set('#add-channel', 'plus', 16);
  set('#add-group', 'plus', 16);
  set('#pin-btn', 'pin', 18);
  set('#menu-btn', 'menu', 22);
  // クイックナビ
  const qn = { '#nav-threads': 'message', '#nav-activity': 'atSign', '#nav-bookmarks': 'bookmark' };
  for (const [sel, name] of Object.entries(qn)) { const s = $(sel)?.querySelector('.quick-ico'); if (s) s.innerHTML = icon(name, 16); }
  // フッター歯車
  const gear = document.querySelector('.me-gear'); if (gear) gear.innerHTML = icon('settings', 16);
  // 検索アイコン
  const sb = document.querySelector('.search-box');
  if (sb && !sb.querySelector('.search-ico')) {
    const ico = el('span', 'search-ico', icon('search', 15));
    sb.prepend(ico);
    $('#search-input').placeholder = '検索';
  }
  // 書式ツールバー
  const fmtIcon = { bold: 'bold', italic: 'italic', strike: 'strike', link: 'link', ol: 'listOrdered', ul: 'list', code: 'code', codeblock: 'codeBlock' };
  document.querySelectorAll('.format-toolbar button').forEach((b) => { const n = fmtIcon[b.dataset.fmt]; if (n) b.innerHTML = icon(n, 16); });
  // 左レール
  const railIco = { home: 'home', dm: 'message', activity: 'atSign', files: 'file', more: 'more' };
  document.querySelectorAll('.rail-btn').forEach((b) => { const s = b.querySelector('.rail-ico'); if (s) s.innerHTML = icon(railIco[b.dataset.view], 22); });
  updateThemeToggleIcon();
}

// ==================== レール（ビュー切替） ====================
function setupRail() {
  document.querySelectorAll('.rail-btn').forEach((b) => {
    b.onclick = () => selectRailView(b.dataset.view, b);
  });
  $('#theme-toggle').onclick = toggleTheme;
  $('#rail-profile').onclick = openProfileModal;
  renderRailAvatar();
  setupDrawer();
  setupResizers();
}

// ==================== モバイルのドロワー ====================
function setupDrawer() {
  $('#menu-btn').onclick = () => document.getElementById('app').classList.toggle('drawer-open');
  $('#drawer-backdrop').onclick = closeDrawer;
}
function closeDrawer() { document.getElementById('app').classList.remove('drawer-open'); }
function isMobile() { return window.matchMedia('(max-width: 720px)').matches; }

// ==================== 幅のドラッグリサイズ ====================
function setupResizers() {
  const app = document.getElementById('app');
  // サイドバー幅
  const sb = document.querySelector('.sidebar');
  const savedSb = localStorage.getItem('sidebarWidth');
  if (savedSb) sb.style.width = savedSb + 'px';
  makeResizer(sb, 'right', 180, 480, (w) => { sb.style.width = w + 'px'; localStorage.setItem('sidebarWidth', w); });
  // スレッドパネル幅
  const tp = document.querySelector('.thread-panel');
  const savedTp = localStorage.getItem('threadWidth');
  if (savedTp) tp.style.width = savedTp + 'px';
  makeResizer(tp, 'left', 300, 640, (w) => { tp.style.width = w + 'px'; localStorage.setItem('threadWidth', w); });
}

// 要素の端にドラッグ用ハンドルを付ける
function makeResizer(elm, side, min, max, onResize) {
  const handle = el('div', 'resize-handle resize-' + side);
  elm.append(handle);
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (isMobile()) return;
    const startX = e.clientX;
    const startW = elm.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const move = (ev) => {
      const delta = side === 'right' ? ev.clientX - startX : startX - ev.clientX;
      const w = Math.max(min, Math.min(max, startW + delta));
      onResize(w);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}

function setRailActive(view) {
  document.querySelectorAll('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
}

function selectRailView(view, btn) {
  if (view !== 'more') setRailActive(view);
  if (view === 'home') { $('#sidebar-scroll')?.scrollTo?.(0, 0); if (currentChannel) selectChannel(currentChannel); else selectChannel(channels.find((c) => c.id === 'general') || channels[0]); }
  else if (view === 'dm') showDMDirectory();
  else if (view === 'activity') showActivityView();
  else if (view === 'files') showFilesView();
  else if (view === 'more') openMoreMenu(btn);
}

function openMoreMenu(btn) {
  document.querySelector('.ctx-menu')?.remove();
  const menu = el('div', 'ctx-menu');
  const items = [
    { ic: 'message', label: 'スレッド', fn: showThreadsView },
    { ic: 'bookmark', label: 'ブックマーク', fn: showBookmarksView },
    { ic: 'settings', label: 'プロフィール・設定', fn: openProfileModal },
  ];
  if (me.role === 'admin') items.push({ ic: 'settings', label: '管理者パネル', fn: openAdminPanel });
  for (const it of items) {
    const row = el('div', 'ctx-item');
    row.innerHTML = `<span class="ctx-ico">${icon(it.ic, 16)}</span><span>${it.label}</span>`;
    row.onclick = () => { menu.remove(); it.fn(); };
    menu.append(row);
  }
  const r = btn.getBoundingClientRect();
  document.body.append(menu);
  menu.style.left = (r.right + 6) + 'px';
  menu.style.top = r.top + 'px';
  setTimeout(() => document.addEventListener('click', function h() { menu.remove(); document.removeEventListener('click', h); }), 0);
}

// チャンネルヘッダーに設定ボタンを表示（作成者 or 管理者）
function updateChannelHeaderActions(channel) {
  const actions = document.querySelector('.channel-header-actions');
  document.getElementById('channel-settings-btn')?.remove();
  if (!channel || channel.is_dm) return;
  const canEdit = channel.created_by === me.id || me.role === 'admin';
  if (!canEdit) return;
  const btn = el('button', 'header-btn');
  btn.id = 'channel-settings-btn';
  btn.innerHTML = icon('settings', 16);
  btn.title = 'チャンネル設定';
  btn.onclick = () => openChannelSettings(channel);
  actions.prepend(btn);
}

// チャンネル設定（名前・説明の編集、削除）＝#7
function openChannelSettings(channel) {
  const modal = $('#modal');
  const deletable = channel.id !== 'general' && channel.id !== 'random';
  modal.innerHTML = `
    <h2>チャンネル設定</h2>
    <label>名前</label>
    <input type="text" id="cs-name" value="${esc(channel.name)}" />
    <label>説明</label>
    <input type="text" id="cs-topic" value="${esc(channel.topic || '')}" />
    <div class="modal-actions">
      ${deletable ? '<button class="btn-cancel danger-btn" id="cs-delete">チャンネルを削除</button>' : ''}
      <button class="btn-cancel" id="cs-cancel">キャンセル</button>
      <button class="btn-primary" id="cs-save">保存</button>
    </div>`;
  $('#modal-overlay').classList.remove('hidden');
  $('#cs-cancel').onclick = closeModal;
  $('#cs-save').onclick = async () => {
    const res = await api(`/api/channels/${channel.id}`, { method: 'PUT', json: { name: $('#cs-name').value.trim(), topic: $('#cs-topic').value.trim() } });
    if (res.ok) { closeModal(); toast('保存しました'); } else alert((await res.json()).error || '失敗しました');
  };
  if ($('#cs-delete')) $('#cs-delete').onclick = async () => {
    if (!confirm(`#${channel.name} を削除しますか？メッセージも全て消えます。`)) return;
    const res = await api(`/api/channels/${channel.id}`, { method: 'DELETE' });
    if (res.ok) { closeModal(); toast('削除しました'); } else alert((await res.json()).error || '失敗しました');
  };
}

// 管理者パネル（#9/#10）
async function openAdminPanel() {
  const modal = $('#modal');
  modal.innerHTML = `<h2>管理者パネル</h2><div id="admin-users" class="admin-users">読み込み中…</div>
    <div class="modal-actions"><button class="btn-cancel" id="admin-close">閉じる</button></div>`;
  $('#modal-overlay').classList.remove('hidden');
  $('#admin-close').onclick = closeModal;
  const list = await (await api('/api/admin/users')).json();
  const box = $('#admin-users');
  box.innerHTML = '';
  for (const u of list) {
    const row = el('div', 'admin-row');
    const av = avatarNode(u, true);
    const info = el('div', 'admin-info');
    info.innerHTML = `<div class="admin-name">${esc(u.name)} ${u.role === 'admin' ? '<span class="admin-badge">管理者</span>' : ''} ${u.disabled ? '<span class="admin-badge off">無効</span>' : ''}</div><div class="admin-email">${esc(u.email || '')}</div>`;
    const actions = el('div', 'admin-actions');
    if (u.id !== me.id) {
      const roleBtn = el('button', 'btn-cancel', u.role === 'admin' ? '管理者を解除' : '管理者にする');
      roleBtn.onclick = async () => { await api(`/api/admin/users/${u.id}`, { method: 'POST', json: { role: u.role === 'admin' ? 'member' : 'admin' } }); openAdminPanel(); };
      const disBtn = el('button', 'btn-cancel', u.disabled ? '有効化' : '無効化');
      disBtn.onclick = async () => { await api(`/api/admin/users/${u.id}`, { method: 'POST', json: { disabled: !u.disabled } }); openAdminPanel(); };
      const pwBtn = el('button', 'btn-cancel', 'PW再設定');
      pwBtn.onclick = async () => {
        const pw = prompt(`${u.name} の新しいパスワード（6文字以上）`);
        if (!pw) return;
        const res = await api('/api/admin/reset-password', { method: 'POST', json: { userId: u.id, password: pw } });
        if (res.ok) toast('パスワードを再設定しました'); else alert((await res.json()).error || '失敗しました');
      };
      actions.append(roleBtn, disBtn, pwBtn);
    } else {
      actions.append(el('span', 'admin-you', 'あなた'));
    }
    row.append(av, info, actions);
    box.append(row);
  }
}

function renderRailAvatar() {
  applyAvatar($('#rail-avatar-inner'), me.avatar);
  $('#rail-presence').className = 'presence-dot sm ' + presenceClass(me.presence || 'active');
}

// ==================== テーマ ====================
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  updateThemeToggleIcon();
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}
function updateThemeToggleIcon() {
  const btn = $('#theme-toggle');
  if (!btn) return;
  const dark = (document.documentElement.getAttribute('data-theme') || 'light') === 'dark';
  btn.innerHTML = icon(dark ? 'sun' : 'moon', 20);
  btn.title = dark ? 'ライトモードに切替' : 'ダークモードに切替';
}
applyTheme(localStorage.getItem('theme') || 'light'); // 起動時に適用

// ==================== テーマカラー（アクセント） ====================
const ACCENT_PRESETS = [
  { id: 'aubergine', label: 'オーベルジン', sidebar: '#3f0e40', rail: '#2c0a2d' },
  { id: 'navy', label: 'ネイビー', sidebar: '#10294e', rail: '#0a1c37' },
  { id: 'forest', label: 'フォレスト', sidebar: '#0b4a34', rail: '#073123' },
  { id: 'teal', label: 'ティール', sidebar: '#0b3d40', rail: '#06282a' },
  { id: 'indigo', label: 'インディゴ', sidebar: '#2b2a5e', rail: '#1c1b40' },
  { id: 'rose', label: 'ローズ', sidebar: '#5c1030', rail: '#3d0a20' },
  { id: 'graphite', label: 'グラファイト', sidebar: '#2a2d33', rail: '#1a1c20' },
];
function applyAccent(id) {
  const p = ACCENT_PRESETS.find((x) => x.id === id) || ACCENT_PRESETS[0];
  document.documentElement.style.setProperty('--sidebar-bg', p.sidebar);
  document.documentElement.style.setProperty('--rail-bg', p.rail);
  document.documentElement.style.setProperty('--sidebar-hover', p.rail);
  localStorage.setItem('accent', p.id);
}
applyAccent(localStorage.getItem('accent') || 'aubergine'); // 起動時に適用

// Service Worker 登録（#21）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// 自分の情報をフッターに反映
function renderMe() {
  applyAvatar($('#me-avatar'), me.avatar);
  $('#me-name').textContent = me.name;
  const away = me.presence === 'away';
  $('#me-presence').className = 'presence-dot ' + presenceClass(me.presence || 'active');
  $('#me-status').textContent = away ? '離席中' : 'アクティブ';
  if ($('#rail-avatar-inner')) renderRailAvatar();
}

async function loadUsers() {
  users = await (await api('/api/users')).json();
  renderMembers();
}

function renderMembers() {
  const list = $('#member-list');
  list.innerHTML = '';
  // オンラインを上に
  const sorted = [...users].filter((u) => u.id !== me.id)
    .sort((a, b) => (b.presence !== 'offline') - (a.presence !== 'offline') || a.name.localeCompare(b.name));
  for (const u of sorted) {
    const li = el('li');
    const wrap = el('span', 'avatar-wrap');
    const av = avatarNode(u, true);
    const dot = el('span', 'presence-dot sm ' + presenceClass(u.presence));
    wrap.append(av, dot);
    li.append(wrap, document.createTextNode(u.name));
    li.title = u.presence === 'active' ? 'アクティブ' : u.presence === 'away' ? '離席中' : 'オフライン';
    li.onclick = () => startDM(u.id);
    list.append(li);
  }
}

async function loadChannels() {
  channels = await (await api(`/api/channels`)).json();
  renderChannels();
}

function userName(id) {
  const u = users.find((x) => x.id === id);
  return u ? u.name : '不明';
}

function renderChannels() {
  const chList = $('#channel-list');
  const grList = $('#group-list');
  const dmList = $('#dm-list');
  chList.innerHTML = grList.innerHTML = dmList.innerHTML = '';
  for (const c of channels) {
    const li = el('li');
    li.dataset.id = c.id;
    if (currentChannel && c.id === currentChannel.id) li.classList.add('active');
    if (unreadChannels.has(c.id) && c.id !== currentChannel?.id) li.classList.add('unread');
    li.onclick = () => selectChannel(c);
    if (c.is_dm) {
      const peer = c.dmPeer;
      const wrap = el('span', 'avatar-wrap');
      const av = avatarNode(peer, true);
      const pres = findUser(peer?.id)?.presence || peer?.presence || 'offline';
      wrap.append(av, el('span', 'presence-dot sm ' + presenceClass(pres)));
      li.append(wrap, document.createTextNode(peer?.name || 'DM'));
      dmList.append(li);
    } else {
      const prefix = el('span', 'channel-prefix', icon(c.is_private ? 'lock' : 'hash', 15));
      li.append(prefix, document.createTextNode(' ' + c.name));
      (c.is_private ? grList : chList).append(li);
    }
  }
}

async function startDM(targetUserId) {
  const res = await api('/api/dm', { method: 'POST', json: { targetUserId } });
  if (!res.ok) return;
  const ch = await res.json();
  await loadChannels();
  const created = channels.find((c) => c.id === ch.id);
  if (created) selectChannel(created);
}

// ==================== チャンネル選択 ====================
async function selectChannel(channel) {
  currentChannel = channel;
  unreadChannels.delete(channel.id);
  renderChannels();
  closeThread();
  if (isMobile()) closeDrawer();
  $('#current-channel-name').innerHTML = channel.is_dm
    ? `${icon('message', 17)} ${esc(channel.dmPeer?.name || 'DM')}`
    : `${icon(channel.is_private ? 'lock' : 'hash', 16)} ${esc(channel.name)}`;
  $('#current-channel-topic').textContent = channel.topic || '';
  updateChannelHeaderActions(channel);
  updatePinButton(channel.id);
  channelReads = await (await api(`/api/channels/${channel.id}/reads`)).json();
  const msgs = await (await api(`/api/channels/${channel.id}/messages`)).json();
  renderMessages(msgs);
  socket.emit('read', { channelId: channel.id }); // 開いたら既読
}

// 無限スクロール用の状態
let oldestTs = null, hasMoreOlder = false, loadingOlder = false;
async function loadOlderMessages() {
  if (!hasMoreOlder || loadingOlder || !currentChannel || oldestTs == null) return;
  loadingOlder = true;
  const box = $('#messages');
  const prevH = box.scrollHeight;
  const older = await (await api(`/api/channels/${currentChannel.id}/messages?before=${oldestTs}`)).json();
  if (older.length) {
    oldestTs = older[0].created_at;
    hasMoreOlder = older.length >= 50;
    const frag = document.createDocumentFragment();
    for (const m of older) frag.append(renderMessage(m, false));
    box.prepend(frag);
    box.scrollTop = box.scrollHeight - prevH; // スクロール位置を維持
    refreshReadLabels();
  } else {
    hasMoreOlder = false;
  }
  loadingOlder = false;
}

// ピン留めボタンの表示更新（件数）
async function updatePinButton(channelId) {
  const btn = $('#pin-btn');
  const pins = await (await api(`/api/channels/${channelId}/pins`)).json();
  if (pins.length) { btn.classList.remove('hidden'); btn.innerHTML = `${icon('pin', 16)} ${pins.length}`; }
  else btn.classList.add('hidden');
}

function renderMessages(msgs) {
  const box = $('#messages');
  box.innerHTML = '';
  if (msgs.length === 0) {
    box.append(el('div', 'empty-state', `<div style="padding:40px 20px;color:#888;text-align:center;">まだメッセージはありません。最初の投稿をしましょう 👋</div>`));
  }
  for (const m of msgs) box.append(renderMessage(m, false));
  box.scrollTop = box.scrollHeight;
  refreshReadLabels();
  // ページネーション状態
  oldestTs = msgs.length ? msgs[0].created_at : null;
  hasMoreOlder = msgs.length >= 50;
  // 上端付近までスクロールしたら過去を読み込む
  box.onscroll = () => {
    if (box.scrollTop < 80) loadOlderMessages();
    hideNewMessageBanner();
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 80) hideNewMessageBanner();
  };
}

// ==================== メッセージ描画 ====================
function renderMessage(m, inThread) {
  const wrap = el('div', 'message');
  wrap.dataset.id = m.id;
  wrap.dataset.created = m.created_at;
  wrap.dataset.author = m.user?.id || '';
  if (!inThread && !m.deleted && m.mentions?.includes(me.id)) wrap.classList.add('mention-me');

  const av = avatarNode(m.user, false);

  const body = el('div', 'message-body-wrap');
  const timeStr = new Date(m.created_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const editedMark = m.edited_at && !m.deleted ? ' <span class="edited-mark">(編集済み)</span>' : '';

  if (m.deleted) {
    body.innerHTML = `<div class="message-head"><span class="message-author">${esc(m.user?.name || '不明')}</span></div>
      <div class="message-text deleted">${icon('trash', 14)} このメッセージは削除されました</div>`;
    wrap.append(av, body);
    return wrap;
  }

  if (m.pinned) wrap.classList.add('pinned');
  const pinBadge = m.pinned ? `<span class="pin-badge" title="ピン留め">${icon('pin', 12)} ピン留め</span>` : '';

  body.innerHTML = `
    <div class="message-head">
      <span class="message-author">${esc(m.user?.name || '不明')}</span>
      <span class="message-time">${timeStr}${editedMark}</span>
      ${pinBadge}
    </div>
    ${m.body ? `<div class="message-text${isOnlyEmoji(m.body) ? ' big-emoji' : ''}">${renderBody(m.body)}</div>` : ''}
  `;

  if (m.attachments?.length) body.append(renderAttachments(m.attachments));
  body.append(renderReactions(m));

  if (!inThread && m.replyCount > 0) {
    const link = el('div', 'thread-link', `${icon('reply', 14)} ${m.replyCount}件の返信`);
    link.onclick = () => openThread(m);
    body.append(link);
  }

  // 既読ラベル（トップレベルのみ）
  if (!inThread) body.append(el('div', 'read-label'));

  // ホバー操作（リアクション・返信・…メニュー）
  const actions = el('div', 'message-actions');
  const reactBtn = el('button', '', icon('smile'));
  reactBtn.title = 'リアクション';
  reactBtn.onclick = (e) => { e.stopPropagation(); showReactionPicker(m.id, actions); };
  actions.append(reactBtn);
  if (!inThread) {
    const threadBtn = el('button', '', icon('reply'));
    threadBtn.title = 'スレッドで返信';
    threadBtn.onclick = () => openThread(m);
    actions.append(threadBtn);
  }
  const bmBtn = el('button', 'bm-btn' + (bookmarkedIds.has(m.id) ? ' on' : ''), icon('bookmark'));
  bmBtn.title = 'ブックマーク';
  bmBtn.onclick = (e) => { e.stopPropagation(); toggleBookmark(m.id); };
  const moreBtn = el('button', '', icon('more'));
  moreBtn.title = 'その他';
  moreBtn.onclick = (e) => { e.stopPropagation(); const r = moreBtn.getBoundingClientRect(); openContextMenu(m, r.right, r.bottom, inThread); };
  actions.append(bmBtn, moreBtn);

  // 右クリックでコンテキストメニュー
  wrap.addEventListener('contextmenu', (e) => { e.preventDefault(); openContextMenu(m, e.clientX, e.clientY, inThread); });

  wrap.append(av, body, actions);
  return wrap;
}

// ==================== コンテキストメニュー ====================
function openContextMenu(m, x, y, inThread) {
  document.querySelector('.ctx-menu')?.remove();
  const menu = el('div', 'ctx-menu');
  const isMine = m.user?.id === me.id;
  const bookmarked = bookmarkedIds.has(m.id);
  const items = [];
  items.push({ ic: 'smile', label: 'リアクションを追加', fn: () => showReactionPickerAt(m.id, x, y) });
  if (!inThread) items.push({ ic: 'reply', label: 'スレッドで返信', fn: () => openThread(m) });
  items.push({ ic: 'forward', label: 'メッセージを転送', fn: () => openForwardModal(m) });
  items.push({ ic: 'bookmark', label: bookmarked ? 'ブックマークを解除' : 'ブックマークする', fn: () => toggleBookmark(m.id) });
  items.push({ ic: 'mailOpen', label: 'ここから未読にする', fn: () => markUnread(m) });
  items.push({ sep: true });
  items.push({ ic: 'link', label: 'リンクをコピー', fn: () => copyLink(m) });
  items.push({ ic: 'copy', label: 'メッセージをコピー', fn: () => copyText(m.body) });
  items.push({ ic: 'pin', label: m.pinned ? 'ピン留めを外す' : 'チャンネルにピン留め', fn: () => socket.emit('pin:toggle', { messageId: m.id }) });
  if (isMine) {
    items.push({ sep: true });
    items.push({ ic: 'pencil', label: 'メッセージを編集', fn: () => { const node = document.querySelector(`.message[data-id="${m.id}"]`); if (node) startEdit(m, node, inThread); } });
    items.push({ ic: 'trash', label: '削除する', danger: true, fn: () => { if (confirm('このメッセージを削除しますか？')) socket.emit('message:delete', { messageId: m.id }); } });
  }
  for (const it of items) {
    if (it.sep) { menu.append(el('div', 'ctx-sep')); continue; }
    const row = el('div', 'ctx-item' + (it.danger ? ' danger' : ''));
    row.innerHTML = `<span class="ctx-ico">${icon(it.ic, 16)}</span><span>${it.label}</span>`;
    row.onclick = () => { menu.remove(); it.fn(); };
    menu.append(row);
  }
  document.body.append(menu);
  // 画面内に収める
  const mw = 240, mh = menu.offsetHeight;
  menu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - mh - 8) + 'px';
  setTimeout(() => document.addEventListener('click', function h() { menu.remove(); document.removeEventListener('click', h); }), 0);
}

function toggleBookmark(messageId) {
  socket.emit('bookmark:toggle', { messageId }, (resp) => {
    if (resp?.ok) {
      if (resp.bookmarked) bookmarkedIds.add(messageId); else bookmarkedIds.delete(messageId);
      document.querySelectorAll(`.message[data-id="${messageId}"] .bm-btn`).forEach((b) => b.classList.toggle('on', resp.bookmarked));
    }
  });
}

function markUnread(m) {
  socket.emit('markUnread', { channelId: m.channel_id, beforeTs: m.created_at });
  unreadChannels.add(m.channel_id);
  renderChannels();
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text || ''); toast('メッセージをコピーしました'); } catch { toast('コピーできませんでした'); }
}
async function copyLink(m) {
  const url = `${location.origin}/?c=${encodeURIComponent(m.channel_id)}&m=${encodeURIComponent(m.id)}`;
  try { await navigator.clipboard.writeText(url); toast('リンクをコピーしました'); } catch { toast('コピーできませんでした'); }
}

// リアクションピッカーを座標指定で開く
function showReactionPickerAt(messageId, x, y) {
  document.querySelector('.emoji-popover')?.remove();
  const pop = el('div', 'emoji-popover');
  pop.style.position = 'fixed';
  pop.style.left = Math.min(x, window.innerWidth - 260) + 'px';
  pop.style.top = y + 'px';
  for (const e of REACTION_EMOJIS) {
    const b = el('button', '', e);
    b.onclick = () => { socket.emit('reaction:toggle', { messageId, emoji: e }); pop.remove(); };
    pop.append(b);
  }
  document.body.append(pop);
  setTimeout(() => document.addEventListener('click', function h() { pop.remove(); document.removeEventListener('click', h); }), 0);
}

// 簡易トースト
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = el('div', 'toast', msg);
  document.body.append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 1800);
}

// 画像ライトボックス（#23）
function openLightbox(url, name) {
  document.querySelector('.lightbox')?.remove();
  const lb = el('div', 'lightbox');
  const img = el('img');
  img.src = url;
  const bar = el('div', 'lightbox-bar');
  const dl = el('a', 'lightbox-dl', `${icon('download', 16)} ダウンロード`);
  dl.href = url; dl.download = name || '';
  const close = el('button', 'lightbox-close', icon('x', 22));
  bar.append(dl, close);
  lb.append(bar, img);
  lb.onclick = (e) => { if (e.target === lb || e.target === close || close.contains(e.target)) lb.remove(); };
  document.addEventListener('keydown', function esc(ev) { if (ev.key === 'Escape') { lb.remove(); document.removeEventListener('keydown', esc); } });
  document.body.append(lb);
}

// 本文描画：Markdown（太字/斜体/打消/コード/リスト/引用/リンク）＋メンション
function renderBody(body) {
  const lines = esc(body).split('\n');
  const parts = []; // {block:bool, html}
  let listType = null, listItems = [];
  const flushList = () => {
    if (listType) {
      parts.push({ block: true, html: `<${listType} class="md-list">` + listItems.map((t) => `<li>${inlineMd(t)}</li>`).join('') + `</${listType}>` });
      listType = null; listItems = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // フェンス付きコードブロック ```
    if (/^```/.test(line.trim())) {
      flushList();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
      parts.push({ block: true, html: `<pre class="md-codeblock"><code>${buf.join('\n')}</code></pre>` });
      continue;
    }
    let m;
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (listType !== 'ul') { flushList(); listType = 'ul'; } listItems.push(m[1]); continue; }
    if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) { if (listType !== 'ol') { flushList(); listType = 'ol'; } listItems.push(m[1]); continue; }
    flushList();
    if ((m = line.match(/^&gt;\s?(.*)$/))) { parts.push({ block: true, html: `<blockquote class="md-quote">${inlineMd(m[1])}</blockquote>` }); continue; }
    parts.push({ block: false, html: inlineMd(line) });
  }
  flushList();
  // インライン行は<br>で連結、ブロック要素は独立
  let html = '', run = [];
  const flushRun = () => { if (run.length) { html += run.join('<br>'); run = []; } };
  for (const p of parts) { if (p.block) { flushRun(); html += p.html; } else run.push(p.html); }
  flushRun();
  return html;
}

// メンションのユーザー特定：完全一致優先→最長の前方一致（サーバーと同じ規則）
function matchMentionUser(name) {
  let hit = users.find((u) => u.name === name);
  if (!hit) {
    const prefixes = users.filter((u) => name.startsWith(u.name));
    if (prefixes.length) hit = prefixes.sort((a, b) => b.name.length - a.name.length)[0];
  }
  return hit;
}

// 行内のMarkdown・メンション・リンクを処理（textはエスケープ済み）
function inlineMd(text) {
  const tokens = [];
  const stash = (h) => { tokens.push(h); return `\u0000${tokens.length - 1}\u0000`; };
  text = text.replace(/`([^`]+)`/g, (m, c) => stash(`<code class="md-code">${c}</code>`));
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]*)\)/g, (m, t, u) => stash(`<a href="${u}" target="_blank" rel="noopener" class="md-link">${t}</a>`));
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  text = text.replace(/@([^\s@、。！？]+)/g, (full, name) => {
    const hit = matchMentionUser(name);
    if (!hit) return full;
    const cls = hit.id === me.id ? 'mention mention-self' : 'mention';
    return `<span class="${cls}">@${esc(hit.name)}</span>` + name.slice(hit.name.length);
  });
  text = text.replace(/(https?:\/\/[^\s<]+)/g, (u) => stash(`<a href="${u}" target="_blank" rel="noopener" class="md-link">${u}</a>`));
  text = text.replace(/\u0000(\d+)\u0000/g, (m, i) => tokens[+i]);
  return text;
}

// ==================== 書式ツールバー ====================
function applyFormat(fmt, ta) {
  if (!ta) return;
  const wrap = (b, a, ph) => wrapSelection(ta, b, a, ph);
  switch (fmt) {
    case 'bold': wrap('**', '**', '太字'); break;
    case 'italic': wrap('*', '*', '斜体'); break;
    case 'strike': wrap('~~', '~~', '打ち消し'); break;
    case 'code': wrap('`', '`', 'コード'); break;
    case 'codeblock': wrapCodeBlock(ta); break;
    case 'link': insertLink(ta); break;
    case 'ul': prefixLines(ta, '- '); break;
    case 'ol': prefixLines(ta, '1. '); break;
  }
}

function wrapSelection(ta, before, after, placeholder) {
  const s = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || placeholder;
  ta.value = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
  ta.focus();
  ta.selectionStart = s + before.length;
  ta.selectionEnd = s + before.length + sel.length;
  ta.dispatchEvent(new Event('input'));
}

function wrapCodeBlock(ta) {
  const s = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || 'コード';
  const ins = '```\n' + sel + '\n```';
  ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
  ta.focus();
  ta.selectionStart = s + 4;
  ta.selectionEnd = s + 4 + sel.length;
  ta.dispatchEvent(new Event('input'));
}

function insertLink(ta) {
  const s = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || 'リンクテキスト';
  const ins = `[${sel}](https://)`;
  ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e);
  ta.focus();
  // URL部分（https://）を選択状態に
  ta.selectionStart = s + sel.length + 3;
  ta.selectionEnd = s + ins.length - 1;
  ta.dispatchEvent(new Event('input'));
}

function prefixLines(ta, prefix) {
  const val = ta.value;
  const lineStart = val.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let lineEnd = val.indexOf('\n', ta.selectionEnd);
  if (lineEnd === -1) lineEnd = val.length;
  const block = val.slice(lineStart, lineEnd);
  const newBlock = block.split('\n').map((ln, idx) => (prefix === '1. ' ? `${idx + 1}. ${ln}` : `${prefix}${ln}`)).join('\n');
  ta.value = val.slice(0, lineStart) + newBlock + val.slice(lineEnd);
  ta.focus();
  ta.selectionStart = lineStart;
  ta.selectionEnd = lineStart + newBlock.length;
  ta.dispatchEvent(new Event('input'));
}

function startEdit(m, wrap, inThread) {
  const bodyWrap = wrap.querySelector('.message-body-wrap');
  const textDiv = bodyWrap.querySelector('.message-text');
  if (!textDiv || wrap.querySelector('.edit-box')) return;
  const box = el('div', 'edit-box');
  const ta = el('textarea', 'edit-textarea');
  ta.value = m.body;
  const bar = el('div', 'edit-actions');
  const save = el('button', 'btn-primary', '保存');
  const cancel = el('button', 'btn-cancel', 'キャンセル');
  bar.append(save, cancel);
  box.append(ta, bar);
  textDiv.replaceWith(box);
  ta.focus();
  const finish = () => socket.emit('message:edit', { messageId: m.id, body: ta.value }, () => {});
  save.onclick = finish;
  cancel.onclick = () => { const msgs = null; box.replaceWith(textDiv); };
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey && !e.isComposing) { e.preventDefault(); finish(); }
    if (e.key === 'Escape') cancel.click();
  });
}

function renderAttachments(attachments) {
  const box = el('div', 'attachments');
  for (const a of attachments) {
    if (a.mimetype && a.mimetype.startsWith('image/')) {
      const d = el('div', 'attach-image');
      const img = el('img');
      img.src = withToken(a.url);
      img.onclick = () => openLightbox(withToken(a.url), a.filename);
      d.append(img);
      box.append(d);
    } else {
      const card = el('div', 'attach-file');
      const open = el('a', 'attach-file-main');
      open.href = withToken(a.url); open.target = '_blank'; open.rel = 'noopener';
      open.innerHTML = `<span class="file-icon">${icon('file', 22)}</span>
        <span class="file-meta">
          <div class="file-name">${esc(a.filename)}</div>
          <div class="file-size">${formatSize(a.size)}・クリックで開く</div>
        </span>`;
      const dl = el('a', 'attach-dl', icon('download', 16));
      dl.href = `/api/download/${a.id}?token=${encodeURIComponent(token)}`;
      dl.title = 'ダウンロード';
      card.append(open, dl);
      box.append(card);
    }
  }
  return box;
}

function renderReactions(m) {
  const box = el('div', 'reactions');
  for (const [emoji, userIds] of Object.entries(m.reactions || {})) {
    if (!userIds.length) continue;
    const mine = userIds.includes(me.id);
    const r = el('span', 'reaction' + (mine ? ' mine' : ''), `${emoji} ${userIds.length}`);
    r.title = userIds.map(userName).join(', ');
    r.onclick = () => socket.emit('reaction:toggle', { messageId: m.id, emoji });
    box.append(r);
  }
  return box;
}

function showReactionPicker(messageId, anchor) {
  document.querySelector('.emoji-popover')?.remove();
  const pop = el('div', 'emoji-popover');
  for (const e of REACTION_EMOJIS) {
    const b = el('button', '', e);
    b.onclick = () => { socket.emit('reaction:toggle', { messageId, emoji: e }); pop.remove(); };
    pop.append(b);
  }
  anchor.append(pop);
  setTimeout(() => document.addEventListener('click', function h() { pop.remove(); document.removeEventListener('click', h); }), 0);
}

// ==================== 既読ラベル ====================
function refreshReadLabels() {
  document.querySelectorAll('#messages .message').forEach((node) => {
    const label = node.querySelector('.read-label');
    if (!label) return;
    const created = Number(node.dataset.created);
    const author = node.dataset.author;
    const readers = Object.entries(channelReads)
      .filter(([uid, at]) => uid !== author && uid !== me.id && at >= created)
      .map(([uid]) => userName(uid));
    // DMは相手1人なので「既読」だけ、グループ等は人数
    if (readers.length === 0) { label.innerHTML = ''; return; }
    if (currentChannel?.is_dm) {
      label.innerHTML = `${icon('check', 13)} 既読`;
    } else {
      label.innerHTML = `${icon('check', 13)} 既読 ${readers.length}`;
      label.title = readers.join(', ');
    }
  });
}

// ==================== スレッド ====================
async function openThread(parent) {
  currentThreadParent = parent;
  $('#thread-panel').classList.remove('hidden');
  $('#thread-parent').innerHTML = '';
  $('#thread-parent').append(renderMessage(parent, true));
  const replies = await (await api(`/api/channels/${parent.channel_id}/messages?parentId=${parent.id}`)).json();
  const box = $('#thread-messages');
  box.innerHTML = '';
  for (const r of replies) box.append(renderMessage(r, true));
  box.scrollTop = box.scrollHeight;
}
function closeThread() {
  currentThreadParent = null;
  $('#thread-panel').classList.add('hidden');
}
$('#thread-close').onclick = closeThread;

// ==================== コンポーザー ====================
function setupComposer() {
  const input = $('#composer-input');
  autoGrow(input);
  $('#send-btn').onclick = () => sendMessage(false);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(false); }
  });
  input.addEventListener('input', () => {
    socket.emit('typing', { channelId: currentChannel?.id, name: me.name, userId: me.id });
    handleMentionAutocomplete(input);
  });
  $('#attach-btn').onclick = () => $('#file-input').click();
  $('#file-input').addEventListener('change', (e) => handleFiles(e.target.files, false));
  $('#emoji-btn').onclick = (e) => { e.stopPropagation(); showEmojiPicker($('#emoji-btn'), input); };

  const tinput = $('#thread-input');
  autoGrow(tinput);
  $('#thread-send-btn').onclick = () => sendMessage(true);
  tinput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(true); }
  });
  tinput.addEventListener('input', () => {
    socket.emit('typing', { channelId: currentChannel?.id, name: me.name, userId: me.id });
    handleMentionAutocomplete(tinput);
  });
  $('#thread-attach-btn').onclick = () => $('#thread-file-input').click();
  $('#thread-file-input').addEventListener('change', (e) => handleFiles(e.target.files, true));
  $('#thread-emoji-btn').onclick = (e) => { e.stopPropagation(); showEmojiPicker($('#thread-emoji-btn'), tinput); };

  // 書式ツールバーの配線
  document.querySelectorAll('.format-toolbar button').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      const target = btn.closest('.format-toolbar').dataset.target;
      applyFormat(btn.dataset.fmt, document.getElementById(target));
    };
  });
  // キーボードショートカット（Ctrl/⌘+B / I）
  for (const ta of [input, tinput]) {
    ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        if (e.key.toLowerCase() === 'b') { e.preventDefault(); applyFormat('bold', ta); }
        if (e.key.toLowerCase() === 'i') { e.preventDefault(); applyFormat('italic', ta); }
      }
    });
  }
}

function autoGrow(input) {
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  });
}

// 絵文字ピッカー（入力欄に挿入）
function showEmojiPicker(anchorBtn, input) {
  document.querySelector('.emoji-picker')?.remove();
  const pop = el('div', 'emoji-picker');
  for (const e of EMOJIS) {
    const b = el('button', '', e);
    b.onclick = (ev) => {
      ev.stopPropagation();
      insertAtCursor(input, e);
    };
    pop.append(b);
  }
  anchorBtn.parentElement.style.position = 'relative';
  anchorBtn.parentElement.append(pop);
  setTimeout(() => document.addEventListener('click', function h(ev) {
    if (!pop.contains(ev.target) && ev.target !== anchorBtn) { pop.remove(); document.removeEventListener('click', h); }
  }), 0);
}

function insertAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  input.selectionStart = input.selectionEnd = start + text.length;
  input.focus();
}

// メンション補完
function handleMentionAutocomplete(input) {
  document.querySelector('.mention-menu')?.remove();
  const pos = input.selectionStart;
  const before = input.value.slice(0, pos);
  const match = before.match(/@([^\s@]*)$/);
  if (!match) return;
  const q = match[1];
  const matched = users.filter((u) => u.id !== me.id && u.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6);
  if (!matched.length) return;
  const menu = el('div', 'mention-menu');
  for (const u of matched) {
    const item = el('div', 'mention-item');
    const av = el('span', 'avatar sm', u.avatar.initial);
    av.style.background = u.avatar.color;
    item.append(av, document.createTextNode(u.name));
    item.onclick = () => {
      const start = pos - match[1].length - 1; // '@'の位置
      input.value = input.value.slice(0, start) + '@' + u.name + ' ' + input.value.slice(pos);
      input.focus();
      const caret = start + u.name.length + 2;
      input.selectionStart = input.selectionEnd = caret;
      menu.remove();
    };
    menu.append(item);
  }
  input.parentElement.style.position = 'relative';
  input.parentElement.append(menu);
}

async function handleFiles(fileList, isThread) {
  if (!fileList.length) return;
  const fd = new FormData();
  for (const f of fileList) fd.append('files', f);
  const res = await (await api('/api/upload', { method: 'POST', body: fd })).json();
  (isThread ? pendingThreadAttachments : pendingAttachments).push(...res.files);
  renderAttachPreview(isThread);
}

function renderAttachPreview(isThread) {
  const box = isThread ? $('#thread-attach-preview') : $('#attach-preview');
  const list = isThread ? pendingThreadAttachments : pendingAttachments;
  box.innerHTML = '';
  list.forEach((a, i) => {
    const item = el('div', 'attach-preview-item');
    if (a.mimetype?.startsWith('image/')) { const img = el('img'); img.src = withToken(a.url); item.append(img); }
    else item.append(document.createTextNode('📄 '));
    item.append(el('span', '', esc(a.filename)));
    const rm = el('button', '', '✕');
    rm.onclick = () => { list.splice(i, 1); renderAttachPreview(isThread); };
    item.append(rm);
    box.append(item);
  });
}

function sendMessage(isThread) {
  const input = isThread ? $('#thread-input') : $('#composer-input');
  const attachments = isThread ? pendingThreadAttachments : pendingAttachments;
  const body = input.value.trim();
  if (!body && attachments.length === 0) return;
  const parentId = isThread ? currentThreadParent.id : null;
  const channelId = currentChannel.id;
  socket.emit('message:send', {
    channelId, parentId, body,
    attachments: attachments.map((a) => ({ filename: a.filename, stored_name: a.stored_name, mimetype: a.mimetype, size: a.size })),
  }, (resp) => {
    if (resp?.error) { alert(resp.error); return; }
    // 楽観的更新：ackで返ったメッセージを即描画（message:newと重複はガード）
    if (resp?.message) receiveMessage({ channelId, parentId, message: resp.message });
  });
  input.value = '';
  input.style.height = 'auto';
  if (isThread) { pendingThreadAttachments = []; renderAttachPreview(true); }
  else { pendingAttachments = []; renderAttachPreview(false); }
}

// ==================== Socket.IO 受信 ====================
// メッセージ受信の共通処理（重複ガードつき。ack・socket両方から呼ばれる）
function receiveMessage({ channelId, parentId, message }) {
  const mine = message.user?.id === me.id;
  // 別チャンネル（または非表示中）に来たら未読マーク＋通知
  if (!mine && (channelId !== currentChannel?.id || document.hidden)) {
    unreadChannels.add(channelId);
    renderChannels();
  }
  if (channelId !== currentChannel?.id) return;
  if (parentId) {
    if (currentThreadParent && parentId === currentThreadParent.id) {
      const box = $('#thread-messages');
      if (!box.querySelector(`.message[data-id="${message.id}"]`)) {
        box.append(renderMessage(message, true));
        box.scrollTop = box.scrollHeight;
      }
    }
    updateThreadCount(parentId);
  } else {
    const box = $('#messages');
    if (box.querySelector(`.message[data-id="${message.id}"]`)) return; // 重複ガード
    box.querySelector('.empty-state')?.remove();
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    box.append(renderMessage(message, false));
    if (atBottom || mine) box.scrollTop = box.scrollHeight;
    else showNewMessageBanner();
    refreshReadLabels();
    if (!document.hidden) socket.emit('read', { channelId });
  }
}

socket.on('message:new', ({ channelId, parentId, message }) => {
  maybeNotify(channelId, message);
  receiveMessage({ channelId, parentId, message });
});

// 接続の確立・切断・再接続の管理
let firstConnect = true;
function setupConnection() {
  socket.on('connect', () => {
    socket.emit('auth', { token }); // ルームに入り直す
    hideConnBanner();
    if (!firstConnect && currentChannel) selectChannel(currentChannel); // 切断中の取りこぼしを補完
    firstConnect = false;
  });
  socket.on('disconnect', () => showConnBanner('接続が切れました。再接続しています…'));
  socket.io.on('reconnect_attempt', () => showConnBanner('再接続しています…'));
}

function showConnBanner(msg) {
  let b = $('#conn-banner');
  if (!b) { b = el('div', 'conn-banner'); b.id = 'conn-banner'; document.body.append(b); }
  b.textContent = msg;
  b.classList.add('show');
}
function hideConnBanner() { $('#conn-banner')?.classList.remove('show'); }

// 新着メッセージのバナー（下部）
function showNewMessageBanner() {
  let b = $('#newmsg-banner');
  if (!b) {
    b = el('div', 'newmsg-banner');
    b.id = 'newmsg-banner';
    b.innerHTML = `${icon('bell', 14)} 新しいメッセージ`;
    b.onclick = () => { const box = $('#messages'); box.scrollTop = box.scrollHeight; hideNewMessageBanner(); };
    document.querySelector('.main').append(b);
  }
  b.classList.add('show');
  // 最下部までスクロールしたら自動で消す
  const box = $('#messages');
  box.onscroll = () => { if (box.scrollHeight - box.scrollTop - box.clientHeight < 80) hideNewMessageBanner(); };
}
function hideNewMessageBanner() { $('#newmsg-banner')?.classList.remove('show'); }

socket.on('message:update', ({ channelId, message }) => {
  if (channelId !== currentChannel?.id) return;
  replaceMessage('#messages', message, false);
  replaceMessage('#thread-messages', message, true);
  if (currentThreadParent?.id === message.id) {
    $('#thread-parent').innerHTML = '';
    $('#thread-parent').append(renderMessage(message, true));
  }
  refreshReadLabels();
});

// ピン留めの変化 → ヘッダーのピン件数を更新
socket.on('pins:changed', ({ channelId }) => {
  if (channelId === currentChannel?.id) updatePinButton(channelId);
});

socket.on('read:update', ({ channelId, userId, at }) => {
  if (channelId !== currentChannel?.id) return;
  channelReads[userId] = at;
  refreshReadLabels();
});

socket.on('channel:new', async () => {
  socket.emit('auth', { token }); // 新チャンネルのルームに参加し直す
  await loadChannels();
});

socket.on('channel:updated', async (updated) => {
  await loadChannels();
  if (currentChannel?.id === updated.id) {
    const fresh = channels.find((c) => c.id === updated.id);
    if (fresh) {
      currentChannel = fresh;
      $('#current-channel-name').innerHTML = `${icon(fresh.is_private ? 'lock' : 'hash', 16)} ${esc(fresh.name)}`;
      $('#current-channel-topic').textContent = fresh.topic || '';
    }
  }
});

socket.on('channel:deleted', async ({ id }) => {
  const wasCurrent = currentChannel?.id === id;
  await loadChannels();
  if (wasCurrent) selectChannel(channels.find((c) => c.id === 'general') || channels[0]);
});

// 在席状態の変化
socket.on('presence', ({ userId, presence }) => {
  const u = findUser(userId);
  if (u) u.presence = presence;
  if (userId === me.id) { me.presence = presence; renderMe(); }
  renderMembers();
  renderChannels();
});

// プロフィール更新（名前・アイコン・在席）
socket.on('user:update', (updated) => {
  const i = users.findIndex((u) => u.id === updated.id);
  if (i >= 0) users[i] = { ...users[i], ...updated };
  else users.push(updated);
  if (updated.id === me.id) { me = { ...me, ...updated }; renderMe(); }
  renderMembers();
  renderChannels();
  if (currentChannel) refreshVisibleAuthors(updated);
});

// 表示中メッセージの投稿者名・アイコンを更新
function refreshVisibleAuthors(updated) {
  document.querySelectorAll(`.message[data-author="${updated.id}"] .message-author`).forEach((n) => { n.textContent = updated.name; });
}

let typingTimeout;
socket.on('typing', ({ channelId, name, userId }) => {
  if (channelId !== currentChannel?.id || userId === me.id) return;
  $('#typing-indicator').textContent = `${name} さんが入力中…`;
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => ($('#typing-indicator').textContent = ''), 2500);
});

function replaceMessage(containerSel, message, inThread) {
  const node = document.querySelector(`${containerSel} .message[data-id="${message.id}"]`);
  if (node) node.replaceWith(renderMessage(message, inThread));
}

async function updateThreadCount(parentId) {
  const node = document.querySelector(`#messages .message[data-id="${parentId}"]`);
  if (!node) return;
  const res = await api(`/api/messages/${parentId}`);
  if (!res.ok) return;
  const parent = await res.json();
  node.replaceWith(renderMessage(parent, false));
  refreshReadLabels();
}

// タブに戻ったら既読を送る
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentChannel) socket.emit('read', { channelId: currentChannel.id });
});

// ==================== チャンネル/グループ作成 ====================
$('#add-channel').onclick = () => openChannelModal(false);
$('#add-group').onclick = () => openChannelModal(true);

function openChannelModal(isPrivate) {
  const modal = $('#modal');
  modal.innerHTML = `
    <h2>${isPrivate ? '🔒 プライベートグループを作成' : '# チャンネルを作成'}</h2>
    <label>名前</label>
    <input type="text" id="ch-name" placeholder="${isPrivate ? '例：営業チーム' : '例：dev-team'}" />
    <label>説明（任意）</label>
    <input type="text" id="ch-topic" placeholder="このチャンネルの用途" />
    ${isPrivate ? `
      <label>メンバーを追加</label>
      <div class="member-picker" id="member-picker">
        ${users.filter((u) => u.id !== me.id).map((u) => `<label><input type="checkbox" value="${u.id}" /> ${esc(u.name)}</label>`).join('') || '<div style="color:#888;padding:6px;">他のメンバーがまだいません</div>'}
      </div>` : ''}
    <div class="modal-actions">
      <button class="btn-cancel" id="modal-cancel">キャンセル</button>
      <button class="btn-primary" id="modal-create">作成</button>
    </div>`;
  $('#modal-overlay').classList.remove('hidden');
  $('#modal-cancel').onclick = closeModal;
  $('#modal-create').onclick = async () => {
    const name = $('#ch-name').value.trim();
    if (!name) return;
    const members = isPrivate ? Array.from(document.querySelectorAll('#member-picker input:checked')).map((c) => c.value) : [];
    const res = await api('/api/channels', { method: 'POST', json: { name, topic: $('#ch-topic').value.trim(), isPrivate, members } });
    if (res.ok) {
      const ch = await res.json();
      closeModal();
      await loadChannels();
      const created = channels.find((c) => c.id === ch.id);
      if (created) selectChannel(created);
    } else {
      alert((await res.json()).error || '作成に失敗しました');
    }
  };
}
function closeModal() { $('#modal-overlay').classList.add('hidden'); }
$('#modal-overlay').onclick = (e) => { if (e.target.id === 'modal-overlay') closeModal(); };

// ==================== プロフィール編集 ====================
function openProfileModal() {
  const modal = $('#modal');
  const hasImage = !!me.avatar?.image;
  modal.innerHTML = `
    <h2>プロフィール</h2>
    <div class="profile-avatar-row">
      <div class="avatar lg" id="profile-avatar"></div>
      <div>
        <button class="btn-cancel" id="profile-upload">画像をアップロード</button>
        ${hasImage ? '<button class="btn-cancel" id="profile-clear">画像を外す</button>' : ''}
        <input type="file" id="profile-file" accept="image/*" hidden />
        <div class="profile-hint">正方形の画像がおすすめ</div>
      </div>
    </div>
    <label>表示名</label>
    <input type="text" id="profile-name" value="${esc(me.name)}" />
    <label>在席状態</label>
    <div class="radio-row">
      <label><input type="radio" name="away" value="0" ${me.presence !== 'away' ? 'checked' : ''}/> 🟢 アクティブ</label>
      <label><input type="radio" name="away" value="1" ${me.presence === 'away' ? 'checked' : ''}/> 🌙 離席中</label>
    </div>
    <label>通知の頻度</label>
    <div class="radio-row column">
      <label><input type="radio" name="notify" value="all" ${me.notifyPref === 'all' ? 'checked' : ''}/> すべてのメッセージ</label>
      <label><input type="radio" name="notify" value="mentions" ${me.notifyPref === 'mentions' ? 'checked' : ''}/> メンションされた時だけ</label>
      <label><input type="radio" name="notify" value="none" ${me.notifyPref === 'none' ? 'checked' : ''}/> 通知しない</label>
    </div>
    <div class="profile-notice" id="notify-perm"></div>
    <label>テーマカラー</label>
    <div class="swatch-row" id="swatch-row">
      ${ACCENT_PRESETS.map((p) => `<button class="swatch${(localStorage.getItem('accent') || 'aubergine') === p.id ? ' active' : ''}" data-accent="${p.id}" title="${p.label}" style="background:${p.sidebar}"></button>`).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn-cancel" id="profile-logout">ログアウト</button>
      <button class="btn-cancel" id="profile-cancel">キャンセル</button>
      <button class="btn-primary" id="profile-save">保存</button>
    </div>`;
  $('#modal-overlay').classList.remove('hidden');
  applyAvatar($('#profile-avatar'), me.avatar);
  // テーマカラー選択（即時プレビュー）
  $('#swatch-row').querySelectorAll('.swatch').forEach((b) => {
    b.onclick = () => {
      applyAccent(b.dataset.accent);
      $('#swatch-row').querySelectorAll('.swatch').forEach((x) => x.classList.toggle('active', x === b));
    };
  });

  let newImage = me.avatar?.image || null;
  let imageChanged = false;

  // 通知許可の案内
  const permBox = $('#notify-perm');
  if ('Notification' in window && Notification.permission !== 'granted') {
    permBox.innerHTML = '⚠️ ブラウザ通知が許可されていません。<a id="ask-perm">許可する</a>';
    permBox.querySelector('#ask-perm').onclick = () => Notification.requestPermission().then(() => permBox.textContent = '通知が許可されました ✅');
  }

  $('#profile-upload').onclick = () => $('#profile-file').click();
  $('#profile-file').onchange = async (e) => {
    if (!e.target.files.length) return;
    const fd = new FormData();
    fd.append('files', e.target.files[0]);
    const res = await (await api('/api/upload', { method: 'POST', body: fd })).json();
    newImage = res.files[0].url;
    imageChanged = true;
    applyAvatar($('#profile-avatar'), { image: newImage });
  };
  if ($('#profile-clear')) $('#profile-clear').onclick = () => { newImage = null; imageChanged = true; applyAvatar($('#profile-avatar'), { initial: me.avatar.initial, color: me.avatar.color }); };

  $('#profile-cancel').onclick = closeModal;
  $('#profile-logout').onclick = () => { localStorage.removeItem('token'); location.reload(); };
  $('#profile-save').onclick = async () => {
    const body = {
      name: $('#profile-name').value.trim(),
      away: document.querySelector('input[name="away"]:checked').value === '1',
      notifyPref: document.querySelector('input[name="notify"]:checked').value,
    };
    if (imageChanged) body.avatarImage = newImage || '';
    const res = await api('/api/profile', { method: 'POST', json: body });
    if (res.ok) { me = { ...me, ...(await res.json()).user }; renderMe(); closeModal(); }
    else alert((await res.json()).error || '更新に失敗しました');
  };
}

// ==================== スレッド一覧 ====================
async function showThreadsView() {
  closeThread();
  currentChannel = null;
  renderChannels();
  $('#current-channel-name').textContent = '🧵 スレッド';
  $('#current-channel-topic').textContent = '参加しているスレッド';
  const box = $('#messages');
  box.innerHTML = '<div style="padding:20px;color:#888;">読み込み中…</div>';
  const threads = await (await api('/api/threads')).json();
  box.innerHTML = '';
  if (!threads.length) { box.append(el('div', '', '<div style="padding:40px 20px;color:#888;text-align:center;">まだ参加中のスレッドはありません</div>')); return; }
  for (const m of threads) {
    const card = el('div', 'thread-card');
    const label = el('div', 'thread-card-channel', `${m.channelIsDm ? '💬 DM' : '# ' + esc(m.channelName || '')} ・ ${m.replyCount}件の返信`);
    const node = renderMessage(m, true);
    card.append(label, node);
    card.onclick = () => jumpToThread(m);
    box.append(card);
  }
}

async function jumpToThread(m) {
  const ch = channels.find((c) => c.id === m.channel_id);
  if (ch) { await selectChannel(ch); openThread(m); }
}

// ==================== DMディレクトリ ====================
function showDMDirectory() {
  closeThread();
  currentChannel = null;
  renderChannels();
  $('#current-channel-name').innerHTML = `${icon('message', 17)} ダイレクトメッセージ`;
  $('#current-channel-topic').textContent = '1対1のやりとり';
  $('#pin-btn').classList.add('hidden');
  const box = $('#messages');
  box.innerHTML = '';
  const dms = channels.filter((c) => c.is_dm);
  if (dms.length) {
    const h = el('div', 'dir-section-title', '会話');
    box.append(h);
    for (const c of dms) {
      const row = el('div', 'dir-row');
      const wrap = el('span', 'avatar-wrap');
      wrap.append(avatarNode(c.dmPeer, false), el('span', 'presence-dot sm ' + presenceClass(findUser(c.dmPeer?.id)?.presence || 'offline')));
      row.append(wrap, el('span', 'dir-name', esc(c.dmPeer?.name || 'DM')));
      row.onclick = () => selectChannel(c);
      box.append(row);
    }
  }
  const h2 = el('div', 'dir-section-title', 'メンバー（クリックでDMを開始）');
  box.append(h2);
  for (const u of users.filter((x) => x.id !== me.id)) {
    const row = el('div', 'dir-row');
    const wrap = el('span', 'avatar-wrap');
    wrap.append(avatarNode(u, false), el('span', 'presence-dot sm ' + presenceClass(u.presence)));
    row.append(wrap, el('span', 'dir-name', esc(u.name)));
    row.onclick = () => startDM(u.id);
    box.append(row);
  }
}

// ==================== ファイル一覧 ====================
async function showFilesView() {
  closeThread();
  currentChannel = null;
  renderChannels();
  $('#current-channel-name').innerHTML = `${icon('file', 17)} ファイル`;
  $('#current-channel-topic').textContent = '共有されたファイル';
  $('#pin-btn').classList.add('hidden');
  const box = $('#messages');
  box.innerHTML = '<div style="padding:20px;color:#888;">読み込み中…</div>';
  const files = await (await api('/api/files')).json();
  box.innerHTML = '';
  if (!files.length) { box.append(el('div', '', '<div style="padding:40px 20px;color:#888;text-align:center;">ファイルはまだありません</div>')); return; }
  const grid = el('div', 'files-grid');
  for (const f of files) {
    const card = el('div', 'file-card');
    const isImg = f.mimetype?.startsWith('image/');
    const thumb = el('a', 'file-thumb');
    thumb.href = withToken(f.url); thumb.target = '_blank'; thumb.rel = 'noopener';
    if (isImg) { const img = el('img'); img.src = withToken(f.url); thumb.append(img); }
    else thumb.innerHTML = icon('file', 34);
    const info = el('div', 'file-info');
    const txt = el('div', 'file-text');
    txt.innerHTML = `<div class="file-name">${esc(f.filename)}</div>
      <div class="file-sub">${esc(f.user?.name || '')}・${f.channelIsDm ? 'DM' : '# ' + esc(f.channelName || '')}</div>`;
    const dl = el('a', 'attach-dl', icon('download', 16));
    dl.href = `/api/download/${f.id}?token=${encodeURIComponent(token)}`;
    info.append(txt, dl);
    card.append(thumb, info);
    grid.append(card);
  }
  box.append(grid);
}

// ==================== ブックマーク一覧 ====================
async function showBookmarksView() {
  closeThread();
  currentChannel = null;
  renderChannels();
  $('#current-channel-name').innerHTML = `${icon('bookmark', 17)} ブックマーク`;
  $('#current-channel-topic').textContent = 'あとで読む';
  $('#pin-btn').classList.add('hidden');
  const box = $('#messages');
  box.innerHTML = '<div style="padding:20px;color:#888;">読み込み中…</div>';
  const items = await (await api('/api/bookmarks')).json();
  box.innerHTML = '';
  if (!items.length) { box.append(el('div', '', '<div style="padding:40px 20px;color:#888;text-align:center;">ブックマークはまだありません</div>')); return; }
  for (const m of items) {
    const card = el('div', 'thread-card');
    card.append(el('div', 'thread-card-channel', `${m.channelIsDm ? 'DM' : '# ' + esc(m.channelName || '')}`), renderMessage(m, true));
    card.onclick = () => { const ch = channels.find((c) => c.id === m.channel_id); if (ch) selectChannel(ch); };
    box.append(card);
  }
}

// ==================== ピン留め一覧 ====================
async function showPinnedView() {
  if (!currentChannel) return;
  const ch = currentChannel;
  closeThread();
  $('#current-channel-name').innerHTML = `${icon('pin', 17)} ピン留め`;
  $('#current-channel-topic').textContent = (ch.is_dm ? 'DM' : '# ' + ch.name) + ' のピン';
  const box = $('#messages');
  box.innerHTML = '<div style="padding:20px;color:#888;">読み込み中…</div>';
  const items = await (await api(`/api/channels/${ch.id}/pins`)).json();
  box.innerHTML = '';
  if (!items.length) { box.append(el('div', '', '<div style="padding:40px 20px;color:#888;text-align:center;">ピン留めはありません</div>')); }
  for (const m of items) {
    const card = el('div', 'thread-card');
    card.append(renderMessage(m, true));
    box.append(card);
  }
  // 戻るリンク
  const back = el('div', 'pinned-back', '← チャンネルに戻る');
  back.onclick = () => selectChannel(ch);
  box.prepend(back);
}

// ==================== 転送 ====================
function openForwardModal(m) {
  const modal = $('#modal');
  const opts = channels.map((c) => `<option value="${c.id}">${c.is_dm ? 'DM: ' + esc(c.dmPeer?.name || '') : (c.is_private ? '🔒 ' : '# ') + esc(c.name)}</option>`).join('');
  modal.innerHTML = `
    <h2>メッセージを転送</h2>
    <div class="forward-preview">${esc(m.user?.name || '')}：${esc((m.body || '📎 添付ファイル').slice(0, 120))}</div>
    <label>転送先</label>
    <select id="forward-target">${opts}</select>
    <label>ひとこと添える（任意）</label>
    <input type="text" id="forward-note" placeholder="例：これ確認お願いします" />
    <div class="modal-actions">
      <button class="btn-cancel" id="forward-cancel">キャンセル</button>
      <button class="btn-primary" id="forward-send">転送</button>
    </div>`;
  $('#modal-overlay').classList.remove('hidden');
  $('#forward-cancel').onclick = closeModal;
  $('#forward-send').onclick = () => {
    const target = $('#forward-target').value;
    const note = $('#forward-note').value.trim();
    const quoted = (m.body || '📎 添付ファイル').split('\n').map((l) => '> ' + l).join('\n');
    const body = (note ? note + '\n' : '') + `> **${m.user?.name || ''}** より転送:\n${quoted}`;
    socket.emit('message:send', { channelId: target, parentId: null, body, attachments: [] }, (resp) => {
      if (resp?.error) return alert(resp.error);
      closeModal();
      const ch = channels.find((c) => c.id === target);
      if (ch) selectChannel(ch);
      toast('転送しました');
    });
  };
}

// ==================== アクティビティ（自分宛メンション） ====================
async function showActivityView() {
  closeThread();
  currentChannel = null;
  renderChannels();
  $('#current-channel-name').textContent = '📣 アクティビティ';
  $('#current-channel-topic').textContent = 'あなたへのメンション';
  const box = $('#messages');
  box.innerHTML = '<div style="padding:20px;color:#888;">読み込み中…</div>';
  const results = await (await api(`/api/search?q=${encodeURIComponent('@' + me.name)}`)).json();
  const mine = results.filter((m) => m.mentions?.includes(me.id));
  box.innerHTML = '';
  if (!mine.length) { box.append(el('div', '', '<div style="padding:40px 20px;color:#888;text-align:center;">メンションはまだありません</div>')); return; }
  for (const m of mine) {
    const node = renderMessage(m, true);
    const label = el('div', 'search-result-channel', `# ${esc(m.channelName || '')}`);
    label.style.padding = '0 20px';
    node.querySelector('.message-body-wrap').prepend(label);
    node.onclick = () => { const ch = channels.find((c) => c.id === m.channel_id); if (ch) selectChannel(ch); };
    box.append(node);
  }
}

// ==================== 検索 ====================
let searchTimer;
let searchFilters = { channel: '', user: '' };
$('#search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (!q && !searchFilters.channel && !searchFilters.user) { if (currentChannel) selectChannel(currentChannel); return; }
  searchTimer = setTimeout(() => doSearch(q), 300);
});

async function doSearch(q) {
  currentChannel = null;
  renderChannels();
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (searchFilters.channel) params.set('channel', searchFilters.channel);
  if (searchFilters.user) params.set('user', searchFilters.user);
  const results = await (await api(`/api/search?${params.toString()}`)).json();
  $('#current-channel-name').innerHTML = `${icon('search', 17)} 検索結果`;
  $('#current-channel-topic').textContent = `${results.length}件`;
  $('#pin-btn').classList.add('hidden');
  const box = $('#messages');
  box.onscroll = null;
  box.innerHTML = '';
  // 絞り込みバー
  const chOpts = channels.filter((c) => !c.is_dm).map((c) => `<option value="${c.id}" ${searchFilters.channel === c.id ? 'selected' : ''}>#${esc(c.name)}</option>`).join('');
  const usrOpts = users.map((u) => `<option value="${u.id}" ${searchFilters.user === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  const bar = el('div', 'search-filters');
  bar.innerHTML = `<span style="font-size:13px;color:var(--text-muted)">絞り込み:</span>
    <select id="sf-channel"><option value="">全チャンネル</option>${chOpts}</select>
    <select id="sf-user"><option value="">全ユーザー</option>${usrOpts}</select>`;
  box.append(bar);
  bar.querySelector('#sf-channel').onchange = (e) => { searchFilters.channel = e.target.value; doSearch($('#search-input').value.trim()); };
  bar.querySelector('#sf-user').onchange = (e) => { searchFilters.user = e.target.value; doSearch($('#search-input').value.trim()); };

  if (!results.length) {
    box.append(el('div', '', `<div style="padding:40px 20px;color:#888;text-align:center;">見つかりませんでした</div>`));
    return;
  }
  for (const m of results) {
    const node = renderMessage(m, true);
    node.classList.add('search-jump');
    const label = el('div', 'search-result-channel', `${m.channelIsDm ? '💬 DM' : '# ' + esc(m.channelName || '')}`);
    label.style.padding = '0 20px';
    node.querySelector('.message-body-wrap').prepend(label);
    node.onclick = () => jumpToMessage(m);
    box.append(node);
  }
}

// 検索結果からメッセージへジャンプ（チャンネルを開いてハイライト）
async function jumpToMessage(m) {
  searchFilters = { channel: '', user: '' };
  $('#search-input').value = '';
  const ch = channels.find((c) => c.id === m.channel_id);
  if (!ch) return;
  await selectChannel(ch);
  const node = document.querySelector(`#messages .message[data-id="${m.id}"]`);
  if (node) {
    node.scrollIntoView({ block: 'center' });
    node.classList.add('msg-highlight');
    setTimeout(() => node.classList.remove('msg-highlight'), 2000);
  } else {
    toast('メッセージはこのチャンネルにあります（過去分は上スクロールで表示）');
  }
}

// ==================== ユーティリティ ====================
function formatSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function isOnlyEmoji(text) {
  const t = (text || '').trim();
  if (!t) return false;
  if (!/\p{Extended_Pictographic}/u.test(t)) return false;
  const stripped = t.replace(/[\p{Extended_Pictographic}️‍\s]/gu, '');
  if (stripped.length > 0) return false;
  const count = [...t.replace(/\s/g, '').matchAll(/\p{Extended_Pictographic}/gu)].length;
  return count > 0 && count <= 8;
}

function fileIcon(mimetype, filename) {
  const m = mimetype || '';
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (m.startsWith('video/')) return '🎬';
  if (m.startsWith('audio/')) return '🎵';
  if (m === 'application/pdf' || ext === 'pdf') return '📕';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['doc', 'docx'].includes(ext)) return '📘';
  if (['ppt', 'pptx'].includes(ext)) return '📙';
  if (['zip', 'rar', '7z'].includes(ext)) return '🗜️';
  return '📄';
}

function maybeNotify(channelId, message) {
  if (!message.user || message.user.id === me.id) return;
  const mentioned = message.mentions?.includes(me.id);
  if (me.notifyPref === 'none') return;
  if (me.notifyPref === 'mentions' && !mentioned) return;
  const isVisibleHere = channelId === currentChannel?.id && !document.hidden;
  if (isVisibleHere && !mentioned) return;
  const ch = channels.find((c) => c.id === channelId);
  const chLabel = ch ? (ch.is_dm ? 'DM' : (ch.is_private ? '🔒' : '#') + ch.name) : '';
  const title = `${message.user.name}${chLabel ? '・' + chLabel : ''}`;
  const bodyText = message.body || '📎 ファイルが送信されました';
  // アプリ内バナー（許可がなくても見える）
  showInAppNotice({ title, body: bodyText, mentioned, avatar: message.user.avatar, channelId });
  // ブラウザ通知（許可されている場合のみ）
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification(`${mentioned ? '📣 ' : ''}${title}`, { body: bodyText, icon: '/icon.svg', tag: channelId });
    n.onclick = () => { window.focus(); const c = channels.find((x) => x.id === channelId); if (c) selectChannel(c); n.close(); };
  }
}

// アプリ内通知バナー（右上に積む）
function showInAppNotice({ title, body, mentioned, avatar, channelId }) {
  let stack = $('#notice-stack');
  if (!stack) { stack = el('div', 'notice-stack'); stack.id = 'notice-stack'; document.body.append(stack); }
  const card = el('div', 'notice-card' + (mentioned ? ' mention' : ''));
  const av = el('div', 'avatar sm');
  applyAvatar(av, avatar);
  const txt = el('div', 'notice-text');
  txt.innerHTML = `<div class="notice-title">${mentioned ? '📣 ' : ''}${esc(title)}</div><div class="notice-body">${esc(body.slice(0, 90))}</div>`;
  const close = el('button', 'notice-close', icon('x', 14));
  close.onclick = (e) => { e.stopPropagation(); card.remove(); };
  card.append(av, txt, close);
  card.onclick = () => { const c = channels.find((x) => x.id === channelId); if (c) selectChannel(c); card.remove(); };
  stack.append(card);
  setTimeout(() => card.classList.add('show'), 10);
  setTimeout(() => { card.classList.remove('show'); setTimeout(() => card.remove(), 300); }, 6000);
}
