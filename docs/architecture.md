# 架构

## 分层

```
apps/web  ─┐                     ┌─ packages/ui（React 壳层：页面、组件、会话）
           ├─ packages/platform ─┤
apps/android┘  （平台适配：存储 / 离线 / 设备基线）
                                 └─ packages/games/*（规则 + 展示模型 + 内容）
                                          └─ packages/core（契约 / 存档 / i18n / 布局）
```

依赖方向严格单向：`apps → ui/platform → games → core`。
`core` 里不出现 DOM、React、WebView、Android；`games` 里不出现任何平台概念。

## 一次输入发生了什么

```
玩家点「上」
  → ui/session.dispatch({type:'move',dir:'up'})
  → game.reduce(state, action)        // 纯函数；非法动作抛 IllegalActionError
  → 更新 React 状态（立即出画，不做防抖）
  → applyAction(存档, game.encode(next), now)   // 重新计算校验和
  → SaveStore.commit(...)             // 500ms 合并；过关/暂停/隐藏页面时立即提交
```

- **输入不防抖**：每个被接受的输入都立即产生状态变化（规范第 5 条）；
  被拒绝的输入给出明确文字提示，且**不写入动作日志**。
- **只有持久化做合并**：500ms 窗口合并连续动作；关键节点（过关、暂停、页面隐藏、返回）强制立即提交。

## 存档与提交协议

存档是「游戏状态 + 会话统计 + 进度」的封装，`state` 字段就是 `GameDef.encode()` 的产物
（推箱子把自己的动作日志放在状态里，因此天然可重放）。`moves` 只是派生计数。

```
commit(env):
  1. 写 pending{target}        ← 意图
  2. CAS committed（期望旧值 → 新值）
  3. 删除 pending
```

- **CAS**：期望值与实际值不一致就返回 `conflict`，绝不静默覆盖别的窗口/进程写下的进度。
- **崩溃恢复**：`recover()` 在启动时运行：
  `pending.commitId > committed.commitId` 且校验通过 → 补提交；否则删除并记录（陈旧或损坏）。
- **损坏不覆盖**：损坏的存档会保留原样，界面提示并允许导出，只有用户显式选择才重置。

## 平台差异

| 能力 | Web | Android |
|---|---|---|
| 存储 | IndexedDB（`readwrite` 事务内完成 CAS） | 原生 SQLite（`beginTransaction` 内完成 CAS） |
| 资源 | Service Worker 预缓存 + 缓存优先 | 安装包内置，启动即离线 |
| 页面源 | 正常 https/本地地址 | `WebViewAssetLoader` → `https://appassets.androidplatform.net/`（file:// 下存储不可靠） |
| 刷新 | 不能控制（给出系统指引） | 同样不能控制：壳层是通用 Android 实现，不含任何厂商 SDK |
| 备份导出 | Blob 下载 | SAF（`ACTION_CREATE_DOCUMENT` / `ACTION_OPEN_DOCUMENT`） |

两端复用**同一套**提交协议与 i18n、同一份游戏代码，因此规则一致性可以在 Node 侧一次性锁死。

## 版本与迁移

| 版本 | 位置 | 作用 |
|---|---|---|
| `APP_VERSION` | `core/version.ts` | 应用 |
| `SAVE_SCHEMA` | `core/version.ts` | 存档格式（迁移链入口） |
| `BACKUP_SCHEMA` | `core/version.ts` | 跨端备份格式 |
| `rulesVersion` | 每个 `GameDef` | 规则语义；不匹配即判定为不可安全读取 |
| `contentVersion` | 每个 `GameDef` | 题库/关卡包 |

迁移规则：只允许逐级迁移；迁移前先落 `backup_v{n}` 副本；迁移失败保留旧数据并说明，
**绝不静默覆盖**。当前只有 schema 1，因此迁移链是恒等映射（`core/save.ts` 里预留了位置）。

## 为什么不用 Canvas

网页与 WebView 都拿不到可靠的像素级局部刷新：桥**不提供任何刷新控制**（刷新链路已整条删除，见 [handover.md](handover.md) §5b）。
既然如此，用 Canvas 自绘再自己去算 damage 矩形收益很低，还要自己处理中文字形（打包 CJK 位图字体）。
DOM/SVG 让系统做最小重绘，中文直接用系统字体，`1-bit` 可读性靠符号与线型而不是灰阶来保证。

如果将来实测证明某个游戏的 DOM 方案确实不够用，按规划只替换**该游戏的呈现层**，
规则层与存档格式保持不变。
