/**
 * 构建时注入的版本信息（见 apps/web/vite.config.ts 的 `define`）。
 * 声明放在 ui 包里：首页页脚要用它，而该组件属于本包，看不到 apps/web 下的声明。
 */
declare const __BUILD_INFO__: { version: string; stamp: string }
