/**
 * 连续运动测试页：判定墨水屏上「连续运动」到底能做到什么程度。
 *
 * 为什么改成连续运动：上一版是一格一格跳的，用户反馈「只改画面时不够连续，看不出差异」，
 * 而且实测发现区域刷新传了矩形也是整屏刷新（见 docs/refresh-adaptation.md）。
 * 所以这一版用一个 **rAF 匀速滑动** 的圆点，配合五种刷新策略做对照，
 * 并且把「每秒帧数」直接显示出来 —— 流畅度是可量化的，不必只靠感觉。
 *
 * 五种策略：
 *   - 系统默认：不动用任何刷新接口，由系统决定怎么刷（基线）
 *   - 动画模式：EpdDeviceManager.enterAnimationUpdate（应用级快刷）
 *
 * 「高频全刷」已移到诊断页：它不是功能，只是对照工具。
 * 面板每秒只能完成约 2 次完整刷新，而内容每秒变 45 次，必然卡 ——
 * 留着放在这里容易被误当成一种「优化选项」。
 *
 * 已删除「系统快刷」（EpdController.applySystemFastMode）：它是**整机级**开关、会影响其它应用，
 * 本机还开不起来（回读始终 false），且属于擅自改动用户设备全局设置，产品里不应引入。
 *
 * 安全性：动画模式在停止、离开页面、组件卸载时都会退出，且只撤销本应用自己开的开关。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActionButton, TopBar } from '../components.js'
import { useUi } from '../contexts.js'

type Strategy = 'dom' | 'animation'
/** 运动物体的内容：纯黑白 vs 含灰阶（灰阶是快刷的软肋，用作加压） */
type ObjectStyle = 'bw' | 'gray'

const STRATEGIES: ReadonlyArray<{ value: Strategy; labelKey: string }> = [
  { value: 'dom', labelKey: 'shell.motiontest.strategy.dom' },
  { value: 'animation', labelKey: 'shell.motiontest.strategy.animation' },
]

const SPEEDS: ReadonlyArray<{ px: number; labelKey: string }> = [
  { px: 120, labelKey: 'shell.motiontest.speed.slow' },
  { px: 300, labelKey: 'shell.motiontest.speed.normal' },
  { px: 600, labelKey: 'shell.motiontest.speed.fast' },
]

const TRACK_WIDTH = 1100
const DOT_SIZE = 96
const CARD_WIDTH = 260
const CARD_HEIGHT = 96
/** 8 级离散灰阶（0% → 100%），避免用渐变近似 */
const GRAY_STEPS = [0, 36, 73, 109, 146, 182, 219, 255]
/** 状态栏刷新间隔：绝不能每帧调桥（每帧一次同步调用会把主线程占满） */
const STATUS_INTERVAL_MS = 1000
/**
 * 硬性自动停止：万一界面卡到点不动「停止」，也必须能自己停下来，
 * 不能把设备留在动画模式里（真机上已经踩过一次，只能杀进程）。
 */
const MAX_RUN_MS = 20000
/** 自动对比时每种策略的时长 */
const AUTO_PHASE_MS = 9000

export interface MotionTestScreenProps {
  onBack: () => void
}

