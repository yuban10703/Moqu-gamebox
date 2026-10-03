/** 帮助页：墨水屏使用说明、离线说明、存档说明、键盘与硬件键。 */
import type { ReactNode } from 'react'
import { TopBar } from '../components.js'
import { useUi } from '../contexts.js'
import { useOfflineState } from '../useOfflineState.js'

export interface HelpScreenProps {
  onBack: () => void
  onDiagnostics: () => void
}

const CONTROL_KEYS = [
  'shell.help.controls.move',
  'shell.help.controls.undo',
  'shell.help.controls.restart',
  'shell.help.controls.pause',
  'shell.help.controls.paging',
]

export function HelpScreen({ onBack, onDiagnostics }: HelpScreenProps): ReactNode {
  const { i18n, platform } = useUi()
  const capability = platform.refresh.capability()
  // 订阅而不是读一次快照：否则 SW 就绪后这里的离线状态不会更新
  const offline = useOfflineState(platform.offline)

  return (
    <div className="eink-screen eink-screen--sticky-footer">
      <TopBar title={i18n.t('shell.nav.help')} onBack={onBack} />

      {/* 主操作固定在页脚；说明内容可滚动（窄屏上内容必然超过一屏，但操作不该被推下去） */}
      <div className="eink-screen__content">
      <section className="eink-section">
        <h2>{i18n.t('shell.diagnostics.help')}</h2>
        <p className="eink-text">{i18n.t('shell.diagnostics.help.body')}</p>
        {capability.fullRefresh ? <p className="eink-notice">{i18n.t('shell.diagnostics.sdk.found')}</p> : null}
      </section>

      <section className="eink-section">
        <h2>{i18n.t('shell.help.offline.title')}</h2>
        <p className="eink-notice">
          {i18n.t(
            offline === 'ready'
              ? 'shell.offline.ready'
              : offline === 'preparing'
                ? 'shell.offline.preparing'
                : 'shell.offline.unavailable',
          )}
        </p>
        <p className="eink-text">{i18n.t('shell.help.offline.body')}</p>
      </section>

      <section className="eink-section">
        <h2>{i18n.t('shell.help.saves.title')}</h2>
        <p className="eink-text">{i18n.t('shell.help.saves.body')}</p>
        {platform.storage.persistent ? null : (
          <p className="eink-notice" role="alert">
            {i18n.t('shell.help.storage.warning')}
          </p>
        )}
      </section>

      <section className="eink-section">
        <h2>{i18n.t('shell.help.controls.title')}</h2>
        <ul className="eink-list">
          {CONTROL_KEYS.map((key) => (
            <li className="eink-list__item" key={key}>
              {i18n.t(key)}
            </li>
          ))}
        </ul>
      </section>

      </div>

      <footer className="eink-footer">
        <button type="button" className="eink-link" onClick={onDiagnostics}>
          {i18n.t('shell.nav.diagnostics')}
        </button>
      </footer>
    </div>
  )
}
