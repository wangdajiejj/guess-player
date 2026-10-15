# 猜球员 GuessPlayer · 数据库设计 & 种子数据 v1.0

> 上一步：docs/01-PRD.md ｜ 本文件对应第 2 步
> 数据快照日期：**2026-10-11**（五大联赛转会/号码以此为基准，上线前需重新校准）
>
> 注：`database/players.sample.jsonl` 是 10 行的小样例，`data_as_of` 还停在 2026-10-10；
> 正式数据以 `players.full.jsonl`（**500 条**，2026-10-11）为准。
> 名册按批次写在 `database/roster_{a,b,c,d,e,f,g}.py`（每批 50~100 人），
> 由 `scripts/build-players.py` 聚合成 `players.full.jsonl` —— **不要直接改 jsonl**。

---

## 0. 本轮决策更新（承接你的三条回复）

| # | 你的决策 | 我的落地方案 | 影响 |
| --- | --- | --- | --- |
| 1 | 用 AI 生成球员照片，大头照/全身照，一眼能认出 | 每人生成 **3 张衍生图**：`headshot`（3:4 大头）、`fullbody`（3:4 全身）、`avatar`（1:1 裁切，搜索列表用）。已产出 4 张试点图（梅西/姆巴佩/C 罗/哈兰德），见 `assets/generated/` | 详 §5 图片资产规范 |
| 2 | 可放退役传奇 | 保留 `active` 布尔字段，`false` = 退役传奇。**退役球员的 club/league 仍填其代表球队/所在联赛**（不填"已退役"），否则所有传奇的联赛字段会全绿，等于送答案 | 见 §3.2 ⚠️ |
| 3 | 译名按国内主流习惯 | 建立强制译名表 + 拼音/首字母字段，支持「姆总监」「mbp」这类搜索 | 见 §1 |

### ⚠️ 关于 AI 生成真人照片，我必须先提醒两件事（不影响执行，但你要知情）

1. **肖像权不因 AI 生成而消失。** 《民法典》1019 条保护的是"可识别的外部形象"，AI 生成的写实头像只要能认出来，法律定性上仍有风险。
2. **《人工智能生成合成内容标识办法》2025-09-01 已施行**，要求 AI 生成内容必须有**显式标识**（肉眼可见的"AI 生成"角标/水印）和**隐式标识**（文件元数据）。

我的处理（默认已按这个配置，你不用改）：

- 图片风格走**半写实插画风**（不是照片级写实），既"一眼能认"，又明显不是本人照片 —— 这是风险最低的可行方案；
- 生成时**禁止**画俱乐部徽章、赞助商 Logo、球员手臂纹身里的商业标识（这些都是注册商标，比肖像权更容易被投诉）；
- 结果页 + 帮助页固定展示声明：「球员形象由 AI 生成，仅作游戏示意，不代表本人形象或立场」；
- UI 上给每张图加半透明「AI」角标。

如果你坚持要照片级写实，把 `STYLE_LEVEL` 参数调到 `photorealistic` 即可，但我不建议。

---

## 1. 译名规范（强制，导入前必须过一遍）

### 1.1 联赛标准中文名

| English | 标准中文名 | 备注 |
| --- | --- | --- |
| Premier League | **英超** | 不用"英格兰超级联赛" |
| LaLiga | **西甲** | |
| Bundesliga | **德甲** | |
| Serie A | **意甲** | |
| Ligue 1 | **法甲** | |
| Eredivisie | **荷甲** | |
| Primeira Liga | **葡超** | |
| Süper Lig | **土超** | |
| MLS | **美职联** | 不用"美国职业大联盟" |
| Saudi Pro League | **沙特联** | |
| Brasileirão | **巴甲** | |
| Liga Profesional | **阿甲** | |
| K League 1 | **韩K联** | |
| J1 League | **日职联** | |
| Süper Lig / 希腊超 / 苏超 | 依次类推 | 新增联赛必须同步维护本表 |

### 1.2 俱乐部标准中文名（Top 30，覆盖大部分样本）

| English | 标准中文名 | 禁用写法 |
| --- | --- | --- |
| Manchester City | 曼城 | 曼彻斯特城 ❌ |
| Manchester United | 曼联 | 曼彻斯特联 ❌ |
| Arsenal | 阿森纳 | 兵工厂（仅作别名） |
| Liverpool | 利物浦 | |
| Chelsea | 切尔西 | |
| Tottenham Hotspur | 热刺 | 托特纳姆 ❌（仅作别名） |
| Newcastle United | 纽卡斯尔联 | 纽卡斯尔 ❌ |
| Nottingham Forest | 诺丁汉森林 | |
| Real Madrid | **皇家马德里** | 皇马（别名） |
| Barcelona | **巴塞罗那** | 巴萨（别名） |
| Atlético Madrid | **马德里竞技** | 马竞（别名） |
| Real Betis | 皇家贝蒂斯 | 贝蒂斯（别名） |
| Villarreal | 比利亚雷亚尔 | 黄色潜水艇（别名） |
| Athletic Club | 毕尔巴鄂竞技 | 毕尔巴鄂 ❌ |
| Bayern München | **拜仁慕尼黑** | 拜仁（别名） |
| Borussia Dortmund | 多特蒙德 | 多特（别名） |
| Bayer Leverkusen | 勒沃库森 | 药厂（别名） |
| RB Leipzig | **RB莱比锡** | 莱比锡红牛 ❌ |
| Eintracht Frankfurt | 法兰克福 | |
| Inter Milan | **国际米兰** | Inter ❌ / 英特 ❌；国米（别名） |
| AC Milan | **AC米兰** | 米兰（因与城市/国米混淆，禁用） |
| Juventus | 尤文图斯 | 斑马军团（别名） |
| Napoli | 那不勒斯 | 拿坡里 ❌ |
| Atalanta | 亚特兰大 | |
| Paris Saint-Germain | **巴黎圣日耳曼** | 巴黎（别名）；大巴黎（别名） |
| Olympique de Marseille | 马赛 | |
| AS Monaco | 摩纳哥 | |
| Inter Miami CF | **迈阿密国际** | 国际迈阿密 ❌ |
| Los Angeles FC | 洛杉矶FC | |
| Al Nassr | **利雅得胜利** | 纳斯尔 ❌ |
| Al Hilal | **利雅得新月** | 希拉尔 ❌ |
| Al Ittihad | **吉达联合** | |
| Al Ahli | **吉达国民** | |

> **规则**：`club` 只填标准中文名；俗称（皇马、巴萨、国米、红魔、枪手、利物浦=köp...) 一律进 `aliases` 数组参与搜索。

