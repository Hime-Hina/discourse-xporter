# 代码复用思考指南

## 先搜索

新增函数、常量、正则、路径拼接或配置字段前，先搜索相同领域：

```bash
rg "value_or_concept" src test docs/spec
```

不要为了“复用”创建含糊的 `helper`、`utils`、`manager`。只有当函数拥有清晰领域契约时才抽取。

## 本项目已有复用点

- URL 处理：[src/utils/url.ts](../../../src/utils/url.ts)
- 文件名处理：[src/utils/filename.ts](../../../src/utils/filename.ts)
- Obsidian alias 转义：[src/utils/obsidian.ts](../../../src/utils/obsidian.ts)
- 随机延迟：[src/utils/timing.ts](../../../src/utils/timing.ts)
- 二进制 active bytes 转 `ArrayBuffer`：[src/utils/binary.ts](../../../src/utils/binary.ts)
- BBCode 解析：[src/utils/bbcode.ts](../../../src/utils/bbcode.ts)
- 图片资源收集和改写：[src/export/image-assets.ts](../../../src/export/image-assets.ts)
- Obsidian API path 编码和本地 URL 校验：[src/export/obsidian-api.ts](../../../src/export/obsidian-api.ts)

## 复用判断

应该复用或移动已有逻辑：

- 两处以上需要相同 vault path 清理规则。
- 两处以上需要相同 Markdown 图片链接正则。
- 两处以上需要相同 Obsidian wikilink alias 转义。
- 两处以上需要把 `Uint8Array` active view 转成 `ArrayBuffer`。
- 新字段需要同时出现在类型、默认配置、UI、存储、测试中。

不应该抽象：

- 只有一个调用点，且领域含义不稳定。
- 抽象后名称只能叫 `helper`、`process`、`handle`。
- 只是为了隐藏一个特殊分支或 flag。
- 调用方仍需要知道内部步骤顺序才能正确使用。

## 常见重复风险

### 图片路径

不要在 raw pipeline、formatter、导出适配器中各写一套图片路径规则。图片模式归 [src/export/image-assets.ts](../../../src/export/image-assets.ts) 所有。

### Obsidian 链接

`|`、`]`、反斜杠等 alias 转义规则归 [src/utils/obsidian.ts](../../../src/utils/obsidian.ts) 所有。不要在字符串模板里临时 replace。

### Discourse URL

话题 URL 和头像 URL 归 [src/utils/url.ts](../../../src/utils/url.ts) 所有。新增站内链接补全前先检查 `resolveUrl()` 和 `topicUrl()`。

### 配置字段

新增 `Config` 字段时至少同步：

- [src/types.ts](../../../src/types.ts)
- [src/config/defaults.ts](../../../src/config/defaults.ts)
- [src/config/storage.ts](../../../src/config/storage.ts) 的差异保存是否仍正确
- UI 输入或调用方
- 对应测试

## 验证

复用调整后运行：

```bash
pnpm exec tsc --noEmit
pnpm test:run
pnpm run build
```

如果测试失败，不要删除断言来适配新抽象。先确认抽象是否放错所有者。
