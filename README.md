# 交我PLAY

线上小游戏聚合平台。无需注册：设置昵称即可创建/加入房间，房间内实时对战。
首个游戏为**同词相『交』**，架构上通过 `GameDefinition` 接口预留了更多小游戏的扩展位。

- 后端：Node.js + TypeScript + Express + Socket.IO，房间状态保存在服务端内存
- 前端：React + Vite + TypeScript，纯 CSS（无 UI 框架）
- 持久化：SQLite（better-sqlite3），保存对局 / 轮次 / 提交历史
- 部署：Nginx 反向代理（含 WebSocket upgrade）+ PM2 或 systemd

---

## 1. 本地启动

要求：Node.js >= 20.11（推荐 22/24 LTS）。

```bash
npm install

# npm 11+ 默认拦截依赖的安装脚本，需要放行这两个（否则 esbuild / better-sqlite3 不可用）
npm install-scripts approve better-sqlite3 esbuild
npm install          # 再跑一次，执行被放行的安装脚本

cp .env.example .env # 按需修改；本地开发可不改

npm run dev          # 后端 http://127.0.0.1:3000，前端 http://localhost:5173
```

打开 `http://localhost:5173` 即可。前端通过 Vite 代理访问 `/api` 与 `/socket.io`，开发期无需配置跨域。

**两个玩家怎么测**：同一浏览器的两个标签页即可（身份按标签页隔离保存）；
或用两个不同的浏览器 / 无痕窗口。单窗口 + 一个脚本客户端也可以自行扩展。

### npm scripts

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动后端（tsx watch）与前端（Vite） |
| `npm run build` | 依次构建 shared → server → web |
| `npm start` | 以生产模式运行已构建的后端（需先 build，并可设 `STATIC_DIR` 托管前端） |
| `npm test` | 运行服务端全部测试（vitest） |
| `npm run typecheck` | 全仓库类型检查 |

---

## 2. 环境变量

复制 `.env.example` 为 `.env`。**切勿把真实密钥提交到仓库。**

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | HTTP / Socket.IO 端口 |
| `HOST` | `127.0.0.1` | 监听地址；生产保持 127.0.0.1 由 Nginx 反代 |
| `NODE_ENV` | `development` | `production` 时收紧 CORS、启用 trust proxy |
| `DB_PATH` | `./data/jiaowoplay.sqlite` | SQLite 文件路径（相对 server 目录） |
| `SESSION_SECRET` | 空 | 生产必须设为随机长串：`openssl rand -hex 32` |
| `CORS_ORIGIN` | Vite 本地地址 | 允许的浏览器来源，逗号分隔 |
| `STATIC_DIR` | 空 | 设置后由 Express 直接托管该目录（前端构建产物） |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `ADMIN_USER` | 空 | 后台管理员账号。留空或仍为占位符则后台禁用 |
| `ADMIN_PASS` | 空 | 后台管理员密码。**只在服务器上填写，切勿提交** |
| `ADMIN_JWT_SECRET` | 空 | 后台 Token 签名密钥，与 `SESSION_SECRET` 分开；`openssl rand -hex 32` |
| `ADMIN_TOKEN_TTL_SECONDS` | `604800` | 登录态有效期（秒），默认 7 天 |

日志不会打印 `reconnectToken`、密码等敏感字段；后台登录只记录尝试的账号与来源 IP。

`ADMIN_USER` / `ADMIN_PASS` / `ADMIN_JWT_SECRET` **任意一项缺失或仍是 `.env.example` 里的占位符**，
`/api/admin/*` 一律返回 503，不会拿占位符当口令放行。

---

## 3. 测试

```bash
npm test
```

覆盖内容：

- `server/test/sameword.rules.test.ts`：两人同词、多人全员同词、局部同词不结束、超时弃权、轮次上限平局、可判定人数不足、上一轮关联词提炼
- `server/test/room.test.ts`：开局校验、提交/揭晓时序、重复提交、非活跃玩家、强制结束、再来一局、离开与房主转移、房间回收
- `server/test/manager.test.ts`：房间号生成、昵称唯一、满员、重连令牌、巡检回收
- `server/test/abandoned.test.ts`：流局写库与启动对账、前后台读取隔离、回收/关闭收尾、真实启动路径
- `server/test/integration.test.ts`：REST + Socket.IO 端到端（重连、开局、提交、揭晓、胜利、历史落库、错误码）

---

## 4. 游戏规则（同词相『交』）

