# 导出适配器规范

## 导出模式

当前导出模式由 [src/main.ts](../../../src/main.ts) 调用完整目的地操作，具体适配逻辑分布在 `src/export/`：

- Markdown 下载：[src/export/download.ts](../../../src/export/download.ts)，保留远程图片链接。
- ZIP 下载：[src/export/zip-export.ts](../../../src/export/zip-export.ts) 和 [src/export/image-assets.ts](../../../src/export/image-assets.ts)，把图片写入压缩包。
- Obsidian Local REST API：[src/export/obsidian-api.ts](../../../src/export/obsidian-api.ts)，通过 `GM_xmlhttpRequest` 写入 vault。
- 话题目的地交付：[src/export/topic-delivery.ts](../../../src/export/topic-delivery.ts)，组合 Markdown 下载、ZIP 图片物化、Obsidian 图片物化、笔记写入和打开动作。
- Obsidian 批量重导：[src/export/obsidian-batch.ts](../../../src/export/obsidian-batch.ts)，组合严格扫描、话题重建和原路径覆盖写入。
- 剪贴板：[src/export/clipboard.ts](../../../src/export/clipboard.ts)，只负责 `GM_setClipboard`。

新增导出方式应放在 `src/export/`，并暴露完整操作给入口调用。不要让 UI 或入口按底层步骤拼装外部协议。

## 图片资源

[src/export/image-assets.ts](../../../src/export/image-assets.ts) 是图片资源所有者：

- `collectImageAssets()` 从 Markdown 图片链接收集远程 URL。
- 同一个 `ImageAssetMap` 同时用于 ZIP 和 Obsidian 改写，保证文件名一致。
- emoji URL 和头像 URL 不作为导出图片。
- 先下载所需资源，再以完整 SHA-256 内容摘要命名；排序、筛选与源 URL 内容变化不能覆盖旧字节。重复摘要先核对实际 vault 字节，相同则跳过 PUT，不同则拒绝覆盖。
- 内容摘要使用浏览器 Web Crypto；不可用时 file 模式明确失败，建议通过 HTTPS 打开论坛，不退回不稳定顺序编号。
- 图片语法由 `utils/markdown-links.ts` 统一识别：inline/title、完整/折叠/快捷引用、尖括号、括号与转义。代码、frontmatter、emoji/头像不下载；不支持的实际 HTML 图片在 file 模式明确报错。
- vault 路径必须经过 `normalizeVaultPath()` / `joinVaultPath()`，移除 `..`、盘符和非法路径片段。
- file 模式是完整本地图片契约：任意必需图片下载或上传失败时，ZIP/Obsidian 导出必须失败，不生成包含缺失本地图片引用的笔记或压缩包。
- 图片上传和下载必须使用 `imageConcurrency`、`imageDelayMin`、`imageDelayMax`，不能在 Obsidian 路径绕过节流配置。

不要在 formatter 或 raw pipeline 中生成导出模式相关的图片路径。

## Obsidian API 安全边界

`obsidian-api.ts` 的 `apiUrl()` 在拼接请求前验证本机 base URL：

- 只允许 `http:` / `https:`。
- host 只允许 `localhost`、`127.0.0.1`、`::1`。
- 非本地地址不能发送 bearer token；拒绝 URL 里的用户信息、路径、query 和 hash。GM 请求设置 `redirect: error`，不扩大本机 `@connect` 范围。
- 密钥只通过 `config/credentials.ts` 的 GM 菜单和隔离世界内的浏览器原生 prompt 设置；没有已保存 key 的默认值。论坛 DOM 只显示“已配置/未配置”，合成 DOM 点击不能发起特权操作。
- 开发构建禁用密钥菜单，存储强制为空秘密；Vite 桥接测试不能证明生产隔离。真实 Tampermonkey 验收仍见 #1。

这个规则已有测试：[test/obsidian-api.test.ts](../../../test/obsidian-api.test.ts) 验证非本地 API URL 不会触发 `GM_xmlhttpRequest`。

## 写入语义

- `writeNote()` 使用 PUT 全量覆盖 Markdown。
- `writeBinary()` 使用 PUT 写图片或附件二进制。
- `openNote()` 只做打开动作，失败应抛错；交付用例把“笔记已确认提交”和后续打开失败分开反馈。
- 用户主动触发的搜索/扫描必须暴露 HTTP 或响应格式错误；只有被动提示类检查可以把失败折叠为“无结果”。
- `topic-delivery.ts` 的 Obsidian file 模式必须先完成图片上传和 Markdown 改写，再调用 `writeNote()`；任意图片失败应阻止最终笔记写入。
- `obsidian-batch.ts` 批量重导按站点身份校验原 note path，并恢复该记录的 `export_profile`。不要因全局设置变化扩大原筛选范围。
- `export_profile` 只保存版本、筛选条件、稳定帖子 ID、图片策略和楼层模板等输出选项；无上界楼层用 `null` 持久化。凭据、连接信息、UI 状态和节流设置不写入文档。
- 缺失或不支持的策略必须提示用户明确重设，默认拒绝批量覆盖；显式 `profileOverride` 才替换原策略。手动选择依赖稳定 post ID，不按楼层号推测帖子身份。
- 主动扫描读取元数据失败时报告具体文件并中止，不把不完整扫描显示成空结果。普通非导出笔记可以跳过，非法身份和来源不匹配必须拒绝。
- 批量用例在首次异步等待前固定连接、目标和策略，按路径区分同话题的不同导出记录。取消后停止新任务，保留已经完成的结果与待重试记录。
- 读取重试归 API 边界；批量用例不依据错误字符串重跑整篇写入。PUT 结果不确定时必须显示具体错误，不能宣称没有提交。

