# 思考指南

本目录是编码前后的检查清单，用于提醒未来 agent 先确认边界和复用点。它不替代 [frontend 项目规范](../frontend/index.md)。

## 指南索引

| 指南 | 使用时机 |
| --- | --- |
| [代码复用思考指南](./code-reuse-thinking-guide.md) | 修改配置、路径、URL、Markdown、图片、DOM helper、网络请求前 |
| [跨层边界思考指南](./cross-layer-thinking-guide.md) | 改动穿过 API、Markdown 管道、formatter、导出适配器、UI 中任意两层以上时 |

## 快速触发条件

需要读代码复用指南：

- 新增工具函数或复制已有正则。
- 修改 `Config`、`DEFAULTS`、frontmatter 字段、图片路径规则。
- 处理 vault path、URL、文件名、Obsidian wikilink。
- 新增 Toast、DOM 构建 helper、网络请求 helper。

需要读跨层边界指南：

- 新增或修改导出模式。
- 改 raw pipeline 输出。
- 改 frontmatter 或 `FORMAT_VERSION`。
- 改图片下载、上传、路径改写。
- 改 Discourse API 获取字段。
- 改 UI 输入，并影响 core/export 行为。

## 核心规则

- 先搜索现有实现，再新增函数。
- 先找拥有不变量的模块，再决定改哪里。
- 先跑质量门禁，再判断是否完成。
