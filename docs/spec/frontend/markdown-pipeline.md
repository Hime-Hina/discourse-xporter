# Markdown 管道规范

## 数据策略

导出内容以 Discourse `raw` Markdown 为主，`cooked` HTML 只作为补充来源或 fallback：

- `raw` 存在时，使用 [src/core/raw-pipeline.ts](../../../src/core/raw-pipeline.ts) 的 `processRaw()`。
- `raw` 为空或处理抛错时，使用 [src/core/cooked-fallback.ts](../../../src/core/cooked-fallback.ts) 的 `cookedToMarkdown()`。
- Onebox 和 quote preview 需要从 cooked HTML 提取结构，但替换目标仍是 raw 中的裸 URL。
- raw 中的站内相对裸链接也属于替换目标，例如 `/t/slug/123` 和 `/t/slug/123/4`；匹配前必须按当前 `origin` 归一化，不要依赖 DOM 解析后的 `href`。

不要把 cooked fallback 当成主路径扩展。raw 管道已处理的语义不要在 Turndown 规则里重复实现。

## 转换顺序

`processRaw()` 的步骤顺序是输出契约的一部分：

1. `resolveUploadShortUrls()`：`upload://` 到完整 URL。
2. `resolveRelativeLinks()`：站内相对链接转绝对 URL。
3. `transformQuotes()`：`[quote]` 转 Obsidian quote callout。
4. `transformPolls()`：`[poll]` 结合 JSON poll 数据转表格。
5. `transformDates()`：`[date]` 转可读日期字符串。
6. `transformDetails()`：`[details]` 和 raw HTML `<details><summary>...</summary>...</details>` 转 Obsidian 可折叠 callout。
7. `replaceEmoji()`：emoji shortcode 转 Unicode。
8. `transformOneboxes()`：裸 URL 转 link callout 或标题链接。
9. `transformQuotePreviews()`：站内裸 URL 转引用预览 callout。
10. 再次 `resolveRelativeLinks()`：处理 Turndown 可能引入的相对链接。
11. `escapeBracketedLinkLabels()`：避免 Obsidian 把 `[[1]](#footnote)` 误读为 wikilink。
12. `normalizeObsidianSpacing()`：保证 quote 和图片块边界。

新增转换必须说明放在这个顺序中的原因，并补测试证明不会破坏前后步骤。

## 图片路径不属于 raw 管道

`processRaw()` 禁止调用图片路径改写。原因是导出模式不同：

- Markdown 下载保留远程 URL。
- ZIP 需要改写为 `{imgDir}/{topicId}/{filename}`。
- Obsidian file 模式需要改写为 `![[path|alias]]`。
- Obsidian none 模式需要移除图片。

图片收集和改写归 [src/export/image-assets.ts](../../../src/export/image-assets.ts) 所有。提前在 raw 管道改写会导致无法收集原始 URL。

## BBCode 解析

[src/utils/bbcode.ts](../../../src/utils/bbcode.ts) 只负责解析 Discourse BBCode 结构，不负责输出 Markdown。输出语义由 raw pipeline 决定。

规则：

- 成对标签使用外层匹配，调用方递归处理嵌套。
- malformed 标签不应抛出主流程异常，应保留未转换文本。
- 解析结构必须具体命名，例如 `QuoteParams`、`PollParams`，不要使用 `data`、`info`、`result` 这类默认名。

## cooked fallback

[src/core/cooked-fallback.ts](../../../src/core/cooked-fallback.ts) 的 Turndown 规则只覆盖 cooked-only 场景：

- Discourse fenced code block
- lightbox 原图
- onebox 卡片
- cooked quote
- footnote ref / def / backref / separator

不要新增与 raw 管道重复的 cooked 规则，例如 poll、date、details、emoji、internal link。重复规则会让 raw 和 fallback 输出逐渐分叉。

## Obsidian 输出约束

- 同话题引用使用 `[[#^floor-N|#N]]`。
- 每个楼层标题必须保留 `^floor-N` block ref。
- 选中楼层使用 `==已选中==` 并在文末生成高亮摘要。
- Markdown link label 中的双中括号要转义，避免 Obsidian 当作 wikilink。
- 独立图片和 quote block 前后要有空行，避免 Obsidian 渲染粘连。
- Discourse Solved 只在 1 楼追加 accepted answer 楼层链接，不复制解决方案正文；accepted answer 楼层通过模板变量显示解决方案标记。
- 上述输出语义变化必须递增 `FORMAT_VERSION`，让已有 Obsidian 笔记进入过期/重导提示。

对应测试集中在 [test/raw-pipeline.test.ts](../../../test/raw-pipeline.test.ts)、[test/formatter.test.ts](../../../test/formatter.test.ts) 和 [test/cooked-fallback.test.ts](../../../test/cooked-fallback.test.ts)。
