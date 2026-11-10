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
- 文件名要解码、清理危险字符、按大小写无关规则去重。
- vault 路径必须经过 `normalizeVaultPath()` / `joinVaultPath()`，移除 `..`、盘符和非法路径片段。
- file 模式是完整本地图片契约：任意必需图片下载或上传失败时，ZIP/Obsidian 导出必须失败，不生成包含缺失本地图片引用的笔记或压缩包。
- 图片上传和下载必须使用 `imageConcurrency`、`imageDelayMin`、`imageDelayMax`，不能在 Obsidian 路径绕过节流配置。

不要在 formatter 或 raw pipeline 中生成导出模式相关的图片路径。

## Obsidian API 安全边界

`obsidian-api.ts` 必须在拼接请求前调用 `assertLocalApiUrl()`：

- 只允许 `http:` / `https:`。
- host 只允许 `localhost`、`127.0.0.1`、`::1`。
- 非本地地址不能发送 bearer token。

这个规则已有测试：[test/obsidian-api.test.ts](../../../test/obsidian-api.test.ts) 验证非本地 API URL 不会触发 `GM_xmlhttpRequest`。

## 写入语义

- `writeNote()` 使用 PUT 全量覆盖 Markdown。
- `writeBinary()` 使用 PUT 写图片或附件二进制。
- `openNote()` 只做打开动作，失败应抛错。
- 用户主动触发的搜索/扫描必须暴露 HTTP 或响应格式错误；只有被动提示类检查可以把失败折叠为“无结果”。
- `topic-delivery.ts` 的 Obsidian file 模式必须先完成图片上传和 Markdown 改写，再调用 `writeNote()`；任意图片失败应阻止最终笔记写入。
- `obsidian-batch.ts` 批量重导应覆盖原 note path；429 可重试一次，非 429 或重试失败计入 failed。

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