### 1.3 球员译名规则

- 用**央视/咪咕/懂球帝**通用译法，不用台港澳译法（如 Halland 不用"哈兰特"，Bellingham 不用"贝灵汉"）。
- 姓氏全译，中间用 **·** 连接：`Lionel Messi → 利昂内尔·梅西`，`Cristiano Ronaldo → 克里斯蒂亚诺·罗纳尔多`。
- 已约定俗成的短称仍写全名，短称放别名：`Kylian Mbappé → 基利安·姆巴佩`（"姆巴佩"进别名）。
- 外文特殊字母保留：`Müller 穆勒`、`Lloris 洛里斯`，但 ` search_index` 里一律转小写 ASCII 折叠（`muller`, `lloris`）。

### 1.4 国籍标准中文名

阿根廷 / 巴西 / 法国 / 英格兰 / 苏格兰 / 西班牙 / 葡萄牙 / 荷兰 / 比利时 / 挪威 / 克罗地亚 / 塞尔维亚 / 波兰 / 德国 / 意大利 / 乌拉圭 / 哥伦比亚 / 厄瓜多尔 / 摩洛哥 / 塞内加尔 / 埃及 / 阿尔及利亚 / 尼日利亚 / 加纳 / 喀麦隆 / 科特迪瓦 / 韩国 / 日本 / 墨西哥 / 美国

> **注意**：写「英格兰 / 苏格兰 / 威尔士」而不是「英国」；写「荷兰」而不是「尼德兰」。

---

## 2. 集合总览

| 集合 | 用途 | 预估量 | 权限 |
| --- | --- | --- | --- |
| `players` | 球员题库（猜池 + 答案池） | **500 条** | 所有人只读 |
| `games` | 对局记录（**含答案 id**） | 随用户增长 | 仅创建者可读写 |
| `meta` | 题库版本、每日种子盐值、黑白名单 | < 20 条 | 所有人只读 |
| `user_stats` | 累计战绩（P1 排行榜用） | 1 人 1 条 | 仅创建者可读写 |

---

## 3. 集合结构

### 3.1 `players`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `_id` | string | ✅ | 固定格式 `p001` ~ `p200`，便于图片资产一一对应 |
| `id` | number | ✅ | 数字主键 1~200，客户端/前端排序用 |
| `name_cn` | string | ✅ | 标准中文全名 |
| `name_en` | string | ✅ | 英文全名 |
| `aliases` | string[] | ✅ | 别名/绰号/俗称，含中文昵称、姓氏、英文短名 |
| `nationality` | string | ✅ | 标准中文国籍，判定用 |
| `nationality_code` | string | ✅ | ISO 3166-1 alpha-2（`AR`/`FR`/`BR`...）；英格兰/苏格兰/威尔士用 ISO 3166-2 的 `GB-ENG`/`GB-SCO`/`GB-WAL`，用于挂国旗素材 |
| `club` | string | ✅ | 标准中文队名，判定用 |
| `club_en` | string | ✅ | 英文队名，搜索用 |
| `league` | string | ✅ | 标准中文联赛名，判定用 |
| `position` | string | ✅ | 细分位置，判定用（**全绿**条件） |
| `position_group` | string | ✅ | `GK`/`DF`/`MF`/`FW`，判定用（**黄色**条件） |
| `birth_date` | string | ✅ | `YYYY-MM-DD`，**不存年龄**，实时算周岁 |
| `height_cm` | number | ✅ | 整数厘米；无数据填 `0` 并按缺失处理 |
| `preferred_foot` | string | ✅ | `左脚` / `右脚` / `双脚` |
| `shirt_number` | number | ✅ | 当前号码；退役球员填代表号码 |
| `active` | boolean | ✅ | `true` 现役；`false` 退役传奇 |
| `fame_level` | number | ✅ | 1~5，**≥ 3 进自由练习答案池**；每日一题要求 **≥ 4**（`MIN_FAME_DAILY`） |
| `pinyin` | string | ✅ | 全拼小写无空格不含标点，如 `jilianmubapei` |
| `initials` | string | ✅ | 拼音首字母，如 `jmbp` |
| `search_index` | string | ✅ | 预计算检索串（见 §3.5），**大幅降低搜索 CPU** |
| `intro` | string | ✅ | 一句话生涯简介，结果页展示 |
| `fun_fact` | string | ✅ | 生涯趣事，结果页展示 |
| `meme` | string | ⚠️ | 网络热梗，结果页展示。**键必须存在，值可为空串** —— 没有梗的球员别硬编，前端 `wx:if` 判空不渲染该卡片 |
| `primary_color` | string | ✅ | 队色主色 HEX，抽象头像/卡片底色 |
| `secondary_color` | string | ✅ | 队色副色 HEX |
| `data_as_of` | string | ✅ | 本条数据校准日期 |

**索引建议（微信云开发控制台创建）：**

| 索引名 | 字段 | 类型 | 说明 |
| --- | --- | --- | --- |
| `idx_id` | `id` | 升序 - **唯一** | 主键查询、防重复导入 |
| `idx_pool` | `active` + `fame_level` | 升序 - 非唯一 | 答案池筛选 `active==true && fame_level>=3` |
| `idx_position_group` | `position_group` | 升序 - 非唯一 | 运营统计 |

> `search_index` 不要建 150 字以上的普通索引，容易超限；MVP 是**客户端本地搜索**，数据库侧不需要。

### 3.2 ⚠️ 退役球员的特殊规则

| 场景 | 做法 | 反例（会导致游戏失去可玩性） |
| --- | --- | --- |
| `club` | 填其**最具代表性的俱乐部**（贝肯鲍尔→拜仁慕尼黑） | ❌ 填"已退役"/"无" → 所有传奇互绿 |
| `league` | 填该队所在联赛 | ❌ 填"已退役" → 同上，送分 |
| `shirt_number` | 填其最著名的号码（齐达内→5，马尔蒂尼→3） | ❌ 填 0 → 全部按缺失处理成灰色 |
| `active` | `false` | |
| 已故球员 | 仍按 `birth_date` 计算周岁，与在线的口径保持一致（若未来要展示"享年"另加字段，不要改主逻辑） | |

### 3.3 `games`（含答案，权限收到最紧）

