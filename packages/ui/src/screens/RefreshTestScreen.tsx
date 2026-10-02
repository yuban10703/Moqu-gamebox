/**
 * 刷新测试页：用「连续移动」来判定区域刷新到底有没有用。
 *
 * 为什么要做成对照实验：截图和驱动计数都无法证明「面板是否只动了那一块」
 * （见 docs/refresh-adaptation.md），只能靠人眼比较。于是这里把三种方式并排做成可切换的模式：
 *
 *   - 只改画面：只改 DOM，不调用任何刷新接口 —— 系统默认行为基线
 *   - 区域刷新：改完 DOM 再请求刷新「运动区域」这一个矩形
 *   - 整屏全刷：改完 DOM 再请求整屏全刷 —— 对照组，必然会整屏闪
 *
 * 判断方法：
 *   1. 若「区域刷新」与「整屏全刷」的观感明显不同（只有框内在动 vs 整屏闪）→ 区域刷新有效；
 *   2. 若「区域刷新」与「只改画面」完全一样 → 说明系统本来就这么刷，我们的调用没有额外作用（至少无害）；
 *   3. 参照条纹是整屏是否被反复驱动的探针：它变淡/发灰就说明整屏被刷过。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActionButton, TopBar } from '../components.js'
import { useUi } from '../contexts.js'

type Mode = 'dom' | 'region' | 'full'

const GRID = 5
const CELL = 44
const INTERVALS: ReadonlyArray<{ ms: number; labelKey: string }> = [
  { ms: 3000, labelKey: 'shell.refreshtest.interval.slow' },
  { ms: 1500, labelKey: 'shell.refreshtest.interval.normal' },
  { ms: 800, labelKey: 'shell.refreshtest.interval.fast' },
]

export interface RefreshTestScreenProps {
  onBack: () => void
}

export function RefreshTestScreen({ onBack }: RefreshTestScreenProps): ReactNode {
  const { i18n, platform } = useUi()
  const capability = platform.refresh.capability()
  const regionAvailable = capability.regionRefresh
  const fullAvailable = capability.fullRefresh

  const [mode, setMode] = useState<Mode>(regionAvailable ? 'region' : 'dom')
  const [step, setStep] = useState(0)
  const [running, setRunning] = useState(false)
  const [intervalMs, setIntervalMs] = useState(1500)
  const [path, setPath] = useState<string>('—')
  const [events, setEvents] = useState<string[]>([])

  const regionRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<number | null>(null)

  const moveMarker = useCallback(
    (nextStep: number) => {
      setStep(nextStep)
      // 等两帧：先让浏览器把新画面合成完，再去驱动面板
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const element = regionRef.current
          if (!element || mode === 'dom') {
            setPath(mode === 'dom' ? i18n.t('shell.refreshtest.path.none') : '—')
            return
          }
          const rect = element.getBoundingClientRect()
          const dpr = window.devicePixelRatio || 1
          const box = {
            left: Math.round(rect.left * dpr),
            top: Math.round(rect.top * dpr),
            right: Math.round(rect.right * dpr),
            bottom: Math.round(rect.bottom * dpr),
          }
          const stamp = new Date().toLocaleTimeString(undefined, { hour12: false })
          if (mode === 'region') {
            const applied = platform.refresh.refreshRegion(box)
            setPath(applied ?? i18n.t('shell.refreshtest.path.failed'))
            setEvents((previous) =>
              [
                i18n.t('shell.refreshtest.event.region', {
                  time: stamp,
                  box: `${box.left},${box.top},${box.right},${box.bottom}`,
                  path: applied ?? i18n.t('shell.refreshtest.path.failed'),
                }),
                ...previous,
              ].slice(0, 6),
            )
          } else {
            platform.refresh.fullRefresh()
            setPath('refreshScreen(GC)')
            setEvents((previous) =>
              [i18n.t('shell.refreshtest.event.full', { time: stamp }), ...previous].slice(0, 6),
            )
          }
        })
      })
    },
    [i18n, mode, platform],
  )

  // 连续移动：按设定间隔自动推进一步
  useEffect(() => {
    if (!running) {
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
      timerRef.current = null
      return
    }
    timerRef.current = window.setInterval(() => {
      setStep((current) => {
        const next = current + 1
        moveMarker(next)
        return next
      })
    }, intervalMs)
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [running, intervalMs, moveMarker])

  const cells = useMemo(() => Array.from({ length: GRID * GRID }, (_, index) => index), [])
  const marker = step % (GRID * GRID)

  return (
    <div className="eink-screen eink-screen--refresh-test">
      <TopBar
        title={i18n.t('shell.refreshtest.title')}
        subtitle={i18n.t('shell.refreshtest.status', {
          step,
          mode: i18n.t(`shell.refreshtest.mode.${mode}`),
          path,
        })}
        onBack={onBack}
      />

      <section className="eink-section">
        <h2>{i18n.t('shell.refreshtest.mode')}</h2>
        <div className="eink-choice-row">
          <ActionButton
            labelKey="shell.refreshtest.mode.dom"
            emphasis={mode === 'dom' ? 'primary' : 'normal'}
            onSelect={() => setMode('dom')}
          />
          <ActionButton
            labelKey="shell.refreshtest.mode.region"
            emphasis={mode === 'region' ? 'primary' : 'normal'}
            disabled={!regionAvailable}
            onSelect={() => setMode('region')}
          />
          <ActionButton
            labelKey="shell.refreshtest.mode.full"
            emphasis={mode === 'full' ? 'primary' : 'normal'}
            disabled={!fullAvailable}
            onSelect={() => setMode('full')}
          />
        </div>
        {regionAvailable ? null : (
          <p className="eink-muted">{i18n.t('shell.refreshtest.unsupported')}</p>
        )}
        <div className="eink-choice-row">
          {INTERVALS.map((option) => (
            <ActionButton
              key={option.ms}
              labelKey={option.labelKey}
              emphasis={intervalMs === option.ms ? 'primary' : 'normal'}
              onSelect={() => setIntervalMs(option.ms)}
            />
          ))}
        </div>
        <div className="eink-choice-row">
          <ActionButton
            labelKey={running ? 'shell.refreshtest.stop' : 'shell.refreshtest.start'}
            emphasis="primary"
            size="large"
            onSelect={() => setRunning((value) => !value)}
          />
          <ActionButton
            labelKey="shell.refreshtest.step"
            size="large"
            onSelect={() => moveMarker(step + 1)}
          />
          <ActionButton
            labelKey="shell.refreshtest.reset"
            onSelect={() => {
              setRunning(false)
              setStep(0)
              setEvents([])
              setPath('—')
            }}
          />
        </div>
      </section>

      {/* 运动区域：我们请求刷新的那个矩形。框内内容每步都变，框外保持静止。 */}
      <section className="eink-section">
        <h2>{i18n.t('shell.refreshtest.region')}</h2>
        <div className="eink-refresh-region" ref={regionRef}>
          <div
            className="eink-refresh-grid"
            style={{
              gridTemplateColumns: `repeat(${GRID}, ${CELL}px)`,
              gridTemplateRows: `repeat(${GRID}, ${CELL}px)`,
            }}
          >
            {cells.map((index) => (
              <span key={index} className="eink-refresh-cell" data-on={index === marker ? 'yes' : 'no'} />
            ))}
          </div>
          <p className="eink-refresh-status">{i18n.t('shell.refreshtest.regionCaption')}</p>
        </div>
      </section>

      {/* 参照区：内容完全静止。它一旦有任何变化/发灰，就说明整屏被反复驱动过。 */}
      <section className="eink-section">
        <h2>{i18n.t('shell.refreshtest.reference')}</h2>
        <div className="eink-refresh-stripes" aria-hidden="true">
          {Array.from({ length: 80 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
        <div className="eink-refresh-solid" aria-hidden="true" />
        <p className="eink-text">{i18n.t('shell.refreshtest.watch')}</p>
      </section>

      {events[0] ? <p className="eink-muted">{events[0]}</p> : null}

      <footer className="eink-footer">
        <ActionButton
          labelKey="shell.settings.fullRefreshNow"
          disabled={!fullAvailable}
          onSelect={() => platform.refresh.fullRefresh()}
        />
      </footer>
    </div>
  )
}
