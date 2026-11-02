#!/usr/bin/env bash
#
# 交我PLAY 部署脚本
#
# 凭据只通过环境变量或交互输入提供，绝不写入仓库、日志或提交记录。
# 部署完成后请立即修改临时密码，或改用 SSH key 登录。
#
# 用法示例：
#   JWP_HOST=deploy@203.0.113.10 ./deploy/deploy.sh
#   JWP_HOST=deploy@203.0.113.10 JWP_DOMAIN=play.example.com JWP_SESSION_SECRET="$(openssl rand -hex 32)" ./deploy/deploy.sh
#
# 可选环境变量：
#   JWP_PORT           SSH 端口，默认 22
#   JWP_REMOTE_DIR     服务器部署目录，默认 /opt/jiaowoplay
#   JWP_DOMAIN         对外域名；提供时会自动安装 Nginx 配置
#   JWP_SESSION_SECRET 会话密钥；不提供时脚本会在服务器上随机生成
#   JWP_SSH_PASSWORD   SSH 密码（仅当安装了 sshpass 时生效）；强烈建议改用 key/agent

set -euo pipefail

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

command -v rsync >/dev/null 2>&1 || die "本地需要 rsync"
command -v ssh   >/dev/null 2>&1 || die "本地需要 ssh"

: "${JWP_HOST:?请设置 JWP_HOST，例如 deploy@203.0.113.10}"
JWP_PORT="${JWP_PORT:-22}"
JWP_REMOTE_DIR="${JWP_REMOTE_DIR:-/opt/jiaowoplay}"
JWP_DOMAIN="${JWP_DOMAIN:-}"

SSH_CMD=(ssh -p "$JWP_PORT" -o ConnectTimeout=15)
if [[ -n "${JWP_SSH_PASSWORD:-}" ]]; then
  command -v sshpass >/dev/null 2>&1 || die "设置了 JWP_SSH_PASSWORD 但未安装 sshpass；建议改用 SSH key"
  SSH_CMD=(sshpass -e ssh -p "$JWP_PORT" -o ConnectTimeout=15 -o StrictHostKeyChecking=accept-new)
  export SSHPASS="$JWP_SSH_PASSWORD"
  warn "使用密码登录；部署完成后请改用 SSH key 并修改该密码"
fi

run_remote() { "${SSH_CMD[@]}" "$JWP_HOST" "$@"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log "本地自检：运行测试"
npm run test

log "本地构建 shared / server / web"
npm run build

log "同步源码到 ${JWP_HOST}:${JWP_REMOTE_DIR}"
run_remote "mkdir -p '${JWP_REMOTE_DIR}'"
rsync -az --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'server/data' \
  --exclude 'server/dist' \
  --exclude 'web/dist' \
  --exclude 'shared/dist' \
  -e "ssh -p ${JWP_PORT}" \
  ./ "${JWP_HOST}:${JWP_REMOTE_DIR}/"

log "服务器端安装依赖并构建"
run_remote "cd '${JWP_REMOTE_DIR}' && npm ci --no-audit --no-fund && npm run build"

log "生成/更新服务器 .env"
run_remote bash -s <<REMOTE_ENV
set -euo pipefail
cd '${JWP_REMOTE_DIR}'
if [[ ! -f .env ]]; then
  SECRET='${JWP_SESSION_SECRET:-}'
  if [[ -z "\$SECRET" ]]; then
    SECRET="\$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  DOMAIN='${JWP_DOMAIN}'
  CORS="http://localhost:5173"
  [[ -n "\$DOMAIN" ]] && CORS="https://\${DOMAIN},http://\${DOMAIN}"
  {
    echo "NODE_ENV=production"
    echo "PORT=3000"
    echo "HOST=127.0.0.1"
    echo "DB_PATH=${JWP_REMOTE_DIR}/server/data/jiaowoplay.sqlite"
    echo "SESSION_SECRET=\$SECRET"
    echo "CORS_ORIGIN=\$CORS"
    echo "STATIC_DIR=${JWP_REMOTE_DIR}/web/dist"
    echo "LOG_LEVEL=info"
  } > .env
  chmod 600 .env
  echo ".env 已生成（权限 600）"
else
  echo ".env 已存在，保持不变"
fi
REMOTE_ENV

log "重启应用进程（PM2，若不存在则回退 systemd）"
run_remote bash -s <<REMOTE_RUN
set -euo pipefail
cd '${JWP_REMOTE_DIR}'
if command -v pm2 >/dev/null 2>&1; then
  cp -f deploy/ecosystem.config.cjs.example ecosystem.config.cjs 2>/dev/null || true
  if pm2 describe jiaowoplay >/dev/null 2>&1; then
    pm2 reload ecosystem.config.cjs --update-env
  else
    pm2 start ecosystem.config.cjs
  fi
  pm2 save
elif systemctl list-unit-files jiaowoplay.service >/dev/null 2>&1; then
  sudo systemctl restart jiaowoplay
else
  echo "未检测到 PM2 或 systemd 服务；请手动启动：npm run start" >&2
  exit 1
fi
REMOTE_RUN

if [[ -n "$JWP_DOMAIN" ]]; then
  log "安装 Nginx 配置（域名 ${JWP_DOMAIN}）"
  run_remote bash -s <<REMOTE_NGINX
set -euo pipefail
cd '${JWP_REMOTE_DIR}'
sed "s/__DOMAIN__/${JWP_DOMAIN}/g" deploy/nginx.conf.example > /tmp/jiaowoplay.conf
sudo cp /tmp/jiaowoplay.conf /etc/nginx/conf.d/jiaowoplay.conf
sudo nginx -t && sudo systemctl reload nginx
echo "Nginx 已重载"
REMOTE_NGINX
else
  warn "未设置 JWP_DOMAIN，跳过 Nginx 配置；请自行反代 127.0.0.1:3000 并开启 WebSocket upgrade"
fi

log "健康检查"
run_remote "curl -fsS http://127.0.0.1:3000/health || exit 1"

log "部署完成。若本次使用了密码登录，请尽快改为 SSH key 并修改密码。"
