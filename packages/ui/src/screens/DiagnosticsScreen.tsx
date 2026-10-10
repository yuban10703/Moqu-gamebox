/**
 * 诊断页：把 A01 设备基线、存档自检、webView 版本、缺失文案一次性摊开。
 * 真机跑一次，把文本复制进 docs/A01-device-baseline.md 即可。
 */
import { useEffect, useState, type ReactNode } from 'react'
import {
  formatBaseline,
  webViewMajor,
  type DeviceBaseline,
  type RecoveryReport,
  type SaveMeta,
} from '@eink/core'
import { ActionButton, TopBar } from '../components.js'
import { copyText } from '../clipboard.js'
import { useUi } from '../contexts.js'

/**
 * 本页判定 WebView 是否够用的阈值：**110**。
 *
 * 与 `apps/web/vite.config.ts` 的 `target: 'chrome110'`、原生闸 `MainActivity.MIN_WEBVIEW_MAJOR`、
 * 以及 `packages/platform/src/webviewSupport.ts` 的 `MIN_WEBVIEW_MAJOR` 同步（四处一起改）。
 * 注意：core 里另有一个 `MIN_WEBVIEW_MAJOR = 110`（原本写 69，已与页面统一为 110），已对齐实际构建目标，
 * 本页不使用它 —— 用 69 判定会把必然白屏的设备显示成"正常"。
 */
const MIN_WEBVIEW_MAJOR = 110

export interface DiagnosticsScreenProps {
  onBack: () => void
  recovery: RecoveryReport | null
}

export function DiagnosticsScreen({ onBack, recovery }: DiagnosticsScreenProps): ReactNode {
  const { i18n, platform, storage, locale } = useUi()
  const [baseline, setBaseline] = useState<DeviceBaseline | null>(null)
  const [saves, setSaves] = useState<SaveMeta[]>([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setBaseline(platform.baseline())
    void storage.saves.list().then(setSaves)
  }, [platform, storage])

  const text = baseline ? formatBaseline(baseline) : ''
  const major = webViewMajor(baseline?.webViewVersion ?? null)
  // 版本读不到时**不判为过低**（与原生闸、Web 探测同一口径：读不到不等于太旧，不能误伤）
  const webViewOutdated = major !== null && major < MIN_WEBVIEW_MAJOR

  return (
    <div className="eink-screen eink-screen--sticky-footer">
      <TopBar title={i18n.t('shell.diagnostics.title')} onBack={onBack} />

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
        {webViewOutdated ? (
          <p className="eink-notice" role="alert">
            {i18n.t('shell.diagnostics.webview.outdated', {
              current: String(major),
              required: String(MIN_WEBVIEW_MAJOR),
            })}
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
            // 复制走共用的 copyText（含非安全上下文兜底，见 ../clipboard.ts），失败如实反馈
            void copyText(payload).then(setCopied)
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
