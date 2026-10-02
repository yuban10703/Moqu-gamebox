# 刷新适配说明（BOOX）

## 实测事实（不是推测）

| 结论 | 证据 |
|---|---|
| BOOX 的 Maven 仓库 HTTPS 握手失败（`dh key too small`） | 实测 `curl https://repo.boox.com/...` 失败、HTTP 成功；Gradle 必须 `isAllowInsecureProtocol = true` |
| EPD 接口在 `onyxsdk-device`，不在 `onyxsdk-base` | 下载 AAR 解析 `classes.jar`：`onyxsdk-device:1.3.6` 含 `EpdController` / `EpdDeviceManager` / `UpdateMode` / `UpdateOption` / `FrontLightController` / `DeviceEnvironment`；`onyxsdk-base:1.6.53`（660 个类）只有 `DeviceUtils` / `DeviceInfoUtil` |
| SDK 传递依赖很重 | `device` → fastjson2 + batik/xmlgraphics；`base` → fastjson + rxjava2 + rxandroid + eventbus + commonsIO + easypermissions |
| 文档里的 `setWebViewContrastOptimize` 在最新制品里找不到 | `onyxsdk-base 1.6.53` 与 `onyxsdk-device 1.3.6` 的常量池里都没有这个字符串 |
| `EpdController` 确实存在刷新相关方法 | 常量池里可见 `(Landroid/view/View;IIIILcom/onyx/android/sdk/api/device/epd/UpdateMode;)V`、`(Landroid/view/View;Lcom/onyx/android/sdk/api/device/epd/UpdateMode;)V` 等签名 |

## 因此的接入策略

1. **纯反射，零依赖**：`OnyxEinkBackend` 按类名 `Class.forName` 探测，
   再按**方法名 + 精确参数类型**匹配（`findStatic`），不猜签名。
   APK 里不含任何 Onyx 类，也就不会因为传递依赖产生冲突或体积问题。
2. **能力上报而非硬编码**：`capability()` 返回
   `{ onyxSdkFound, features[], modes[], fullRefresh, fastMode }`，
   由诊断页展示，并决定设置页里哪些档位可用。
3. **档位 → 模式名映射是候选列表**：`RefreshMapping`：
   - 清晰优先：`REGAL → GU → DU_QUALITY`
   - 均衡：`GU → REGAL → DU_QUALITY`
   - 速度优先：`DU → ANIMATION → GU`
   - 整屏全刷：`GC → GC16 → GU → DU`
   - 临时快刷：`ANIMATION → DU → A2 → FAST`

   实际使用哪个名字取决于设备报告的模式清单（`RefreshMapping.actualName`），
   因此不同固件不需要改代码。
4. **不支持就明说**：没有探测到接口时，Web 端与通用 Android 端的能力清单全为 `false`，
   设置页显示「当前设备不支持直接控制刷新」，帮助页给出 BOOX 系统设置指引
   （应用优化 / 刷新模式 / 整屏刷新手势）。

## 明确不承诺

- **不做像素级局部刷新**：即便 `EpdController` 有带矩形参数的刷新方法，
  在 WebView 场景下也无法保证「网页改了哪个格子，面板就只刷那块」。
  该能力标记为实验性，默认关闭，不写进界面承诺。
- **不做零残影承诺**：残影程度与全刷闪烁必须真机观察并记录。
- **不预先写死「每 N 步全刷一次」**：触发时机（菜单切换 / 单步操作 / 大面积展开 / 退出）
  需要按真机基线分别测量后再配置（对应规划 E03）。

## 真机验证步骤

1. 侧载 APK，进入 **设置 → 诊断**，记录：
   `onyxSdkFound`、`refreshModes`、`fullRefresh`、`fastMode`、`features`；
2. 在设置页依次切换三个档位，各走 20 步，观察残影与跟手程度；
3. 触发一次整屏全刷，记录闪烁是否可接受；
4. 退出应用后再次进入，确认没有残留的临时快刷状态（`applyApplicationFastMode` 成对调用）；
5. 把结论填进 [A01](A01-device-baseline.md) 的「实测观察记录」。

## 补充：残影不能被截图测量（实测证据）

**结论：`screencap` 拍不到残影。** 不要用截图评估残影，也不要拿它当「全刷有效」的证据。

三条实测证据（BOOX Note X2）：

