<p align="center">
  <img src="apps/android/icon/source.png" alt="墨趣图标：墨滴里的游戏手柄" width="160">
</p>

# 墨趣（Moqu）

面向墨水屏设备（优先 BOOX）的**离线游戏合集**：一套 TypeScript 代码同时产出 **Web(PWA)** 与 **Android 安装包**。

- 游戏规则、存档协议、布局计算全部是纯函数，可在 Node 里直接测；
- 呈现层用 DOM/SVG（不是 Canvas）：网页侧无法承诺像素级局部刷新，DOM 让系统自己做最小重绘，中文也直接用系统字体；
- 存档采用「写前日志 + 比较交换提交」，进程被杀后恢复到**最后一次明确提交成功**的局面；
- Android 端是纯通用的 WebView 壳：不含任何厂商 SDK、不申请任何权限，资源全部内置、装好即可离线。

当前收录 **13 款**：推箱子、华容道、数独、扫雷、关灯游戏、记忆配对、五子棋、数字华容道、2048、贪吃蛇、俄罗斯方块、消消乐、斗地主（单机，已留联机框架）。
最新状态与接手须知见 [docs/handover.md](docs/handover.md)。

---

## 快速开始

```bash
# 依赖（Node 20.19+ / 22.12+，实测 Node 24）
npm install

# 类型检查 + 全部测试 + 文案校验 + 构建 Web 产物（含 sw.js）
npm run check

# 本地预览 Web 端
npm run dev:web        # http://127.0.0.1:5173
```

### 构建 Android APK

```bash
# 一次性安装构建链到 .toolchain/（JDK 17 + Android SDK 35 + Gradle 8.14.3，约 1GB）
npm run setup:android

# 构建可侧载的 debug APK
npm run build:apk
# → apps/android/app/build/outputs/apk/debug/app-debug.apk

# 侧载到设备
adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
```

真机验收流程见 [docs/A06-acceptance.md](docs/A06-acceptance.md)；首次运行请先在应用里 **设置 → 诊断** 复制设备基线，回填 [docs/A01-device-baseline.md](docs/A01-device-baseline.md)。

---

## 目录结构

```
packages/core/        规则契约、确定性随机、i18n 运行时、存档与提交协议、备份、布局纯函数、设置
packages/games/*/    13 款游戏，每款一个包：规则、展示模型、文案、内容（推箱子/华容道的关卡包带求解器校验）
packages/ui/          React 壳层：游戏库、详情、游戏界面、结果、设置、诊断、帮助
packages/platform/    平台适配：IndexedDB / Android 原生事务存储、离线状态、刷新控制、设备基线
apps/web/             Vite + React 的 PWA 入口（产物同时打进 APK）
apps/android/         Kotlin WebView 壳：原生 SQLite 存储、SAF 备份；icon/ 下是图标源图与生成器
tools/scripts/        工具链安装、APK 构建、Service Worker 生成、硬编码文案扫描
docs/                 规划与验收文档（A01/A02/A03/A04/A06）、架构、墨水屏规范、上手指南
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run typecheck` | 全仓 TypeScript 检查 |
| `npm test` | 全部测试（规则、关卡可解性、存档协议、布局不变量、壳层集成） |
| `npm run check:i18n` | 中英字典对齐 + 扫描硬编码中文文案 |
| `npm run build:web` | 构建 Web 产物并生成 `sw.js` |
| `npm run check` | 以上全部串起来（提交前跑这个） |
| `npm run gen:levels` | 重新生成推箱子关卡包（会改写 `src/levels.ts`） |
| `npm run setup:android` / `npm run build:apk` | 安装构建链 / 构建 APK |
| `python3 apps/android/icon/gen-icons.py` | 从图标源图重新生成全部图标（见下文「图标」） |

## 设计要点

**一根数据线：状态 → 存档 → 提交**

```
玩家输入 → GameDef.reduce（纯函数） → 新状态
        → applyAction（写前日志 + 校验和） → SaveStore.commit（CAS 提交栅栏）
        → pending → committed → 删除 pending（崩溃后 recover 能确定结果）
```

**明确不承诺的能力**（见 [docs/eink-guidelines.md](docs/eink-guidelines.md)）

- 不做像素级局部刷新：网页与 WebView 都只能拿到**整屏全刷**与**应用级刷新模式**；
- 不承诺「零残影」：残影与全刷效果必须真机观察并记录；
- 桌面截图或模拟器通过**不算**完成验收（对应规划里的阶段完成条件）。

## 图标

墨水滴里藏着一个游戏手柄（十字键 + 两个按钮），纯黑白 1-bit。
源图是 [`apps/android/icon/source.png`](apps/android/icon/source.png)，**换图标只需替换这张图并重跑生成器**：

```bash
python3 apps/android/icon/gen-icons.py   # 依赖 Python 3 + Pillow
```

生成器一次产出 Android 启动图标（各密度 PNG + adaptive 矢量前景）与 Web 的 favicon / PWA 图标 / `icon.svg`，
并自检：所有 PNG 只含纯黑、纯白、全透明像素；矢量版与源图的重合度（IoU）不低于 0.98。
16px favicon 做了小尺寸光学补偿（十字键与按钮按像素手工挖出），否则两个按钮会糊成一团。

## 许可证与内容来源

关卡内容为自制（房间模板 + 固定种子反向生成 + 求解器校验），不包含第三方题库；依赖与 SDK 的来源与使用条件见 [docs/A03-dependencies.md](docs/A03-dependencies.md)。