## 来源身份、目录及旧笔记

`export/paths.ts` 独占 origin 编码和 vault 路径规则，面板通过入口回调显示同一结果。身份是规范化 HTTP(S) origin + 正整数 topic ID；显示名称不是身份。站点目录保留 scheme、host、非默认 port 与末尾点的差异，默认端口与域名大小写按 URL 规则归一。

- 新正文：`<exportDir>/<siteKey>/<safeTitle>--<topicId>.md`。
- 相对附件：`<exportDir>/<imgDir>/<siteKey>/<topicId>/<sha256>.<ext>`。
- 绝对附件：`<imgDir>/<siteKey>/<topicId>/<sha256>.<ext>`，其中绝对表示从 vault 根开始；ZIP 中仍为包内相对路径。

按身份搜索到唯一旧笔记时保留旧路径；同身份多篇策略时要求在批量列表明确选择记录。目标属于另一来源或普通笔记时拒绝覆盖，等待下载期间检测到正文变化也会停止。新布局不会移动、删除旧笔记或附件；没有策略的旧记录只有明确重设后才重导。不提供自动垃圾回收。

## 引用链接

`export/topic-links.ts` 以最终 Markdown 的真实非代码 block 和唯一来源目标决定链接。缺楼层、模板没有锚点、跨站同 ID 或多篇策略歧义时保留网页地址。Markdown/ZIP 不引用用户 vault 文件；Obsidian 可以连接已导出目标。新目标稍后导出后，用户可在批量区选择记录并执行“更新所选笔记链接”；不扫描改写普通知识库文档，重复操作不产生额外修改。

## 终止与并发

请求和响应体均有有限期限。读取有限重试并尊重有上限的 Retry-After；认证错误不重试。GM 兼用 timeout 回调与拥有者的硬期限，支持 abort handle。`runtime/export-operation.ts` 统一拥有冲突写入和取消信号；按钮状态只是展示。

图片分支使用 allSettled 收束。任何已派发 PUT 的取消、网络中断或超时均为结果不确定，不能自动重跑整篇；并发多个失败时优先报告不确定写入。取消不等于远端回滚；正文提交前发生确定失败时保留旧正文和旧资源。

## 批量更新与增量边界

批量结果区分 `updated`、`unchanged` 和 `failed`，并保留逐路径结果及失败原因。完全一致的最终文档忽略本次执行的 `exported` 时间后可以跳过正文写入；已确认内容与路径都不变的附件可以复用。不能只比较帖子数、末楼或格式版本判定源内容未变化。

目前没有经过目标站点版本和权限条件验证的 ETag / 帖子修订缓存协议。每次仍从源站读取策略所需的完整可见内容；减少的是可证明重复的交付，不把这一行为描述为已经实现源站增量读取。

`pnpm exec vitest run test/batch-contract.test.ts` 使用两个不同策略、非连续楼层且 post ID 不等于楼层号的话题，保留真实构建、路径、资源和交付逻辑，仅替换 HTTP/GM 外部边界。固定 fixture 的测量如下，响应字节不含 HTTP 头：

| 执行 | 源站/图片读取次数 | 响应字节 | Obsidian PUT |
| --- | --- | --- | --- |
| 初次更新 | 7 | 4,429 | 3（2 篇正文、1 个附件） |
| 源内容未变，次日重导 | 6 | 4,353 | 0 |

第二次少一次 `/site.json` 读取来自按 origin 缓存分类表；图片仍下载 4 字节并验证 vault 中的现有内容。旧楼层修改后仅对应正文更新，格式版本升级后两篇均更新。这些是受控合成数据结果，未替代真实 Obsidian / 论坛集成验收。

不要把写入失败降级为成功 Toast。外部写入失败必须向上抛出，让入口显示错误。
不要保留未实现的写入模式配置；没有完整产品契约时只支持全量覆盖写入。

## 二进制边界

`Uint8Array.buffer` 的类型可能是 `ArrayBuffer | SharedArrayBuffer`，而 `Blob` 和 `GM_xmlhttpRequest.data` 需要明确的 `ArrayBuffer` 边界。

规则：

- 发送或构造 Blob 前必须把活跃字节复制到真实 `ArrayBuffer`。
- 不使用类型断言把 `SharedArrayBuffer` 压成 `ArrayBuffer`。
- 子数组只发送 active view 范围，不能把底层完整 buffer 一并写出。

当前约束由 [test/obsidian-api.test.ts](../../../test/obsidian-api.test.ts) 的 `writes only the active Uint8Array view bytes` 覆盖。

## 配置使用

导出适配器只能读取已经合并 defaults 的 `Config`。配置读取和持久化由 [src/config/storage.ts](../../../src/config/storage.ts) 负责：

- `getConfig()` 合并 `DEFAULTS` 和 GM 存储值。
- `saveConfig()` 只保存与默认值不同的字段。
- `getConfig()` 只能恢复仍存在于 `DEFAULTS` 的键。删除配置字段时，旧 GM 存储里的废弃键不能重新进入运行时 `Config`。
- 适配器内部不要直接调用 `GM_getValue` / `GM_setValue`。
