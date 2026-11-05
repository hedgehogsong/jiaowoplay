# TODO

## 已完成

### [已修复] 未结束的对局在库里永久停留为 active（僵尸局）

后台看板里会出现「进行中（第 N 轮）」却再也没有动静的对局。三条成因：

1. `Room.dispose()` 只清计时器，不写库；房间被回收（全员离线 90s、空房 5min、
   房龄 6h 兜底）时，那一局在库里永远是 `status='active'`。
2. **主因**：`bootstrap.close()` 与 SIGTERM/SIGINT 处理不碰房间。每次发版重启、
   崩溃或 OOM（服务器只有 1.9G 内存）都会把当时在打的对局留成僵尸局。
3. `finishSession` 写库失败只 `logger.warn`，内存已 FINISHED 而库里仍是 active。

修复：新增 `ABANDONED`（中途流局/全员流失）终态；`dispose()` 与进程关闭都会把未结束的
对局写成 `finished + ABANDONED + ended_at`，进行中的轮次标记 `ABANDONED`（绝不写
`revealed_at`，所以前台依然看不到那些词，词本身保留在 `submissions` 表）；
服务启动时 `reconcileAbandonedSessions()` 把库里遗留的 active 行统一补成终态，
`ended_at` 取最后活动时间而不是启动时刻。

顺带修掉房主转移刷屏：全员离线时 `transferHost()` 每 5 秒都会「转移」给同一个最早
加入者，反复广播 `hostTransferred` 并打日志；现在选中同一人时只静默校正标志位。

回归测试：`server/test/abandoned.test.ts`（含真实启动路径与前后隔离）、
`server/test/room.test.ts` 的「房间销毁的流局收尾」「房主转移不刷屏」。

### [已修复] 历史接口泄露「尚未揭晓」的提交词

对局进行中，`GET /api/rooms/:code/history` 与 `GET /api/sessions/:id`
会返回本轮已提交但还没揭晓的词语，玩家轮询即可看到别人的词。

修复方式：`server/src/db/repository.ts` 的 `getSession()` 只读取
`revealed_at IS NOT NULL` 的轮次的提交内容；进行中的轮次仍列出（能看到轮号与
`revealedAt: null`），但 `submissions` 为空数组，`partialMeetings` 同理。
写入侧不变，掉电不丢的性质保留。

回归测试：`server/test/integration.test.ts` 的
「揭晓前的提交词不会从历史接口泄露，揭晓后恢复可见」。

**副作用（已知，已确认可接受）**：房主在收集阶段强制结束本局时，那一轮从未揭晓，
其提交词将永久无法通过历史接口读出（数据仍在 `submissions` 表里，只是不外泄）。

已于 2026-11-03 部署上线，并在公网复验：揭晓前两个端点均查不到词，
揭晓后同一轮完整可读、`outcome=ALL_MET`。

## 待办

### /assets 缺失资源返回 200 + index.html（下次发版一并修）

SPA 兜底路由 `server/src/app.ts` 里的

```ts
app.get(/^(?!\/api|\/health|\/socket\.io).*/, ...)
```

没有排除 `/assets`，所以请求一个**不存在**的哈希资源时，不会得到 404，
而是拿到 `200 + text/html`（index.html 本身）。已实测确认：

```
旧哈希 → Content-Type: text/html; Cache-Control: public, max-age=0   → <!doctype html>…
新哈希 → Content-Type: application/javascript; … immutable            → var tp=Object.defineProperty…
```

**影响**：浏览器缓存了旧版 HTML 时，它引用的旧哈希产物已被清理，
于是把一段 HTML 当 JS 执行，报 `Unexpected token '<'` 这类难懂的错，
而不是干净的 404；也会掩盖发版不匹配的问题。

**修法**（一行）：把 `/assets` 加进兜底正则的排除项，缺失资源自然回落到 404。

**决定**：不单独发版（避免多开 SSH 连接触发 IP 封禁），
等下一次功能改动或配置 HTTPS 时一起改一起发。

### HTTPS / 域名

当前只有 `http://<IP>`，`reconnectToken` 在链路上是明文，同网段可嗅探。
拿到域名后：签证书 → 把服务器 `.env` 的 `CORS_ORIGIN` 改成 `https://域名` → 重启服务。
应用的 CSP `upgrade-insecure-requests`、COOP、Origin-Agent-Cluster 会依据
`CORS_ORIGIN` 是否为 https 自动恢复严格模式，无需改代码。

### 横向扩展

房间与对局状态保存在单个 Node 进程的内存里，因此 `instances` 必须为 1。
需要多实例时要先引入 Socket.IO Redis adapter 与共享状态层，否则同一房间会被
不同进程各自持有、状态不一致。

**同一前提还撑着启动对账**：`reconcileAbandonedSessions()` 认为库里所有 `active`
的对局都是本进程遗留的残局并一律判为流局。多实例部署前必须改成只处理本实例登记的
会话，否则新起来的进程会误杀其它进程正在打的对局。