```json
{
  "_id": "自动生成",
  "_openid": "系统写入",
  "gameId": "g_7f3a9c21",
  "mode": "daily",
  "dateKey": "2026-10-10",
  "uniqueKey": "oXxx_openid|daily|2026-10-10",
  "answerId": 3,
  "maxGuesses": 8,
  "guessIds": [57, 88, 3],
  "status": "won",
  "startedAt": 1791676800000,
  "finishedAt": 1791677100000,
  "score": 600
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `gameId` | string | 客户端持有的唯一标识，由服务端生成 |
| `uniqueKey` | string | **唯一索引字段**。daily = `` `${_openid}|daily|${dateKey}` ``；endless = `` `endless|${gameId}` `` |
| `mode` | string | `daily` / `endless` |
| `dateKey` | string | 每日挑战的日期键，`YYYY-MM-DD`，endless 模式为空串 |
| `answerId` | number | **答案在此**。任何下行给客户端的响应都禁止携带此字段 |
| `guessIds` | number[] | 已猜过的球员 id，用于去重和重放 |
| `status` | string | `playing` / `won` / `lost` |
| `score` | number | 终局才写入 |

**索引：**

| 索引名 | 字段 | 类型 | 说明 |
| --- | --- | --- | --- |
| `idx_gameid` | `gameId` | 升序 - **唯一** | 每次猜测都要查 |
| `idx_unique` | `uniqueKey` | 升序 - **唯一** | 幂等开局的兜底防线，见下方说明 |
| `idx_openid_datekey` | `_openid` + `mode` + `dateKey` | 升序 - 非唯一 | 判断"今日是否已挑战" |

> **为什么唯一索引要用 `uniqueKey` 而不是 `_openid + mode + dateKey`？**
> 后者会把 endless 模式也一起约束住，玩家一天只能开一局无限模式——这是严重的功能 bug。
> 用 `uniqueKey` 让 endless 取 `gameId`（本来就唯一），约束只对 daily 生效。
> 有了这条索引，并发点两次"开始"时第二个 `add()` 会抛冲突，
> `gameStart` 的 catch 分支会回查一次复用已有对局（由 `scripts/test-flow.js` 的并发用例覆盖）。

### 3.4 `meta`

```json
{ "_id": "players_meta", "playerVersion": "2026-10-10", "playerCount": 200, "updatedAt": 1791676800000 }
{ "_id": "daily_salt",    "salt": "GP2026v1", "note": "更换会导致历史每日答案错位，禁止随意改" }
{ "_id": "answer_pool",   "minFame": 3, "activeOnly": false, "excludedIds": [] }
```

> **`daily_salt` 一旦上线禁止修改**，否则历史每日答案全部错乱。若要更换管理办法（比如想指定某天的答案），应改为读取 `daily` 集合的人工排期表，而不是改盐值。

### 3.5 `search_index` 生成规则

```js
// 一次性生成，存库后前端只做 indexOf（500 条实测 0.05ms，无需建索引）
const fold = s => s.normalize('NFKD')          // 拆音标
                   .replace(/[\u0300-\u036f]/g, '')  // 去音标：é -> e
                   .toLowerCase()
                   .replace(/[·\s\-'\.]/g, '');      // 折叠分隔符

const parts = [
  p.name_cn, p.name_en, p.club, p.club_en, p.league,
  p.nationality, p.position, p.pinyin, p.initials,
  ...(p.aliases || [])
];
p.search_index = parts.filter(Boolean).map(fold).join('|');
```

说明三点：

1. **含 `league`，是有意为之** —— 输入"西甲""英超"可以直接筛出候选球员，这是玩家很自然的检索方式；
2. **必须做去重音折叠**，否则搜 `Mbappé` 和 `Mbappe` 会得到不同结果（§1.3）；
3. **字段顺序无所谓**，前端只做 `indexOf`，`validate.py` 也是按集合比对的。

例（p004 姆巴佩）：

```
基利安姆巴佩|kylianmbappe|皇家马德里|realmadrid|西甲|法国|中锋|jilianmubapei|jmbp|姆巴佩|姆总监|mbappe|kylian|km
```

> 该字段**永远由脚本生成，不要手写**。跑 `python validate.py players.sample.jsonl --fix` 自动重写。

### 3.6 集合权限（云开发控制台 → 数据库 → 权限设置）

```jsonc
// players：所有人可读，禁止客户端写
{ "read": true, "write": false }

// games：仅创建者可读写
{ "read": "doc._openid == auth.openid", "write": "doc._openid == auth.openid" }

// meta：所有人只读
{ "read": true, "write": false }

// user_stats：仅创建者可读写
{ "read": "doc._openid == auth.openid", "write": "doc._openid == auth.openid" }
```

> 即便 `games` 设了上述权限，**客户端仍可能通过 `db.collection('games').get()` 读到自己的答案**。所以真正的防线是：所有读写都走云函数（`getWXContext` 取 openid + 人工过滤返回字段），前端**绝不直连 `games` 集合**。这一点在第 3 步的代码里会落实。

---

## 4. 位置枚举（判定基准，不可随意增删）

| `position_group` | 细分 `position` |
| --- | --- |
| `GK` | 门将 |
| `DF` | 中后卫、左后卫、右后卫、清道夫 |
| `MF` | 后腰、中前卫、前腰、左边前卫、右边前卫 |
| `FW` | 中锋、影锋、左边锋、右边锋 |

判定逻辑：**细分位置完全相同 → 绿**；细分不同但大类相同 → **黄**；大类不同 → 灰。

---

## 5. 球员头像方案：**程序化绘制，不使用任何位图**

> **决策变更（2026-10-11）**：原本计划 AI 生成 200 张球员像，经核查后**放弃**，
> 改为纯 CSS 程序化绘制。完整推理过程见 `assets/ai-photo-prompt.md` 顶部。

### 5.1 为什么不用球员照片 / AI 人像

| 因素 | 说明 |
| --- | --- |
| **肖像权** | 真人形象踩肖像权，个人主体小程序风险高。主流 AI 工具都刻意拒绝生成可识别的真实球员 —— Soku AI 官网明示：*"won't generate recognizable real athletes — that protects you from name-and-image-rights issues"* |
| **合规成本** | AI 生成内容按《标识办法》(2025-09-01) 需显式角标 + 隐式元数据，审核多一道 |
| **体积与加载** | 200 张 × 50KB ≈ 10MB 存储 + CDN 流量，首屏还要下载 |
| **实际收益低** | 头像在列表里只有 **36~84px**，照片细节根本看不清 |
| **搜不到现成的** | 网上可免费商用的只有**通用**足球插画（Pixabay），没有可识别的特定球星 |

### 5.2 实现：`components/player-badge`

队色渐变 + 球衣斜纹 + 姓氏首字 + 位置徽章，全部用 CSS 画：

```
┌──────────┐
│ 🇦🇷       │  ← 国籍（仅大尺寸）
│          │
│    梅    │  ← 姓氏首字（队色渐变 135° + 45° 斜纹）
│          │
│    FW    │  ← 位置大类（仅大尺寸）
└──────────┘
```

- **背景**：`linear-gradient(135deg, primary_color, secondary_color)`，队色已在库里
- **斜纹**：`repeating-linear-gradient(45deg, ...)`，给纯色块一点球衣织物质感
- **暗角**：底部压一层 `rgba(0,0,0,.38)`，保证白色球衣（皇马）上的白字仍可读
- **首字**：中文名按 `·` 切分取**最后一段**首字 ——
  利昂内尔·梅西 → **梅**（内地就是叫梅西），罗伯托·卡洛斯 → **卡**。
  取首段会得到「利」「罗」，反而是玩家不习惯的叫法

零存储、零加载、任意分辨率清晰、无版权风险、不需要 AI 标识。

### 5.3 使用位置

| 位置 | 尺寸 | 参数 |
| --- | --- | --- |
| 搜索列表 | 64rpx | `circle` |
| 线索行 | 72rpx | `circle` |
| 结果页答案卡 | 168rpx | 方角 + `showMeta`（显示位置徽章与国籍） |

### 5.4 可选：Pixabay 装饰素材存档

头像**不需要**素材，但首页/空状态若想要真实照片背景，以下均为
**Pixabay Content License（免费商用、无需署名）**，需要时自取并压缩后使用：

| 用途 | 链接 | 原始尺寸 |
| --- | --- | --- |
| 球场草地 | https://safesearch.pixabay.com/photos/soccer-field-lawn-football-pitch-8846445 | 4326×2884 |
| 球场俯拍 | https://safesearch.pixabay.com/photos/sports-ground-football-pitch-grass-421921 | 5456×3632 |
| 草皮纹理 | https://safesearch.pixabay.com/photos/grass-field-football-lawn-green-966410 | 3264×2448 |

> ⚠️ 放进小程序前务必压缩：主包上限 **2MB**，建议单图 ≤ 100KB 或改放云存储 CDN。
> 规则图案（草地条纹）用 CSS `repeating-linear-gradient` 画更划算 —— 零体积且不会失真。

---

## 6. 10 条示例 JSON（可直接导入）

下面 10 条由 `scripts/sync-doc-examples.py` 从 **`database/players.full.jsonl` 的前 10 条**自动生成，字段、译名、队色、数据日期与真库完全一致（改动后重跑该脚本即可同步）。
完整 500 条见 `database/players.full.jsonl`。

```jsonc
[
{
  "_id": "p001",
  "id": 1,
  "name_cn": "利昂内尔·梅西",
  "name_en": "Lionel Messi",
  "aliases": [
    "梅西",
    "梅球王",
    "GOAT",
    "Messi",
    "Leo",
    "小跳蚤"
  ],
  "nationality": "阿根廷",
  "nationality_code": "AR",
  "club": "迈阿密国际",
  "club_en": "Inter Miami",
  "league": "美职联",
  "position": "影锋",
  "position_group": "FW",
  "birth_date": "1987-06-24",
  "height_cm": 170,
  "preferred_foot": "左脚",
  "shirt_number": 10,
  "active": true,
  "fame_level": 5,
  "pinyin": "liangneiermeixi",
  "initials": "lanemx",
  "search_index": "利昂内尔梅西|lionelmessi|迈阿密国际|intermiami|美职联|阿根廷|影锋|liangneiermeixi|lanemx|梅西|梅球王|goat|messi|leo|小跳蚤",
  "intro": "八次金球奖得主，被视为足球史上最全面的进攻球员之一。",
  "fun_fact": "童年因生长激素缺乏症险些放弃足球，13 岁被巴萨带到拉玛西亚青训。",
  "meme": "“梅老板”“梅球王”，也常年被拿来和 C 罗做“绝代双骄”对比。",
  "primary_color": "#F7B5CD",
  "secondary_color": "#000000",
  "data_as_of": "2026-10-11"
},
{
  "_id": "p002",
  "id": 2,
  "name_cn": "克里斯蒂亚诺·罗纳尔多",
  "name_en": "Cristiano Ronaldo",
  "aliases": [
    "C罗",
    "罗纳尔多",
    "CR7",
    "Ronaldo",
    "总裁"
  ],
  "nationality": "葡萄牙",
  "nationality_code": "PT",
  "club": "利雅得胜利",
  "club_en": "Al Nassr",
  "league": "沙特联",
  "position": "中锋",
  "position_group": "FW",
  "birth_date": "1985-02-05",
  "height_cm": 187,
  "preferred_foot": "右脚",
  "shirt_number": 7,
  "active": true,
  "fame_level": 5,
  "pinyin": "kelisidiyanuoluonaerduo",
  "initials": "klsdynlned",
  "search_index": "克里斯蒂亚诺罗纳尔多|cristianoronaldo|利雅得胜利|alnassr|沙特联|葡萄牙|中锋|kelisidiyanuoluonaerduo|klsdynlned|c罗|罗纳尔多|cr7|ronaldo|总裁",
  "intro": "五次金球奖得主，欧冠历史射手王，职业寿命与自律的代名词。",
  "fun_fact": "职业生涯正式比赛进球数超过 900 个，是官方认可的历史射手王。",
  "meme": "“SIU”庆祝动作与“总裁”外号一起出圈。",
  "primary_color": "#FFE600",
  "secondary_color": "#0057B8",
  "data_as_of": "2026-10-11"
},
{
  "_id": "p003",
  "id": 3,
  "name_cn": "埃尔林·哈兰德",
  "name_en": "Erling Haaland",
  "aliases": [
    "哈兰德",
    "魔人布欧",
    "Haaland",
    "哈兰德"
  ],
  "nationality": "挪威",
  "nationality_code": "NO",
  "club": "曼城",
  "club_en": "Manchester City",
  "league": "英超",
  "position": "中锋",
  "position_group": "FW",
  "birth_date": "2000-07-21",
  "height_cm": 195,
  "preferred_foot": "左脚",
  "shirt_number": 9,
  "active": true,
  "fame_level": 5,
  "pinyin": "aierlinhalande",
  "initials": "aelhld",
  "search_index": "埃尔林哈兰德|erlinghaaland|曼城|manchestercity|英超|挪威|中锋|aierlinhalande|aelhld|哈兰德|魔人布欧|haaland|哈兰德",
  "intro": "身高体壮却速度惊人，英超处子赛季就打破单季进球纪录。",
  "fun_fact": "父亲阿尔夫-英格·哈兰德也曾是曼城球员，他本人出生在英格兰利兹。",
  "meme": "“魔人布欧”的外号来自他的身材与进球效率。",
  "primary_color": "#6CABDD",
  "secondary_color": "#1C2C5B",
  "data_as_of": "2026-10-11"
},
{
  "_id": "p004",
  "id": 4,
  "name_cn": "基利安·姆巴佩",
  "name_en": "Kylian Mbappe",
  "aliases": [
    "姆巴佩",
    "神龟",
    "Mbappe",
    "姆总监"
  ],
  "nationality": "法国",
  "nationality_code": "FR",
  "club": "皇家马德里",
  "club_en": "Real Madrid",
  "league": "西甲",
  "position": "中锋",
  "position_group": "FW",
  "birth_date": "1998-12-20",
  "height_cm": 178,
  "preferred_foot": "右脚",
  "shirt_number": 9,
  "active": true,
  "fame_level": 5,
  "pinyin": "jilianmubapei",
  "initials": "jlambp",
  "search_index": "基利安姆巴佩|kylianmbappe|皇家马德里|realmadrid|西甲|法国|中锋|jilianmubapei|jlambp|姆巴佩|神龟|mbappe|姆总监",
  "intro": "19 岁就拿世界杯冠军，法国队新一代领军人，爆发力惊人。",
  "fun_fact": "世界杯决赛上演帽子戏法，是 1966 年以来首个做到这一点的球员。",
  "meme": "因速度快被戏称“神龟”，也常被调侃“儿皇梦”终于实现。",
  "primary_color": "#FEBE10",
  "secondary_color": "#00529F",
  "data_as_of": "2026-10-11"
},
{
  "_id": "p005",
  "id": 5,
  "name_cn": "裘德·贝林厄姆",
  "name_en": "Jude Bellingham",
  "aliases": [
    "贝林厄姆",
    "贝林",
    "Bellingham"
  ],
  "nationality": "英格兰",
  "nationality_code": "GB-ENG",
  "club": "皇家马德里",
  "club_en": "Real Madrid",
  "league": "西甲",
  "position": "中前卫",
  "position_group": "MF",
  "birth_date": "2003-06-29",
  "height_cm": 186,
  "preferred_foot": "右脚",
  "shirt_number": 5,
  "active": true,
  "fame_level": 5,
  "pinyin": "qiudebeilinemu",
  "initials": "qdblem",
  "search_index": "裘德贝林厄姆|judebellingham|皇家马德里|realmadrid|西甲|英格兰|中前卫|qiudebeilinemu|qdblem|贝林厄姆|贝林|bellingham",
  "intro": "少年老成的全能中场，登陆皇马首个赛季就成为进攻核心。",
  "fun_fact": "16 岁就在英冠伯明翰一线队首发出场，俱乐部为他提前退役了 22 号球衣。",
  "meme": "张开双臂的“淡定庆祝”成了他的招牌表情包。",
  "primary_color": "#FEBE10",
  "secondary_color": "#00529F",
  "data_as_of": "2026-10-11"
},
{
  "_id": "p006",
  "id": 6,
  "name_cn": "阿什拉夫·哈基米",
  "name_en": "Achraf Hakimi",
  "aliases": [
    "阿什拉夫",
    "哈基米",
    "Hakimi"
  ],
  "nationality": "摩洛哥",
  "nationality_code": "MA",
  "club": "巴黎圣日耳曼",
  "club_en": "Paris Saint-Germain",
  "league": "法甲",
  "position": "右后卫",
  "position_group": "DF",
  "birth_date": "1998-11-04",
  "height_cm": 181,
  "preferred_foot": "右脚",
  "shirt_number": 2,
  "active": true,
  "fame_level": 4,
  "pinyin": "ashenlafuhajimi",
  "initials": "aslfhjm",
  "search_index": "阿什拉夫哈基米|achrafhakimi|巴黎圣日耳曼|parissaintgermain|法甲|摩洛哥|右后卫|ashenlafuhajimi|aslfhjm|阿什拉夫|哈基米|hakimi",
  "intro": "助攻能力极强的边后卫，摩洛哥队闯进世界杯四强的核心之一。",
  "fun_fact": "出生于西班牙马德里，出自皇马青训，却选择代表摩洛哥国家队。",
  "meme": "摩洛哥世界杯之旅让他成了阿拉伯世界的全民偶像。",
  "primary_color": "#004170",
  "secondary_color": "#DA291C",
  "data_as_of": "2026-10-11"
},
{
  "_id": "p007",
  "id": 7,
  "name_cn": "蒂博·库尔图瓦",
  "name_en": "Thibaut Courtois",
  "aliases": [
    "库尔图瓦",
    "裤袜",
    "Courtois"
  ],
  "nationality": "比利时",
  "nationality_code": "BE",
  "club": "皇家马德里",
  "club_en": "Real Madrid",
  "league": "西甲",
  "position": "门将",
  "position_group": "GK",
  "birth_date": "1992-05-11",
  "height_cm": 199,
  "preferred_foot": "左脚",
  "shirt_number": 1,
  "active": true,
  "fame_level": 5,
  "pinyin": "dibokuertuwa",
  "initials": "dbketw",
  "search_index": "蒂博库尔图瓦|thibautcourtois|皇家马德里|realmadrid|西甲|比利时|门将|dibokuertuwa|dbketw|库尔图瓦|裤袜|courtois",
  "intro": "身高接近两米的门线巨塔，多次在欧冠决赛中力挽狂澜。",
  "fun_fact": "早年其实是标准青训出身的左脚门将，少年时打过左后卫。",
  "meme": "中文球迷叫他“裤袜”，源自姓氏谐音。",
  "primary_color": "#FEBE10",
  "secondary_color": "#00529F",
  "data_as_of": "2026-10-11"
},
{
  "_id": "p008",
  "id": 8,
  "name_cn": "哈里·凯恩",
  "name_en": "Harry Kane",
  "aliases": [
    "凯恩",
    "大英帝星",
    "Kane"
  ],
  "nationality": "英格兰",
  "nationality_code": "GB-ENG",
  "club": "拜仁慕尼黑",
  "club_en": "Bayern Munich",
  "league": "德甲",
  "position": "中锋",
  "position_group": "FW",
  "birth_date": "1993-07-28",
  "height_cm": 188,
  "preferred_foot": "右脚",
  "shirt_number": 9,
  "active": true,
  "fame_level": 5,
  "pinyin": "halikaien",
  "initials": "hlke",
  "search_index": "哈里凯恩|harrykane|拜仁慕尼黑|bayernmunich|德甲|英格兰|中锋|halikaien|hlke|凯恩|大英帝星|kane",
  "intro": "英格兰队史射手王，既能终结也能回撤组织的现代中锋。",
  "fun_fact": "在热刺效力十余年一直是队史射手王，转会拜仁后立刻拿下德甲金靴。",
  "meme": "“无冠魔咒”曾是被反复调侃的话题，直到他终于夺冠。",
  "primary_color": "#DC052D",
  "secondary_color": "#0066B2",
  "data_as_of": "2026-10-11"
},
{
  "_id": "p009",
  "id": 9,
  "name_cn": "齐内丁·齐达内",
  "name_en": "Zinedine Zidane",
  "aliases": [
    "齐达内",
    "齐祖",
    "Zidane",
    "Zizou"
  ],
  "nationality": "法国",
  "nationality_code": "FR",
  "club": "皇家马德里",
  "club_en": "Real Madrid",
  "league": "西甲",
  "position": "前腰",
  "position_group": "MF",
  "birth_date": "1972-06-23",
  "height_cm": 185,
  "preferred_foot": "右脚",
  "shirt_number": 5,
  "active": false,
  "fame_level": 5,
  "pinyin": "qineidingqidanei",
  "initials": "qndqdn",
  "search_index": "齐内丁齐达内|zinedinezidane|皇家马德里|realmadrid|西甲|法国|前腰|qineidingqidanei|qndqdn|齐达内|齐祖|zidane|zizou",
  "intro": "球风优雅的世纪中场，球员和教练两重身份都拿过欧冠。",
  "fun_fact": "2006 年世界杯决赛因头顶马特拉齐被红牌罚下，成为世界杯史上最著名瞬间之一。",
  "meme": "“齐祖”的转身动作被做成无数 GIF。",
  "primary_color": "#FEBE10",
  "secondary_color": "#00529F",
  "data_as_of": "2026-10-11"
},
{
  "_id": "p010",
  "id": 10,
  "name_cn": "保罗·马尔蒂尼",
  "name_en": "Paolo Maldini",
  "aliases": [
    "马尔蒂尼",
    "马队",
    "Maldini"
  ],
  "nationality": "意大利",
  "nationality_code": "IT",
  "club": "AC米兰",
  "club_en": "AC Milan",
  "league": "意甲",
  "position": "左后卫",
  "position_group": "DF",
  "birth_date": "1968-06-26",
  "height_cm": 186,
  "preferred_foot": "右脚",
  "shirt_number": 3,
  "active": false,
  "fame_level": 5,
  "pinyin": "baoluomaerdini",
  "initials": "blmedn",
  "search_index": "保罗马尔蒂尼|paolomaldini|ac米兰|acmilan|意甲|意大利|左后卫|baoluomaerdini|blmedn|马尔蒂尼|马队|maldini",
  "intro": "AC 米兰终身效力的一代旗手，被公认为史上最伟大的后卫之一。",
  "fun_fact": "父子两代都效力米兰，父亲塞萨尔·马尔蒂尼也曾是米兰队长。",
  "meme": "“3 号球衣退役”本身就是米兰球迷的集体记忆。",
  "primary_color": "#FB090B",
  "secondary_color": "#000000",
  "data_as_of": "2026-10-11"
}
]
```

```jsonc
{
  "_id": "p002",
  "id": 2,
  "name_cn": "克里斯蒂亚诺·罗纳尔多",
  "name_en": "Cristiano Ronaldo",
  "aliases": ["C罗", "Cristiano", "Ronaldo", "总裁", "罗总裁", "SIU", "CR7"],
  "nationality": "葡萄牙",
  "nationality_code": "PT",
  "club": "利雅得胜利",
  "club_en": "Al Nassr",
  "league": "沙特联",
  "position": "中锋",
  "position_group": "FW",
  "birth_date": "1985-02-05",
  "height_cm": 187,
  "preferred_foot": "右脚",
  "shirt_number": 7,
  "active": true,
  "fame_level": 5,
  "pinyin": "kelisidinuoluonaduo",
  "initials": "ksdnlnd",
  "search_index": "克里斯蒂亚诺罗纳尔多|cristianoronaldo|利雅得胜利|alnassr|葡萄牙|中锋|kelisidinuoluonaduo|ksdnlnd|c罗|罗纳尔多|总裁|siu|cr7",
  "intro": "5 座金球奖、5 座欧冠冠军，历史级射手，职业生涯正式比赛进球数超过 900 球。",
  "fun_fact": "他是历史上第一位在 6 届世界杯上都有进球的男足球员。",
  "meme": "SIU —— 招牌庆祝动作，进球后跃起转体落地双臂下拉，已成全网模仿素材。",
  "primary_color": "#FDB913",
  "secondary_color": "#1B4F8A",
  "data_as_of": "2026-10-10"
}
```

```jsonc
{
  "_id": "p003",
  "id": 3,
  "name_cn": "埃尔林·哈兰德",
  "name_en": "Erling Haaland",
  "aliases": ["哈兰德", "Haaland", "魔人布欧", "哈兰缪勒", "Erling Braut Haaland"],
  "nationality": "挪威",
  "nationality_code": "NO",
  "club": "曼城",
  "club_en": "Manchester City",
  "league": "英超",
  "position": "中锋",
  "position_group": "FW",
  "birth_date": "2000-07-21",
  "height_cm": 195,
  "preferred_foot": "左脚",
  "shirt_number": 9,
  "active": true,
  "fame_level": 5,
  "pinyin": "aierlinhalande",
  "initials": "aelhld",
  "search_index": "埃尔林哈兰德|erlinghaaland|曼城|manchestercity|英超|挪威|中锋|aierlinhalande|aelhld|哈兰德|魔人布欧|haaland",
  "intro": "曼城当家射手，保持着英超单赛季 36 球（38 轮制）的进球纪录，2022-23 赛季率队拿下三冠王。",
  "fun_fact": "父亲阿尔夫-因格·哈兰德曾是曼城后卫，两人曾在同一时期被曼城青训和一线队以不同身份效力。",
  "meme": "魔人布欧 —— 中国球迷给他起的绰号，取自《龙珠》里那个又壮又能吸收对手的角色。",
  "primary_color": "#6CABDD",
  "secondary_color": "#0B2A4A",
  "data_as_of": "2026-10-10"
}
```

```jsonc
{
  "_id": "p004",
  "id": 4,
  "name_cn": "基利安·姆巴佩",
  "name_en": "Kylian Mbappé",
  "aliases": ["姆巴佩", "Mbappe", "姆总监", "Kylian", "KM"],
  "nationality": "法国",
  "nationality_code": "FR",
  "club": "皇家马德里",
  "club_en": "Real Madrid",
  "league": "西甲",
  "position": "中锋",
  "position_group": "FW",
  "birth_date": "1998-12-20",
  "height_cm": 178,
  "preferred_foot": "右脚",
  "shirt_number": 10,
  "active": true,
  "fame_level": 5,
  "pinyin": "jilianmubapei",
  "initials": "jmbp",
  "search_index": "基利安姆巴佩|kylianmbappe|皇家马德里|realmadrid|西甲|法国|中锋|jilianmubapei|jmbp|姆巴佩|姆总监|mbappe|kylian",
  "intro": "2018 年世界杯冠军法国队核心，2024 年加盟皇家马德里，现披 10 号战袍。",
  "fun_fact": "19 岁那年成为继贝利之后第二位在世界杯决赛破门的青少年球员。",
  "meme": "姆总监 —— 在巴黎时期因深度参与球队决策、发言掷地有声，被球迷半调侃地封为总监。",
  "primary_color": "#FEBE10",
  "secondary_color": "#00529F",
  "data_as_of": "2026-10-10"
}
```

```jsonc
{
  "_id": "p005",
  "id": 5,
  "name_cn": "裘德·贝林厄姆",
  "name_en": "Jude Bellingham",
  "aliases": ["贝林厄姆", "Bellingham", "贝皇", "新齐达内"],
  "nationality": "英格兰",
  "nationality_code": "GB-ENG",
  "club": "皇家马德里",
  "club_en": "Real Madrid",
  "league": "西甲",
  "position": "前腰",
  "position_group": "MF",
  "birth_date": "2003-06-29",
  "height_cm": 186,
  "preferred_foot": "右脚",
  "shirt_number": 5,
  "active": true,
  "fame_level": 5,
  "pinyin": "qiudebeilingemu",
  "initials": "qdblm",
  "search_index": "裘德贝林厄姆|judebellingham|皇家马德里|realmadrid|西甲|英格兰|前腰|qiudebeilingemu|qdblm|贝林厄姆|贝皇|新齐达内",
  "intro": "英格兰中场核心，2023 年加盟皇家马德里，首个西甲赛季即拿下联赛冠军与欧冠，成为球队新中场支柱。",
  "fun_fact": "16 岁就在伯明翰城一线队首发并破门，是英格兰职业联赛历史上最年轻的一线队首发球员之一。",
  "meme": "标志性的双臂张开静止 3 秒庆祝动作，因其沉稳老成的气质被中国球迷称作贝皇。",
  "primary_color": "#FEBE10",
  "secondary_color": "#00529F",
  "data_as_of": "2026-10-10"
}
```

```jsonc
{
  "_id": "p006",
  "id": 6,
  "name_cn": "阿什拉夫·哈基米",
  "name_en": "Achraf Hakimi",
  "aliases": ["阿什拉夫", "Hakimi", "哈基米"],
  "nationality": "摩洛哥",
  "nationality_code": "MA",
  "club": "巴黎圣日耳曼",
  "club_en": "Paris Saint-Germain",
  "league": "法甲",
  "position": "右后卫",
  "position_group": "DF",
  "birth_date": "1998-11-04",
  "height_cm": 181,
  "preferred_foot": "右脚",
  "shirt_number": 2,
  "active": true,
  "fame_level": 4,
  "pinyin": "ashenlafuhajimi",
  "initials": "aslfhjm",
  "search_index": "阿什拉夫哈基米|achrafhakimi|巴黎圣日耳曼|parissaintgermain|法甲|摩洛哥|右后卫|ashenlafuhajimi|aslfhjm|阿什拉夫|哈基米|hakimi",
  "intro": "摩洛哥国家队右后卫，现效力巴黎圣日耳曼，以极强的上下往返能力和前插得分著称。",
  "fun_fact": "2022 年卡塔尔世界杯，他所在的摩洛哥成为史上第一支打进世界杯四强的非洲球队。",
  "meme": "摩洛哥奇迹 —— 2022 年世界杯淘汰西班牙、葡萄牙的那波黑马之旅，中文网络至今仍在回味。",
  "primary_color": "#004170",
  "secondary_color": "#DA291C",
  "data_as_of": "2026-10-10"
}
```

```jsonc
{
  "_id": "p007",
  "id": 7,
  "name_cn": "蒂博·库尔图瓦",
  "name_en": "Thibaut Courtois",
  "aliases": ["库尔图瓦", "Courtois", "比利时门神"],
  "nationality": "比利时",
  "nationality_code": "BE",
  "club": "皇家马德里",
  "club_en": "Real Madrid",
  "league": "西甲",
  "position": "门将",
  "position_group": "GK",
  "birth_date": "1992-05-11",
  "height_cm": 199,
  "preferred_foot": "左脚",
  "shirt_number": 1,
  "active": true,
  "fame_level": 5,
  "pinyin": "dibokurtuwa",
  "initials": "dbktw",
  "search_index": "蒂博库尔图瓦|thibautcourtois|皇家马德里|realmadrid|西甲|比利时|门将|dibokurtuwa|dbktw|库尔图瓦|比利时门神|courtois",
  "intro": "身高超过一米九九的世界级门将，现为皇家马德里主力，被视为当今门线覆盖最强的守门员之一。",
  "fun_fact": "2022 年欧冠决赛面对利物浦完成 9 次扑救，被媒体称为一个人守住了整座奖杯。",
  "meme": "门线科幻电影 —— 中国球迷常拿他夸张的扑救面积做表情包，形容这球也能扑到。",
  "primary_color": "#FEBE10",
  "secondary_color": "#00529F",
  "data_as_of": "2026-10-10"
}
```

```jsonc
{
  "_id": "p008",
  "id": 8,
  "name_cn": "哈里·凯恩",
  "name_en": "Harry Kane",
  "aliases": ["凯恩", "Kane", "无冠魔咒"],
  "nationality": "英格兰",
  "nationality_code": "GB-ENG",
  "club": "拜仁慕尼黑",
  "club_en": "Bayern Munich",
  "league": "德甲",
  "position": "中锋",
  "position_group": "FW",
  "birth_date": "1993-07-28",
  "height_cm": 188,
  "preferred_foot": "右脚",
  "shirt_number": 9,
  "active": true,
  "fame_level": 5,
  "pinyin": "halikaien",
  "initials": "hlka",
  "search_index": "哈里凯恩|harrykane|拜仁慕尼黑|bayernmunich|德甲|英格兰|中锋|halikaien|hlka|凯恩|无冠魔咒|kane",
  "intro": "英格兰队史射手王、热刺队史射手王，2023 年转投拜仁慕尼黑后拿下个人首座联赛冠军。",
  "fun_fact": "他漫长生涯里直到 2025 年才拿到职业生涯第一座正式比赛冠军奖杯，此前的无冠魔咒一直是英格兰球迷的经典话题。",
  "meme": "无冠魔咒终结 —— 2025 年随拜仁夺得德甲冠军那一刻，中文足球圈一片爷青结式刷屏。",
  "primary_color": "#DC052D",
  "secondary_color": "#0066B2",
  "data_as_of": "2026-10-10"
}
```

```jsonc
{
  "_id": "p009",
  "id": 9,
  "name_cn": "齐内丁·齐达内",
  "name_en": "Zinedine Zidane",
  "aliases": ["齐达内", "Zidane", "齐祖", "Zizou"],
  "nationality": "法国",
  "nationality_code": "FR",
  "club": "皇家马德里",
  "club_en": "Real Madrid",
  "league": "西甲",
  "position": "前腰",
  "position_group": "MF",
  "birth_date": "1972-06-23",
  "height_cm": 185,
  "preferred_foot": "右脚",
  "shirt_number": 5,
  "active": false,
  "fame_level": 5,
  "pinyin": "qineidingqidanei",
  "initials": "qndqdn",
  "search_index": "齐内丁齐达内|zinedinezidane|皇家马德里|realmadrid|西甲|法国|前腰|qineidingqidanei|qndqdn|齐达内|齐祖|zizou|zidane",
  "intro": "1998 年世界杯冠军、2000 年欧洲杯冠军法国队核心，1998 年金球奖得主，退役后又以教练身份率皇马完成欧冠三连冠。",
  "fun_fact": "球员时代最著名的一幕是 2006 年世界杯决赛头顶马特拉齐领红牌离场，那场比赛成了他职业生涯的收官战。",
  "meme": "天外飞仙 —— 2002 年欧冠决赛那脚左脚凌空抽射，中文解说给出的经典命名，至今仍是集锦必剪片段。",
  "primary_color": "#FEBE10",
  "secondary_color": "#00529F",
  "data_as_of": "2026-10-10"
}
```

```jsonc
{
  "_id": "p010",
  "id": 10,
  "name_cn": "保罗·马尔蒂尼",
  "name_en": "Paolo Maldini",
  "aliases": ["马尔蒂尼", "Maldini", "米兰传奇", "保罗马尔蒂尼"],
  "nationality": "意大利",
  "nationality_code": "IT",
  "club": "AC米兰",
  "club_en": "AC Milan",
  "league": "意甲",
  "position": "左后卫",
  "position_group": "DF",
  "birth_date": "1968-06-26",
  "height_cm": 186,
  "preferred_foot": "右脚",
  "shirt_number": 3,
  "active": false,
  "fame_level": 5,
  "pinyin": "baolumaerdini",
  "initials": "blmdn",
  "search_index": "保罗马尔蒂尼|paolomaldini|ac米兰|acmilan|意甲|意大利|左后卫|baolumaerdini|blmdn|马尔蒂尼|米兰传奇|maldini",
  "intro": "AC米兰终身效力传奇，25 年红黑生涯出场超过 900 次，5 次欧冠冠军，公认的史上最伟大左后卫之一。",
  "fun_fact": "他的父亲切萨雷·马尔蒂尼也曾是米兰队长，祖孙三代都穿着红黑球衣踢过意甲。",
  "meme": "3 号永远属于马尔蒂尼 —— 他退役后球队长期没有让其他球员穿上 3 号，这个号码几乎成了他的专属代号。",
  "primary_color": "#FB090B",
  "secondary_color": "#000000",
  "data_as_of": "2026-10-10"
}
```

### 6.1 这 10 条的覆盖校验

| 维度 | 覆盖情况 |
| --- | --- |
| 位置大类 | GK ✅(p007) DF ✅(p006, p010) MF ✅(p005, p009) FW ✅(其余 5 人) |
| 五大联赛 | 英超 ✅(p003) 西甲 ✅(p004,p005,p007) 德甲 ✅(p008) 意甲 ✅(p010) 法甲 ✅(p006) |
| 海外联赛 | 美职联 ✅(p001) 沙特联 ✅(p002) |
| 现役 / 传奇 | 现役 8 条 / 退役 2 条（p009, p010） |
| 惯用脚 | 右脚 7 条 / 左脚 3 条（p001, p003, p007） |
| 身高跨度 | 170 ~ 199 cm（覆盖箭头公差 ±3cm 的两侧） |

---

## 7. 导入与校验

### 7.1 导入步骤

1. 云开发控制台 → 数据库 → 选择 `players` 集合 → **导入**；
2. 选择 `database/players.sample.jsonl`，**冲突处理选"新增（insert）"**（不要选 upsert，避免本地调试污染正式数据）；
3. 按 §3.1 创建索引；
4. 按 §3.6 设置权限。

### 7.2 导入前必跑的数据校验清单

| 校验项 | 规则 | 不通过的处理 |
| --- | --- | --- |
| `id` 唯一 | 1~200 不重复 | 阻断导入 |
| `_id` 规范 | `^p\d{3}$` | 阻断 |
| 队色齐全 | `primary_color` / `secondary_color` 必须合法 HEX | 阻断（头像是靠队色画出来的，缺了就是绿块） |
| 必填非空 | 全部必填字段非空 | 阻断 |
| 允许为空 | `meme` 允许空串（键必须存在） | 告警 |
| 枚举合法 | `position` ∈ §4 枚举；`position_group` ∈ `{GK,DF,MF,FW}`；`preferred_foot` ∈ `{左脚,右脚,双脚}`；`league` ∈ §1.1 | 阻断 |
| 数值合理 | `height_cm` ∈ [160, 215]（门将可到 205+）；`shirt_number` ∈ [1, 99]；`birth_date` ∈ [1940-01-01, 2010-12-31] | 告警 |
| **译名污染** | `club` 不得出现在 §1.2 的"禁用写法"列 | 阻断 |
| `search_index` | 必须包含 `name_cn` 的折叠形式 | 自动重算 |
| `active=false` 的 `club` | 不得为「已退役」「无」「retired」 | 阻断（见 §3.2） |

校验脚本会在第 5 步以云函数 `dbValidate` 的形式给出。

---

*下一步：docs/03-algorithm.md —— 匹配算法、位置/数值判定、每日种子、以及 4 个云函数的完整实现。*
