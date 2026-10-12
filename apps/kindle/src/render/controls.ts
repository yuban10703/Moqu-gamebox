/**
 * 控制区渲染器（ControlSpec[] → DOM，ES5 目标）。
 *
 * 语义对齐 packages/ui/src/components.tsx 的 `Dpad` / `ActionButton`：
 * - 方向键**始终可点**（走不通时由会话给明确文字反馈），走不通的方向用 muted 呈现；
 * - `layout: 'tee'` = 倒 T（撤销/重开收在上排两侧），`'row'` = 四键平铺一行（俄罗斯方块）；
 * - 普通按钮按 `enabled` 禁用；`emphasis: 'primary'` 反白突出。
 *
 * 布局手段：老引擎上没有 grid / 现代 flex，倒 T 用**表格**摆（3 列 2 行），
 * 平铺用 inline-block 一行 —— 两者都能保证等宽且不依赖新特性。
 */
import type { ControlSpec, MoveDir } from '@eink/core'
import { el } from '../dom.js'
import type { RenderCtx } from './types.js'

/** 平铺时的键序：左右放两端（与平移方向一致），上 / 下居中 */
const ROW_ORDER: readonly MoveDir[] = ['left', 'up', 'down', 'right']
/** 倒 T 的表格摆法：第一行 [空, 上, 空]，第二行 [左, 下, 右] */
const TEE_ROWS: ReadonlyArray<ReadonlyArray<MoveDir | null>> = [
  [null, 'up', null],
  ['left', 'down', 'right'],
]

export interface ControlsOptions {
  /** 方向键是否显示（设置里可关；点格子的玩法默认收起） */
  dpad: boolean
  /** 摆法，见 core 的 DpadLayout */
  layout: 'tee' | 'row'
  /** 方向键边长（像素）；倒 T 用放大后的键 */
  size: number
  /** 方向键组的无障碍名 */
  padLabelKey: string
  /** 点了某个方向 */
  onMove(dir: MoveDir): void
  /** 点了普通按钮（id 交给会话：壳层固定 id 或游戏自定义 id） */
  onControl(controlId: string): void
  /** 倒 T 上排两侧的格子（壳层放「撤销」「重开」）；返回 null 表示该角不放 */
  cornerLeft?: HTMLElement | null
  cornerRight?: HTMLElement | null
}

function buttonLabel(ctx: RenderCtx, control: ControlSpec): string {
  return ctx.t(control.labelKey, control.labelParams)
}

/** 普通按钮（含方向键用不到的 action 角色） */
export function actionButton(ctx: RenderCtx, control: ControlSpec, onClick: () => void, width: number): HTMLElement {
  const disabled = control.enabled !== true
  const primary = control.emphasis === 'primary'
  let css =
    'display:inline-block;min-width:' + Math.max(56, Math.round(width)) + 'px;height:44px;' +
    'line-height:42px;padding:0 12px;margin:0 4px 6px 0;box-sizing:border-box;' +
    'border:1px solid #000;border-radius:4px;font-size:15px;text-align:center;' +
    'text-decoration:none;overflow:hidden;white-space:nowrap;'
  if (disabled) {
    // 禁用：虚线边框 + 空心，与可用按钮在 1-bit 下也能分辨
    css += 'border-style:dashed;background:#fff;color:#000;'
  } else if (primary) {
    css += 'background:#000;color:#fff;'
  } else {
    css += 'background:#fff;color:#000;'
  }
  const btn = el('button', { class: 'k-btn' + (primary ? ' k-btn--primary' : ''), type: 'button', style: css }, buttonLabel(ctx, control))
  if (disabled) {
    btn.setAttribute('disabled', 'disabled')
    btn.setAttribute('aria-disabled', 'true')
  } else {
    btn.addEventListener(
      'click',
      function onClickHandler(): void {
        onClick()
      },
      false,
    )
  }
  return btn
}

