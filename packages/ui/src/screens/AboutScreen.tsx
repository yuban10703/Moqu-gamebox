/**
 * 关于页：项目名 + 版本号 + 一句话说明 + **作者信息**（署名 / 邮箱 / 打赏码）。
 *
 * 用户要求：这里写的是**作者的信息**，不是让用户自己填的「我的信息」备注框 ——
 * 那个可编辑、可保存的 textarea（以及它背后的 loadNote/saveNote）已按用户要求删除，
 * 不再有用户输入与本机存储读写，这一页现在是纯只读的。
 *
 * 作者信息的值集中在 `./authorInfo.ts` 里改（含打赏码图片放哪里、推荐尺寸与格式），
 * 本文件只负责「填了才显示、没填就不渲染」。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { APP_VERSION } from '@eink/core'
import { TopBar } from '../components.js'
import { useUi } from '../contexts.js'
import { AUTHOR_INFO } from './authorInfo.js'

export interface AboutScreenProps {
  onBack: () => void
}

/**
 * 打赏码图片：**文件存在才返回它的地址**，不存在返回 null。
 *
 * 为什么要先探一次而不是直接 <img onError>：文件还没放进去时（作者的图还没准备好），
 * 直接渲染会先出现浏览器的破图图标、再把整块内容抽掉 —— 墨水屏上一闪就是一次整屏刷新。
 * 用一个游离的 Image 探完再决定渲染，用户看不到任何中间状态；缺图时整块直接不出现。
 */
function useDonateImage(src: string): string | null {
  const [ready, setReady] = useState<string | null>(null)
  useEffect(() => {
    setReady(null)
    if (!src) return
    let cancelled = false
    const probe = new Image()
    probe.onload = () => {
      if (!cancelled) setReady(src)
    }
    probe.onerror = () => {
      if (!cancelled) setReady(null)
    }
    probe.src = src
    return () => {
      cancelled = true
      probe.onload = null
      probe.onerror = null
    }
  }, [src])
  return ready
}

export function AboutScreen({ onBack }: AboutScreenProps): ReactNode {
  const { i18n } = useUi()
  /*
   * 构建时注入的版本信息（首页页脚那个版本号按用户要求去掉后，这里是**唯一**能看到
   * 构建时间的地方 —— 用户据此判断设备上是不是最新版）；单测 / 非 vite 环境下不存在，
   * 因此做存在性判断（不能直接引用，否则在 vitest 里会抛 ReferenceError）。
   */
  const buildInfo = typeof __BUILD_INFO__ === 'undefined' ? null : __BUILD_INFO__
  const version = buildInfo?.version ?? APP_VERSION
  const donate = useDonateImage(AUTHOR_INFO.donateImage)
  // 三项全空 → 整块不渲染（不留标题、不留空行）；填任意一项，区块就出现
  const hasAuthor = AUTHOR_INFO.name !== '' || AUTHOR_INFO.email !== '' || donate !== null

  return (
    <div className="eink-screen eink-screen--sticky-footer">
      <TopBar title={i18n.t('shell.about.title')} onBack={onBack} />

      {/* 没有主操作要做成固定页脚了（保存按钮随「我的信息」一起去掉），内容区自己滚动 */}
      <div className="eink-screen__content">
        <section className="eink-section">
          {/* 项目名 → 版本号 → 一句话说明，顺序按用户给的页面结构（名字跟随 i18n，英文界面显示罗马字 Moqu） */}
          <h2 className="eink-about__product">{i18n.t('shell.about.product')}</h2>
          <p
            className="eink-muted"
            aria-label={`${i18n.t('shell.common.version')} ${version}${buildInfo ? ` ${buildInfo.stamp}` : ''}`}
          >
            v{version}
            {buildInfo ? ` · ${buildInfo.stamp}` : ''}
          </p>
          <p className="eink-text">{i18n.t('shell.about.tagline')}</p>
        </section>

        {hasAuthor ? (
          <section className="eink-section">
            <h2>{i18n.t('shell.about.author.title')}</h2>
            <dl className="eink-about__meta">
              {AUTHOR_INFO.name ? (
                <>
                  <dt>{i18n.t('shell.about.author.name')}</dt>
                  <dd>{AUTHOR_INFO.name}</dd>
                </>
              ) : null}
              {AUTHOR_INFO.email ? (
                <>
                  <dt>{i18n.t('shell.about.author.email')}</dt>
                  <dd>{AUTHOR_INFO.email}</dd>
                </>
              ) : null}
            </dl>
            {donate ? (
              <figure className="eink-about__donate">
                <img src={donate} alt={i18n.t('shell.about.author.donate')} />
                <figcaption className="eink-muted">{i18n.t('shell.about.author.donate')}</figcaption>
              </figure>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  )
}
