# 無料クラウドVMへのデプロイ手順（Mac非依存・永年無料）

あなたのMacから完全に切り離し、**URL固定・24時間稼働・データ保持**にする手順です。
費用は0円（本人確認でクレカ登録は必要ですが、Always Free枠なので請求は発生しません）。

全体像：**無料VM（Oracle Cloud）** の上で、**HTTPS付きの固定URL（DuckDNS + Caddy）** でアプリを常駐させます。

---

## STEP 1. 無料VMを作る（Oracle Cloud Always Free / 東京リージョン）
1. https://www.oracle.com/jp/cloud/free/ →「無料で始める」でアカウント作成（クレカは本人確認用・請求なし）
2. リージョンは **Japan East (Tokyo)** を選択
3. 「インスタンスの作成」→ イメージ **Canonical Ubuntu 22.04** / シェイプ **Always Free 対象**（`VM.Standard.A1.Flex` か `VM.Standard.E2.1.Micro`）
4. SSHキーは「キーペアを自動生成」→ **秘密鍵をダウンロード**（後でSSHに使う）
5. 作成後、**パブリックIPアドレス**を控える

## STEP 2. ポート開放（重要・つまずきポイント）
Oracleは二重にファイアウォールがあります。両方で **80番・443番** を開けます。
1. VMの「サブネット」→「セキュリティリスト」→ イングレス規則を追加：
   - ソース `0.0.0.0/0` / TCP / ポート **80**
   - ソース `0.0.0.0/0` / TCP / ポート **443**
2. VMにSSH接続後、OS側でも開放：
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save 2>/dev/null || sudo bash -c 'iptables-save > /etc/iptables/rules.v4'
   ```

## STEP 3. 無料の固定サブドメイン（DuckDNS）
1. https://www.duckdns.org/ にアクセス → GitHub/Googleでログイン
2. 好きなサブドメインを作成（例：`aitaid-chat` → `aitaid-chat.duckdns.org`）
3. ページ上部の **token** を控える

## STEP 4. コード取得用のGitHubトークン
1. GitHub → Settings → Developer settings → **Personal access tokens (Fine-grained)** → Generate
2. Repository access: `Kou-aitaid/shanai-chat` のみ / Permissions: **Contents = Read-only**
3. 生成された **トークン**を控える

## STEP 5. セットアップ実行（VMにSSHして1コマンド）
SSH接続後、以下を実行（`<>` は自分の値に置き換え）：
```bash
curl -fsSL https://raw.githubusercontent.com/Kou-aitaid/shanai-chat/main/deploy/setup.sh -o setup.sh
# ↑ privateなので落ちる場合は、下の「手動取得」を使う
bash setup.sh <DuckDNSサブドメイン> <DuckDNSトークン> <GitHubトークン>
```
※ privateリポジトリでcurlが403になる場合の手動取得：
```bash
GH=<GitHubトークン>
git clone https://$GH@github.com/Kou-aitaid/shanai-chat.git /tmp/sc
bash /tmp/sc/deploy/setup.sh <DuckDNSサブドメイン> <DuckDNSトークン> $GH
```

数十秒後、**`https://<サブドメイン>.duckdns.org`** で全員がアクセスできます。
このURLは固定で、Macを消しても、VMを再起動しても変わりません。

---

## 日々の運用
- **コード更新の反映**（私が修正してpushしたあと）：
  ```bash
  cd /opt/shanai-chat && git pull && npm install --omit=dev && sudo systemctl restart shanai-chat
  ```
- **状態確認**： `sudo systemctl status shanai-chat`
- **ログ**： `journalctl -u shanai-chat -f`
- **データの場所**： `/opt/shanai-chat-data`（`data.db` と `uploads/`。VM再起動でも消えません）

## PWA（アプリ化）
固定URLになったので、各自Chromeで開いて「アプリをインストール」すればDockに常駐アプリとして追加できます。