/**
 * 画整个控制区：方向键（可选）+ 普通按钮。
 * 返回容器元素，由屏幕层挂到页面底部。
 */
export function renderControls(controls: readonly ControlSpec[], ctx: RenderCtx, options: ControlsOptions): HTMLElement {
  const wrap = el('div', { class: 'k-controls' })

  const dpadControls: ControlSpec[] = []
  const actionControls: ControlSpec[] = []
  /*
   * 页脚动作行**排除壳层自己渲染的 id**（与现代版 GameScreen 的 SHELL_CONTROL_IDS 同一套规则）：
   *   · next-level —— 结果面板专用。玩法注释写明「对局页不会重复渲染（壳层把它当自己的按钮）」；
   *     壳层不滤的话，空当接龙/斗地主的页脚会常驻一个重复按钮（实测：「换一局」×2）。
   *   · undo / restart —— 只在**有方向键**的玩法排除（倒 T 上排两侧的 ↶/↻ 已经是它们）；
   *     没有方向键的玩法（如扫雷）没有别的入口，必须保留玩法自己声明的按钮。
   *   · nextLevel（驼峰变体）一并排除：两种写法在不同玩法的 view 里语义相同。
   */
  const shellOnly: Record<string, boolean> = {}
  shellOnly['next-level'] = true
  shellOnly['nextLevel'] = true
  /*
   * 只在**真的有角落 ↶/↻** 时才滤掉 undo/restart：角落只在倒 T 布局里渲染
   * （平铺布局没有角落；没有方向键的玩法更没有）。
   * 判断条件不能用 options.dpad 这个开关 —— 它默认为 true，
   * 空当接龙（没有方向键）会被误判，唯一的「撤销」按钮跟着消失（实测踩过）。
   */
  for (let i = 0; i < controls.length; i++) {
    const spec = controls[i]
    if (spec.role === 'dpad') {
      dpadControls.push(spec)
      continue
    }
    if (shellOnly[spec.id] === true) continue
    /*
     * 玩法声明的 undo / restart：只有**角落 ↶/↻ 真的会渲染**时才省下
     * （tee 布局 + 存在方向键）。**注意条件在这里写** ——
     * 原先在循环前就判断 `dpadControls.length > 0`，那时它还是 0，
     * 于是 sokoban 的页脚撤销/重开永远滤不掉（视觉检查发现的）。
     */
    /*
     * **必须带上 options.dpad**：dpadDefault: false 的玩法（数字华容道）方向控件
     * 只是"声明了但不渲染"，角落 ↶/↻ 同样不存在 —— 把它的页脚撤销滤掉，
     * 玩家就没有任何撤销入口了（视觉检查发现整块控制区空白）。
     */
    if ((spec.id === 'undo' || spec.id === 'restart') && options.dpad && options.layout === 'tee' && dpadControls.length > 0) {
      continue
    }
    actionControls.push(spec)
  }

  // 方向键：没有方向控件时整块不渲染，避免在窄屏上白占一块高度
  if (options.dpad && dpadControls.length > 0) {
    const find = function find(dir: MoveDir): ControlSpec | null {
      for (let i = 0; i < dpadControls.length; i++) {
        if (dpadControls[i].dir === dir) return dpadControls[i]
      }
      return null
    }
    const key = function key(dir: MoveDir): HTMLElement {
      const control = find(dir)
      if (!control) return el('span', { class: 'k-dpad__empty', style: 'display:inline-block;width:' + options.size + 'px;height:' + options.size + 'px;' })
      let css =
        'display:inline-block;width:' + options.size + 'px;height:' + options.size + 'px;' +
        'line-height:' + (options.size - 4) + 'px;padding:0;box-sizing:border-box;' +
        'border:1px solid #000;border-radius:4px;font-size:16px;text-align:center;' +
        'background:#fff;color:#000;'
      // muted：这个方向现在走不通 —— 但仍然可点（点了给文字反馈，不静默）
      if (control.tone === 'muted') css += 'border-style:dashed;'
      const btn = el('button', { class: 'k-dpad__btn', type: 'button', style: css }, buttonLabel(ctx, control))
      btn.setAttribute('aria-label', buttonLabel(ctx, control))
      btn.addEventListener(
        'click',
        function onKey(): void {
          options.onMove(dir)
        },
        false,
      )
      return btn
    }

    /*
     * 角落按钮：打上 k-dpad__corner，并把**通用按钮写下的行内尺寸清掉**。
     *
     * 为什么必须清：通用按钮（`button()`）会把 height / line-height / margin / padding
     * 写成**行内样式**，而行内样式压过样式表 —— 于是 CSS 里怎么写都没用
     * （实测 height 一直是 34、margin-right 一直是 3px，两处都改不动）。
     * 清掉之后尺寸完全由 CSS 的 `.k-dpad--tee .k-dpad__corner` 决定，
     * 与方向键取同一套数值：上排三列因此与下排三列对齐。
     */
    const markCorner = function markCorner(node: HTMLElement): void {
      const cls = node.getAttribute('class') ? node.getAttribute('class') + ' ' : ''
      node.setAttribute('class', cls + 'k-dpad__corner')
      node.style.height = ''
      node.style.lineHeight = ''
      node.style.margin = ''
      node.style.padding = ''
      node.style.display = ''
    }

    if (options.layout === 'row') {
      const row = el('div', { class: 'k-dpad k-dpad--row', role: 'group' })
      row.setAttribute('aria-label', ctx.t(options.padLabelKey))
      for (let i = 0; i < ROW_ORDER.length; i++) row.appendChild(key(ROW_ORDER[i]))
      wrap.appendChild(row)
    } else {
      // 倒 T：3 列 2 行，撤销/重开借上排两侧的格子
      const pad = el('div', { class: 'k-dpad k-dpad--tee', role: 'group' })
      pad.setAttribute('aria-label', ctx.t(options.padLabelKey))
      const table = el('table', { cellspacing: '0', cellpadding: '0', style: 'border-collapse:collapse;margin:0 auto;' })
      for (let r = 0; r < TEE_ROWS.length; r++) {
        const tr = el('tr', {})
        for (let c = 0; c < 3; c++) {
          const td = el('td', { style: 'border:none;padding:2px;text-align:center;vertical-align:middle;' })
          const dir = TEE_ROWS[r][c]
          if (dir !== null) {
            td.appendChild(key(dir))
          } else if (r === 0 && c === 0 && options.cornerLeft) {
            // 角落的 ↶/↻ 借放在上排两侧的空格里：**必须与方向键同尺寸**，
            // 否则上排是 48/72/48、下排是 72/72/72，三列边界对不上（用户报的"按钮错位"）
            markCorner(options.cornerLeft)
            td.appendChild(options.cornerLeft)
          } else if (r === 0 && c === 2 && options.cornerRight) {
            markCorner(options.cornerRight)
            td.appendChild(options.cornerRight)
          }
          tr.appendChild(td)
        }
        table.appendChild(tr)
      }
      pad.appendChild(table)
      wrap.appendChild(pad)
    }
  }

  // 普通按钮：两个一行地排（老引擎没有 flex-wrap，用 float 让它们自然折行）
  if (actionControls.length > 0) {
    const row = el('div', { class: 'k-controls__actions', style: 'overflow:hidden;' })
    for (let i = 0; i < actionControls.length; i++) {
      const control = actionControls[i]
      const btn = actionButton(ctx, control, function makeHandler(id: string): () => void {
        return function onClick(): void {
          options.onControl(id)
        }
      }(control.id), 72)
      btn.setAttribute('style', (btn.getAttribute('style') ?? '') + 'float:left;')
      row.appendChild(btn)
    }
    row.appendChild(el('div', { style: 'clear:both;' }))
    wrap.appendChild(row)
  }

  return wrap
}
