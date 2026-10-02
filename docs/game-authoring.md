# 新增一款游戏

目标：**只补规则、内容与呈现，不用重做设置、存档、备份与恢复**。
接入一款游戏的全部工作都在 `packages/games/<game>/` 与一行注册代码里。

## 1. 目录

```
packages/games/<game>/
├─ src/
│  ├─ level.ts     内容格式与解析（如有）
│  ├─ rules.ts     纯规则：derive / reduce / legal
│  ├─ view.ts      展示模型（黑白可读、符号化）
│  ├─ i18n.ts      中英文案（zh / en 基础 key 必须一致）
│  ├─ index.ts     GameDef 实现 + 对外导出
│  └─ levels.ts    内容（建议由工具生成，带来源字段）
└─ test/           规则不变量、内容校验、确定性
```

## 2. 必须实现的契约

```ts
interface GameDef<S, A> {
  id: string
  rulesVersion: number      // 规则语义变化时 +1
  contentVersion: number    // 内容变化时 +1
  i18nNamespace: string
  difficulties: readonly { id: string; labelKey: string }[]
  illegalNoticeKey?: string // 被拒绝输入时的文字提示
  create(seed: number, difficultyId: string): S   // 必须确定性，禁止 Math.random
  reduce(state: S, action: A): S                  // 纯函数；非法动作抛 IllegalActionError
  legal(state: S): readonly A[]
  status(state: S): 'playing' | 'won' | 'lost'
  view(state: S): GameView                        // 只产出展示模型，不碰 DOM
  controls(state: S): ControlSpec[]               // 壳层渲染成可见按钮
  encode(state: S): unknown                       // 存档用的状态编码
  decode(raw: unknown): S                         // 必须严格校验；非法输入抛错
}
```

硬性要求：

1. **确定性**：同一个 `(seed, difficulty)` 必须产出同一个初始状态；随机数只用 `@eink/core` 的 `createRng`。
2. **状态自包含**：`encode` 的产物必须能独立还原局面（撤销历史也放进去，推箱子就是这么做的）。
3. **拒绝非法输入**：`decode` 遇到损坏内容必须抛错——上层会把它当作「存档损坏」处理并保留原档。
4. **展示模型不含平台概念**：不要出现 DOM、CSS、像素；尺寸由壳层用 `computeBoardLayout` 计算。

## 3. 注册（唯一需要改壳层之外的地方）

`apps/web/src/library.ts`：

```ts
export const library: GameLibrary = {
  entries: [
    defineGame({
      game: myGame,
      rulesKeys: ['mygame.rules.body'],
      defaultDifficulty: 'easy',
      levels: MY_LEVELS.map((level) => ({ id: level.id })),
      progressFor: (completed) => ({ done: /* … */, total: /* … */ }),
      indexOfLevel: (levelId) => /* … */,
    }),
  ],
  dicts: { 'zh-CN': { ...coreDictZh, ...myZh }, 'en-US': { ...coreDictEn, ...myEn } },
}
```

壳层会自动获得：游戏库入口、详情页、难度选择、关卡分页列表、统一外框（暂停/返回/重开/覆盖确认）、
结果页、存档与恢复、跨端备份、诊断与自检。

## 4. 必须补的测试

| 测试 | 目的 |
|---|---|
| 规则不变量 | 移动/撤销/重开语义、非法动作被拒绝、计数正确 |
| 确定性重放 | 同一动作序列重放得到同一局面（对应 F01 的双端一致性口径） |
| ≥100 步随机合法动作 | 不出现状态漂移或计数错误（对应 F02） |
| 内容校验 | 每个关卡/题目：格式合法、可解、来源可按 seed 复算（如有生成器） |
| 字典对齐 | 中英基础 key 一致（由已有的 dicts 测试与 `npm run check:i18n` 覆盖） |

## 5. 不要做的事

- 不要引入渲染循环或 `requestAnimationFrame`；
- 不要用透明度/浅灰表达状态（黑白模式下会消失）；
- 不要用动画表达「正在计算」——用稳定的文字；
- 不要把未实现的能力（例如死局检测）做成界面提示；
- 不要在规则层依赖平台能力（那是 `EinkPlatform` 的事）。
