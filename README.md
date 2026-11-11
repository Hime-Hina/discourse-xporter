# Discourse Xporter

将 Discourse 话题和选中楼层导出为 Obsidian Markdown 的 TypeScript userscript，使用 Vite 与 vite-plugin-monkey 构建，界面为原生 DOM。

## 安装与升级

生产脚本以 **Tampermonkey 的隔离世界（`@sandbox DOM`）** 为支持目标。安装 Tampermonkey 后，从本仓库 [Releases](https://github.com/Hime-Hina/discourse-xporter/releases) 下载 `discourse-xporter.user.js` 并在管理器中确认安装。尚无发布版本时，可按下述步骤构建并安装本地 `dist/discourse-xporter.user.js`。不要把脚本正文直接粘贴到论坛控制台。

发布产物带有本仓库的 namespace、author 和升级 URL；后续安装同一 namespace/name 的脚本即为升级。旧占位 namespace 版本不会自动成为同一安装项，升级时先在管理器里禁用旧脚本，避免双重注入，并在新安装项中重新配置连接。不要同时启用生产脚本与 `server:Discourse Xporter`。

## 使用

进入 Discourse 话题页后，点击标题附近的导出按钮或 Tampermonkey 的「Discourse Xporter」菜单打开面板。可选全部楼层、楼层区间或手动选择，并按作者、关键词、图片与长度筛选。

- **Markdown**：下载正文文件；远程图片是否可访问取决于原站。
- **ZIP**：将正文和所需图片打包；附件失败时不能视为完整导出。
- **Obsidian**：通过本机 Local REST API 写入笔记与附件。

Obsidian 图片支持文件、远程嵌入和移除三种策略。目录与筛选等非敏感设置在面板调整；连接密钥仅通过脚本管理器的专用菜单配置，面板只显示配置状态。具体来源身份、路径与重导策略见[导出规范](docs/spec/frontend/export-adapters.md)。

## Obsidian 连接

在 Obsidian 中安装并启用 Local REST API 插件，在其设置中取得本机 API 地址与 API Key。默认地址为 `https://127.0.0.1:27124`；根据本机插件设置调整端口与 HTTP(S) 协议。若使用自签名证书，需先按该插件说明在浏览器中信任证书。

只支持 `localhost`、`127.0.0.1` 与 IPv6 loopback `[::1]`；不会把 bearer key 发往远端论坛。密钥设置、更换与清除入口位于 Tampermonkey 菜单，不要在论坛页面表单或控制台输入真实密钥。生产配置保存在对应 userscript 的 GM 存储中。

## 权限

| 声明 | 用途 |
| --- | --- |
| `@match *://*/*` | 在不同域名的论坛检测 Discourse；页面标记只用于适配，不代表可信授权 |
| `GM_getValue` / `GM_setValue` | 保存本安装项的配置 |
| `GM_setClipboard` | 复制单楼 Markdown |
| `GM_xmlhttpRequest` | 访问本机 Obsidian API |
| `GM_addStyle` | 注入带 `dxp-` 前缀的样式 |
| `GM_registerMenuCommand` | 打开设置与管理连接密钥 |
| `@connect 127.0.0.1 / localhost / [::1]` | 限制 GM 网络目标为本机；请求边界还会校验 URL |
| `@sandbox DOM` / `@noframes` | 在隔离世界运行，避免在子框架重复注入 |

论坛 API 和图片下载使用浏览器 `fetch`，受登录状态、可见性与 CORS 影响；不为绕过这些限制扩大 GM 网络权限。Turndown、GFM 插件与 fflate 仍使用 lockfile 解析出的固定版本 CDN `@require`，安装和执行需要能访问对应 unpkg URL。

## 开发与质量检查

使用 Node **24.x** 和 package.json 声明的 **pnpm 10.20.0**。已安装 Corepack 的环境可直接运行以下命令；若环境没有 Corepack，安装相同版本的 pnpm 后把 `corepack pnpm` 换成 `pnpm`。

```bash
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm exec tsc --noEmit
corepack pnpm run lint
corepack pnpm test:run
corepack pnpm run build
```

类型与 lint 检查同时覆盖 `src`、`test`、`vite.config.ts` 和 `vitest.config.ts`。测试只在 fetch、GM 和浏览器交付边界使用合成数据，不应包含真实 token、论坛私有内容或 vault 文件。

`getConfig` 与 `saveConfig` 会验证存储边界：批次为 1–100 的整数，图片并发为 1–16 的整数，延迟为 0–60000 ms 的有限数值，最大延迟不小于最小延迟。未知键和非法值回退默认值；合法旧值保留。URL 的 localhost 限制在请求边界再次检查。

本地调试入口为 `corepack pnpm run dev`，固定 `127.0.0.1:5173`。详细步骤见[浏览器开发循环](docs/spec/frontend/browser-dev-loop.md)，项目边界见[规范索引](docs/spec/frontend/index.md)。开发桥接会把 GM 能力挂到宿主可访问环境，**只能使用隔离的合成配置**：开发模式使用独立 `dxp_dev_config`，不会读写生产配置，且返回、保存的 API Key 均强制为空。不得把生产 key 放入开发存储、源码或开发控制台；生产隔离验证必须安装正式构建。

## CI 与发布

`.github/workflows/check.yml` 在 PR 和 main push 上执行 frozen-lockfile 安装、类型、lint、测试与构建，并保留 userscript artifact。推送与 package.json version 一致的 `v<version>` 标签后，同一工作流通过全部检查才创建 GitHub Release 并上传 `discourse-xporter.user.js`。例如 version 为 `1.0.0` 时标签必须为 `v1.0.0`。版本的唯一来源是 package.json；修改版本后需重新构建，不能手改产物头部。

## 验证范围与限制

本轮实现、受控度量和仍待现场验收的事项见[重构验证记录](docs/refactor-validation.md)。

自动测试可验证转换、路径、配置边界和 Vite 开发/生产产物契约，不能证明某个浏览器、论坛版本或脚本管理器已经完成真实集成验收。当前工程检查使用 Node 24 与 pnpm 10.20.0；真实 Tampermonkey 安装、原生密钥对话框与宿主隔离、localhost 证书、Obsidian 读写和完整导出仍需在受控配置中验收并记录版本与结果。

不要把超大型公开话题作为全量冒烟目标。仅对受控小话题做有界请求；权限缺失、未能证明完整获取、附件失败或输出策略无法恢复时，应保留明确失败或待处理状态。
