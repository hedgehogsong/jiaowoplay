#!/usr/bin/env bash
#
# 交我PLAY 部署脚本
#
# 流程：本地测试与构建 → tar over ssh 上传产物 → 服务器 npm ci --omit=dev + systemd 启动
#       → 可选安装 Nginx 反代（含 WebSocket upgrade）→ 健康检查
#
# 凭据与公网地址只通过环境变量或交互输入提供，绝不写入仓库、日志或提交记录。
#
# 用法：
#   JWP_HOST=deploy@203.0.113.10 JWP_ORIGIN=https://play.example.com ./deploy/deploy.sh
#   JWP_HOST=my-alias JWP_ORIGIN=http://203.0.113.10 JWP_DOMAIN=203.0.113.10 ./deploy/deploy.sh
#
# 环境变量：
#   JWP_HOST      必填，ssh 目标（user@host 或 ~/.ssh/config 里的别名）
#   JWP_ORIGIN    必填，公网访问地址，写入服务器 .env 的 CORS_ORIGIN
#   JWP_PORT      SSH 端口，默认 22
#   JWP_APP_DIR   应用目录，默认 /opt/jiaowoplay
#   JWP_NODE_DIR  Node 运行时目录，默认 /opt/node-v24.22.2
#   JWP_DOMAIN    提供时自动安装 Nginx 站点（server_name 用它）
#   JWP_SKIP_TEST 设为 1 时跳过本地测试（不建议）
#
# 服务器前置要求：root 或可 sudo；已存在 $JWP_NODE_DIR/bin/node（见 README 第 6 节）。
# 服务器不需要 rsync —— 本脚本用 tar over ssh。

set -euo pipefail

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

: "${JWP_HOST:?请设置 JWP_HOST，例如 JWP_HOST=deploy@203.0.113.10}"
: "${JWP_ORIGIN:?请设置 JWP_ORIGIN（公网访问地址，用于 CORS_ORIGIN）}"
JWP_PORT="${JWP_PORT:-22}"
JWP_APP_DIR="${JWP_APP_DIR:-/opt/jiaowoplay}"
JWP_NODE_DIR="${JWP_NODE_DIR:-/opt/node-v24.22.2}"
JWP_DOMAIN="${JWP_DOMAIN:-}"

command -v ssh >/dev/null 2>&1 || die "本地需要 ssh"
command -v tar >/dev/null 2>&1 || die "本地需要 tar"

SSH=(ssh -p "$JWP_PORT" -o ConnectTimeout=20 -o BatchMode=yes "$JWP_HOST")

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ "${JWP_SKIP_TEST:-0}" = "1" ]; then
  warn "已跳过本地测试"
else
  log "本地测试"
  npm test
fi

log "本地构建 shared / server / web"
npm run build

log "上传产物到 ${JWP_HOST}:${JWP_APP_DIR} 并执行服务器初始化"
"${SSH[@]}" "mkdir -p '$JWP_APP_DIR'"

# 单条连接内完成：传 tar 包 → 解包 → 跑服务器端脚本
tar czf - \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=server/data \
  --exclude='*.sqlite' --exclude='*.sqlite-wal' --exclude='*.sqlite-shm' \
  --exclude=.env --exclude='.env.*' \
  -C "$REPO_ROOT" . \
  | "${SSH[@]}" "tar xzf - -C '$JWP_APP_DIR' && PUBLIC_ORIGIN='$JWP_ORIGIN' NODE_DIR='$JWP_NODE_DIR' APP_DIR='$JWP_APP_DIR' bash '$JWP_APP_DIR/deploy/remote-setup.sh'"

if [ -n "$JWP_DOMAIN" ]; then
  log "安装 Nginx 站点（server_name ${JWP_DOMAIN}）"
  "${SSH[@]}" "set -e
    ts=\$(date +%Y%m%d-%H%M%S)
    mkdir -p /root/jiaowoplay-backup
    tar czf /root/jiaowoplay-backup/nginx-\$ts.tar.gz -C / etc/nginx
    sed 's/__DOMAIN__/$JWP_DOMAIN/g' '$JWP_APP_DIR/deploy/nginx.conf.example' > /etc/nginx/conf.d/jiaowoplay.conf
    rm -f /etc/nginx/sites-enabled/default
    nginx -t && systemctl reload nginx
    echo 'nginx 已重载'"
else
  warn "未设置 JWP_DOMAIN，跳过 Nginx；请自行反代 127.0.0.1:3000 并透传 WebSocket Upgrade 头"
fi

log "健康检查"
"${SSH[@]}" "curl -fsS http://127.0.0.1:3000/health && echo && systemctl is-active jiaowoplay"

log "部署完成。日志：journalctl -u jiaowoplay -f   重启：systemctl restart jiaowoplay"
