# 类型安全与质量门禁

## TypeScript 基线

项目启用 `strict`、`isolatedModules`、`noUnusedLocals`、`noUnusedParameters`、`noEmit`，配置在 [tsconfig.json](../../../tsconfig.json)。质量门禁必须包含：

```bash
pnpm exec tsc --noEmit
pnpm test:run
pnpm run build
pnpm run lint
```

类型与 lint 检查覆盖 `src/`、`test/`、`vite.config.ts` 和 `vitest.config.ts`。CI 固定 Node 24，并从 package.json 安装 pnpm 10.20.0，使用 frozen-lockfile。安装、发布与权限的入口见根目录 README。

`vite build` 不能替代 `tsc --noEmit`。Vite 可能构建成功，但 TypeScript 静态检查仍能发现真实边界错误。

## 禁止新增 `any`

新增代码禁止使用 `any`，包括：

- `as any`
- 参数或返回值显式 `any`
- 用 `Record<string, any>` 逃避外部数据建模
- 把 DOM refs、API 响应、配置对象塞进未类型化对象

外部未知值使用 `unknown`，在边界收敛成具体类型。[src/ui/panel.ts](../../../src/ui/panel.ts) 的 refs 必须通过显式接口持有，禁止用 `(x as any)._refs`、`_selGroup` 或隐藏 DOM 属性承载复杂对象。

## 类型断言

允许的断言必须位于边界，并且断言后立即建立不变量：

- DOM 创建后断言为具体元素，例如 `h('input', ...) as HTMLInputElement`。
- DOM 查询后必须检查 null，再使用具体元素。
- 测试 mock 可以用最小对象断言为外部类型，但必须只服务于当前测试场景。

禁止用断言绕过真实类型问题。例如 `Uint8Array.buffer` 可能是 `SharedArrayBuffer` 时，正确做法是复制到新的 `ArrayBuffer`，不是 `as ArrayBuffer`。

## 命名规则

名称必须表达具体领域含义。避免默认名称：

- `data`
- `info`
- `result`
- `handler`
- `manager`
- `process`
- `utils`
- `helper`
- `do_*`
- `*_impl`

已有少量历史名称不作为新增模板。新增导出用例应命名为具体动作，例如 `buildTopicExport`、`collectImageAssets`、`rewriteImageUrlsForObsidian`。

## 边界验证

- Discourse API 响应在获取边界检查结构，例如 `fetchAllPosts()` 校验 `data?.post_stream?.posts` 是否为数组。
- 配置在 `getConfig()` 与 UI 输入边界收敛，内部使用 `Config`。
- Obsidian API URL 在 `apiUrl()` 中校验本地地址，内部写入函数信任该校验。
- DOM 查询只在 UI 边界反复检查，核心转换函数不处理 DOM 缺失。

不要在可信内部流程里层层加 `if (!x) return`。如果同类检查出现多次，应重新审视入口、类型或所有者。

## 测试策略

优先测试纯函数和边界契约：

- BBCode 解析：[test/bbcode.test.ts](../../../test/bbcode.test.ts)
- raw 管道：[test/raw-pipeline.test.ts](../../../test/raw-pipeline.test.ts)
- cooked fallback：[test/cooked-fallback.test.ts](../../../test/cooked-fallback.test.ts)
- frontmatter 和楼层模板：[test/formatter.test.ts](../../../test/formatter.test.ts)
- Discourse API 完整性：[test/api.test.ts](../../../test/api.test.ts)
- 图片资源路径：[test/image-assets.test.ts](../../../test/image-assets.test.ts)
- Obsidian API 安全边界：[test/obsidian-api.test.ts](../../../test/obsidian-api.test.ts)
- 话题生命周期：[test/topic-lifecycle.test.ts](../../../test/topic-lifecycle.test.ts)
- 目的地交付用例：[test/topic-delivery.test.ts](../../../test/topic-delivery.test.ts)
- 单楼层导出：[test/single-post-export.test.ts](../../../test/single-post-export.test.ts)
- Obsidian 批量重导：[test/obsidian-batch.test.ts](../../../test/obsidian-batch.test.ts)
- 面板筛选 refs 归一化：[test/panel.test.ts](../../../test/panel.test.ts)

新增转换规则、导出模式、路径规则、外部 API 行为必须加测试。只靠真实论坛手动验证不够。

## 注释规则

注释只解释契约、不变量、外部约束或拒绝的替代方案。不要用注释复述代码流程。

可接受例子：

- `FORMAT_VERSION` 注释说明只在输出格式不兼容时递增。
- raw pipeline 注释说明图片改写不能提前执行，因为会影响图片收集。
- Obsidian API local URL 校验说明 bearer token 不能发往非本地地址。

不可接受例子：

- “创建按钮”
- “循环数组”
- “调用函数”
- 用注释解释一个命名含糊的接口

## 质量失败处理

质量命令失败时先定位根因并修复。禁止：

- 放宽类型签名让 `tsc` 通过。
- 删除测试断言掩盖行为变化。
- 为一个特殊情况新增 flag / mode。
- 在多个调用方补丁式调整调用顺序。

如果修复需要扩散到多个文件，先判断是否是职责归属错误，而不是继续堆补丁。
