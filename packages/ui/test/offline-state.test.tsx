// @vitest-environment jsdom
/**
 * `useOfflineState` 的回归测试。
 *
 * 背景：首页与帮助页原先在渲染时直接调用 `platform.offline.state()`，只是"读一次快照"、没有订阅，
 * 于是 Service Worker 从「准备中」变成「就绪」时界面不会重渲染（徽标卡在旧状态）。
 * 这里用一个可手动驱动的假 store 把"变化 → 重渲染"这条链路钉住。
 */
import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { OfflineController, OfflineState } from '@eink/platform'
import { useOfflineState } from '../src/useOfflineState.js'

/** 可手动驱动的假 store，并暴露监听者数量用于验证不泄漏 */
function fakeOffline(initial: OfflineState) {
  let state = initial
  const listeners = new Set<(state: OfflineState) => void>()
  const controller: OfflineController = {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    ensure: async () => state,
    dispose() {
      listeners.clear()
    },
  }
  return {
    controller,
    listenerCount: () => listeners.size,
    set(next: OfflineState) {
      state = next
      for (const listener of listeners) listener(next)
    },
  }
}

function Probe({ offline }: { offline: OfflineController }) {
  return <span data-testid="state">{useOfflineState(offline)}</span>
}

describe('useOfflineState', () => {
  it('store 变化时界面跟着更新（这正是原先卡住的那一步）', () => {
    const fake = fakeOffline('preparing')
    render(<Probe offline={fake.controller} />)
    expect(screen.getByTestId('state').textContent).toBe('preparing')

    act(() => {
      fake.set('ready')
    })
    expect(screen.getByTestId('state').textContent).toBe('ready')
  })

  it('卸载后取消订阅（不留监听者）', () => {
    const fake = fakeOffline('preparing')
    const { unmount } = render(<Probe offline={fake.controller} />)
    expect(fake.listenerCount()).toBe(1)
    unmount()
    expect(fake.listenerCount()).toBe(0)
  })
})
