/**
 * 设置与数据管理。
 * 「不支持的选项不作为可用选项显示」——只呈现本设备真正生效的选项。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { APP_VERSION, MAX_BACKUP_BYTES, type ConflictStrategy } from '@eink/core'
import { ActionButton, Dialog, TopBar } from '../components.js'
import { FONT_SCALE_OPTIONS, LOCALE_OPTIONS, useUi } from '../contexts.js'

export interface SettingsScreenProps {
  onBack: () => void
  onOpenHelp: () => void
  onBackupsChanged: () => void
}

export function SettingsScreen({ onBack, onOpenHelp, onBackupsChanged }: SettingsScreenProps): ReactNode {
  const { i18n, settings, updateSettings, platform, storage } = useUi()
  const [message, setMessage] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [backups, setBackups] = useState<Array<{ gameId: string; slot: number }>>([])
  const fileInput = useRef<HTMLInputElement | null>(null)

  const reloadBackups = async (): Promise<void> => {
    const list = await storage.listBackups()
    setBackups(list.map((item) => ({ gameId: item.gameId, slot: item.slot })))
  }

  useEffect(() => {
    void reloadBackups()
  }, [storage])

  const doExport = async (): Promise<void> => {
    const text = await storage.createBackupText(platform.baseline(), Date.now())
    const fileName = `moqu-backup-${new Date().toISOString().slice(0, 10)}.json`
    const result = await platform.exportBackup(fileName, text)
    setMessage(result.ok ? i18n.t('shell.storage.exported') : i18n.t('shell.storage.importFailed', { reason: result.error ?? '' }))
  }

  const applyImportText = async (text: string, strategy: ConflictStrategy): Promise<void> => {
    const outcome = await storage.applyImport(text, strategy)
    if (outcome.ok) {
      setMessage(
        i18n.t('shell.storage.importOk', {
          count: outcome.summary.added + outcome.summary.overwritten + outcome.summary.keptBoth,
        }),
      )
      await reloadBackups()
      onBackupsChanged()
    } else {
      setMessage(i18n.t('shell.storage.importFailed', { reason: outcome.reason }))
    }
  }

  const doImport = async (): Promise<void> => {
    const nativeText = await platform.importBackup()
    if (nativeText !== null) {
      await applyImportText(nativeText, 'keepBoth')
      return
    }
    if (platform.kind === 'web') fileInput.current?.click()
  }

  return (
    <div className="eink-screen eink-screen--sticky-footer">
      <TopBar title={i18n.t('shell.settings.title')} onBack={onBack} />

      {/*
       * 内容滚动 + 页脚固定：设置项会随字号变大而变高，
       * 原先没有这一层，字号切到「大」时页面 930 > 视口 847，
       * 「清除全部进度」被顶出屏幕（探索式测试发现）。
       */}
      <div className="eink-screen__content">
      <section className="eink-section">
        <h2>{i18n.t('shell.settings.language')}</h2>
        <div className="eink-choice-row">
          {LOCALE_OPTIONS.map((option) => (
            <ActionButton
              key={option.value}
              text={option.label ?? i18n.t(option.labelKey)}
              emphasis={settings.locale === option.value ? 'primary' : 'normal'}
              onSelect={() => void updateSettings({ locale: option.value })}
            />
          ))}
        </div>
      </section>

      <section className="eink-section">
        <h2>{i18n.t('shell.settings.fontScale')}</h2>
        <div className="eink-choice-row">
          {FONT_SCALE_OPTIONS.map((option) => (
            <ActionButton
              key={String(option.value)}
              labelKey={option.labelKey}
              emphasis={settings.fontScale === option.value ? 'primary' : 'normal'}
              onSelect={() => void updateSettings({ fontScale: option.value })}
            />
          ))}
        </div>
      </section>

      <section className="eink-section">
        <h2>{i18n.t('shell.settings.appliesToAll')}</h2>
        <div className="eink-choice-row">
          <ActionButton
            text={`${i18n.t('shell.settings.timer')}: ${settings.timer ? i18n.t('shell.common.on') : i18n.t('shell.common.off')}`}
            emphasis={settings.timer ? 'primary' : 'normal'}
            onSelect={() => void updateSettings({ timer: !settings.timer })}
          />
          <ActionButton
            text={`${i18n.t('shell.settings.dpad')}: ${settings.dpad ? i18n.t('shell.common.on') : i18n.t('shell.common.off')}`}
            emphasis={settings.dpad ? 'primary' : 'normal'}
            onSelect={() => void updateSettings({ dpad: !settings.dpad })}
          />
          <ActionButton
            text={`${i18n.t('shell.settings.boldLines')}: ${settings.boldLines ? i18n.t('shell.common.on') : i18n.t('shell.common.off')}`}
            emphasis={settings.boldLines ? 'primary' : 'normal'}
            onSelect={() => void updateSettings({ boldLines: !settings.boldLines })}
          />
        </div>
      </section>

      <section className="eink-section">
        <h2>{i18n.t('shell.storage.title')}</h2>
        <div className="eink-card__actions">
          <ActionButton labelKey="shell.storage.export" onSelect={() => void doExport()} />
          <ActionButton labelKey="shell.storage.import" onSelect={() => void doImport()} />
          <ActionButton labelKey="shell.storage.clear" onSelect={() => setConfirmClear(true)} />
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            const input = event.currentTarget
            if (file.size > MAX_BACKUP_BYTES) {
              setMessage(i18n.t('shell.storage.importFailed', { reason: 'backup-too-large' }))
              input.value = ''
              return
            }
            void file
              .text()
              .then((text) => applyImportText(text, 'keepBoth'))
              .catch(() => {
                setMessage(i18n.t('shell.storage.importFailed', { reason: 'read-failed' }))
              })
              .finally(() => {
                input.value = ''
              })
          }}
        />
        {backups.length > 0 ? (
          <div className="eink-backups">
            <h3>{i18n.t('shell.storage.conflict')}</h3>
            <ul className="eink-list">
              {backups.map((backup) => (
                <li key={`${backup.gameId}-${backup.slot}`} className="eink-list__item">
                  <span>{new Date(backup.slot).toLocaleString()}</span>
                  {/* 文案曾用「继续」，但动作其实是 restoreBackup —— 恢复路径上的歧义最容易误操作 */}
                  <ActionButton
                    labelKey="shell.storage.restore"
                    onSelect={() => {
                      void storage.restoreBackup(backup.gameId, backup.slot).then(async (ok) => {
                        setMessage(ok ? i18n.t('shell.storage.saved') : i18n.t('shell.storage.importFailed', { reason: 'backup' }))
                        onBackupsChanged()
                      })
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {message ? (
          <p className="eink-notice" role="status">
            {message}
          </p>
        ) : null}
      </section>
      </div>

      <footer className="eink-footer">
        {/* The help entry used to live in the refresh-profile section; that section is gone */}
        <button type="button" className="eink-link" onClick={onOpenHelp}>
          {i18n.t('shell.nav.help')}
        </button>
        <span className="eink-muted">{`v${APP_VERSION}`}</span>
      </footer>

      {confirmClear ? (
        <Dialog
          titleKey="shell.storage.clear"
          bodyKey="shell.storage.clearConfirm"
          confirmKey="shell.storage.clear"
          cancelKey="shell.common.cancel"
          danger
          onConfirm={() => {
            setConfirmClear(false)
            void storage.clearAll().then(() => {
              setMessage(i18n.t('shell.storage.clearDone'))
              onBackupsChanged()
            })
          }}
          onCancel={() => setConfirmClear(false)}
        />
      ) : null}
    </div>
  )
}
