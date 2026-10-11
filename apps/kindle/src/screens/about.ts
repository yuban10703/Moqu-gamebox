/**
 * 关于：产品信息、版本、为什么有这么一个 Kindle 版。
 * 版本号来自 core 的 APP_VERSION（与 Web/Android 同一个数字，避免各说各话）。
 */
import { APP_VERSION } from '@eink/core'
import { el, clear, on } from '../dom.js'
import type { Screen, ScreenCtx } from '../screen-ctx.js'
import { topBar, button, field } from './common.js'

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
    body.appendChild(field(ctx.t('shell.common.version'), APP_VERSION))
    body.appendChild(field(ctx.t('shell.about.author.title'), ctx.t('shell.about.author.name')))
    body.appendChild(
      el('p', { style: 'margin:12px 0 0;font-size:13px;' }, ctx.t('shell.about.source.title')),
    )
    root.appendChild(body)

    const footer = el('div', { class: 'k-footer', style: 'padding:6px 10px;border-top:1px solid #000;' })
    footer.appendChild(button(ctx.t('shell.nav.settings'), function settings(): void { ctx.navigate('settings') }, { small: true }))
    footer.appendChild(button(ctx.t('shell.nav.diagnostics'), function diag(): void { ctx.navigate('diagnostics') }, { small: true }))
    root.appendChild(footer)
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
