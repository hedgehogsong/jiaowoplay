# TODO

## 安全：历史接口会泄露「尚未揭晓」的提交词（已知，暂不修复）

**现状**：对局进行中，任何人（包括正在玩的玩家）访问

- `GET /api/rooms/:code/history`
- `GET /api/sessions/:id`

就能看到本轮**已提交但还没揭晓**的词语，绕过了「提交前看不到别人的词」这条核心规则，可以直接作弊。

**已于 2026-11-03 在线上复现**（房间 `5A7P8S`，房主提交后本轮未揭晓）：

```
LEAK via /api/rooms/:code/history : true
LEAK via /api/sessions/:id        : true
rounds in history: [{"n":1,"revealedAt":null,"words":["绝密灯塔9527"]}]
```

**成因**：提交时为了掉电不丢就立刻落库（`Room.submitWord` → `HistoryRepository.createSubmission`），
但读取侧 `server/src/db/repository.ts` 的 `getSession()` 无条件返回所有轮的 `submissions`，
没有按 `revealed_at` 过滤。内存态的投影（`server/src/rooms/roundView.ts`）是做对的，只有 SQLite 这条读取路径漏了。

**修法**（约 10 行，只改读取侧，不动写入）：`revealed_at IS NULL` 的轮次不返回 `submissions` 内容
（返回空数组并保留 `revealedAt: null`，让调用方知道这轮还在进行），并补一条单测断言未揭晓轮次不含词。

**决定**：等新版平台首页 UI 上线验证无误后单独排期修复。