1. 房主开局后，房间内**所有在线玩家**进入第一轮；开局后加入者进等待区，下一局自动加入。
2. 每轮每人提交一个词（1–20 字符，禁止纯空白/控制字符）。提交前互相不可见，全员提交后统一揭晓，展示 5 秒后自动进入下一轮。
3. 第一轮自由输入；从第二轮起，你的词需要**同时关联上一轮所有已揭晓词**（主观关联，系统不校验语义）。
4. 全员提交词去首尾空格后完全一致 → 全员相遇，本局胜利，记录总轮次与每轮词。
5. 仅部分人同词 → 不结束，揭晓区标记「局部相遇：A 与 B」并写入历史，进入下一轮。
6. 每轮默认 120 秒；超时未提交记为弃权，不参与本轮判定。可判定人数 < 2 → 本局按人数不足平局。
7. 默认最多 20 轮；用尽仍无全员同词 → 平局。房主可随时强制结束或「再来一局」。
8. 房主离开/掉线超过宽限期 → 自动转移给最早加入且在线的成员。
9. 房间号 6 位（大写字母+数字，排除 0/O/1/I）；昵称 2–12 字符且房间内唯一。
10. 房间被回收（全员离线 90s 等）或进程退出时若还有没打完的对局，该局记为
    **中途流局/全员流失**（`ABANDONED`）并写入结束时间，进行中的那一轮标记为废弃；
    已提交的词仍保留在库中，但按「未揭晓」处理，不会出现在前台历史里。
    服务启动时会把库里遗留的进行中对局统一补成这个终态，不会留下永久 `active` 的僵尸局。

---

## 5. 接口与事件协议

### REST

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查（含房间/玩家计数、数据库状态） |
| POST | `/api/rooms` | 创建房间，返回 `code` / `playerId` / `reconnectToken` |
| POST | `/api/rooms/:code/join` | 加入房间，返回同上 |
| GET | `/api/rooms/:code` | 房间公开信息（不含玩家明细） |
| GET | `/api/rooms/:code/history` | 该房间历史对局 |
| GET | `/api/sessions/:id` | 单局完整历史（每轮每人提交词，**不含尚未揭晓的轮次**） |
| GET | `/api/games` | 已注册游戏列表 |

创建/加入接口有每 IP 每分钟 20 次的限流，防止房间号爆破。

### Socket.IO

client → server：`createRoom` `joinRoom` `reconnectRoom` `setNickname` `leaveRoom`
`requestRoomState` `startGame` `submitWord` `forceEndGame` `restartGame` `nextRound`

server → client：`roomState` `reconnected` `playerJoined` `playerLeft` `playerOnline`
`hostTransferred` `gameStarted` `roundStarted` `submissionAccepted` `roundRevealed` `gameEnded` `error`

所有事件负载经 zod 校验；失败通过 ack 或 `error` 事件返回 `{code, message, field?}`。
服务端是唯一权威状态源，客户端只渲染按视角裁剪后的 `roomState`
（未揭晓轮次的提交内容绝不下发）。

### 扩展新游戏

后端：

1. 在 `shared/src/types.ts` 的 `GameType` 中加类型；
2. 实现 `server/src/games/Game.ts` 的 `GameDefinition`；
3. 在 `server/src/games/registry.ts` 中 `registerGame(...)`。

房间状态机、成员管理、重连、持久化均可复用，无需改动。

前端只需两步，路由不用改：

1. 写一个游戏面板组件（参考 `web/src/components/games/sameword/GamePanel.tsx`，
   它接收 `GamePanelProps`：`room / selfId / serverOffset / busy / title / onSubmit`）；
2. 在 `web/src/games/registry.ts` 的 `GAMES` 里加一条，填 `slug`、`gameType`、
   卡片文案与 `panel`。

`GAMES` 是平台首页卡片、`/play/:slug` 大厅页、房间页面板选择的唯一来源：
首页会自动多出这张卡片，`/play/<新slug>` 自动可用，房间页按服务端返回的
`room.gameType` 自动挑对应面板。

### 前端路由

| 路径 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 平台首页 | 平台介绍 + 游戏卡片列表 |
| `/play/:slug` | 游戏大厅 | 设昵称、创建/加入房间、玩法介绍 |
| `/room/:code` | 房间页 | 成员、房主控制、对局面板 |
| 其它 | 404 | |

---

## 6. 生产构建与部署

```bash
npm run build     # 产出 shared/dist、server/dist、web/dist
```

