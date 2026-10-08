/**
 * 四类版本号分开管理（对应验收要求 C04）：
 * - APP_VERSION：应用/壳层
 * - SAVE_SCHEMA：存档格式
 * - BACKUP_SCHEMA：跨端备份格式
 * 游戏自身的 rulesVersion / contentVersion 由各游戏在 GameDef 上声明。
 */
export const APP_VERSION = '0.1.5'
export const SAVE_SCHEMA = 1
export const BACKUP_SCHEMA = 1

/** 存档写入失败的可重试错误码（界面据此显示对应文案，见 shell.storage.reason.*） */
export type SaveFailureReason = 'io' | 'quota' | 'conflict' | 'corrupt' | 'unsupported-version'
