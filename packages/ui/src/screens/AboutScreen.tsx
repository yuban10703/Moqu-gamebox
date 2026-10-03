/**
 * 关于页：项目名 + 版本号 + 一句话说明 + **用户自己编辑保存的「我的信息」**。
 *
 * 用户原话是「用于添加我的信息等等」——所以这里不是一块只读的 About 文本，
 * 而是一个可编辑、可保存、重开应用仍在的备注区（用户要求）。
 * 落盘走 platform.storage（与设置/存档同一套本机存储后端，见 packages/platform/src/appStorage.ts），
 * 界面不直接接触 localStorage / IndexedDB —— 否则 Android 端（原生 SQLite）会失效。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { APP_VERSION } from '@eink/core'
import { NOTE_MAX_LENGTH } from '@eink/platform'
import { ActionButton, TopBar } from '../components.js'
import { useUi } from '../contexts.js'

export interface AboutScreenProps {
  onBack: () => void
}

/** 保存状态：idle 表示还没动过，此时不能显示「已保存」（那是在宣称一件没发生过的事） */
type NoteStatus = 'idle' | 'saving' | 'saved' | 'failed'

export function AboutScreen({ onBack }: AboutScreenProps): ReactNode {
  const { i18n, platform } = useUi()
  /*
   * 构建时注入的版本信息（与首页右下角同源）；单测 / 非 vite 环境下不存在，
   * 因此做存在性判断（不能直接引用，否则在 vitest 里会抛 ReferenceError）。
   */
  const buildInfo = typeof __BUILD_INFO__ === 'undefined' ? null : __BUILD_INFO__
  const version = buildInfo?.version ?? APP_VERSION
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<NoteStatus>('idle')

  // 读回上次保存的内容；读失败退化成空输入框（个人备注读不出来不该弹错误）
  useEffect(() => {
    let cancelled = false
    void platform.storage.loadNote().then((text) => {
      if (!cancelled) setNote(text)
    })
    return () => {
      cancelled = true
    }
  }, [platform])

  const save = async (): Promise<void> => {
    setStatus('saving')
    const ok = await platform.storage.saveNote(note)
    setStatus(ok ? 'saved' : 'failed')
  }

  return (
    <div className="eink-screen eink-screen--sticky-footer">
      <TopBar title={i18n.t('shell.about.title')} onBack={onBack} />

      {/*
       * 内容可滚动 + 主操作（保存）固定在页脚：备注可能很长，
       * 但「保存」绝不能被文字顶出屏幕（与设置页同一套写法）。
       */}
      <div className="eink-screen__content">
        <section className="eink-section">
          {/* 项目名与一句话说明；名字跟随 i18n（英文界面显示罗马字 Moqu） */}
          <h2 className="eink-about__product">{i18n.t('shell.about.product')}</h2>
          <p className="eink-text">{i18n.t('shell.about.tagline')}</p>
          <p
            className="eink-muted"
            aria-label={`${i18n.t('shell.common.version')} ${version}${buildInfo ? ` ${buildInfo.stamp}` : ''}`}
          >
            v{version}
            {buildInfo ? ` · ${buildInfo.stamp}` : ''}
          </p>
        </section>

        <section className="eink-section">
          <h2>{i18n.t('shell.about.mine.title')}</h2>
          <p className="eink-muted">{i18n.t('shell.about.mine.hint')}</p>
          <textarea
            className="eink-note"
            // 读屏要能独立读懂这个输入框：标题在它之外，不一定被一起读到
            aria-label={i18n.t('shell.about.mine.title')}
            placeholder={i18n.t('shell.about.mine.placeholder')}
            maxLength={NOTE_MAX_LENGTH}
            rows={5}
            value={note}
            onChange={(event) => {
              setNote(event.target.value)
              // 内容一变，「已保存」就不再是事实
              if (status !== 'idle') setStatus('idle')
            }}
          />
          {status === 'saved' || status === 'failed' ? (
            <p className="eink-notice" role="status">
              {status === 'saved'
                ? i18n.t('shell.about.mine.saved')
                : i18n.t('shell.storage.failed', { reason: i18n.t('shell.storage.reason.io') })}
            </p>
          ) : null}
        </section>
      </div>

      <footer className="eink-footer">
        <ActionButton
          text={i18n.t('shell.about.mine.save')}
          emphasis="primary"
          disabled={status === 'saving'}
          onSelect={() => void save()}
        />
      </footer>
    </div>
  )
}
