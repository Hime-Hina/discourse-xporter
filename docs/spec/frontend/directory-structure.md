# 目录结构

## 项目形态

项目是单包 userscript，不存在前端路由、页面目录、React component 或 hook 层。`src/` 直接按运行时边界组织：

```text
src/
├── main.ts                  # userscript 入口：检测环境、初始化 UI、连接回调
├── types.ts                 # Discourse API 类型和应用内部 DTO
├── config/                  # 默认配置与 GM 存储
├── core/                    # Discourse 数据获取、Markdown 转换、导出文档组装
├── export/                  # 浏览器下载、ZIP、Obsidian API、图片资源适配
├── runtime/                 # Discourse SPA 话题生命周期和话题级状态重置
├── ui/                      # 原生 DOM 面板、楼层按钮、Toast、样式注入
└── utils/                   # 无副作用或低副作用的通用函数
```

测试放在 `test/*.test.ts`，按被测模块命名，例如 [test/raw-pipeline.test.ts](../../../test/raw-pipeline.test.ts)、[test/image-assets.test.ts](../../../test/image-assets.test.ts)。

## 模块职责

- `src/main.ts` 只应负责 userscript 启动、Discourse 页面检测、注册菜单、启动运行时生命周期、初始化 UI、把 UI 回调连接到用例函数。
- `src/runtime/topic-lifecycle.ts` 负责 `/t/...`、`/nested/...` 话题身份检测、SPA 话题激活、标题按钮补注入、话题级状态重置和按话题 ID 去重的被动检查触发。
- `src/core/topic-export.ts` 是完整话题导出的用例入口，负责组合 `fetchTopic`、`fetchAllPosts`、`resolveUploadUrls`、`processPost` 和 `assembleDocument`。
- `src/core/single-post-export.ts` 是单楼层 Markdown 构建用例，负责获取话题/楼层数据、解析 `upload://`，并调用统一的 `post-content.ts` 正文规则。
- `src/core/post-content.ts` 是单楼与整帖共用正文入口，拥有 raw 优先与可观察降级语义；`core/cooked-fallback.ts` 拥有共享 Onebox 提取/呈现。
- `src/core/raw-pipeline.ts` 负责 raw Markdown 转换。不要在这里做导出模式相关的图片路径改写。
- `src/export/topic-delivery.ts` 负责 Markdown、ZIP、Obsidian 话题交付的完整目的地操作。入口不应按图片收集、上传、改写、写入这些底层步骤拼流程。
- `src/export/obsidian-batch.ts` 负责 Obsidian 已导出笔记扫描和批量重导。UI 只触发回调和展示进度。
- `src/export/image-assets.ts` 负责图片物化、内容地址及图片链接改写；`export/paths.ts` 拥有站点身份与目录，`export/topic-links.ts` 拥有实际跨笔记引用。
- `src/utils/markdown-code.ts` 与 `markdown-links.ts` 提供正文和附件共用的代码保护、链接识别边界。
- `src/export/obsidian-api.ts` 是 Obsidian Local REST API 边界，负责 URL 校验、鉴权 header、vault path 编码和 GM 请求。
- `src/ui/*` 只处理 DOM 构建、事件绑定、用户输入和展示状态。导出逻辑、Discourse API、Markdown 转换不得塞进 UI 文件。
- `src/utils/*` 只放有清晰领域含义的函数，例如 `safeFilename`、`topicUrl`、`sleepRandom`。不要创建含糊的 `utils` 聚合文件或 `helper` 命名。

## 导入方向

- `main.ts` 可以导入各层模块，因为它是入口编排层。
- `ui/*` 不直接调用导出业务流程；通过 `PanelCallbacks`、`setOnCopyPost` 这类明确回调连接到入口。
- `core/*` 可以依赖 `types`、`config/defaults` 和 `utils/*`，但不依赖 `ui/*`。
- `export/*` 可以依赖低层工具和必要的数据获取函数，例如 [src/export/image-assets.ts](../../../src/export/image-assets.ts) 使用 `fetchBinary` 下载图片。
- `test/*` 可以构造最小 mock，但应覆盖真实边界契约，例如 `fetchAllPosts` 缺楼层必须抛错、Obsidian API 非本地地址不得发送 token。

## 新文件放置规则

- 新增完整业务流程：优先放入 `core/<domain>.ts` 或 `export/<adapter>.ts`，不要继续扩展 `main.ts`。
- 新增 Discourse SPA 话题生命周期行为：放入 `runtime/*`，不要把路由状态机重新堆回 `main.ts` 或 UI 文件。
- 新增 Discourse 页面选择器：放入 `ui/*` 的页面适配边界，避免散落到转换或导出层。
- 新增 Markdown 转换：放入 `core/raw-pipeline.ts` 或拆出同层专用模块，并为转换顺序写测试。
- 新增 Obsidian、ZIP、下载相关行为：放入 `export/*`，入口只调用完整操作。
- 新增共享函数前先搜索是否已有同类函数，避免把重复逻辑换成含糊的工具函数。
