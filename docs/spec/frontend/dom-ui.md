# DOM UI 规范

## UI 模型

项目 UI 是注入到第三方 Discourse 页面里的轻量 DOM，不是由项目完全控制的前端应用。默认不引入 AntD、MUI、Element、Headless UI 等前端组件库。

原因：

- userscript bundle 应保持小而可审计。
- 组件库样式容易与 Discourse 主题和全局 CSS 冲突。
- 组件库默认假设应用控制 DOM 生命周期，而这里需要适配 Discourse SPA、懒加载和主题变量。
- 当前维护问题来自职责混杂和类型不严，不是缺少组件库。

允许的方向是项目内轻量组件化：明确 DOM 构建函数、section 构造函数、refs 类型和回调接口。

## 样式边界

所有自有 DOM class 和 CSS selector 必须使用 `dxp-` 前缀。样式统一通过 [src/ui/styles.ts](../../../src/ui/styles.ts) 的 `GM_addStyle` 注入。

规则：

- 不写裸元素全局样式，例如 `button {}`、`input {}`。
- 不覆盖 Discourse 自有 class，除非选择器同时限定在 `.dxp-*` 内。
- 自有浮层 z-index 要集中在样式文件中，不在业务逻辑里零散写 style。
- 可使用 Discourse CSS 变量，例如 `--primary`、`--secondary`、`--tertiary`，以适配主题。

## 面板职责

[src/ui/panel.ts](../../../src/ui/panel.ts) 当前负责面板 DOM、配置输入、筛选输入、批量重导 UI 和进度展示，文件已经偏大。

新增 UI 时遵守：

- UI 收集用户输入并触发 `PanelCallbacks`，不直接执行导出流程。
- 批量扫描、重导、图片上传等业务步骤不放进 UI 文件。
- 面板拆分优先按 section 归属，例如连接设置、筛选设置、高级设置、批量重导。
- DOM refs 必须有显式接口；禁止新增 `(x as any)._refs`、`dataset` 承载复杂对象等写法。

`(panel as any)._refs` 是历史债务，只能在重构时删除，不能复制为新模式。

## 楼层按钮

[src/ui/floor-buttons.ts](../../../src/ui/floor-buttons.ts) 是 Discourse 楼层 DOM 适配边界：

- flat、nested OP、nested reply 的选择器集中放在 `VIEW_SELECTORS`。
- 每个楼层只注入一次按钮，通过 `.dxp-floor-btn` 去重。
- 选中状态由模块内 `selectedPosts` 持有，并同步 `.dxp-selected` 和 `.dxp-active`。
- `onCopyPost` 通过 `setOnCopyPost()` 注入，UI 不知道复制流程细节。

新增 Discourse DOM 选择器先放在这个边界里，不向 core/export 扩散。

## DOM 查询与不变量

Discourse DOM 是外部输入，允许在 UI 边界检查缺失元素：

- 找不到楼层编号或 post ID 时不注入按钮。
- 找不到 actions area 时不注入按钮。
- 找不到标题注入点时跳过当前轮注入，等待 `MutationObserver`。

进入内部回调后应信任已经建立的不变量，例如复制回调拿到的是有效 `postNumber` 和 `postId`。不要在每一层重复防御同一件事。

## MutationObserver 与巡检

允许使用 `MutationObserver` 应对 Discourse 动态加载：

- `floor-buttons.ts` 观察新增楼层。
- `main.ts` 观察标题区域注入全局按钮。

定时巡检只能作为 UI 注入兜底，不能驱动业务流程。新增巡检前要说明为什么 `MutationObserver` 不够。
