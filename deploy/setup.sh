#!/bin/bash
# ============================================================
# 社内チャット クラウドVMセットアップ（Ubuntu 22.04 / 24.04 用）
# 使い方:
#   bash setup.sh <DuckDNSサブドメイン> <DuckDNSトークン> <GitHubトークン>
# 例:
#   bash setup.sh aitaid-chat 12345678-xxxx-xxxx xxxxghp_token
# ============================================================
set -e

SUBDOMAIN="$1"; DUCK_TOKEN="$2"; GH_TOKEN="$3"
if [ -z "$SUBDOMAIN" ] || [ -z "$DUCK_TOKEN" ] || [ -z "$GH_TOKEN" ]; then
  echo "使い方: bash setup.sh <DuckDNSサブドメイン> <DuckDNSトークン> <GitHubトークン>"; exit 1
fi
DOMAIN="${SUBDOMAIN}.duckdns.org"
APP_DIR="/opt/shanai-chat"
DATA_DIR="/opt/shanai-chat-data"
REPO="github.com/Kou-aitaid/shanai-chat.git"

echo "==> 1/6 パッケージ更新 & Node.js 20 & git 導入"
sudo apt-get update -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git curl cron

echo "==> 2/6 Caddy（自動HTTPS）導入"
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo apt-get update -y
sudo apt-get install -y caddy

echo "==> 3/6 DuckDNS を このVMのIP に向ける（5分毎に自動更新）"
mkdir -p "$HOME/duckdns"
echo "curl -s \"https://www.duckdns.org/update?domains=${SUBDOMAIN}&token=${DUCK_TOKEN}&ip=\" >/dev/null" > "$HOME/duckdns/duck.sh"
chmod +x "$HOME/duckdns/duck.sh"
bash "$HOME/duckdns/duck.sh"
( crontab -l 2>/dev/null | grep -v duckdns; echo "*/5 * * * * $HOME/duckdns/duck.sh" ) | crontab -

echo "==> 4/6 アプリ取得 & 依存インストール"
sudo mkdir -p "$DATA_DIR"; sudo chown "$USER" "$DATA_DIR"
if [ -d "$APP_DIR/.git" ]; then
  sudo git -C "$APP_DIR" pull
else
  sudo rm -rf "$APP_DIR"
  sudo git clone "https://${GH_TOKEN}@${REPO}" "$APP_DIR"
fi
sudo chown -R "$USER" "$APP_DIR"
cd "$APP_DIR"
npm install --omit=dev

echo "==> 5/6 常駐サービス（自動起動・自動再起動）設定"
NODE_BIN="$(which node)"
sudo tee /etc/systemd/system/shanai-chat.service >/dev/null <<EOF
[Unit]
Description=Shanai Chat
After=network.target
[Service]
Environment=PORT=3001
Environment=DATA_DIR=${DATA_DIR}
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} server/index.js
Restart=always
RestartSec=3
User=${USER}
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now shanai-chat

echo "==> 6/6 HTTPSリバースプロキシ設定"
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
${DOMAIN} {
  reverse_proxy localhost:3001
}
EOF
sudo systemctl restart caddy

echo ""
echo "============================================================"
echo " 完了！ 数十秒でHTTPS証明書が発行されます。"
echo " 公開URL:  https://${DOMAIN}"
echo "============================================================"
echo " 更新したい時（コード更新の反映）:"
echo "   cd ${APP_DIR} && git pull && npm install --omit=dev && sudo systemctl restart shanai-chat"
