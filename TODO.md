# TODO

## 已完成

### [已修复] 历史接口泄露「尚未揭晓」的提交词

对局进行中，`GET /api/rooms/:code/history` 与 `GET /api/sessions/:id`
会返回本轮已提交但还没揭晓的词语，玩家轮询即可看到别人的词。

修复方式：`server/src/db/repository.ts` 的 `getSession()` 只读取
`revealed_at IS NOT NULL` 的轮次的提交内容；进行中的轮次仍列出（能看到轮号与
`revealedAt: null`），但 `submissions` 为空数组，`partialMeetings` 同理。
写入侧不变，掉电不丢的性质保留。

回归测试：`server/test/integration.test.ts` 的
「揭晓前的提交词不会从历史接口泄露，揭晓后恢复可见」。

**副作用（已知且可接受）**：房主在收集阶段强制结束本局时，那一轮从未揭晓，
其提交词将永久无法通过历史接口读出（数据仍在 `submissions` 表里，只是不外泄）。

## 待办

### HTTPS / 域名

当前只有 `http://<IP>`，`reconnectToken` 在链路上是明文，同网段可嗅探。
拿到域名后：签证书 → 把服务器 `.env` 的 `CORS_ORIGIN` 改成 `https://域名` → 重启服务。
应用的 CSP `upgrade-insecure-requests`、COOP、Origin-Agent-Cluster 会依据
`CORS_ORIGIN` 是否为 https 自动恢复严格模式，无需改代码。

### 横向扩展

房间与对局状态保存在单个 Node 进程的内存里，因此 `instances` 必须为 1。
需要多实例时要先引入 Socket.IO Redis adapter 与共享状态层，否则同一房间会被
不同进程各自持有、状态不一致。
