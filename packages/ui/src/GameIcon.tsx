/**
 * 游戏图标：**自己画的 1-bit 线条图**，不用 Unicode 符号。
 *
 * 为什么换掉符号：符号字体在不同设备上覆盖不一（有的字缺字形会画成方框），
 * 而且 `▤`/`▥`/`▩` 这类方块符号彼此太像 —— 用户反馈"图标不匹配游戏"。
 * 自己画则：形状可控、渲染一致、纯线条（无灰度、不用位图），符合墨水屏 1-bit 约束。
 *
 * 统一规格：24×24 viewBox、`stroke: currentColor`、无填充（个别实心点除外）、线宽 1.6。
 */
import type { ReactNode } from 'react'

type Props = { namespace: string; size?: number }

const SHAPES: Record<string, ReactNode> = {
  // 推箱子：箱子（内嵌方块）+ 目标点
  sokoban: (
    <>
      <rect x="3" y="3" width="11" height="11" />
      <rect x="6.5" y="6.5" width="4" height="4" />
      <circle cx="17.5" cy="17.5" r="2.6" />
    </>
  ),
  // 数独：九宫格（外框粗、内部细分）
  sudoku: (
    <>
      <rect x="3" y="3" width="18" height="18" />
      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" strokeWidth="1" />
    </>
  ),
  // 扫雷：水雷（圆 + 八向尖刺）
  minesweeper: (
    <>
      <circle cx="12" cy="12" r="5.5" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M19.1 4.9l-2.8 2.8M7.7 16.3l-2.8 2.8" />
    </>
  ),
  // 华容道：大小不一的滑块（2×2 曹操 + 1×2 + 1×1）
  klotski: (
    <>
      <rect x="3" y="3" width="10" height="10" />
      <rect x="15" y="3" width="6" height="6" />
      <rect x="15" y="11" width="6" height="10" />
      <rect x="3" y="15" width="10" height="6" />
    </>
  ),
  // 关灯游戏：灯泡（圆 + 灯座）
  lightsout: (
    <>
      <circle cx="12" cy="10" r="6" />
      <path d="M9.5 18h5M10.5 21h3" />
    </>
  ),
  // 记忆配对：两张并排的牌
  memory: (
    <>
      <rect x="3.5" y="6" width="8" height="13" />
      <rect x="12.5" y="4" width="8" height="13" />
    </>
  ),
  // 五子棋：棋盘十字 + 一枚实心棋子
  gomoku: (
    <>
      <path d="M3 8h18M3 16h18M8 3v18M16 3v18" strokeWidth="1" />
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </>
  ),
  // 数字华容道：格子里缺一块（空白格）
  fifteen: (
    <>
      <rect x="3" y="3" width="18" height="18" />
      <path d="M12 3v18M3 12h18" strokeWidth="1" />
      <rect x="14" y="14" width="5" height="5" fill="currentColor" />
    </>
  ),
  // 2048：两块正在合并的方块（错位叠放，与华容道的并排滑块区分开）
  '2048': (
    <>
      <rect x="3" y="10" width="9" height="9" />
      <rect x="10" y="5" width="11" height="11" />
    </>
  ),
  // 贪吃蛇：折线蛇身 + 实心蛇头
  snake: (
    <>
      <path d="M5 19h8a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h6" />
      <circle cx="5" cy="19" r="2.4" fill="currentColor" />
    </>
  ),
  // 俄罗斯方块：已固定的两行（带细分线）+ 正在下落的一块
  tetris: (
    <>
      <rect x="3" y="6" width="18" height="6" />
      <path d="M9 6v6M15 6v6" strokeWidth="1" />
      <rect x="9" y="12" width="6" height="6" />
    </>
  ),
  // 斗地主：两张错开叠放的扑克牌，前一张左上角一个黑桃
  doudizhu: (
    <>
      <rect x="3.5" y="6" width="10" height="14" rx="1.5" transform="rotate(-12 8.5 13)" />
      <rect x="10.5" y="4" width="10" height="14" rx="1.5" fill="#fff" />
      <path d="M15.5 7.3c-1.6 1.7-3 2.8-3 4.1 0 .9.7 1.5 1.5 1.5.6 0 1-.3 1.3-.7l-.5 1.8h1.4l-.5-1.8c.3.4.7.7 1.3.7.8 0 1.5-.6 1.5-1.5 0-1.3-1.4-2.4-3-4.1z" fill="currentColor" stroke="none" />
    </>
  ),
  // 恶魔轮盘赌：一发霰弹（弹头 + 底火圈）旁边一对恶魔角
  buckshot: (
    <>
      <rect x="9" y="7" width="7" height="12" rx="1" />
      <path d="M8 19h9v3H8z" fill="currentColor" />
      <path d="M17 6l4-4 0 6zM8 6l-4-4 0 6z" fill="currentColor" stroke="none" />
    </>
  ),
  // 消消乐：三连（三枚实心棋子连成一线，与五子棋的「棋盘 + 单子」区分开）
  match3: (
    <>
      <path d="M3 12h18" strokeWidth="1" />
      <circle cx="6" cy="12" r="3" fill="currentColor" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <circle cx="18" cy="12" r="3" fill="currentColor" />
    </>
  ),
}

/** 未知命名空间回退到一个中性方块，绝不返回空（空图标比通用图标更糟） */
const FALLBACK = <rect x="4" y="4" width="16" height="16" />

export function GameIcon({ namespace, size = 26 }: Props): ReactNode {
  return (
    <svg
      className="eink-game-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[namespace] ?? FALLBACK}
    </svg>
  )
}
