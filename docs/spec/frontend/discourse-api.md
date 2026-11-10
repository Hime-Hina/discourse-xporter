# Discourse API 规范

## 数据来源

话题导出统一使用 Discourse 标准 API，不根据 flat / nested 视图切换数据源：

- 话题元数据和首批楼层：`GET /t/topic/{topicId}.json?include_raw=true`
- 缺失楼层批量获取：`GET /t/{topicId}/posts.json?post_ids[]=...&include_raw=true`
- `upload://` 短链解析：`POST /uploads/lookup-urls`
- 分类名补全：DOM 面包屑优先，失败后读取 `/site.json`

对应代码在 [src/core/api.ts](../../../src/core/api.ts)。

## 楼层完整性

[src/core/api.ts](../../../src/core/api.ts) 的 `fetchAllPosts()` 以 `post_stream.stream` 为完整楼层 ID 列表，必须返回覆盖全部 ID 的楼层数组。

规则：

- 首批 posts 先进入 `allPosts`。
- `stream` 中缺失的 ID 按 `config.batchSize` 分批获取。
- 批次请求失败时，429 和 5xx 可有限重试；最终失败必须抛错。
- 全部分批完成后再次比对 `stream`，仍缺失必须抛错。
- 返回前按 `post_number` 排序。

不要为了“尽量导出”吞掉缺失楼层。缺失楼层会破坏引用、楼层筛选和 Obsidian block ref。

## `upload://` 解析

raw Markdown 中的图片和附件可能是 `upload://abc`。流程由 [src/core/topic-export.ts](../../../src/core/topic-export.ts) 收集所有 raw 中的短链，再调用 `resolveUploadUrls()` 批量解析。

规则：

- 收集阶段只读取 `post.raw`，不要从 cooked HTML 反推 upload 短链。
- 解析请求要带 `X-CSRF-Token`、`X-Requested-With` 和 `Accept: application/json`。
- `/uploads/lookup-urls` 是增强边界：失败时可以 `console.warn` 并保留原短链，不能中断整篇话题获取。
- 替换逻辑必须处理 `upload://abc.png` 这类带扩展名写法，避免留下 `.png.png`。

## 分类名

`fetchCategoryName()` 的优先级：

1. 从 `.category-breadcrumb .badge-category__name` 取最后一个面包屑，支持子分类。
2. 从 `/site.json` 的 `categories` 中按 `category_id` 查找。
3. 最后返回 `category-{id}`。

DOM fallback 属于 Discourse 页面边界，允许在 `core/api.ts` 中存在；不要把分类 DOM 查询散落到 formatter 或 UI 文件。

## 网络与节流

- 楼层批量请求使用 `config.batchDelayMin` / `config.batchDelayMax` 控制批次间延迟。
- 图片下载使用 [src/export/image-assets.ts](../../../src/export/image-assets.ts) 的 `imageConcurrency` 和图片延迟配置。
- 新增网络请求必须明确是否是主流程必需。必需请求失败应抛错；增强请求失败可降级但必须限制影响范围。

## 测试要求

修改 Discourse API 行为时至少覆盖：

- 请求失败不会静默遗漏楼层。
- 返回楼层排序稳定。
- `post_stream.stream` 未完整覆盖时抛错。
- 429 / 5xx 重试策略不让测试耗时失控，测试中应把延迟配置设为 0。