1. 同一屏内容，在做完整屏全刷（日志确认 `full refresh applied via refreshScreen mode=GC`）前后各截一张，
   **棋盘区与空白区的像素统计完全一致**：
   棋盘 `纯黑 57.11% / 纯白 42.63% / 中间灰 0.26%`，
   空白区 `纯黑 1.31% / 纯白 98.51% / 中间灰 0.17%`；
   两张图唯一的差异来自状态栏时钟。
2. 原因在原理层：`screencap` 取的是 SurfaceFlinger 合成出的 framebuffer（系统「认为」该显示什么），
   而残影是面板颜料未完成翻转的物理残留，只存在于面板层，从未进入 framebuffer。
3. 全刷调用本身在 ~2ms 内返回（与一次普通存储读取同量级），
   说明它只是**标记/排队**一次刷新，真正的波形驱动发生在 EPD 控制器里、异步完成 ——
   所以也无法靠「抓闪光瞬间」来间接拍到。

### 那还能测什么

| 想知道的 | 能测吗 | 手段 |
|---|---|---|
| 全刷调用是否执行、用了哪个模式 | 能 | 原生日志 `full refresh applied via refreshScreen mode=GC` |
| 波形是否真的驱动了面板 | 只能间接 | 调用耗时（本机 ~2ms，说明是排队而非同步等待）|
| 渲染内容里有没有不该出现的灰（误用灰阶、抗锯齿过重）| 能 | `tools/scripts/png-stats.py` |
| **残影本身** | 不能 | 人眼观察，或**相机拍面板**（截图无效） |

### 建议的残影评估流程（需要你本人操作）

1. 连续走 100 步以上（让局部刷新累积）；
2. 关掉所有对话框，用手机相机拍一张面板照片（正对、避免反光）；
3. 在暂停菜单里点「立即整屏全刷」；
4. 再拍一张同样角度的照片；
5. 对比两张照片里空白区域的干净程度 —— 这才是残影结论的有效依据。

## 补充：开启 `-PonyxBundled` 后的真机结论（Note X2 + onyxsdk-device 1.3.6）

把 SDK 打进 APK（`./gradlew -PonyxBundled=true assembleDebug`）后的实测结果：

| 项目 | 结论 |
|---|---|
| 体积 | 1.4MB → **3.4MB**（Onyx SDK + fastjson2；batik 未被拉入） |
| 权限 | SDK 清单里的 ACCESS_WIFI_STATE / CHANGE_WIFI_STATE / BLUETOOTH / DUMP **已被 `tools:node="remove"` 剥掉**，最终 APK 零权限（`aapt2 dump badging` 可验证） |
| 类加载 | `EpdController` / `UpdateMode` / `FrontLightController` / `EpdDeviceManager` 均在 dex 中，反射可用 |
| `onyxSdkFound` | true（类存在 **且** 厂商为 ONYX 才判真；只有类存在会在普通安卓设备上谎报支持） |
| 设备实际模式名 | 18 个：`None, DU, DU4, GU, GU_FAST, GC, GCC, DEEP_GC, ANIMATION, ANIMATION_QUALITY, ANIMATION_MONO, ANIMATION_X, GC4, REGAL, REGAL_D, REGAL_PLUS, DU_QUALITY, HAND_WRITING_REPAINT_MODE` |
| **整屏全刷** | **可用**，走 `refreshScreen(view, GC)`；`invalidate(view, GC)` 会抛 `AssertionError`（SDK 内部 SDMDevice 断言失败，它没识别出这台机型）。调用按候选顺序尝试：`refreshScreen → repaintEveryThing → applyTransientUpdate → invalidate` |
| **刷新档位（局部模式）** | **不可用**：`setViewDefaultUpdateMode` 返回 true（接受调用），但写入 REGAL/GU 后回读仍是 DU —— 也就是调用被接受但没生效。如实报告为不支持，界面改为提示用系统「应用优化/刷新模式」 |
| 临时快刷 | 不可用：3 参数的 `applyApplicationFastMode` 在 1.3.6 不存在；5 参数版本语义未知，不猜测调用 |
| 全刷调用耗时 | ~2ms（与一次存储读取同量级）→ 它只是标记/排队，真正波形由 EPD 控制器异步完成 |

### 验证方式（值得复用）

