/**
 * 设置：语言、方向键、自动步进、数据管理（导出 / 导入 / 清除）。
 *
 * 只保留 Kindle 版真正生效的项 —— 界面上的每一行都必须真的改变行为，
 * 否则就是假开关（原版把「字号缩放」等交给 CSS 变量，这里没有变量可用）。
 */
import { el, clear, on } from '../dom.js'
import type { Screen, ScreenCtx } from '../screen-ctx.js'
import { clearAll, listSaves, loadSettings, rawSaves, saveSettings, storageAvailable } from '../store.js'
import { topBar, button, showDialog, field } from './common.js'

export const renderSettings: Screen = function renderSettings(root: HTMLElement, ctx: ScreenCtx): () => void {
  const unbinds: Array<() => void> = []
  let exportText: string | null = null

  function draw(): void {
    clear(root)
    const settings = ctx.settings

    root.appendChild(
      topBar(ctx, {
        title: ctx.t('shell.settings.title'),
        onBack: function back(): void {
          ctx.navigate('library')
        },
      }),
    )

    const body = el('div', { class: 'k-main', style: 'font-size:14px;' })

    // 语言
    body.appendChild(el('div', { class: 'k-section__title', style: 'font-size:15px;font-weight:700;margin:8px 0 6px;' }, ctx.t('shell.settings.language')))
    const langs: Array<{ id: 'zh-CN' | 'en-US'; label: string }> = [
      { id: 'zh-CN', label: '简体中文' },
      { id: 'en-US', label: 'English' },
    ]
    const langRow = el('div', {})
    for (let i = 0; i < langs.length; i++) {
      const item = langs[i]
      langRow.appendChild(
        button(item.label, function pick(): void {
          ctx.updateSettings({ locale: item.id })
          draw()
        }, { small: true, primary: settings.locale === item.id }),
      )
    }
    body.appendChild(langRow)

    // 方向键
    body.appendChild(el('div', { class: 'k-section__title', style: 'font-size:15px;font-weight:700;margin:14px 0 6px;' }, ctx.t('shell.settings.dpad')))
    // 这里**不放**滑动提示：设置页与具体玩法无关，而滑动只对方向键驱动的玩法有效。
    // 那句话（"…用滑动操作"）现在只在详情页、且该玩法真的能滑动时出现。

    const dpadRow = el('div', {})
    dpadRow.appendChild(
      button(ctx.t('shell.common.on'), function onDpad(): void {
        ctx.updateSettings({ dpad: true })
        draw()
      }, { small: true, primary: settings.dpad }),
    )
    dpadRow.appendChild(
      button(ctx.t('shell.common.off'), function offDpad(): void {
        ctx.updateSettings({ dpad: false })
        draw()
      }, { small: true, primary: !settings.dpad }),
    )
    body.appendChild(dpadRow)

    // 自动步进
    body.appendChild(el('div', { class: 'k-section__title', style: 'font-size:15px;font-weight:700;margin:14px 0 6px;' }, ctx.t('shell.settings.timer')))
    const tickRow = el('div', {})
    tickRow.appendChild(
      button(ctx.t('shell.common.on'), function onTick(): void {
        ctx.updateSettings({ autoTick: true })
        draw()
      }, { small: true, primary: settings.autoTick }),
    )
    tickRow.appendChild(
      button(ctx.t('shell.common.off'), function offTick(): void {
        ctx.updateSettings({ autoTick: false })
        draw()
      }, { small: true, primary: !settings.autoTick }),
    )
    body.appendChild(tickRow)

    // 存储
    body.appendChild(el('div', { class: 'k-section__title', style: 'font-size:15px;font-weight:700;margin:14px 0 6px;' }, ctx.t('shell.storage.title')))
    body.appendChild(field(ctx.t('shell.common.version'), ctx.t('shell.storage.saved')))
    const available = storageAvailable()
    if (!available) {
      body.appendChild(el('div', { style: 'border:1px dashed #000;padding:8px;margin:6px 0;font-size:13px;' }, ctx.t('shell.storage.notPersistent')))
    }
    const saves = listSaves()
    body.appendChild(field(ctx.t('shell.diagnostics.saves'), String(saves.length)))

    const dataRow = el('div', { style: 'margin-top:8px;' })
    dataRow.appendChild(
      button(ctx.t('shell.storage.export'), function doExport(): void {
        exportText = JSON.stringify({ settings: loadSettings(), saves: rawSaves() })
        draw()
      }, { small: true }),
    )
    dataRow.appendChild(
      button(ctx.t('shell.storage.clear'), function doClear(): void {
        showDialog({
          title: ctx.t('shell.storage.clearConfirm'),
          actions: [
            { label: ctx.t('shell.common.cancel'), onClick: function cancel(): void {} },
            {
              label: ctx.t('shell.common.confirm'),
              primary: true,
              onClick: function confirm(): void {
                clearAll()
                ctx.setStatus(ctx.t('shell.storage.clearDone'))
                draw()
              },
            },
          ],
        })
      }, { small: true, danger: true }),
    )
    body.appendChild(dataRow)

    if (exportText) {
      // 老引擎上 <textarea> 是唯一能选中复制的控件；Kindle 没有剪贴板 API
      const area = el('textarea', {
        style: 'width:100%;height:120px;font-size:11px;margin-top:8px;box-sizing:border-box;border:1px solid #000;',
      })
      ;(area as HTMLTextAreaElement).value = exportText
      body.appendChild(area)
      body.appendChild(el('div', { style: 'font-size:12px;line-height:1.5;margin-top:4px;' }, ctx.t('shell.storage.exported')))
    }

    root.appendChild(body)

    const footer = el('div', { class: 'k-footer', style: 'padding:6px 10px;border-top:1px solid #000;' })
    footer.appendChild(button(ctx.t('shell.nav.about'), function about(): void { ctx.navigate('about') }, { small: true }))
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

  // 设置改动一律落盘：Kindle 上用户可能随时合上盖子
  const original = ctx.updateSettings
  void original
  void saveSettings

  draw()

  return function cleanup(): void {
    for (let i = 0; i < unbinds.length; i++) unbinds[i]()
  }
}
