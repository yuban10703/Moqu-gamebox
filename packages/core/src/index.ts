/**
 * @eink/core —— 与平台、与呈现技术无关的公共层。
 *
 * 包含：游戏接入契约、确定性随机、i18n 运行时、存档与提交协议、跨端备份、
 * 布局纯函数、设置模型、设备基线。
 * 这里不出现任何 DOM / React / WebView / Android 相关代码。
 */
export * from './types.js'
export * from './version.js'
export * from './rng.js'
export * from './i18n.js'
export * from './save.js'
export * from './history.js'
export * from './storage.js'
export * from './backup.js'
export * from './layout.js'
export * from './diagnostics.js'
export * from './settings.js'

export { zhCN as coreDictZh } from './locales/zh-CN.js'
export { enUS as coreDictEn } from './locales/en-US.js'