- **全刷**：按候选顺序逐个尝试，谁不抛异常并且在候选里就采用谁，全失败才改口说不支持；
  并把成功的那条记进 `features`（如 `fullRefreshWorks:refreshScreen`），诊断页可见。
- **档位**：不能只看「写入后回读是否等于请求值」——请求值恰好等于当前值时也会成立（假阳性）。
  也不能只看「读回是否变化」——全刷刚结束时读回是 GC，写任何值都会"变化"（也是假阳性，我第一版就被骗过）。
  正确判据：**写入一个与当前不同的值，且读回确实变成了请求的值**。
- 验证必须发生在网页读取能力清单**之前**，否则 JS 会在「尚未验证」的窗口里读到乐观结论。

## 区域刷新：能不能指定「只刷这块」

**能。** 实测可用路径是 `EpdController.refreshScreenRegion(View, left, top, right, bottom, UpdateMode)`，
坐标是**视图坐标系像素**（网页侧把 CSS 坐标乘 DPR）。

| 项目 | 结论 |
|---|---|
| 可用接口 | `refreshScreenRegion`（已实测调用成功）；退路 `invalidate(view, l, t, r, b, mode)` |
| 能力上报 | `regionRefresh: true`，并记录实际生效的实现名（`regionRefreshWorks:refreshScreenRegion`） |
| 无区域能力的接口 | `EpdDeviceManager` 只有整屏级（`refreshScreen` / `applyGCUpdate` / `refreshScreenWithGCInterval`） |
| 已接入应用 | 每走一步、撤销、下一关：只请求刷新**棋盘区域**；暂停菜单里另保留「立即整屏全刷」用于清残影 |
| 实测日志 | `region refresh via refreshScreenRegion rect=[54,200,1869,893] mode=REGAL`（= 棋盘 CSS 矩形 × DPR 1.5） |

### 面板是否真的「只动那块」——我无法客观证明

- **截图不行**：`screencap` 取的是 framebuffer，不反映面板层的更新范围（与残影同理）。
- **驱动计数器也不行**：`/sys/devices/virtual/sepdc/debug/status` 里的 `frame[...]` 只与**波形模式**有关，与面积无关。
  受控实测（同一模式、同一屏内容）：50×50 → 141 帧；1800×1300 → 141 帧；GC 全刷 → 149/151 帧。
  这个结果本身也说明：面板很可能是**对整屏行施加波形**，区域只决定「哪些像素换内容」。

因此「区域刷新在视觉上到底有没有意义（是否只有那块闪）」**只能由眼睛判断**。
当前设备上已按「每步只刷棋盘」运行：走一步即可看出是局部变化还是整屏闪。
若实屏看起来与整屏刷新无异，这个能力就没有实际价值，应当关掉。

### 踩到的两个坑（值得记下来）

1. **Java 桥的方法不能取出来单独调用**：`const fn = bridge.refreshRegion; fn(...)` 会脱离接收者而
   **静默失效**（返回 undefined，原生侧完全收不到请求，且不报错）。必须写成 `bridge.refreshRegion(...)`。
2. **提示行会把方向键挤出屏幕**：方向键原本在提示出现后被推到 y=1433（屏高 1404）。
   修法是给「提示 + 保存状态」一个固定高度的状态条（`.eink-statusstrip`），并在布局计算里预留同样的高度。

## 真机结论更新（用户实测反馈）

1. **区域参数无效**：用户在真机上对比后反馈「区域刷新和整屏全刷都是刷全屏」。
   即 `refreshScreenRegion` 虽然调用成功，但面板并不只更新传入的矩形 ——
   因此本项目**不再把它当区域刷新使用**（已停止在游戏里按步调用）。
   能力位 `regionRefresh` 改为恒为 false，并在 features 里留下
   `regionRefreshNotHonored:updatesFullScreen` 作为证据，避免后人再被 API 名骗一次。
2. **只改画面时连续运动不流畅**：不再显式调用刷新接口时，连续动画观感不够连续。
   于是新增「连续运动测试」页做对照（见下）。

## 连续运动测试页（连续运动 + 五种策略）

页面：诊断 → 顶栏「连续运动测试」。圆点以 rAF 逐帧匀速滑动（120/300/600 px/s），
五种策略各自走自己的路径，互不借用：

