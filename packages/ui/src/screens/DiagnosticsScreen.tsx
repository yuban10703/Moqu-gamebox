/**
 * 诊断页：把 A01 设备基线、刷新能力、存档自检、webView 版本、缺失文案一次性摊开。
 * 真机跑一次，把文本复制进 docs/A01-device-baseline.md 即可。
 */
import { useEffect, useState, type ReactNode } from 'react'
import {
  formatBaseline,
  isWebViewSufficient,
  webViewMajor,
  type DeviceBaseline,
  type RecoveryReport,
  type SaveMeta,
} from '@eink/core'
import { ActionButton, TopBar } from '../components.js'
import { useUi } from '../contexts.js'

export interface DiagnosticsScreenProps {
  onBack: () => void
  onOpenRefreshTest: () => void
  recovery: RecoveryReport | null
}

export function DiagnosticsScreen({ onBack, onOpenRefreshTest, recovery }: DiagnosticsScreenProps): ReactNode {
  const { i18n, platform, storage, locale } = useUi()
  const [baseline, setBaseline] = useState<DeviceBaseline | null>(null)
  const [saves, setSaves] = useState<SaveMeta[]>([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setBaseline(platform.baseline())
    void storage.saves.list().then(setSaves)
  }, [platform, storage])

  const text = baseline ? formatBaseline(baseline) : ''
  const capability = platform.refresh.capability()
  const major = webViewMajor(baseline?.webViewVersion ?? null)

  return (
    <div className="eink-screen eink-screen--sticky-footer">
      <TopBar title={i18n.t('shell.diagnostics.title')} onBack={onBack}>
        {capability.animationMode ? (
          <ActionButton
            labelKey="shell.diagnostics.refreshTest"
            size="large"
            onSelect={onOpenRefreshTest}
          />
        ) : null}
      </TopBar>

      {/* 主操作固定在页脚；原始转储很长（实测可达 1884px），绝不能把按钮顶出首屏 */}
      <div className="eink-screen__content">
      <section className="eink-section">
        <h2>{i18n.t('shell.diagnostics.device')}</h2>
        <dl className="eink-kv">
          <Row label="platform" value={baseline?.platform ?? '-'} />
          <Row label="manufacturer" value={baseline?.manufacturer || '-'} />
          <Row label="model" value={baseline?.model || '-'} />
          <Row label="androidSdk" value={baseline?.androidSdk === null || baseline?.androidSdk === undefined ? '-' : String(baseline.androidSdk)} />
          <Row label="webView" value={baseline?.webViewVersion ?? '-'} />
          <Row label="locale" value={locale} />
        </dl>
        {!isWebViewSufficient(baseline?.webViewVersion ?? null) ? (
          <p className="eink-notice" role="alert">
            {i18n.t('shell.diagnostics.webview.outdated', { version: String(major ?? '?') })}
          </p>
        ) : null}
      </section>

      <section className="eink-section">
        <h2>{i18n.t('shell.diagnostics.viewport')}</h2>
        <dl className="eink-kv">
          <Row
            label="css"
            value={baseline ? `${baseline.viewport.width}x${baseline.viewport.height} @dpr ${baseline.viewport.dpr}` : '-'}
          />
          <Row
            label="screen"
            value={baseline?.screen ? `${baseline.screen.width}x${baseline.screen.height}` : '-'}
          />
          <Row
            label="touch"
            value={baseline ? `${baseline.touch.maxTouchPoints} / coarse=${String(baseline.touch.coarse)}` : '-'}
          />
        </dl>
      </section>

      <section className="eink-section">
        <h2>{i18n.t('shell.diagnostics.refresh')}</h2>
        <p className={capability.onyxSdkFound ? 'eink-notice' : 'eink-muted'}>
          {i18n.t(capability.onyxSdkFound ? 'shell.diagnostics.sdk.found' : 'shell.diagnostics.sdk.missing')}
        </p>
        <dl className="eink-kv">
          <Row label="features" value={capability.features.join(',') || '-'} />
          <Row label="modes" value={capability.modes.join(',') || '-'} />
          <Row label="fullRefresh" value={String(capability.fullRefresh)} />
          <Row label="partialProfiles" value={String(capability.partialProfiles)} />
          <Row label="regionRefresh" value={String(capability.regionRefresh)} />

          <Row label="fastMode" value={String(capability.fastMode)} />
          <Row label={i18n.t('shell.diagnostics.fullRefresh')} value={String(platform.refresh.stats().fullRefreshes)} />
        </dl>
        {!capability.onyxSdkFound ? (
          <p className="eink-text">{i18n.t('shell.diagnostics.help.body')}</p>
        ) : null}
      </section>

      <section className="eink-section">
        <h2>{i18n.t('shell.diagnostics.saves')}</h2>
        <dl className="eink-kv">
          <Row label="storage" value={platform.storage.kind} />
          {saves.map((meta) => (
            <Row
              key={meta.gameId}
              label={meta.gameId}
              value={`commit ${meta.commitId} · moves ${meta.moves}${meta.corrupt ? ' · CORRUPT' : ''}`}
            />
          ))}
        </dl>
        {recovery ? (
          <>
            <p className="eink-muted">
              {i18n.t('shell.diagnostics.saves.recovered', { count: recovery.recovered.length })}
            </p>
            <p className="eink-muted">
              {i18n.t('shell.diagnostics.saves.discarded', { count: recovery.discarded.length })}
            </p>
          </>
        ) : null}
      </section>

      <section className="eink-section">
        <h2>{i18n.t('shell.diagnostics.missingKeys')}</h2>
        <p className="eink-muted">{i18n.missingKeys().join(', ') || '—'}</p>
      </section>

      {/* 原始转储很长（实测可达 1884px）：必须放在**可滚动的内容区**里。
          之前它被放在页脚里，页脚被撑到 504px，内容再长就会把页脚自己顶出视口。 */}
      <section className="eink-section">
        <h2>{i18n.t('shell.diagnostics.raw')}</h2>
        <div className="eink-diagnostics__raw">
          <pre>{text || '—'}</pre>
        </div>
      </section>
      </div>

      <footer className="eink-footer">
        <ActionButton
          labelKey="shell.diagnostics.copy"
          emphasis="primary"
          onSelect={() => {
            const payload = `${text}\nstorage: ${platform.storage.kind}\nmissingKeys: ${i18n.missingKeys().join(',')}`
            if (typeof navigator !== 'undefined' && navigator.clipboard) {
              void navigator.clipboard.writeText(payload).then(() => setCopied(true))
            } else {
              setCopied(false)
            }
          }}
        />
        {copied ? <span className="eink-muted">{i18n.t('shell.diagnostics.copied')}</span> : null}
      </footer>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className="eink-kv__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
