/**
 * 项目级信息（关于页显示）—— **只在这个文件里改**。
 *
 * 与 `authorInfo.ts` 分开：那边是作者个人资料（署名 / 邮箱 / 打赏码），
 * 这边是项目本身的地址，改的人、改的频率都不一样。
 */
export interface ProjectInfo {
  /** 开源仓库地址。留空则不显示「开源地址」这一段 */
  repoUrl: string
}

export const PROJECT_INFO: ProjectInfo = {
  repoUrl: 'https://github.com/yuban10703/Moqu-gamebox',
}
