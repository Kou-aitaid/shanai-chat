# 社内チャット

社内向けのSlackライクなコミュニケーションツール（テキストチャット）。

## 主な機能
- メール＋パスワードのログイン（`@aitaid.co.jp` 限定）
- チャンネル / プライベートグループ / DM（1対1）
- リアルタイムメッセージ、スレッド返信、既読表示
- 画像・ファイル添付、絵文字リアクション、@メンション、通知
- メッセージ編集・削除、ピン留め、ブックマーク、検索、転送
- リッチテキスト（太字・斜体・コード等）、ダークモード
- 左アイコンレール（ホーム / DM / アクティビティ / ファイル）
- PWA対応（各自の端末にアプリとしてインストール可能）

## 技術構成
- サーバー: Node.js + Express + Socket.IO
- DB: SQLite（better-sqlite3）
- フロント: バニラJS（ビルド不要）

## 起動方法
```bash
npm install
npm start
# http://localhost:3000
```

## 環境変数
- `PORT`（省略時 3000）
- `DATA_DIR`（省略時はプロジェクト直下。`data.db` と `uploads/` の保存先）

## 注意
- `data.db`（会話ログ）と `uploads/`（添付ファイル）は Git 管理外です。
- 本番運用ではデータを永続化できるホスティング／ディスクを利用してください。

## 本番環境（現在の稼働状況）

**公開URL:** https://aitaid-chat.duckdns.org

### 仕組み
Oracle Cloud の無料VM上にアプリ本体を常駐（systemd）させ、DuckDNSで名前解決、Caddyが自動HTTPS化とリバースプロキシを行っている。

```
ブラウザ → https://aitaid-chat.duckdns.org
        → DuckDNS が実IPに変換
        → Oracle Cloud VM の 443番ポート（Caddy）
        → Caddy が 3001番ポート（アプリ本体）へ橋渡し
```

詳しいデプロイ手順は [`deploy/README.md`](deploy/README.md) を参照。

### アクセスできる人
- URL自体（ログイン画面）はインターネット上の誰でも開ける（社内限定ネットワークではない）
- ただし新規登録は **`@aitaid.co.jp` のメールアドレスのみ**（サーバー側で強制）
- ログインには各自のパスワードが必要（bcryptでハッシュ化して保存。平文は保持しない）

### データの保管場所とセキュリティ
- 会話ログ・アカウント情報・添付ファイルは **Oracle Cloud VM（大阪リージョン）のディスク**（`/opt/shanai-chat-data`）に保存
- 開発者のローカルPCやAnthropic側にはデータは残らない
- 通信はHTTPS（Let's Encrypt証明書、Caddyが自動更新）で暗号化
- ⚠️ **現状、自動バックアップは未設定**。VM/ディスク障害時のデータ消失リスクがある（必要なら追加対応）

### 費用
- Oracle Cloud Always Free枠のみ使用（VM・ディスク・パブリックIP）のため **月額0円**
- DuckDNS・Let's Encryptも無料
- Oracle側で予算アラート（$1・80%閾値）を設定済み

### 更新方法（コード修正の反映）
```bash
ssh -i <秘密鍵> ubuntu@<VMのIP>
cd /opt/shanai-chat && git pull && npm install --omit=dev && sudo systemctl restart shanai-chat
```
サーバー再起動は数秒で完了し、クライアントは自動で再接続・取りこぼしメッセージを補完する。
