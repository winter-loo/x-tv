# 我的喜欢列表 — 在时间线与我的喜欢之间按左键循环切换

**验收构建**：`app-debug.apk`，本地 `assembleDebug` 产出并 `adb install -r` 安装到当贝 DBD5X Pro（`192.168.10.100:5555`，阅读器 WebView `com.android.webview 66`）。
**复现脚本**：`node scripts/check-likes.mjs`（只读：只发起本功能自身的 `Likes` 查询，不做任何写入，并在结束前检查全程无写流量）
**原始证据**：`docs/validation/likes-samples.json`

## 一、做了什么

X 从 2024 年起把喜欢列表设为仅本人可见，所以这个功能就是**登录账号自己的「我的喜欢」**。

阅读器表头现在是两个并列的列表，正文区域按左键即可循环切换（时间线 ⇄ 我的喜欢，且保留各自浏览位置）：

```
← 我的喜欢   X · 时间线          （在时间线上）
← X · 时间线  我的喜欢           （在我的喜欢上）
```

左边那个永远是「按左键会到达的那个」，所以箭头方向和实际按键一致。列表内的其它按键完全沿用时间线：上下切帖、顶部上键刷新、确认进详情、右键看媒体、菜单更多操作、到底再按下键翻页。返回键在「我的喜欢」首帖上回到时间线，而不是退出阅读器。

**右键仍然是媒体**。工单选项写的是「顶部左右键切换」，实现时只用了左键：右键在首帖上原本就是进入媒体面板，抢走它会让首帖（最常读的一条）失去媒体入口。两个列表用一个左键切换即可循环往复，`tests/likes.spec.mjs` 里「the media pane keeps left, while posts anywhere in the list switch lists cyclically」专门钉住了这一点。

## 二、数据是怎么取到的

时间线和详情用的是**抓到的请求模板**（X 自己发过一次，我们保留 cookie + queryId + features 复用）。`Likes` 没有模板可用：用户可能从没在电视上打开过自己的喜欢页，等 X 自己发一次是不可靠的。

所以 `Likes` 走的是**从页面 webpack 模块里挖出操作定义**这条路——就是原来点赞/回复在用的那条：

- 扩展的 `sites/x/api-metadata.js`（原 `write-api.js`）挖出 `queryId`、`featureSwitches`、`fieldToggles`，并为该操作签出一个 `x-client-transaction-id`。它现在带一张操作表，写操作签 `POST` 并附带回读用的 `TweetResultByRestId`，`Likes` 签 `GET` 且不带伴随查询。
- 登录账号的数字 ID 从 `twid` cookie 解出（`XGraphQL.accountId`），不需要额外请求。
- 原来散在 `XWriteClient` 里的「用挖来的元数据发一次 GraphQL」被提到 `XGraphQL`：请求头白名单、元数据校验、URL/请求体拼装、响应判定。读写两条路现在共用同一份，`XReadClient.fetchLikes` 只负责组 `variables` 和把结果交回阅读器。

页面给的元数据始终只是**输入**，不是权威：URL、方法、请求体、凭据都在原生侧拼装，`XGraphQL.validate` 会拒掉任何形状不对的 `queryId`／`transaction`／布尔开关（`XGraphQLTest.pageMetadataIsInputNotAuthority`）。

## 三、真机结果

### 打开：一次读取，20 条，全部真的是「已喜欢」

`likes-opened` 记录：

```
scene:   {tabNow: "我的喜欢", tabAlt: "← X · 时间线", position: "1 / 20", liked: true}
request: ["TvXApiPerf Likes status=200 ms=962",
          "TvXReaderPerf likes request ms=11049 result=ok"]
probe:   [{ok: true, error: "", posts: 20, liked: 20, id: "r1"}]
```

`probe` 是脚本挂在 `TvXReader.receive` 上、直接数原始 payload 得到的：X 返回 20 条，其中 `legacy.favorited === true` 的也是 20 条。列表里显示的确实是喜欢过的帖子，不是把别的时间线当成了喜欢。

### 首次打开慢，是在等浏览器就绪，不是在等 X

同一条记录里两个数字差得很远：HTTP 本身 **962 ms**，而用户看到的等待是 **11 049 ms**。中间 ~10 s 花在等 GeckoView 里的 x.com 页面加载出来、能被挖元数据为止（冷启动时预热还没跑完）。

`likes-refreshed` 是同一次会话里热态再读一次：

```
reads: ["TvXApiPerf Likes status=200 ms=811",
        "TvXReaderPerf likes request ms=1816 result=ok"]
```

热态总耗时 **1 816 ms**，其中 HTTP **811 ms**，元数据准备约 1 s。

**这是本次实现的已知代价，没有在这一版里解决**：冷启动后第一次进「我的喜欢」会等约 10 秒，期间表头显示「正在加载我的喜欢…」。要压下去得让 x.com 预热更早发生，或者把 `Likes` 的 `queryId`／`features` 缓存下来（只有 `transaction` 必须每次现签）。两条都超出「把列表做出来」这一步，留给后续决定。

### 翻动、进详情、回来都保住位置

```
likes-paged:     position "2 / 20"，作者与首帖不同
likes-detail:    detail=true，作者与首帖一致（samzong）
likes-restored:  回到 "1 / 20"，作者仍是 samzong
timeline-restored: 回到 "1 / 35"，作者仍是 Meng To，reads: []
```

`timeline-restored` 的 `reads: []` 是关键：从「我的喜欢」按左键回时间线，没有再发任何网络请求，时间线保持在原来那一条上。

### 全程无写入

`no-writes` 记录 `writes: []`：整轮验收没有出现任何 `TvXWritePerf` 行，没有点赞、取消喜欢或评论被发出。

## 四、自动化覆盖

- `tests/likes.spec.mjs`（11 项）：入口、表头两个标签、二次进入不重复请求、媒体面板不被抢走、游标翻页、空列表当作答案而非错误、返回回时间线、顶部上键刷新、在喜欢列表里点赞同步回时间线、进详情再返回恢复列表，以及在时间线刷新途中切走后仍能再刷新（`claim()` 会丢弃走开了的那次刷新）。
- `tests/write-metadata.spec.mjs` 新增一项：读操作按 `GET` 签名且不拉伴随查询。
- `app/src/test/java/.../XGraphQLTest.java`（8 项）：响应判定、`twid` 解析、请求头白名单、不完整会话直接失败、页面元数据的形状校验。
- 全量：Playwright 223 项、JVM 36 项通过。

## 五、没有做的事

- 不是别人的喜欢列表。X 只让本人看自己的，接口也只接受登录账号的 `userId`。
- 没有本地缓存。时间线有加密的本地副本用于冷启动秒开；「我的喜欢」每次进入都现取，冷启动的 10 秒代价见上。
- 没有在「我的喜欢」里做「有 N 条新帖」的待合入提示。它没有后台更新通道，顶部上键就是直接重取。
