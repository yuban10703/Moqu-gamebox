/**
 * 应用外壳：路由、启动自检（存档恢复 / 离线准备 / 刷新档位）、硬件按键。
 *
 * 路由与浏览器历史一致，因此 Android 的系统返回键 = history.back()，
 * 浏览器返回键行为也一致（对应 E04：不重复执行旧输入、不占用系统保留键）。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { RecoveryReport, SaveEnvelope } from '@eink/core'
import type { Platform } from '@eink/platform'
import { useHardwarePageKeys } from './components.js'
import { UiProvider, useRootAttributes, useUi } from './contexts.js'
import type { GameLibrary, GameRegistryEntry } from './registry.js'
import { LibraryScreen } from './screens/LibraryScreen.js'
import { GameDetailScreen } from './screens/GameDetailScreen.js'
import { GameScreen } from './screens/GameScreen.js'
import { SettingsScreen } from './screens/SettingsScreen.js'
import { DiagnosticsScreen } from './screens/DiagnosticsScreen.js'
import { MotionTestScreen } from './screens/MotionTestScreen.js'
import { HelpScreen } from './screens/HelpScreen.js'

type Screen =
  | { name: 'library' }
  | { name: 'detail'; gameId: string }
  | { name: 'game'; gameId: string; difficulty: string; nonce: number }
  | { name: 'settings' }
  | { name: 'diagnostics' }
  | { name: 'motionTest' }
  | { name: 'help' }

export interface AppProps {
  platform: Platform
  library: GameLibrary
}

export function App({ platform, library }: AppProps): ReactNode {
  return (
    <UiProvider platform={platform} dicts={library.dicts}>
      <Shell library={library} />
    </UiProvider>
  )
}

function Shell({ library }: { library: GameLibrary }): ReactNode {
  const ui = useUi()
  const { platform } = ui
  const [screen, setScreen] = useState<Screen>({ name: 'library' })
  const [saves, setSaves] = useState<Record<string, SaveEnvelope>>({})
  const [corruptGameIds, setCorruptGameIds] = useState<string[]>([])
  const [recovery, setRecovery] = useState<RecoveryReport | null>(null)
  const nonceRef = useRef(1)
  /**
   * 本次页面加载的标识。只信任本次加载 push 进去的历史项 ——
   * 否则「WebView 重载 / 渲染进程崩溃自愈后」按返回会跳回重载前那张旧页面：
   * 崩溃自愈正是我们主动重载页面的场景，用户会莫名其妙地落回一个旧游戏页（探索式测试发现）。
   */
  const loadIdRef = useRef(`load-${Math.random().toString(36).slice(2)}`)

  useRootAttributes(ui.locale, ui.settings)
  // 实体翻页键 → 滚动当前可滚动区域（全应用生效，游戏页无滚动内容时自动无操作）
  useHardwarePageKeys()

  const refreshSaves = useCallback(async () => {
    const metas = await platform.storage.saves.list()
    const next: Record<string, SaveEnvelope> = {}
    const corrupt: string[] = []
    for (const meta of metas) {
      if (meta.corrupt) {
        corrupt.push(meta.gameId)
        continue
      }
      const envelope = await platform.storage.saves.load(meta.gameId)
      if (envelope) next[meta.gameId] = envelope
    }
    setSaves(next)
    setCorruptGameIds(corrupt)
  }, [platform])

  // 启动自检：先补提交未完成的存档，再读列表；同时准备离线资源、应用刷新档位
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const report = await platform.storage.recover()
      if (cancelled) return
      setRecovery(report)
      await refreshSaves()
      await platform.offline.ensure()
      platform.refresh.setProfile(ui.settings.refreshProfile)
    })()
    return () => {
      cancelled = true
    }
  }, [platform, refreshSaves, ui.settings.refreshProfile])

  const navigate = useCallback((next: Screen) => {
    if (typeof history !== 'undefined') {
      history.pushState({ screen: next, loadId: loadIdRef.current }, '')
    }
    setScreen(next)
  }, [])

  const goBack = useCallback(() => {
    if (typeof history !== 'undefined' && history.length > 1) history.back()
    else setScreen({ name: 'library' })
  }, [])

  // 启动时把「当前这一项」规范化成本次加载的首页：重载会带着旧 state 复用同一条历史记录
  useEffect(() => {
    if (typeof history === 'undefined') return
    history.replaceState({ screen: { name: 'library' }, loadId: loadIdRef.current }, '')
  }, [])

  useEffect(() => {
    const onPop = (event: PopStateEvent): void => {
      const state = event.state as { screen?: Screen; loadId?: string } | null
      // 陈旧历史项（来自上一次页面加载）：一律回首页，绝不跳回旧页面
      if (!state || state.loadId !== loadIdRef.current) {
        setScreen({ name: 'library' })
        return
      }
      setScreen(state.screen ?? { name: 'library' })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // 硬件按键：返回键交给路由；翻页键留给列表分页
  useEffect(() => {
    return platform.onHardwareKey((event) => {
      if (event.type === 'back') goBack()
    })
  }, [platform, goBack])

  // Android 系统返回键：壳层调用这个钩子，返回 false 表示已到首页、可以退出应用
  useEffect(() => {
    window.__einkHandleBack = (): boolean => {
      if (screen.name === 'library') return false
      goBack()
      return true
    }
    return () => {
      delete window.__einkHandleBack
    }
  }, [screen, goBack])

  // 页面标题跟随语言（index.html 里的标题只是脚本执行前的占位）
  useEffect(() => {
    document.title = ui.i18n.t('shell.app.title')
  }, [ui.i18n])

  const entry = (gameId: string): GameRegistryEntry<unknown, unknown> | undefined =>
    library.entries.find((candidate) => candidate.game.id === gameId)

  const startNew = async (gameId: string, difficulty: string): Promise<void> => {
    await platform.storage.saves.remove(gameId)
    await refreshSaves()
    nonceRef.current += 1
    navigate({ name: 'game', gameId, difficulty, nonce: nonceRef.current })
  }

  const resume = (gameId: string): void => {
    const envelope = saves[gameId]
    const target = entry(gameId)
    navigate({
      name: 'game',
      gameId,
      difficulty: envelope?.difficulty ?? target?.defaultDifficulty ?? 'starter',
      nonce: nonceRef.current,
    })
  }

  const renderScreen = (): ReactNode => {
    switch (screen.name) {
      case 'library':
        return (
          <LibraryScreen
            entries={library.entries}
            saves={saves}
            corruptGameIds={corruptGameIds}
            onOpenCorrupt={(gameId) => resume(gameId)}
            onContinue={(gameId) => resume(gameId)}
            onOpenDetail={(gameId) => navigate({ name: 'detail', gameId })}
            onSettings={() => navigate({ name: 'settings' })}
            onDiagnostics={() => navigate({ name: 'diagnostics' })}
            onHelp={() => navigate({ name: 'help' })}
          />
        )
      case 'detail': {
        const target = entry(screen.gameId)
        if (!target) {
          return (
            <LibraryScreen
              entries={library.entries}
              saves={saves}
              corruptGameIds={corruptGameIds}
              onOpenCorrupt={resume}
              onContinue={resume}
              onOpenDetail={() => undefined}
              onSettings={() => undefined}
              onDiagnostics={() => undefined}
              onHelp={() => undefined}
            />
          )
        }
        return (
          <GameDetailScreen
            entry={target}
            envelope={saves[screen.gameId]}
            corrupt={corruptGameIds.includes(screen.gameId)}
            onBack={goBack}
            onResume={() => resume(screen.gameId)}
            onStartNew={(difficulty) => void startNew(screen.gameId, difficulty)}
          />
        )
      }
      case 'game': {
        const target = entry(screen.gameId)
        if (!target) return null
        return (
          <GameScreen
            key={`${screen.gameId}-${screen.nonce}`}
            entry={target}
            difficulty={screen.difficulty}
            onBack={goBack}
            // 「返回游戏库」字面意思就是回库：原先与顶栏返回共用 goBack，
            // 点下去其实只到详情页，文案与行为不符（探索式测试发现）
            onExit={() => navigate({ name: 'library' })}
            onCommitted={() => void refreshSaves()}
          />
        )
      }
      case 'settings':
        return (
          <SettingsScreen
            onBack={goBack}
            onOpenHelp={() => navigate({ name: 'help' })}
            onBackupsChanged={() => void refreshSaves()}
          />
        )
      case 'diagnostics':
        return (
          <DiagnosticsScreen
            onBack={goBack}
            recovery={recovery}
            onOpenRefreshTest={() => navigate({ name: 'motionTest' })}
          />
        )
      case 'motionTest':
        return <MotionTestScreen onBack={goBack} />
      case 'help':
        return <HelpScreen onBack={goBack} onDiagnostics={() => navigate({ name: 'diagnostics' })} />
    }
  }

  return <div className="eink-app">{renderScreen()}</div>
}
