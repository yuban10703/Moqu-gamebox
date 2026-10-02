# 墨水屏交互规范（与代码的对应关系）

规范来源：BOOX 官方《墨水屏开发指南》的产品化，加上本项目的实测约束。
每条都标注了它在代码/测试里的落点，避免规范与实现脱节。

| # | 规范 | 代码落点 | 自动化验证 |
|---|---|---|---|
| 1 | 白底深色文字为默认，彩色仅作增强 | `packages/ui/src/styles.css`（`--ink-black/--ink-white`，无彩色） | — |
| 2 | 状态区分不靠浅灰或透明度：用符号 + 线型 + 文字 | 棋盘符号 `○ □ ◼ ▲ △`（`games/sokoban/src/view.ts`）；按钮禁用=点线、走不通=虚线（`styles.css`） | 壳层测试断言提示文本；`eink-guidelines` 人工检查 |
| 3 | 关闭装饰动画、滑入滑出、循环加载、闪烁 | `styles.css` 全局 `animation/transition: none`；无 spinner，计算态用稳定文字 | — |
| 4 | 主操作用可见按钮；滑动/长按只作补充 | 方向盘 + 撤销/重开/菜单按钮；长按被壳层禁用（`MainActivity`） | 壳层测试通过按钮完成操作 |
| 5 | 输入被接受即产生状态变化；不重复提交 | `session.dispatch` 立即更新状态；非法动作弹提示且不入日志 | `rules.test.ts` 输入处理用例；`shell.test.tsx` |
| 6 | 列表优先分页，不依赖上下反复滚动 | 详情页关卡列表分页（`GameDetailScreen` + `Pager`） | `Pager` 组件测试（壳层） |
| 7 | 小屏棋盘不能让整体缩小；提供聚焦格与独立数字区 | `computeBoardLayout` 保证整数格且不小于下限；数独实现按 [A04](A04-screens.md) 预留 | `layout.test.ts` 不变量 |
| 8 | 触摸目标 ≥48px（棋盘格外，且棋盘格必须有替代输入） | `DEFAULT_LAYOUT.minTouchTarget = 48`；方向盘尺寸来自 `computeRootLayout` | `layout.test.ts` 全设备断言 |
| 9 | 静止时不连续绘制；后台暂停计算与输入 | 无渲染循环；暂停后 `dispatch` 直接返回 false | 壳层测试（暂停不响应） |
| 10 | 刷新控制只做平台已验证的能力 | Web 端能力清单全为 false 并给出系统指引；Android 端按探测结果开放 | `platform.test.ts` 能力上报 |

## 具体尺寸基线

- 正文：18 / 22 / 26 CSS px 三档（跟随「字号」设置，写进 `html[data-font-scale]`）；
- 按钮：≥48px；方向盘按钮高度 = `max(48, 字号 × 2.2)`；
- 棋盘格：整数 px，最小 24px；主基线（10.3 吋）下 11×9 棋盘格子 ≥44px；
- 线宽：默认 2px（1px 在墨水屏上容易消失），设置「加粗线条」关闭后降为 1px。

## 明确不承诺

- **不做零残影承诺**：残影与全刷效果必须真机观察（记录到 [A01](A01-device-baseline.md)）；
- **不做像素级局部刷新**：网页与 WebView 只能拿到整屏全刷与应用级模式切换；
- **不把未实现的能力写进界面**：探测不到的能力显示为不可用并给出指引，而不是显示一个点了没反应的开关。

## 布局硬性规则：主操作必须固定在首屏内

**教训（6 寸竖屏实测）**：详情页的「开始新游戏」在 P6Plus（439×847 CSS）上位于 880~940，
而视口只有 847 —— 用户必须先拖动才能开始游戏。同一份代码在 Note X2（1248×903 横屏）上完全正常，
**这类问题只有窄屏才暴露**，所以必须在多设备上验收。

### 做法：`eink-screen--sticky-footer`

```html
<div class="eink-screen eink-screen--sticky-footer">
  <TopBar/>
  <div class="eink-screen__content"> …可滚动的内容… </div>
  <footer class="eink-footer"> …主操作… </footer>
</div>
```

```css
.eink-screen--sticky-footer {
  /* 必须覆盖 .eink-screen 的 flex:1 —— 在列向 flex 容器里 flex-basis(0) 会压掉 height，
     只写 height:100vh 不生效（实测计算高度为内容高度 951px 而非视口 847px）。 */
  flex: 0 0 auto;
  height: 100vh;
  overflow: hidden;
}
.eink-screen--sticky-footer .eink-screen__content {
  flex: 1 1 auto;
  min-height: 0;   /* 不加这行 flex 子项不肯收缩，不会出现滚动 */
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--gap);
}
.eink-screen--sticky-footer .eink-footer { flex: 0 0 auto; margin-top: 0; }
```

已应用：游戏详情页、帮助页、诊断页（诊断页的原始转储可达 1884px，原本把按钮顶到屏幕外）。

### 自动审计

用 `tools/scripts/` 下的思路（临时脚本，逻辑见提交说明）逐个页面检查
「是否有按钮 bottom > innerHeight」，两台设备都应为 0。
当前结果：Note X2 六页全为 0；P6Plus 首页/设置/帮助/诊断/测试页为 0，
详情页仅剩关卡选择等**滚动区内的次级控件**（主操作已固定）。

### 关卡列表：按实测容量决定是否分页

**规则**：装得下就全部列出、**不显示分页**；装不下才分页，且**翻页按钮固定在页脚**、
无需滚动即可看见。

实现（`GameDetailScreen`）：

- `useLayoutEffect` 里实测三个几何量：列表首项高度、`rowGap`、`gridTemplateColumns` 的列数，
  再用「内容区底边 − 列表顶边」得到可见高度 → 算出能放几行 × 几列 = 容量。
- `关卡数 ≤ 容量` → 每页 = 全部、`pagerNeeded=false`（不渲染分页器）。
- 否则 → 每页 = 容量，并把分页器渲染在**固定页脚**里（与主操作同一栏，窄屏自动换行）。
- 分页器出现后内容区变矮，`content.bottom` 自动上移 → 依赖 `pagerNeeded` 触发一次重算即收敛。
- 容量随视口/字号/粗线设置变化重算；页码越界时夹紧（从第 2 页切回单页不会卡在空页）。

实测（16 关）：

| 设备 | 视口 | 本页显示 | 分页器 | 翻页按钮 |
|---|---|---|---|---|
| Note X2 | 1248×903 | **16（全部）** | 无 ✓ | — |
| P6Plus | 439×847 | 10 | 有 | bottom 830 ≤ 847，**无需滚动可见** ✓ |

规律：**列数由宽度决定、行数由高度决定**，所以横屏大屏一屏放得下 16 关就不分页，
窄屏竖屏放不下才分页 —— 同一份代码自适应，不写死每页数量。
