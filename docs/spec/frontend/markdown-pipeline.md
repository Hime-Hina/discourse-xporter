# Markdown 管道规范

## 数据策略

导出内容以 Discourse `raw` Markdown 为主，`cooked` HTML 只作为补充来源或 fallback：

- 整篇和单楼复制共同通过 [src/core/post-content.ts](../../../src/core/post-content.ts) 的 `postToMarkdown()` 转换正文。
- `raw` 存在时调用 [src/core/raw-pipeline.ts](../../../src/core/raw-pipeline.ts) 的 `processRaw()`；raw 处理失败时只记录 topic ID、post ID、楼层号等定位信息，并降级 cooked 一次，不记录正文或密钥。
- `raw` 为空时直接使用 [src/core/cooked-fallback.ts](../../../src/core/cooked-fallback.ts) 的 `cookedToMarkdown()`；cooked 再失败必须抛错，不重复调用同一失败转换。
- Onebox 和 quote preview 需要从 cooked HTML 提取结构，但替换目标仍是 raw 中的裸 URL。
- raw 中的站内相对裸链接也属于替换目标，例如 `/t/slug/123` 和 `/t/slug/123/4`；匹配前必须按当前 `origin` 归一化，不要依赖 DOM 解析后的 `href`。

不要把 cooked fallback 当成主路径扩展。Onebox 等两条路径都需要的结构提取和呈现规则应复用已有实现，不维护两套 selector 和 callout 拼装。正文入口只接收转换需要的上下文，不透传完整 Config、API Key、vault 目录或 UI 状态。

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

## 代码区域

[utils/markdown-code.ts](../../../src/utils/markdown-code.ts) 统一识别并保护代码区域，raw 转换、emoji、间距调整和附件扫描/改写共用这一边界。覆盖反引号或波浪号围栏的字符与长度、任意长度反引号 inline code、缩进代码；未闭合围栏保护到 EOF。代码内的示例 URL、BBCode、emoji 和图片语法不能被正文转换或资源下载解释。

生成 cooked code fence 时，围栏必须长于内容中的对应字符 run，保留代码文字和空白。后续新增正文转换或链接扫描应复用代码范围，不能复制只识别三反引号的正则。

## 图片路径不属于 raw 管道

`processRaw()` 禁止调用图片路径改写。原因是导出模式不同：

- Markdown 下载保留远程 URL。
- ZIP 需要按交付边界的资源映射改写为压缩包内路径；路径由来源身份与附件布局共同决定。
- Obsidian file 模式需要改写为 `![[path|alias]]`。
- Obsidian none 模式需要移除图片。

图片收集和改写归 [src/export/image-assets.ts](../../../src/export/image-assets.ts) 所有。提前在 raw 管道改写会导致无法收集原始 URL。

## BBCode 解析

[src/utils/bbcode.ts](../../../src/utils/bbcode.ts) 只负责解析 Discourse BBCode 结构，不负责输出 Markdown。输出语义由 raw pipeline 决定。

规则：

- 成对标签按源文本的 start/end 区间消费，调用方递归处理嵌套，不用内容反向查找定位闭合标签。
- 无属性标签和属性标签使用同一配对规则；递归最多 64 层，超限时保留尚未消费的子树并发出定位警告，不静默截断。
- malformed 标签不应抛出主流程异常，应保留未转换文本。
- 解析结构必须具体命名，例如 `QuoteParams`、`PollParams`，不要使用 `data`、`info`、`result` 这类默认名。

## cooked fallback

[src/core/cooked-fallback.ts](../../../src/core/cooked-fallback.ts) 的 Turndown 规则只覆盖 cooked-only 场景：

- Discourse fenced code block
- lightbox 原图
- onebox 卡片
- cooked quote
- footnote ref / def / backref / separator

Onebox 与 inline Onebox 共享 `renderOnebox()` / `renderInlineOnebox()`；raw 的 Onebox 和 quote preview 在同一帖子复用一份已解析 cooked Document。新增展示字段应只修改这份结构与呈现规则。其他 cooked 规则仍按真实 cooked-only 需求增加，避免复制 raw 的完整流水线。

HTML details 的属性和 open 状态由当前转换规则处理；open details 生成展开 callout。无法安全展开的嵌套 HTML details 保留原文，不能用非配对正则吞掉内容。

## Obsidian 输出约束

- 只有目标楼层确实在本次文档内、且模板明确生成可用的 `^floor-N` 锚点时，引用使用 `[[#^floor-N|#N]]`；否则保留可访问的完整网页 URL。
- 默认模板在楼层标题行末生成 `{{block_ref}}`；自定义模板不生成可用锚点时，回复、解决方案与高亮导航同样回退网页链接，不能生成悬空内部链接。
- 选中楼层使用 `==已选中==` 并在文末生成高亮摘要。
- Markdown link label 中的双中括号要转义，避免 Obsidian 当作 wikilink。
- 独立图片和 quote block 前后要有空行，避免 Obsidian 渲染粘连。
- Discourse Solved 只在 1 楼追加 accepted answer 楼层链接，不复制解决方案正文；accepted answer 楼层通过模板变量显示解决方案标记。
- 上述输出语义变化必须递增 `FORMAT_VERSION`，让已有 Obsidian 笔记进入过期/重导提示。

对应测试集中在 [test/raw-pipeline.test.ts](../../../test/raw-pipeline.test.ts)、[test/formatter.test.ts](../../../test/formatter.test.ts) 和 [test/cooked-fallback.test.ts](../../../test/cooked-fallback.test.ts)。