### 服务器首次准备（一次性）

`deploy.sh` 只负责发布，不安装运行时：

```bash
apt-get install -y nginx
# Node 官方 tarball：免改 apt 源、免动 PATH，回滚只需删目录
curl -fsSL -o /tmp/node.tar.xz https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.xz
tar xJf /tmp/node.tar.xz -C /opt && mv /opt/node-v24.22.2-linux-x64 /opt/node-v24.22.2
useradd --system --home-dir /opt/jiaowoplay --shell /usr/sbin/nologin jiaowoplay
```

### 方式 A：deploy.sh（推荐）

凭据与公网地址只通过环境变量提供，脚本不会把任何密钥写进仓库、日志或提交记录。

```bash
JWP_HOST=deploy@你的服务器IP \
JWP_ORIGIN=https://play.example.com \
JWP_DOMAIN=play.example.com \
./deploy/deploy.sh
```

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `JWP_HOST` | 是 | ssh 目标（`user@host` 或 `~/.ssh/config` 里的别名） |
| `JWP_ORIGIN` | 是 | 公网访问地址，写入服务器 `.env` 的 `CORS_ORIGIN` |
| `JWP_DOMAIN` | 否 | 提供时自动安装并 reload Nginx 站点 |
| `JWP_APP_DIR` | 否 | 应用目录，默认 `/opt/jiaowoplay` |
| `JWP_NODE_DIR` | 否 | Node 运行时目录，默认 `/opt/node-v24.22.2` |
| `JWP_PORT` | 否 | SSH 端口，默认 22 |
| `JWP_SKIP_TEST` | 否 | 设为 `1` 跳过本地测试（不建议） |

流程：本地 `npm test` + `npm run build` → **tar over ssh** 上传产物（服务器不需要 rsync）
→ 服务器 `npm ci --omit=dev`（**不在服务器上构建**，小内存机器更稳）→ 校验 better-sqlite3 原生绑定
→ 生成 `.env`（`SESSION_SECRET` 在服务器随机生成、权限 600、脚本不打印）
→ 安装并启动 systemd 服务 → 可选 Nginx → `/health` 健康检查。

`deploy/remote-setup.sh` 随包上传并在服务器执行，可单独重跑：它是幂等的，且已存在的 `.env` 不会被覆盖。

> 脚本用 `BatchMode=yes`，**只做 key 认证**，不会尝试密码登录、不使用 sshpass。

### 方式 B：手动

1. 同步仓库到 `/opt/jiaowoplay`（不含 `node_modules`、`.env`），并 `chown -R jiaowoplay:jiaowoplay`。
2. `PATH=/opt/node-v24.22.2/bin:$PATH npm ci --omit=dev`（原生模块按本机平台安装）。
3. 按第 2 节写 `.env`，`chmod 600`，`SESSION_SECRET` 用 `openssl rand -hex 32`。
4. 守护二选一：
   - systemd：`sed -e "s|__NODE_BIN__|/opt/node-v24.22.2/bin/node|g" -e "s|__APP_DIR__|/opt/jiaowoplay|g" deploy/jiaowoplay.service.example > /etc/systemd/system/jiaowoplay.service && systemctl daemon-reload && systemctl enable --now jiaowoplay`
   - PM2：`cp deploy/ecosystem.config.cjs.example ecosystem.config.cjs`，改 env 后 `pm2 start ecosystem.config.cjs && pm2 save`
5. Nginx：`sed "s/__DOMAIN__/你的域名或IP/g" deploy/nginx.conf.example > /etc/nginx/conf.d/jiaowoplay.conf`，
   删除 Debian 自带的 `/etc/nginx/sites-enabled/default`（否则争抢 80 的 `default_server`），
   再 `nginx -t && systemctl reload nginx`。示例配置已包含 WebSocket upgrade、`/socket.io/` 120s 读超时与放宽的代理缓冲。

**务必注意**

- 房间与对局状态保存在进程内存，**只能单实例运行**（PM2 的 `instances` 必须为 1）。
  启动时会把库里 `active` 的对局判为流局，这个判断依赖「本进程独占该库」；
  多实例部署前必须先改掉这条对账，否则会误杀其它进程正在跑的对局。
- 纯 HTTP 部署时 `CORS_ORIGIN` 必须写成 `http://...`：应用据此关闭 CSP 的 `upgrade-insecure-requests`，
  否则浏览器会把静态资源升级到 https，未配 443 时直接白屏。
