# 2026-11-11 重构验证记录

审查基线为 `549d09aff027ca39fb7f6f87f549b3a3f0b768fc`。保留 TypeScript、原生 DOM 与 core/export/runtime/ui 边界，未增加运行时依赖、数据库或前端框架。输出格式版本递增到 3；旧记录不自动搬迁、删除或扩大导出范围。

## 自动化验证

Node v24.22.1、package.json 声明的 pnpm 10.20.0：

```bash
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm exec tsc --noEmit
corepack pnpm run lint
corepack pnpm test:run
corepack pnpm run build
```

类型、lint、测试、构建均通过，27 个测试文件、258 个测试。生产 userscript 为 190.90 kB，gzip 47.85 kB；这是新增完整性、安全与重导能力后的实测体积，不宣称 bundle 缩小。CI 会在 PR 与 main push 重新执行同一门禁；标签发布入口只在显式推送匹配 package version 的标签时执行。

| Issue | 实现与主要验证 |
| --- | --- |
| #2 | origin + topic ID 唯一身份、正文/附件站点目录、旧路径保留、拒绝异源/普通笔记覆盖；`image-assets` / `topic-delivery` / `obsidian-api` 测试 |
| #3 | 内容地址附件、字节确认复用、下载失败保全旧资源、收束并发；`image-assets` / `topic-delivery` |
| #4 | 启动输入快照、统一写入门禁、迟到过期响应与动作失效；`topic-export` / `main-entry` / `export-operation` |
| #5 | 共用任意长度 inline、两类 fence、缩进、list/quote 代码保护；`markdown-code` / `markdown-links` / `raw-pipeline` / `cooked-fallback` |
| #6–#7 | 原模板单次替换、文本 YAML 双引号与控制字符转义；`formatter`，另用已安装 js-yaml 实际解析往返 |
| #8 | inline title、引用式、括号/转义、链接内图片、frontmatter 排除与 raw/cooked 图片筛选；`markdown-links` / `image-assets` |
| #9–#10 | 普通/mega 可见 ID 完整性与分类按 origin + ID 查询；`api` / `topic-export` / `batch-contract` |
| #11 | 白名单版本化 export_profile、稳定帖子 ID、策略恢复、缺失策略明确重设；`export-profile` / `obsidian-batch` / `batch-contract` / `panel` |
| #12 | 真实 block、唯一来源目标、未导出/歧义回网页、只刷新选中导出笔记；`topic-links` / `topic-delivery` |
| #13–#14 | 主动 metadata 失败不伪装空扫描、批量后置刷新与逐路径选择；`obsidian-api` / `obsidian-batch` / `panel-batch` |
| #15 | 无属性与嵌套 BBCode、日期分钟、details、资源深度上限保留；`bbcode` / `raw-pipeline` |
| #17 | 已知 ID 定向获取、候选用户筛选、本地精筛、只解析交付内容资源；`topic-export` |
| #18 | 完整内容重建后跳过相同交付，旧帖编辑/删帖/格式升级不会只凭计数跳过；`batch-contract` |
| #19 | 请求与响应体期限、有限退避、取消收束、PUT 不确定结果优先报告、打开失败独立反馈；`api` / `obsidian-api` / `image-assets` / `main-entry` |
| #22–#24 | 两入口统一正文降级、共享 Onebox 呈现、删除正文 Config/slug 与无用构建中间数组；`post-content` / `single-post-export` / `formatter` |

固定源站采集 fixture：目标 2 帖的定向与完整路径均为 2 次 GET，分别 3,055 与 8,488 响应字节，最终 Markdown 完全一致。批量交付的具体读写次数见[导出规范](spec/frontend/export-adapters.md)。这些是合成数据度量，没有经过真实源站验证的 ETag/帖子修订缓存；无法证明未变时继续完整读取。

## 保留开放的验收

- **#1**：已去掉所有共享 DOM 密钥输入/回填，GM 菜单使用无已存值默认项的浏览器原生 prompt；生产 `@sandbox DOM`、本机网络权限、禁止合成特权点击、开发配置隔离均有代码与合成回归。实际 Tampermonkey 的设置、更换、清除与输入期间隔离尚未验证。
- **#16**：URL/DOM 时序、history/popstate/Navigation 通知、标题补注入、离页停止 observer 与 flat/nested post ID 绑定已有回归。真实主题、前进/后退与原始偶发 TODO 尚未完成现场复现/验收。
- **#20**：固定工具版本、CI、发布入口、存储边界、完整静态检查、生产/开发构建契约已实现。真实支持管理器与 Obsidian 集成仍欠验收，不能用这些检查替代 #1 的生产隔离证据。
- **#21**：总跟踪保留，待以上现场验收完成再关闭。

当前执行环境有受管 Chromium，但没有 Tampermonkey，管理策略禁止安装扩展；未绕过策略。所有测试使用合成凭据与内存 vault，没有读取真实密钥或写入用户 Obsidian。

现场验收应使用正式构建、独立合成 API Key 与小型受控话题，记录浏览器、Tampermonkey、Obsidian Local REST API、站点/主题版本，以及设置/换钥/清除、宿主覆写 prompt/合成点击、导航/取消、图片失败保护和重导结果。不要使用巨型公开话题全量抓取替代协议 fixture。

## 后续改动的所有者

目录与来源规则修改 `export/paths.ts`；新的正文规则修改 `core/post-content.ts` 及对应 raw/cooked 所有者；图片语法修改 `utils/markdown-links.ts`，代码区域修改 `utils/markdown-code.ts`；每篇输出选项修改 `ExportProfile` 的显式构造/解析；新写入入口调用已有 `runtime/export-operation.ts` 与完整交付用例。