export function MotionTestScreen({ onBack }: MotionTestScreenProps): ReactNode {
  const { i18n, platform } = useUi()
  const [strategy, setStrategy] = useState<Strategy>('dom')
  const [speed, setSpeed] = useState(300)
  const [objectStyle, setObjectStyle] = useState<ObjectStyle>('gray')
  const [running, setRunning] = useState(false)
  const [position] = useState(0)
  const [fps, setFps] = useState(0)
  const [frames, setFrames] = useState(0)
  const [stateText, setStateText] = useState('—')
  const [summary, setSummary] = useState<string[]>([])
  const [autoIndex, setAutoIndex] = useState(-1)

  const dotRef = useRef<HTMLDivElement | null>(null)
  const runStartRef = useRef(0)
  const lastStatusRef = useRef(0)
  const positionRef = useRef(0)
  const frameCountRef = useRef(0)
  const fpsWindowRef = useRef<{ start: number; frames: number }>({ start: 0, frames: 0 })
  const strategyRef = useRef<Strategy>(strategy)
  const autoRef = useRef<{ active: boolean; index: number; phaseStart: number; fps: number[] }>({
    active: false,
    index: 0,
    phaseStart: 0,
    fps: [],
  })

  strategyRef.current = strategy

  /**
   * 主循环里**不再有任何桥调用**。
   *
   * 这是用两次事故换来的结论：在 rAF 循环里同步调原生桥会把 WebView 主线程占满，
   * 触摸事件收不到（用户以为按钮坏了），渲染进程还可能因内存压力被杀
   * （真机日志：Scheduling restart of crashed service ...SandboxedProcessService0），
   * 此时页面直接变成一张冻住的死图。
   * 需要高频刷新就交给原生刷新泵，网页只负责开关。
   */

  // 连续运动主循环
  useEffect(() => {
    if (!running) return
    let raf = 0
    let last = performance.now()
    fpsWindowRef.current = { start: performance.now(), frames: 0 }
    runStartRef.current = performance.now()

    const loop = (now: number): void => {
      const delta = Math.min(now - last, 100)
      last = now
      frameCountRef.current += 1

      // 圆点位置**直接改 DOM**，不走 React state：
      // 每帧 setState 会触发整屏重渲染，正是之前把界面卡住的做法。
      // 行程按物体实际宽度算，否则带灰阶的卡片会滑出轨道右边界
      const travel = TRACK_WIDTH - (objectStyle === 'gray' ? CARD_WIDTH : DOT_SIZE)
      positionRef.current = (positionRef.current + (speed * delta) / 1000) % travel
      const dot = dotRef.current
      if (dot) dot.style.transform = `translateX(${Math.round(positionRef.current)}px)`

      const window = fpsWindowRef.current
      window.frames += 1
      if (now - window.start >= 1000) {
        const measured = Math.round((window.frames * 1000) / (now - window.start))
        setFps(measured)
        setFrames(frameCountRef.current)
        if (autoRef.current.active) autoRef.current.fps.push(measured)
        window.start = now
        window.frames = 0
      }

      // 状态栏最多每秒读一次，且只在内容变化时更新（原来每帧都调桥，是卡顿的主因）
      if (now - lastStatusRef.current >= STATUS_INTERVAL_MS) {
        lastStatusRef.current = now
        const next = platform.refresh.animationState()
        setStateText((previous) => (previous === next ? previous : next))
      }

      // 硬性自动停止：界面万一卡住，也必须能自己退出动画模式
      if (now - runStartRef.current >= MAX_RUN_MS) {
        setRunning(false)
        platform.refresh.setAnimationMode(false, 'auto')
        return
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [running, speed, objectStyle, platform])

  // 进入/退出对应策略的面板状态；任何路径退出都要恢复
  const applyStrategyState = useCallback(
    (next: Strategy, on: boolean): void => {
      if (next === 'animation') {
        // 必须指定路径：不指定会走优先级链，测的就不是动画模式本身
        const result = platform.refresh.setAnimationMode(on, next)
        setStateText(result.state)
        if (on && !result.ok) {
          setStateText(`${i18n.t('shell.motiontest.animationUnavailable')} · ${result.state}`)
        }
        return
      }
      setStateText(platform.refresh.animationState())
    },
    [i18n, platform],
  )

  const stop = useCallback((): void => {
    setRunning(false)
    applyStrategyState(strategyRef.current, false)
  }, [applyStrategyState])

  const start = useCallback(
    (next?: Strategy): void => {
      const target = next ?? strategyRef.current
      if (next) {
        setStrategy(next)
        strategyRef.current = next
      }
      frameCountRef.current = 0
      setFrames(0)
      applyStrategyState(target, true)
      setRunning(true)
    },
    [applyStrategyState],
  )

  // 注意：这里**不要**加「任意触摸即停止」。
  // 试过，结果是「先停后启」：pointerdown 先把 running 置 false，
  // 紧接着按钮 click 看到 false 就调了 start()，用户看到的是「点停止反而在跑」。
  // 而且页面真冻住时根本收不到任何事件，这类网页侧保险没有意义 ——
  // 真正的兜底在原生侧：刷新泵的硬超时、动画模式的原生看门狗、onPause 清理、
  // 以及渲染进程崩溃后的自愈重载。
  // 离开页面/卸载/页面被隐藏时都要退出动画模式：
  // 仅仅依赖「点停止」是不够的，真机上出现过界面卡住点不动的情况。
  useEffect(() => {
    const restore = (): void => {
      platform.refresh.setAnimationMode(false, 'auto')
      platform.refresh.stopRefreshPump()
    }
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') restore()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', restore)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', restore)
      restore()
    }
  }, [platform])

  /** 自动依次对比：每种策略跑一段时间，记录稳定后的帧数 */
  const runAuto = useCallback((): void => {
    const sequence: Strategy[] = ['dom', 'animation']
    autoRef.current = { active: true, index: 0, phaseStart: performance.now(), fps: [] }
    setSummary([])
    setAutoIndex(0)
    start(sequence[0])

    const advance = (index: number): void => {
      if (index >= sequence.length) {
        autoRef.current.active = false
        setAutoIndex(-1)
        setRunning(false)
        platform.refresh.setAnimationMode(false, 'auto')
        return
      }
      autoRef.current = {
        active: true,
        index,
        phaseStart: performance.now(),
        fps: [],
      }
      setAutoIndex(index)
      start(sequence[index])
      window.setTimeout(() => {
        const measured = autoRef.current.fps
        // 丢掉前 2 秒（进入模式后的稳定期），取后面的平均
        const stable = measured.slice(2)
        const average = stable.length
          ? Math.round(stable.reduce((sum, value) => sum + value, 0) / stable.length)
          : 0
        setSummary((previous) => [
          ...previous,
          `${i18n.t(
            sequence[index] === 'dom'
              ? 'shell.motiontest.strategy.dom'
              : 'shell.motiontest.strategy.animation',
          )}: ${average} FPS`,
        ])
        setRunning(false)
        platform.refresh.setAnimationMode(false, 'auto')
        window.setTimeout(() => advance(index + 1), 1500)
      }, AUTO_PHASE_MS)
    }
    advance(0)
  }, [i18n, platform, start])

  const dots = useMemo(() => Array.from({ length: 40 }, (_, index) => index), [])

  // 非运行态时把圆点位置同步到 DOM（运行态由主循环直接写，避免每帧 setState）
  useEffect(() => {
    const dot = dotRef.current
    if (dot && !running) dot.style.transform = `translateX(${Math.round(position)}px)`
  }, [position, running])

  return (
    <div className="eink-screen eink-screen--motion-test">
      <TopBar
        title={i18n.t('shell.motiontest.title')}
        subtitle={i18n.t('shell.motiontest.status', {
          fps: running ? fps : 0,
          frames,
          state: stateText,
        })}
        onBack={() => {
          stop()
          onBack()
        }}
      />

      <section className="eink-section">
        <h2>{i18n.t('shell.motiontest.strategy')}</h2>
        <div className="eink-choice-row">
          {STRATEGIES.map((option) => (
            <ActionButton
              key={option.value}
              labelKey={option.labelKey}
              emphasis={strategy === option.value ? 'primary' : 'normal'}
              onSelect={() => {
                stop()
                setStrategy(option.value)
                strategyRef.current = option.value
              }}
            />
          ))}
        </div>
        <div className="eink-choice-row">
          <ActionButton
            labelKey="shell.motiontest.object.bw"
            emphasis={objectStyle === 'bw' ? 'primary' : 'normal'}
            onSelect={() => setObjectStyle('bw')}
          />
          <ActionButton
            labelKey="shell.motiontest.object.gray"
            emphasis={objectStyle === 'gray' ? 'primary' : 'normal'}
            onSelect={() => setObjectStyle('gray')}
          />
        </div>
        <div className="eink-choice-row">
          {SPEEDS.map((option) => (
            <ActionButton
              key={option.px}
              labelKey={option.labelKey}
              emphasis={speed === option.px ? 'primary' : 'normal'}
              onSelect={() => setSpeed(option.px)}
            />
          ))}
        </div>
        <div className="eink-choice-row">
          {/* 开始与停止是两个独立按钮，不做二合一 toggle：
              toggle 依赖渲染时的 running 值，一旦有竞态就会「点停止反而在跑」。 */}
          <ActionButton
            labelKey="shell.motiontest.start"
            emphasis={running ? 'normal' : 'primary'}
            size="large"
            disabled={running}
            onSelect={() => start()}
          />
          <ActionButton
            labelKey="shell.motiontest.stop"
            emphasis={running ? 'primary' : 'normal'}
            size="large"
            disabled={!running}
            onSelect={stop}
          />
          <ActionButton labelKey="shell.motiontest.auto" size="large" onSelect={runAuto} />
          <ActionButton
            labelKey="shell.motiontest.clean"
            onSelect={() => platform.refresh.fullRefresh()}
          />
        </div>
        {platform.refresh.capability().animationMode ? null : (
          <p className="eink-muted">{i18n.t('shell.motiontest.animationUnavailable')}</p>
        )}
        {autoIndex >= 0 ? (
          <p className="eink-text">
            {i18n.t('shell.motiontest.autoRunning', { index: autoIndex + 1 })}
          </p>
        ) : null}
        {summary.length > 0 ? (
          <ul className="eink-list">
            {summary.map((line) => (
              <li className="eink-list__item" key={line}>
                {line}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* 运动轨道：圆点匀速滑动，位置每帧更新（不是一格一格跳） */}
      <section className="eink-section">
        <h2>{i18n.t('shell.motiontest.track')}</h2>
        <div className="eink-motion-track" style={{ width: TRACK_WIDTH, height: DOT_SIZE + 16 }}>
          <div className="eink-motion-rail" aria-hidden="true" />
          <div
            className="eink-motion-dot"
            data-style={objectStyle}
            ref={dotRef}
            style={{
              width: objectStyle === 'gray' ? CARD_WIDTH : DOT_SIZE,
              height: CARD_HEIGHT,
              transform: `translateX(${Math.round(position)}px)`,
            }}
          >
            {objectStyle === 'gray' ? (
              <>
                {/* 连续灰度渐变：测试中间灰能否在快刷下保住 */}
                <div className="eink-motion-gradient" />
                {/* 8 级离散灰阶：测试灰阶是否被抖动/压平成一团 */}
                <div className="eink-motion-steps">
                  {GRAY_STEPS.map((value) => (
                    <span
                      key={value}
                      style={{ background: `rgb(${value}, ${value}, ${value})` }}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </section>

      {/* 参照区：静止不动。变淡/发灰说明整屏被反复驱动 */}
      <section className="eink-section">
        <h2>{i18n.t('shell.motiontest.reference')}</h2>
        <div className="eink-refresh-stripes" aria-hidden="true">
          {dots.map((index) => (
            <span key={index} />
          ))}
        </div>
        <div className="eink-refresh-solid" aria-hidden="true" />
        <div className="eink-gray-wedge" aria-hidden="true">
          {GRAY_STEPS.map((value) => (
            <span key={value} style={{ background: `rgb(${value}, ${value}, ${value})` }} />
          ))}
        </div>
        <p className="eink-text">{i18n.t('shell.motiontest.watch')}</p>
      </section>
    </div>
  )
}
