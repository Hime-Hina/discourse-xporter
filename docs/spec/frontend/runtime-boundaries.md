# 运行时边界

## userscript 初始化

入口是 [src/main.ts](../../../src/main.ts)。脚本通过 `vite-plugin-monkey` 生成油猴脚本，`vite.config.ts` 中声明 `@match *://*/*`，运行时再判断当前页面是否为 Discourse。

本项目不绑定论坛域名。初始化顺序应保持清晰：

1. `isDiscourse()` 检查 `meta[name="generator"]` 或 `window.Discourse`。
2. `injectStyles()` 注入 `.dxp-*` 样式。
3. `GM_registerMenuCommand` 注册菜单，只负责打开面板。
4. `startTopicLifecycle()` 负责检测 `/t/{slug}/{topic_id}` 和 `/nested/{slug}/{topic_id}` 话题页面，并在 Discourse SPA 导航进入话题时激活话题 UI。
5. 话题激活回调初始化 `initFloorButtons()`、`initPanel()`，并补注入 `.dxp-global-toggle`。
6. 异步检查过期笔记必须按 topic ID 去重，且不能阻塞页面初始化。

## `main.ts` 职责上限

`main.ts` 当前包含导出、复制、过期检测、批量重导等流程，这是需要拆分的历史债务。新增代码必须遵守：

- 入口只做环境检测、生命周期初始化和回调连接。
- 超过“调用一个完整操作并处理 UI 反馈”的流程，应移动到 `core/*` 或 `export/*`。
- 不在 `main.ts` 新增复杂分支来适配特殊模式；如果行为是独立业务概念，应拆成独立函数或模块。
- 不让 UI 层按步骤拼装导出流程。入口应调用完整用例，例如 `buildTopicExport()`。

## 外部 API 声明

GM API 只在使用它的文件中声明：

- [src/config/storage.ts](../../../src/config/storage.ts)：`GM_getValue`、`GM_setValue`
- [src/export/clipboard.ts](../../../src/export/clipboard.ts)：`GM_setClipboard`
- [src/export/obsidian-api.ts](../../../src/export/obsidian-api.ts)：`GM_xmlhttpRequest`
- [src/ui/styles.ts](../../../src/ui/styles.ts)：`GM_addStyle`
- [src/main.ts](../../../src/main.ts)：`GM_registerMenuCommand`

不要把所有 GM API 声明集中到全局类型文件里，除非同时建立真实的测试替身和边界契约。局部声明能让副作用边界更明显。

## 错误处理

- 主导出流程失败必须向用户显示 Toast，并保留 console 错误，参考 [src/main.ts](../../../src/main.ts) 的 `doExport()`。
- 可选增强失败可以静默忽略或 `console.warn`，例如上传短链解析失败、过期笔记检测失败；但主流程不能因此生成缺楼层文档。
- `fetchAllPosts()` 的楼层缺失必须抛错，不能“尽量导出已拿到的内容”。对应测试在 [test/api.test.ts](../../../test/api.test.ts)。

## 页面状态与 SPA 适配

Discourse 是 SPA，帖子和标题区域可能动态更新。允许使用 `MutationObserver` 作为页面适配机制，但只能出现在运行时或 UI 边界：

- [src/runtime/topic-lifecycle.ts](../../../src/runtime/topic-lifecycle.ts) 观察页面变化以检测话题激活、补注入全局按钮、重置话题级 UI 状态。
- [src/ui/floor-buttons.ts](../../../src/ui/floor-buttons.ts) 观察楼层列表以补注入楼层按钮。

不要在核心转换、导出适配或配置层引入 DOM 观察逻辑。
