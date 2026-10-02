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
