# 交我PLAY

线上小游戏聚合平台。无需注册：设置昵称即可创建/加入房间，房间内实时对战。
首个游戏为**同词相见**，架构上通过 `GameDefinition` 接口预留了更多小游戏的扩展位。

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

日志不会打印 `reconnectToken`、密码等敏感字段。

---

## 3. 测试

```bash
npm test
```

覆盖内容：

- `server/test/sameword.rules.test.ts`：两人同词、多人全员同词、局部同词不结束、超时弃权、轮次上限平局、可判定人数不足、上一轮关联词提炼
- `server/test/room.test.ts`：开局校验、提交/揭晓时序、重复提交、非活跃玩家、强制结束、再来一局、离开与房主转移、房间回收
- `server/test/manager.test.ts`：房间号生成、昵称唯一、满员、重连令牌、巡检回收
- `server/test/integration.test.ts`：REST + Socket.IO 端到端（重连、开局、提交、揭晓、胜利、历史落库、错误码）

---

## 4. 游戏规则（同词相见）

1. 房主开局后，房间内**所有在线玩家**进入第一轮；开局后加入者进等待区，下一局自动加入。
2. 每轮每人提交一个词（1–20 字符，禁止纯空白/控制字符）。提交前互相不可见，全员提交后统一揭晓。
3. 第一轮自由输入；从第二轮起，你的词需要**同时关联上一轮所有已揭晓词**（主观关联，系统不校验语义）。
4. 全员提交词去首尾空格后完全一致 → 全员相遇，本局胜利，记录总轮次与每轮词。
5. 仅部分人同词 → 不结束，揭晓区标记「局部相遇：A 与 B」并写入历史，进入下一轮。
6. 每轮默认 120 秒；超时未提交记为弃权，不参与本轮判定。可判定人数 < 2 → 本局按人数不足平局。
7. 默认最多 20 轮；用尽仍无全员同词 → 平局。房主可随时强制结束或「再来一局」。
8. 房主离开/掉线超过宽限期 → 自动转移给最早加入且在线的成员。
9. 房间号 6 位（大写字母+数字，排除 0/O/1/I）；昵称 2–12 字符且房间内唯一。

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
| GET | `/api/sessions/:id` | 单局完整历史（每轮每人提交词） |
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

1. 在 `shared/src/types.ts` 的 `GameType` 中加类型；
2. 实现 `server/src/games/Game.ts` 的 `GameDefinition`；
3. 在 `server/src/games/registry.ts` 中 `registerGame(...)`。

房间状态机、成员管理、重连、持久化均可复用，无需改动。

---

## 6. 生产构建与部署

```bash
npm run build     # 产出 server/dist 与 web/dist
```

### 方式 A：deploy.sh（推荐）

凭据只通过环境变量或交互输入提供，脚本不会把任何密码写进仓库。

```bash
JWP_HOST=deploy@你的服务器IP \
JWP_DOMAIN=play.example.com \
JWP_SESSION_SECRET="$(openssl rand -hex 32)" \
./deploy/deploy.sh
```

脚本流程：本地测试与构建 → rsync 源码 → 服务器 `npm ci` + 构建 → 生成 `.env`（权限 600）
→ PM2 reload（无 PM2 时回退 systemd）→ 可选安装 Nginx 配置 → `/health` 健康检查。

> 使用 SSH 密码登录需安装 `sshpass` 并设置 `JWP_SSH_PASSWORD`；**部署完成后请改用 SSH key 并修改临时密码。**

### 方式 B：手动

1. 服务器上创建低权限用户与目录，例如 `/opt/jiaowoplay`，同步仓库（不含 `node_modules`、`.env`）。
2. `npm ci && npm run build`。
3. 配置 `.env`（见第 2 节），`SESSION_SECRET` 用随机值。
4. 二选一启动：
   - PM2：`cp deploy/ecosystem.config.cjs.example ecosystem.config.cjs`，改 env 后 `pm2 start ecosystem.config.cjs && pm2 save`
   - systemd：`sudo cp deploy/jiaowoplay.service.example /etc/systemd/system/jiaowoplay.service`，改 Environment 后 `systemctl enable --now jiaowoplay`
5. Nginx：`cp deploy/nginx.conf.example /etc/nginx/conf.d/jiaowoplay.conf`，替换 `__DOMAIN__`，`nginx -t && systemctl reload nginx`。
   配置中已包含 WebSocket upgrade 头与 65s 读超时（需大于 Socket.IO 的 pingTimeout）。

**注意**：`ecosystem.config.cjs` 中 `instances` 必须为 1 —— 房间状态在进程内存中，多实例会状态不一致。

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

---

## 8. 目录结构

```
├─ shared/      前后端共用的类型、常量与事件协议（构建为 dist 供两侧消费）
├─ server/
│  ├─ src/
│  │  ├─ domain/      领域类型、ID/令牌生成、输入校验、错误码
│  │  ├─ games/       GameDefinition 抽象 + 同词相见实现 + 注册表
│  │  ├─ rooms/       房间状态机（Room）、房间管理（RoomManager）、视角投影
│  │  ├─ realtime/    Socket.IO 接入、Notifier、Socket 层限流
│  │  ├─ routes/      REST 路由与统一错误处理
│  │  ├─ db/          SQLite 打开、建表、历史仓储
│  │  └─ app.ts / bootstrap.ts / index.ts
│  └─ test/           vitest 单元 + 集成测试
├─ web/
│  └─ src/
│     ├─ pages/       首页 / 房间页 / 404
│     ├─ components/  成员列表、房主控制、游戏面板、揭晓区、历史等
│     ├─ hooks/       useRoom（连接与状态）、useNow（倒计时）
│     └─ lib/         REST 客户端、Socket 单例、本地存储
└─ deploy/      Nginx / PM2 / systemd 示例与 deploy.sh
```
