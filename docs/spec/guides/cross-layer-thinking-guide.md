# 跨层边界思考指南

## 什么时候使用

当一个改动影响两个以上层时，先读本指南：

- Discourse API 字段进入 Markdown 输出。
- UI 配置改变导出行为。
- raw pipeline 输出影响图片下载、ZIP、Obsidian 写入。
- frontmatter 字段影响 Obsidian 搜索、过期检测、批量重导。
- `FORMAT_VERSION` 改变旧笔记迁移判断。

## 层级地图

```text
Discourse 页面 / API
  ↓
src/core/api.ts
  ↓
src/core/topic-export.ts
  ↓
src/core/raw-pipeline.ts + src/core/formatter.ts
  ↓
src/export/*
  ↓
Obsidian / ZIP / Markdown 下载 / 剪贴板

src/ui/* 通过回调触发流程，不拥有导出业务规则。
```

## 必查问题

- 输入边界在哪里验证？内部是否还在重复检查同一个条件？
- 谁拥有这个不变量？例如图片路径归 export/image-assets，不归 raw-pipeline。
- 改动是否需要同步类型、默认配置、UI、存储和测试？
- 是否引入了 mode / flag 来隐藏真实业务差异？
- 是否需要递增 `FORMAT_VERSION`？只有输出格式不兼容时才递增。
- 错误是主流程失败还是增强功能失败？主流程失败必须抛出或显示错误。

## 典型跨层案例

### 图片模式

图片从 raw Markdown 出现，但导出模式决定最终格式。

正确边界：

- raw pipeline 保留远程 URL。
- `collectImageAssets()` 收集图片。
- ZIP 和 Obsidian 分别改写路径。
- `imgMode: none` 由 export 层移除图片。

错误做法：

- 在 `processRaw()` 中提前生成 `![[...]]`。
- formatter 根据模式拼图片路径。
- UI 直接改 Markdown 字符串。

### 过期笔记检测

过期检测依赖 frontmatter、Obsidian 搜索和当前格式版本。

正确边界：

- formatter 输出 `xporter_version`。
- `FORMAT_VERSION` 只在不兼容输出变更时递增。
- `obsidian-api.ts` 使用 JsonLogic 查询。
- `main.ts` 只负责触发检查并显示 Toast。

错误做法：

- UI 自己解析 Markdown frontmatter。
- API 层知道 Toast 文案。
- 为不同版本新增兼容 flag，而不是明确迁移或重导。

### 楼层引用

楼层引用影响 quote 转换、formatter、Obsidian 导航和测试。

正确边界：

- raw pipeline 把同话题引用转为 `[[#^floor-N|#N]]`。
- formatter 确保每个楼层标题包含 `^floor-N`。
- 高亮摘要复用同一 block ref 规则。

错误做法：

- 某个导出适配器重写 block ref。
- UI 根据 DOM 楼层临时拼 Obsidian 链接。

## 完成前检查

跨层改动完成前至少确认：

- `pnpm exec tsc --noEmit` 通过。
- `pnpm test:run` 覆盖新增或变更的边界。
- `pnpm run build` 通过。
- `docs/spec/frontend/` 中相关规范仍准确。
