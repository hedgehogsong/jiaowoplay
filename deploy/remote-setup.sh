#!/usr/bin/env bash
#
# 交我PLAY 服务器端初始化脚本（由 deploy/deploy.sh 通过 tar over ssh 上传后执行，也可手工跑）
#
# 职责：准备运行用户与目录 → 清理旧前端产物 → 安装生产依赖 → 校验原生模块 → 生成 .env
#       → 安装并启动 systemd 服务 → 自检
# 幂等：可重复执行；已存在的 .env 不会被覆盖。
#
# 环境变量：
#   PUBLIC_ORIGIN  必填，公网访问地址（写入 CORS_ORIGIN），如 https://play.example.com
#   NODE_DIR       Node 运行时目录，默认 /opt/node-v24.22.2
#   APP_DIR        应用目录，默认 /opt/jiaowoplay
#   PORT           后端监听端口，默认 3000
#   LOG_LEVEL      日志级别，默认 info
#
# 注意：SESSION_SECRET 只在本机生成并写入 .env，脚本不会打印它。

set -euo pipefail

PUBLIC_ORIGIN="${PUBLIC_ORIGIN:?必须提供 PUBLIC_ORIGIN，例如 PUBLIC_ORIGIN=https://play.example.com}"
NODE_DIR="${NODE_DIR:-/opt/node-v24.22.2}"
APP_DIR="${APP_DIR:-/opt/jiaowoplay}"
PORT="${PORT:-3000}"
LOG_LEVEL="${LOG_LEVEL:-info}"
APP_USER=jiaowoplay

# npm 的 shebang 是 #!/usr/bin/env node，因此必须把 node 目录放进 PATH
export PATH="$NODE_DIR/bin:$PATH"

NODE_BIN="$NODE_DIR/bin/node"
NPM_BIN="$NODE_DIR/bin/npm"

command -v "$NODE_BIN" >/dev/null 2>&1 || { echo "找不到 $NODE_BIN，请先安装 Node 运行时" >&2; exit 1; }
[ -d "$APP_DIR/deploy" ] || { echo "应用目录 $APP_DIR 里没有 deploy/，请先上传产物" >&2; exit 1; }

echo "== [1/7] 准备运行用户与目录 =="
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi
mkdir -p "$APP_DIR/server/data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 750 "$APP_DIR"

cd "$APP_DIR"

echo "== [2/7] 清理前端旧构建产物 =="
# 上传用 tar 覆盖式解包，不会删掉上一版遗留的哈希文件，日积月累会白占空间。
# 以 index.html 实际引用的资源为准，assets 里其余文件视为过期产物。
if [ -f web/dist/index.html ] && [ -d web/dist/assets ]; then
  referenced="$(grep -oE 'assets/[A-Za-z0-9._-]+' web/dist/index.html | sort -u || true)"
  if [ -n "$referenced" ]; then
    removed=0
    for file in web/dist/assets/*; do
      [ -e "$file" ] || continue
      name="assets/$(basename "$file")"
      if ! printf '%s\n' "$referenced" | grep -qxF "$name"; then
        rm -f "$file"
        removed=$((removed + 1))
      fi
    done
    echo "已清理 $removed 个过期前端产物，保留 $(printf '%s\n' "$referenced" | grep -c . ) 个"
  else
    echo "index.html 没有引用任何 assets，跳过清理以免误删全部产物"
  fi
else
  echo "未启用前端静态托管或无 assets 目录，跳过"
fi

echo "== [3/7] 安装生产依赖（产物已在本机构建，服务器不执行构建） =="
"$NPM_BIN" ci --omit=dev --no-audit --no-fund

echo "== [4/7] 校验 better-sqlite3 原生绑定 =="
"$NODE_BIN" -e "const D=require('better-sqlite3');const d=new D(':memory:');d.exec('create table t(a int)');console.log('sqlite binding OK')"
"$NODE_BIN" -e "console.log('express/socket.io OK', require('express/package.json').version, require('socket.io/package.json').version)"

echo "== [5/7] 生成 .env（密钥只在本机生成，不打印） =="
if [ ! -f .env ]; then
  SECRET="$(openssl rand -hex 32)"
  umask 077
  {
    echo "NODE_ENV=production"
    echo "PORT=$PORT"
    echo "HOST=127.0.0.1"
    echo "DB_PATH=$APP_DIR/server/data/jiaowoplay.sqlite"
    echo "SESSION_SECRET=$SECRET"
    echo "CORS_ORIGIN=$PUBLIC_ORIGIN"
    echo "STATIC_DIR=$APP_DIR/web/dist"
    echo "LOG_LEVEL=$LOG_LEVEL"
  } > .env
  unset SECRET
  chmod 600 .env
  echo ".env 已生成（权限 600）"
else
  echo ".env 已存在，保持不变"
fi
chown "$APP_USER:$APP_USER" .env

echo "== [6/7] 安装 systemd 服务 =="
sed -e "s|__NODE_BIN__|$NODE_BIN|g" -e "s|__APP_DIR__|$APP_DIR|g" \
  deploy/jiaowoplay.service.example > /etc/systemd/system/jiaowoplay.service
systemctl daemon-reload
systemctl enable jiaowoplay >/dev/null 2>&1 || true
systemctl restart jiaowoplay

echo "== [7/7] 启动自检 =="
sleep 3
systemctl is-active jiaowoplay
curl -fsS "http://127.0.0.1:$PORT/health"
echo
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
echo "REMOTE_SETUP_DONE"
