# 浏览器开发测试循环

本项目是 `vite-plugin-monkey` userscript。浏览器验证目标不是打开一个本地 SPA，而是在真实 Discourse 页面中确认调试脚本由脚本管理器加载并完成 DOM 注入。

## 基础质量门禁

进入浏览器验证前先运行：

```bash
pnpm exec tsc --noEmit
pnpm test:run
pnpm run build
```

`vite build` 不能替代 `tsc --noEmit`。浏览器只验证运行时集成，不能代替类型和单元测试。

## Dev Server

启动前先确认浏览器环境：

- Chrome 使用安装了 Tampermonkey 的同一用户配置。
- 目标 Discourse 站点已允许 Local Network Access / loopback network。
- Tampermonkey 中只启用 `server:Discourse Xporter`，禁用正式 `Discourse Xporter`。

启动前先检查 `5173` 端口是否已有 dev server：

```powershell
Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

如果端口已监听，先访问本地入口做健康检查：

```powershell
Invoke-WebRequest -Uri http://127.0.0.1:5173/__vite-plugin-monkey.entry.js -UseBasicParsing
```

入口可访问且内容指向当前项目时，复用现有 dev server，不要再启动新进程，也不要重新安装 `server:` 脚本。入口不可访问、响应不符合当前项目、或端口被非本项目进程占用时，先向用户说明占用进程，再经用户确认后只停止该进程。

启动开发服务器：

```bash
pnpm run dev
```

默认地址是：

```text
http://127.0.0.1:5173/
```

`vite-plugin-monkey` 的安装脚本应指向本地入口：

```text
http://127.0.0.1:5173/__vite-plugin-monkey.entry.js
```

启动或重启 dev server 后，如果浏览器弹出脚本安装或更新页面，必须等待用户在 Tampermonkey 页面完成确认。不要跳过这一步继续刷新 Discourse 页面；未确认时 `server:` 脚本仍可能使用旧元数据或旧入口。

不要接受 Vite 自动退避到 `5174`、`5175` 等端口。本项目的浏览器开发循环固定使用 `127.0.0.1:5173`；端口被占用时应先处理占用，而不是安装指向新端口的第二份 `server:` 脚本。

只在以下情况安装或更新 `server:` 脚本：

- 首次使用当前 Chrome/Tampermonkey 配置。
- `vite-plugin-monkey` 元数据发生变化，例如 `grant`、`match`、`noframes`、脚本名或入口地址变化。
- Tampermonkey 明确弹出更新页面。

普通源码改动只需要保存文件并刷新 Discourse 页面；不重新安装脚本。

开发入口由 `vite-plugin-monkey` 注入为宿主页面 `document.head` 里的 `<script type="module">`，会受宿主站 CSP 约束。若控制台只有 `[vite-plugin-monkey] mount entry module to document.head`，但没有 `[Discourse Xporter] Discourse detected, initializing…`，优先检查 CSP，而不是改业务初始化逻辑。

Chrome + Tampermonkey 开发验证需要满足：

- 新版 Chrome 还可能要求对当前站点授予 Local Network Access / loopback network 权限。控制台出现 `Permission was denied for this request to access the loopback address space` 时，先在地址栏站点权限中允许当前站点访问本地网络。
- Vite dev server 对 `__vite-plugin-monkey.*.js` 和源码模块都返回 `Cross-Origin-Resource-Policy: cross-origin`、`Access-Control-Allow-Origin: *`、`Access-Control-Allow-Private-Network: true`，并正确处理 `OPTIONS` 预检。
- 禁用 Vite HMR，并在 dev middleware 中接管 `__vite-plugin-monkey.entry.js`。开发入口只应导入 `__vite-plugin-monkey.gm.api.js` 和 `src/main.ts`；不要让宿主页面加载 `/@vite/client` 或连接 loopback WebSocket。
- 因当前代码仍使用全局 `GM_*` API，`vite-plugin-monkey` dev server 必须启用 `server.mountGmApi: true`。

这是开发环境要求，不应写入生产脚本逻辑。生产脚本是完整打包后的 userscript，不依赖本地 Vite module script。

`mountGmApi` 会将 GM 能力挂到宿主可访问环境，开发模式不具有生产隔离保证。只使用合成数据：开发配置使用独立的 `dxp_dev_config`，不读取或写入生产 `dxp_config`，API Key 在读取和保存时都强制为空。不要把真实密钥放入开发存储或控制台。正式凭据流程和 `@sandbox DOM` 的安全验收必须安装生产构建后单独完成。

开发兼容入口仍只导入 GM bridge 与 main，GET/HEAD/OPTIONS 契约由 `test/build-config.test.ts` 验证，生产构建同时检查不含开发入口、HMR 或开发配置键。升级 vite-plugin-monkey 时，先核对 transformIndexHtml、GM bridge 与 CSP 约束；只有原约束消失并且这些回归通过后，才移除入口接管。

如果浏览器打开了安装确认页，脚本管理器的确认页面可能属于 `chrome-extension://`。自动化工具不一定允许操作该页面；这种情况下由用户手动确认安装或更新脚本。确认完成后再刷新 Discourse 话题页继续验证。

`server:Discourse Xporter` 和正式 `Discourse Xporter` 是脚本管理器里的两条脚本。二者同时启用会在同一页面重复注入 `.dxp-*` UI；浏览器开发时只启用 `server:` 脚本。

## Discourse 话题页冒烟检查

在真实 Discourse 话题页验证以下状态：

- 页面满足 `isDiscourse()` 检测。
- URL 匹配 `/t/{slug}/{topic_id}` 或 `/nested/{slug}/{topic_id}`。
- 控制台出现 `[Discourse Xporter] Discourse detected, initializing…`。
- DOM 中存在 `.dxp-global-toggle`、`.dxp-panel`、`.dxp-floor-btn`。
- 点击 `.dxp-global-toggle` 后面板可见。
- 点击 `.dxp-section-header` 后设置区展开。
- 点击 `.dxp-select-btn` 后楼层选中状态同步到 `.dxp-active` 和 `.dxp-selected`。

页面滚动或懒加载后，`.dxp-floor-btn` 数量增加是正常现象；按钮注入由 `MutationObserver` 和巡检兜底共同维护。

## 导出验证边界

不要把超大公开话题作为完整导出冒烟测试目标。`buildTopicExport()` 可使用手选楼层已有的稳定 post ID 定向获取，或通过用户名条件缩小候选 ID 集合，再做本地精确筛选；区间、关键词、图片等无法证明等价的条件仍可能需要完整获取。不得把 post number 当成 stream 数组下标，或假定选少量楼层就总是少量请求。

完整导出测试应选择楼层较少、网络状态稳定的话题，或使用已有单元测试覆盖纯转换和边界契约。浏览器冒烟测试默认只验证脚本加载、DOM 注入和轻量交互。

## 控制台错误判断

只把来自 Discourse Xporter 的日志和错误作为本项目问题入口。宿主站主题、Cloudflare、其他浏览器扩展产生的警告或错误需要与 `.dxp-*` 行为、`[Discourse Xporter]`、`[DXP]` 日志建立关联后再归因。