| 策略 | 实际调用 |
|---|---|
| 系统默认 | 不调用任何刷新接口，由系统决定怎么刷（基线；原名「只改画面」，已改名以免误解） |
| 动画模式 | `EpdDeviceManager.enterAnimationUpdate(true)` / `exitAnimationUpdate(true)` |
| 高频全刷 | 原生泵每 0.5 秒 `refreshScreen(View, GC)`，20 秒自动停（最差对照） |

已删除「系统快刷」：`applySystemFastMode` 是**整机级**开关（等同系统里的快刷模式，会影响其它应用），
本机启用不了（调用被接受但回读 `inSystemFastMode()` 始终 false，疑似不在 Onyx 白名单），
且属于擅自改动用户设备全局设置，故连同后端实现一并移除，只保留只读查询用于诊断展示。

### 实测数据（Note X2）

- **三种策略下网页侧都是 ~45–46 FPS**（共 181–369 帧）。也就是说 WebView/合成**不是**瓶颈，
  视觉流畅度取决于面板 —— 所以「哪个更流畅」只能靠人眼判断，页面把 FPS 直接显示出来供参考。
- **动画模式确实进入了**：`animation=true(enterAnimationUpdate)`，停止/离开页面会退出
  （日志 `animation mode OFF via enterAnimationUpdate`）。
- **系统快刷在这台设备上启用不了**：`applySystemFastMode(true)` 被接受（未抛异常），
  但回读 `inSystemFastMode()` 与 `isInFastMode()` 仍为 false。
  日志：`applySystemFastMode accepted but readback still false`。如实报告为不可用。
  可能原因：Onyx 的 `/system/etc/sysconfig/onyx_whitelist.xml` 未包含本应用。
- `exitAnimationUpdate` 等接口**没有公开的「当前是否在动画模式」查询**，
  因此动画模式的能力位只能表达「接口存在且调用被接受」，features 里以
  `animationVerified:no-readback-api` 标注该区别。

### 安全性

- 退出动画模式时**只撤销本应用自己开的开关**：绝不无条件调用 `applySystemFastMode(false)`，
  否则会把用户在系统设置里自己打开的快刷关掉。
- 停止、离开页面、组件卸载三条路径都会退出动画模式。

## 事故与修复：测试页把界面卡到「点不动停止」

**现象**：连续运动测试页在动画模式下，用户点不动「停止」，只能强杀进程。

**根因（自己写的 bug，与设备无关）**：主循环里每帧都做了一次**同步的原生桥调用**
（`animationState()` → `getAnimationState()`），约 46 次/秒，同时每帧还 `setState` 触发整屏重渲染。
两者叠加把 WebView 主线程占满，触摸事件处理不过来。
这与本项目早先那次「真机冻结」是同一类问题（主线程饱和），当时的教训没有被贯彻到新页面。

**修复**：

1. 圆点位置**直接改 DOM**（`ref.style.transform`），不再每帧 `setState`；
2. 状态栏最多**每秒**读一次桥，且只在内容变化时更新；
3. 每帧刷新类策略的桥调用限速由 20 次/秒降到 **10 次/秒**；
4. 新增 **90 秒硬性自动停止**：即使界面再次卡住，也会自己退出动画模式；
5. 退出动画模式的触发点补齐：停止 / 返回 / 组件卸载 / `visibilitychange` / `pagehide`；
6. **启动时先执行一次 `exitAnimationUpdate(true)`**：被强杀留下的快刷状态会在下次启动被清掉
   （日志 `startup cleanup: exitAnimationUpdate to clear any leftover animation state`）。

**验证**（真机，动画运行中）：

```
运行中: 43 FPS · 共 260 帧 · animation=true(enterAnimationUpdate)
触摸「停止」→ 0 FPS · animation=false(-)，按钮恢复为「开始运动」
日志: animation mode ON via enterAnimationUpdate (preferred)
      animation mode OFF via enterAnimationUpdate
```

**给后续页面的硬性要求**：任何逐帧循环里**不得**出现同步桥调用或 `setState`；
需要显示状态就按秒节流，需要动的东西就改 DOM。

## 事故二：「停止」点不动的真正原因 —— WebView 渲染进程崩溃

用户反馈「停止还是点不动」。一开始以为是按钮/触摸问题，实际根因在日志里：

```
W ActivityManager: Scheduling restart of crashed service
  com.einkgamebox/org.chromium.content.app.SandboxedProcessService0:0
```

