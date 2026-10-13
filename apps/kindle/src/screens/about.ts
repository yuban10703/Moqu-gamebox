/**
 * 关于：产品信息、版本、为什么有这么一个 Kindle 版。
 * 版本号来自 core 的 APP_VERSION（与 Web/Android 同一个数字，避免各说各话）。
 */
import { APP_VERSION } from '@eink/core'
// 作者与项目信息是**纯数据**（不含 React），从源文件直接取——
// 本构建的 @eink/ui 特意只指向 registry.ts（不把 React 拖进 ES5 包）
import { AUTHOR_INFO } from '@eink/ui/screens/authorInfo.js'
import { PROJECT_INFO } from '@eink/ui/screens/projectInfo.js'
import { el, clear, on } from '../dom.js'
import type { Screen, ScreenCtx } from '../screen-ctx.js'
import { topBar, button, field, hugFooter } from './common.js'

export const renderAbout: Screen = function renderAbout(root: HTMLElement, ctx: ScreenCtx): () => void {
  const unbinds: Array<() => void> = []

  function draw(): void {
    clear(root)
    root.appendChild(
      topBar(ctx, {
        title: ctx.t('shell.about.title'),
        onBack: function back(): void {
          ctx.navigate('library')
        },
      }),
    )

    const body = el('div', { class: 'k-main', style: 'font-size:14px;line-height:1.6;' })
    body.appendChild(el('div', { style: 'font-size:17px;font-weight:700;' }, ctx.t('shell.about.product')))
    body.appendChild(el('div', { style: 'margin-bottom:10px;' }, ctx.t('shell.about.tagline')))
    body.appendChild(field(ctx.t('shell.common.version'), 'v' + APP_VERSION))

    /*
     * 作者与开源地址：**值来自集中配置**（现代版同源：authorInfo.ts / projectInfo.ts），
     * 词典里的 `shell.about.author.*` 只是各行**标签**——
     * 原先把标签当值渲染，屏幕上出现「作者信息：作者」这种占位残留（视觉检查发现的）。
     * 与现代版同一约定：某项留空就不渲染那一行，不留「待填写」之类的占位。
     */
    if (AUTHOR_INFO.name) {
      body.appendChild(field(ctx.t('shell.about.author.name'), AUTHOR_INFO.name))
    }
    if (AUTHOR_INFO.email) {
      body.appendChild(field(ctx.t('shell.about.author.email'), AUTHOR_INFO.email))
    }
    if (PROJECT_INFO.repoUrl) {
      // 地址本身做成链接：在线时能点开；离线时照样可长按选中抄下来
      const row = el('div', { style: 'font-size:14px;line-height:1.6;' })
      row.appendChild(el('span', { style: 'font-weight:700;' }, ctx.t('shell.about.source.title') + '：'))
      row.appendChild(
        /*
         * 链接要**自己撑到 44px 高**：13px 的行内文本只有 15px 高，
         * 触摸目标下限是 44×44（审计脚本会拦），而 Kindle 上手指点不中小目标。
         * 用 block + 纵向内边距把可点区域撑起来，颜色仍是纯黑（1-bit 下不加灰）。
         */
        el(
          'a',
          {
            href: PROJECT_INFO.repoUrl,
            style: 'display:block;padding:14px 0;color:#000;font-size:13px;line-height:20px;word-break:break-all;',
          },
          PROJECT_INFO.repoUrl,
        ),
      )
      body.appendChild(row)
    }
    root.appendChild(body)

    const footer = el('div', { class: 'k-footer', style: 'padding:6px 10px;border-top:1px solid #000;' })
    footer.appendChild(button(ctx.t('shell.nav.settings'), function settings(): void { ctx.navigate('settings') }, { small: true }))
    footer.appendChild(button(ctx.t('shell.nav.diagnostics'), function diag(): void { ctx.navigate('diagnostics') }, { small: true }))
    root.appendChild(footer)
    hugFooter(root, footer)
  }

  unbinds.push(
    on(document, 'keydown', function keydown(event: Event): void {
      const code = (event as KeyboardEvent).keyCode || 0
      if (code === 27 || code === 8) {
        event.preventDefault()
        ctx.navigate('library')
      }
    }),
  )

  draw()
  return function cleanup(): void {
    for (let i = 0; i < unbinds.length; i++) unbinds[i]()
  }
}