- 运行配置放在 `.env` 而不是 systemd 的 `Environment=`，避免 `systemctl show` 明文读出密钥。

### 运维命令

```bash
systemctl status jiaowoplay            # 服务状态
journalctl -u jiaowoplay -f            # 实时日志
systemctl restart jiaowoplay           # 重启（内存中的房间会丢失，历史仍在 SQLite）
curl -s http://127.0.0.1:3000/health   # 房间/玩家计数
```

---

## 7. 故障排查

| 现象 | 处理 |
| --- | --- |
| `npm install` 后启动报 esbuild / better-sqlite3 缺失 | 执行 `npm install-scripts approve better-sqlite3 esbuild` 后重新 `npm install` |
| 前端能打开但一直「正在连接服务器」 | 检查后端是否在 3000 端口；直连部署时确认 Nginx 带了 `Upgrade`/`Connection` 头 |
| 实时连接频繁断开 | Nginx `proxy_read_timeout` 太小；或反向代理未开 WebSocket |
| 刷新后回不到房间 | 浏览器禁用了 localStorage/sessionStorage（隐私模式）；或房间已被回收（全员离线 90s / 空房 5min） |
| 提示「房间不存在或已关闭」 | 房间长时间无人已被自动清理，重新创建即可 |
| 提示「房间内已有玩家使用该昵称」 | 掉线玩家仍占着昵称；换昵称，或用原浏览器标签页重连 |
| 数据库报错但游戏仍能玩 | 历史写入失败只记日志不中断对局；检查 `DB_PATH` 目录权限与磁盘空间 |
| 端口被占用 | 改 `.env` 的 `PORT`，并同步修改 `web/vite.config.ts` 的代理目标（`VITE_BACKEND`） |
| 线上首页白屏，控制台报 `ERR_CONNECTION_REFUSED https://…/assets/…` | 纯 HTTP 部署却把 `CORS_ORIGIN` 写成了 `https://`，CSP 强制升级了请求；改回 `http://` 后重启服务 |
| 服务器 `npm ci` 后 better-sqlite3 找不到原生绑定 | 预编译包下载失败；`apt-get install -y build-essential python3` 后 `npm rebuild better-sqlite3` |
| 服务器 `npm` 执行报 `env: 'node': No such file` | 用 tarball 安装时 npm 的 shebang 需要 node 在 PATH 上；`export PATH=/opt/node-v24.22.2/bin:$PATH` |
| Nginx error.log 反复出现 `upstream response is buffered to a temporary file` | 放宽 `proxy_buffers` 并设 `proxy_max_temp_file_size 0`（示例配置已含） |
| `nginx -t` 报 duplicate default server | 未删除 Debian 自带的 `/etc/nginx/sites-enabled/default` |

---

## 8. 目录结构

```
├─ shared/      前后端共用的类型、常量与事件协议（构建为 dist 供两侧消费）
├─ server/
│  ├─ src/
│  │  ├─ domain/      领域类型、ID/令牌生成、输入校验、错误码
│  │  ├─ games/       GameDefinition 抽象 + 同词相『交』实现 + 注册表
│  │  ├─ rooms/       房间状态机（Room）、房间管理（RoomManager）、视角投影
│  │  ├─ admin/       后台鉴权（JWT + 定长比较 + 登录限流）与后台数据接口
│  │  ├─ realtime/    Socket.IO 接入、Notifier、Socket 层限流
│  │  ├─ routes/      REST 路由与统一错误处理
│  │  ├─ db/          SQLite 打开、建表、历史仓储（前台/后台两套读取路径）
│  │  └─ app.ts / bootstrap.ts / index.ts
│  └─ test/           vitest 单元 + 集成测试
├─ web/
│  └─ src/
│     ├─ games/       registry.ts —— 游戏注册表：首页卡片、/play/:slug、面板选择都源于此
│     ├─ pages/       平台首页 / 游戏大厅 / 房间页 / 404
│     │  └─ admin/    后台首页与数据看板
│     ├─ components/  成员列表、房主控制、揭晓区、历史、页脚、登录弹窗等
│     │  └─ games/sameword/  同词相『交』专属组件
│     ├─ hooks/       useRoom（连接与状态）、useNow（倒计时）
│     └─ lib/         REST 客户端、后台 API、Socket 单例、本地存储、时间格式化
└─ deploy/      deploy.sh（tar over ssh + systemd）、remote-setup.sh、
                Nginx / systemd / PM2 示例配置
```
