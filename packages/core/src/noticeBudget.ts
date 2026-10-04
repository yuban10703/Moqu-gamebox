/**
 * 对局页「提示条」（`.eink-notice`）的**单行预算**。
 *
 * 为什么需要它：提示条固定在状态条里 —— 高 48px、`white-space: nowrap`、`overflow: hidden`，
 * 所以**放不下的字会被静默切掉**。用户报过一次：竖屏 P6Plus 上贪吃蛇的
 * 「这一步走不通（不能原地掉头，或本局已经结束）」只显示到一半。
 * 状态条高度必须固定（提示出现/消失不能让棋盘抖动），因此预算只能落在**文案**这一侧。
 *
 * 预算来自实测（2026-10-04，见 docs/eink-guidelines.md「提示条的一行预算」）：
 * 提示出现时它独占状态条那一行（`.eink-statusstrip[data-notice='yes'] .eink-save` 让位），
 * 内容区约 397px；最紧的是竖屏 439×847 的 1.5× 档（26px 字号）→ 一行约 **15.3 全角字**。
 * 1.25× 档约 18、1× 档约 22，宽屏与极矮横屏都更宽松。取 **14** 作为硬预算（留约 9% 余量，
 * 因为字体度量随设备/字重浮动）。
 *
 * 宽度的估算系数也来自实测（26px、font-weight 600 下逐条量过）：
 * 全角 1.0（中文与中文标点精确为 1）、半角 0.6（英文正文实测 0.49~0.56 em/字符，
 * 个别全大写串能到 0.73 —— 所以取 0.6 并靠预算余量兜住）。
 *
 * 守卫：`packages/ui/test/notice-budget.test.ts` 会遍历 12 款游戏的中英词典，
 * 把所有提示类文案按这个预算卡一遍 —— 加长文案时会先在那里红。
 */
export const NOTICE_BUDGET = 14

/** 半角字符的宽度系数（em）：英文正文实测 0.49~0.56，取 0.6 留余量 */
const HALF_WIDTH = 0.6

/**
 * 估算一段文案的显示宽度（单位：全角字）。
 * ASCII 记 0.6（见上），其余记 1（含中文标点）。
 */
export function noticeWidth(text: string): number {
  let width = 0
  for (const char of text) {
    width += (char.codePointAt(0) ?? 0) <= 0x7f ? HALF_WIDTH : 1
  }
  // 0.6 在二进制里不精确，累加会得到 11.999999999999996 这种值：
  // 舍到两位小数，让「≤ 预算」这类比较与测试断言都是确定的
  return Math.round(width * 100) / 100
}
