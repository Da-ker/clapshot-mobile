# Safari 视频有声无画修复说明

## 现象
- 微信内置浏览器可正常播放
- iOS Safari 出现“有声音，无画面”

## 根因（本次定位）
问题不是单一解码失败，而是 **Safari 下多条件叠加导致视频被隐藏或走到不稳定路径**：

1. 播放可见性与初始化状态耦合（`opacity` 依赖 `$videoIsReady`）
2. Safari 的媒体 ready 时序和其他 WebView 不同
3. Safari 下切换到 Mediabunny 路径时，存在音频正常但画面不可见风险

## 修复策略
### 1) Safari 强制 HTML5 解码路径（禁用 Mediabunny 切换）
文件：`client/src/lib/player_view/video-decoder/HybridVideoDecoder.ts`

- 增加 `forceHtml5Only`（Safari 为 true）
- `ensureMediabunny()` 在 Safari 直接返回 false
- `stepFrame()` 在 Safari 永远使用 `html5.stepFrame()`

目的：避免 Safari 进入不稳定的 canvas/decoder 切换路径。

### 2) 视频可见性与绘图初始化解耦
文件：`client/src/lib/player_view/VideoPlayer.svelte`

- `prepare_drawing()` 提前设置 `$videoIsReady = true`
- `<video>` 的显示不再因初始化时序被隐藏（`style` 改为固定可见）
- 增加 `oncanplay={prepare_drawing}`，适配 Safari 的 ready 触发时机

目的：即使绘图层慢一步，视频也必须先显示。

### 3) 移除误导性错误提示
文件：`client/src/lib/player_view/VideoPlayer.svelte`

- 当 draw layer 尚未就绪时，`onToggleDraw()` 静默返回
- 不再弹“Video loading not done? Cannot enable drawing.” 干扰用户

## 结果
- Safari 实测从“有声无画”恢复为正常显示
- 微信播放保持正常
- 桌面端播放逻辑保持不变