**WebView 的渲染进程崩溃了。** 渲染进程一死，页面就变成一张**冻住的死图** ——
点什么都没反应，用户当然会认为「按钮坏了」。同期还有 `lowmemorykiller` 的内存压力日志。

诱因是我在测试页里设计的「每帧整屏全刷 / 每帧区域刷新」策略：
每秒 20 次全屏（1872×1404）同步刷新调用，既占满主线程又造成内存压力。

### 三层修复

1. **循环里不再有任何桥调用**：逐帧循环只做 DOM 操作（`ref.style.transform`）。
   高频刷新改为**原生刷新泵**（`startRefreshPump(intervalMs, maxDurationMs)`）：
   在原生侧用 Handler 循环，网页只负责开关，不再被同步调用阻塞；
   泵会**按实测耗时自适应降频**（`next = max(请求间隔, 平均耗时×3)`），
   并在到达 `maxDurationMs` 后**自动停止**。实测统计：`calls=17 avgCost=2ms`。
2. **渲染进程崩溃自愈**（`onRenderProcessGone`）：返回 true 阻止整个应用被一起干掉，
   先清设备状态（退出动画模式、停泵），再重新加载页面。
   **已用真实崩溃验证**：用内存耗尽把渲染进程打崩两次，
   日志两次都出现 `renderer process gone: didCrash=true - reloading UI`，
   宿主应用存活、页面自动恢复、存档完好（步数 86）。
   在此之前，这种崩溃会让界面永久冻住，只能杀进程。
3. **原生看门狗**（60 秒）与 `onPause` 清理：动画模式的退出不再只依赖网页调用 ——
   网页冻住/进程被杀时，原生侧仍会自动退出动画模式并停泵。

### 另一个自写 bug：「任意触摸即停止」导致点停止反而在跑

为了兜底加过一条「任意触摸就停止」，结果 `pointerdown` 先把 `running` 置 false，
紧接着按钮 `click` 看到 false 就调了 `start()` —— 用户看到的是「点停止反而在跑」。
而且页面真冻住时根本收不到事件，这条保险本身就没有意义。
现已移除，并把「开始/停止」拆成**两个独立按钮**（不做二合一 toggle），消除竞态。

### 硬性规则（后续所有页面）

1. 逐帧循环里**不得**出现同步桥调用或 `setState`（要动就改 DOM，要显示就按秒节流）。
2. 高频刷新一律走**原生刷新泵**，并带自适应降频与硬超时。
3. 任何可能长时间占用设备的模式，都必须有**不依赖网页的**原生退出路径
   （看门狗 / 生命周期 / 崩溃回调）。

## 「高频全刷」为什么不是功能，只是对照

用户实测反馈「高频全刷很卡」，并问它有没有实际意义。**没有** —— 它是刻意的对照组：

| | 数值 |
|---|---|
| 面板能完成的完整刷新 | 约 **2 次/秒**（每次 16 级灰阶全屏，泵统计 `avgCost=2ms` 只是入队耗时） |
| 画面内容变化速率 | 约 **45 次/秒**（WebView 侧实测） |
| 结果 | 约 43/45 的帧被丢掉 → 必然卡 |

它的历史用途（已完成）：证明「卡与闪来自刷新策略本身，而不是 WebView」——
WebView 一直能产出 45 FPS，卡只可能来自面板侧。

**真正有意义的是「一次性全刷」**（清残影），已提供在暂停菜单 / 设置页的「立即整屏全刷」。

### 如果将来需要「长时间快刷又不积残影」

正确做法**不是**高频全刷，而是 SDK 里专门的「快刷为主、偶尔插一次全刷」：

- `EpdDeviceManager.setGcInterval(n)` / `getGcInterval()`
- `EpdDeviceManager.applyWithGCInterval(View, boolean)`
- `EpdDeviceManager.refreshScreenWithGCInterval(View, boolean)`
- `EpdDeviceManager.refreshScreenWithGCIntervalWithRegal(View)` / `...WithoutRegal(View)`

区别在于：这些是**每 N 次快刷插一次全刷**，而不是**一直整屏全刷**。
若后续动画/长列表需要，应走这条路径。

### 位置调整

「高频全刷」已从连续运动测试页移到**诊断页**（`高频全刷对照（2 次/秒，15 秒自停）`）：
留在测试页容易被误当成一种「优化选项」，而它恰恰是最差的一种。
连续运动测试页现在只保留两条策略：系统默认 / 动画模式。
