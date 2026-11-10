# Discourse Xporter 项目规范

本目录描述当前代码库的真实工程边界。项目是 TypeScript + Vite + `vite-plugin-monkey` 构建的油猴脚本，运行在第三方 Discourse 页面上；不要按 React/Vue 应用理解，也不要沿用组件、hook、全局 store 这类不适用的模板规则。

## 规范索引

| 规范 | 内容 |
| --- | --- |
| [目录结构](./directory-structure.md) | `src/`、`test/` 的职责边界和导入方向 |
| [运行时边界](./runtime-boundaries.md) | userscript 初始化、`main.ts` 入口职责、GM API 与页面环境 |
| [Discourse API](./discourse-api.md) | 话题、楼层、上传资源、分类名和网络错误处理 |
| [Markdown 管道](./markdown-pipeline.md) | raw 优先、cooked fallback、BBCode、Onebox、Obsidian 输出规则 |
| [导出适配器](./export-adapters.md) | Markdown 下载、ZIP、Obsidian Local REST API、图片资源 |
| [DOM UI](./dom-ui.md) | 原生 DOM 面板、楼层按钮、样式注入、第三方页面适配 |
| [浏览器开发测试循环](./browser-dev-loop.md) | Vite userscript 调试、Chrome/Tampermonkey 注入验证、浏览器冒烟边界 |
| [类型安全与质量门禁](./type-safety-and-quality.md) | TypeScript 规则、禁止新增 `any`、测试和验证命令 |

## 全局原则

- 文档使用中文；代码、命令、配置键、错误信息保持原文。
- 新增代码优先放在拥有不变量和外部依赖知识的模块中，不把流程继续堆进 `main.ts`。
- 不引入前端组件库作为默认方案。当前 UI 是注入式 userscript UI，组件库会增加 bundle、样式隔离和宿主页面兼容成本。
- 边界处验证外部输入，内部流程信任已建立的不变量。不要用重复空值检查掩盖入口设计问题。
- 禁止为了兼容不清晰的调用方式增加 mode、flag、options bag 或 facade。真实业务差异应拆成独立操作。

## 当前重点债务

- [src/main.ts](../../../src/main.ts) 应保持入口连接器角色。新增导出、扫描、迁移、复制流程必须先放到 `core/*` 或 `export/*` 的完整操作中，再由入口连接 UI 回调。
- [src/ui/panel.ts](../../../src/ui/panel.ts) 的 DOM refs 必须通过显式接口返回和持有，禁止重新引入 `(x as any)._refs`、`_selGroup` 或类似隐藏属性。
- 质量门禁包括 `pnpm exec tsc --noEmit`、`pnpm test:run`、`pnpm run build` 和 `pnpm run lint`。发现失败时先定位边界和类型契约，不用放宽类型绕过。
