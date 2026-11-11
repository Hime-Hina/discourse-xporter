# Discourse API 规范

## 数据来源与完整性

API 操作归 `src/core/api.ts` 所有，显式 `RequestContext.origin` 固定任务的来源站点；调用期间导航不会改变请求目标。`signal` 沿读取、响应体消费和批次间等待传递。

- 元数据与首批正文：`GET /t/{topicId}.json?include_raw=true`。不使用伪 slug，避免重定向丢弃查询参数。
- 已知稳定帖子 ID：`GET /t/{topicId}/posts.json?post_ids[]=...&include_raw=true`。
- 完整可见 ID：普通话题用 `post_stream.stream`；mega topic 用 `/t/{topicId}/post_ids.json?post_number=1`，与初始首楼 ID 合并。
- 指定用户候选：同一 `post_ids` 操作增加 `username_filters`；服务端额外保留首楼，仍须在本地应用精确筛选。旧部署若返回 400/404/422，则回退完整 ID 获取。

mega 协议依据固定 Discourse 提交 `cfa7b412b21ecb599500f1160eaf3bc0556e2358` 的 `TopicsController#post_ids`：`skip_limit: true, asc: true` 以及 `TopicView#filter_posts_by_post_number`。它返回首楼之后的全部可见 ID，不以 `posts_count` 或楼层数组下标推测完整性。首楼缺失或 ID 结果不包含 `lastId` 时拒绝交付。

入口校验正整数 ID、响应归属和必要正文结构。批次大小为 1–100；以稳定 post ID 去重，每一批必须覆盖该批请求 ID。无法获取、响应无进展或权限改变时明确失败，不能用空数组宣告完整。结果按 `post_number` 排序。

## 采集与筛选

`buildTopicExport()` 首次等待前复制配置、筛选数组和楼层选择。已知稳定 ID 的手动选择仅获取对应正文；楼主/用户筛选先缩小可见 ID 候选，再本地筛选。楼层区间、关键词、长度和图片判定保留本地规则，不能把 stream 的位置当作楼层号。

仅为最终实际导出的帖子解析 `upload://` 短链。没有选中楼层、选中目标不可用或筛选无匹配时拒绝生成空笔记。

## 上传短链和分类

- `/uploads/lookup-urls` 携带 CSRF 与 XHR 标头；失败可告警并保留短链。取消必须继续向外抛出，不能被增强降级吞掉。
- 分类名以目标 `category_id` 为权威，从该来源的 `/site.json` 分类表解析，成功结果按 origin 缓存。绝不借用当前页面分类面包屑；不可用时明确返回 `category-{id}`。

## 有界读取

每次读取的 60 秒超时覆盖 headers 和 body；GET 对网络异常、超时、429、5xx 最多尝试两次，401/403 等确定错误不重试。`Retry-After` 支持秒与 HTTP 日期，等待上限 60 秒；缺省退避从 500 毫秒起。POST 上传短链解析不自动重试。`HttpError.status` 提供结构化状态，不通过错误文字识别限流。

取消会终止在途读取与退避，不再调度下一批。外层操作必须等待并发分支收束后才释放任务状态。二进制下载复用相同有限读取机制。

## 验证边界

API 与用例 fixture 覆盖普通/mega 响应、非连续楼层、稳定 ID、重复与缺失结果、目标分类、筛选等价性、超时、Retry-After 和取消。性能证据必须来自固定响应的请求数与字节度量；本地合成测试不能替代真实站点或巨型话题实测。
