# 猜球员 GuessPlayer · 匹配算法 & 云函数逻辑 v1.0

> 上一步：docs/02-database.md ｜ 本文件对应第 3 步
> 所有此处定义的规则，**服务端是唯一权威实现**，客户端不得重复实现比对逻辑。

---

## 0. 本轮决策更新（承接你的四条回复）

| # | 你的决策 | 落地方式 | 影响面 |
| --- | --- | --- | --- |
| 1 | **个人主体** | 类目策略调整：走「工具 → 效率」兜底，同时后端验证「体育」是否可选。**公开排行榜下线**（个人主体禁止 UGC/用户信息外显） | 见 §7 授权合规，以及下方「重要提醒」 |
| 2 | 每日答案**不统一** | 每日种子加入 `openid`：`sha256(salt \| dateKey \| openid)` | §2 抽样算法 |
| 3 | **开通**朋友圈分享 | `onShareTimeline` 需在首页/结果页实现，5:4 分享图（非 3:4） | 第 4 步代码；本次先出接口约定 |
| 4 | 由我**生成** AI 球员图 | 先跑 4 张试点图锁画风，确认后批量生成 200 人 | `assets/ai-photo-prompt.md`，本次产出试点图 |

### ⚠️ 重要提醒：个人主体 + 游戏类目，这里有个结构性问题

查的结果是 —— **「微信小程序」和「微信小游戏」是两个独立账号体系，规则不同**：

| 平台 | UI 技术 | 个人主体能否选「游戏」类目 | 结论 |
| --- | --- | --- | --- |
| **微信小程序** | WXML / WXSS（我们现在的选型） | ❌ 不能，该类目不向个人开放 | 我们在这里 |
| **微信小游戏** | Canvas / Cocos / Unity（没有 WXML） | ✅ 可以，走「游戏 → 休闲益智」，纯广告变现免版号 | 需要重写 UI |

所以没有"两全其美"的选项，只有两条路：

**路径①（我推荐，先这么走）** —— 保持小程序原生 + 云开发，类目选：

- 首选尝试：`体育 → 运动健身信息`（部分体育二级类目对个媒开放，以你后台**实际能勾选**为准）
- 兜底：`工具 → 效率`（个人主体稳定开放，几乎必过）
- 同时**弱化游戏感**：不出现"排名""竞技""奖励""积分商城"等字样；不做虚拟奖励、不做诱导分享

风险：审核员仍可能认定这是游戏而要求改类目 —— 被拒是**整改**不是封号，代价可控。

**路径②（合规最稳，但要重写）** —— 注册为「小游戏」账号，个人主体明确可走「休闲益智」，无需版号，**但**要：① UI 全部改用 Canvas；② 办软件著作权（约 60 天）；③ 游戏自审自查报告；④ 工信部 ICP 备案。周期长、成本高，不适合现在。

> 另外两条必须知道：个人主体**不能做 UGC**（评论、留言、动态、社区一律禁止），所以 MVP 原本 P1 的「好友排行榜」我建议直接砍掉改本地统计；个人主体也**不能开通流量主（广告变现）**，未来想赚钱必须转企业主体。

以上基于公开规则整理，**最终以你小程序后台「设置 → 基本设置 → 服务类目」实际可勾选项为准**。

---

## 1. 判定常量

```js
// cloudfunctions/_shared/constants.js
MAX_GUESSES   = 8      // 每局最多猜测次数
AGE_TOL       = 2      // 年龄黄色公差（岁）
HEIGHT_TOL    = 3      // 身高黄色公差（cm）
SHIRT_TOL     = 3      // 球衣号黄色公差（号）
MIN_FAME      = 3      // 进入答案池的最低知名度（自由练习）
MIN_FAME_DAILY= 4      // 每日一题专用门槛，高 MIN_FAME 一档
MAX_POOL_SIZE = 1000   // 答案池/候选池拉取上限，必须 >= 题库总人数
```

> ⚠️ **`MAX_POOL_SIZE` 必须 ≥ 题库总人数**，它不是"防拖慢"的软限制，而是正确性约束：
> 候选池就是玩家能在搜索框里选到的全部球员。一旦答案落在被截断的那部分，
> 玩家搜不到正确答案 —— 游戏无解，同时违反 `clue.js` 的黄金不变量「筛选结果必含答案」。
> 题库 200 人时 300 够用；扩到 500 人后被截掉 200，由 `test-flow.js` 的
> 「下发条数正确」（期望值取自题库实际条数，题库一变就会红）抓出。
> 取 1000 是给继续扩池留余量。
>
> 另有一处**独立的**写死上限曾经藏在 `getPlayers/index.js`：分页循环 `page < 3`
> （每页 100 条 = 硬顶 300），不受 `MAX_POOL_SIZE` 约束。已改为「取不满一页即止」
> 并用 `MAX_POOL_SIZE` 兜底防死循环。看到这里请记住：**分页取全量时不要写死页数**。

> **为什么每日一题要单独抬高一档**：答案池里混进 `fame=3` 的冷门球员时，
> 没听说过他的人即使拿到 8 行反馈也推理不出来 —— 信息再多也唤不出一个你不认识的人名，
> 只剩挫败感。自由练习是玩家主动点的，愿意挑战冷门就让他挑战，所以维持 3。
> 线上可用 `meta/answer_pool` 的 `minFameDaily` / `minFameEndless` 覆盖，改配置不用发版。

线索字段固定顺序（前后端渲染顺序必须一致）：

```js
CLUE_ORDER = [
  'nationality', 'club', 'league', 'position',
  'age', 'height', 'shirt_number', 'preferred_foot'
]
```

---

## 2. 每日答案抽样算法

### 2.1 要求

| 要求 | 实现 |
| --- | --- |
| 同一用户同一自然日答案固定 | 种子含 `dateKey` + `openid` |
| 不同用户同日**可以不同**（本轮决策） | 种子含 `openid` |
| 跨日高离散 | SHA-256 取前 16 位十六进制转整数取模 |
| 答案可复现（复盘/客服） | 纯函数，输入相同必输出相同 |
| 题库更新不影响进行中的对局 | 答案 `id` 在开局时写死进 `games` 文档 |

### 2.2 实现

```js
const crypto = require('crypto');

/**
 * 十六进制串对 m 取模 —— 逐位累加，纯整数运算。
 *
 * ⚠️ 千万别写成 parseInt(h.slice(0,16), 16) % pool.length：
 *    64 位十六进制约 1.8e19，远超 Number.MAX_SAFE_INTEGER（9.0e15），
 *    双精度表示会把它吸附到 2048 的整数倍上；2048 与 200 的最大公约数是 8，
 *    于是 200 人的答案池实际只剩 25 个可能值，分布严重塌缩。
 *    这个 bug 在肉眼review 里完全看不出来，是被 scripts/test-compare.js
 *    里那条「不同 user 同一天应高度离散」的分布断言抓出来的。
 */
function modHex(hexStr, m) {
  let r = 0;
  for (let i = 0; i < hexStr.length; i++) {
    r = (r * 16 + parseInt(hexStr[i], 16)) % m;
  }
  return r;
}

function pickDailyAnswer(pool, { salt, dateKey, openid, mode }) {
  // pool 必须已按 id 升序排列，保证同一输入结果稳定
  const tail = mode === 'global' ? '' : `|${openid}`;   // global 模式不掺 openid
  const h = crypto.createHash('sha256')
    .update(`${salt}|${dateKey}${tail}`)
    .digest('hex');
  return pool[modHex(h, pool.length)];
}

function pickEndlessAnswer(pool) {
  return pool[crypto.randomInt(0, pool.length)];
}
```

> **这条 bug 的教训**：涉及散列的均匀分布，请务必写「分布类断言」而不是只测「同一输入固定输出」。前者能发现答案池塌缩，后者发现不了。

### 2.3 "自然日"的时区陷阱 ⚠️

云函数默认跑在 UTC+8，但不能依赖运行环境。必须手动对齐北京时间：

```js
function beijingDateKey(now = Date.now()) {
  const d = new Date(now + 8 * 3600 * 1000);   // 强制 UTC+8
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
```

不这么做的话，跨零点那一两小时会用错 `dateKey`，导致"今天开了两次局"。

### 2.4 ⚠️ 关于"每人每日答案不同"的代价（产品经理视角）

这个决策会削弱一点传播性 —— 玩家在群里晒战绩时，**没法大家一起讨论同一个人**，也没法形成"今天这题太难了"的集体话题 —— 大家一起讨论同一个答案，正是这类游戏传播性的核心来源。

我先按你的要求实现，但给你留了开关：`meta/answer_pool` 里加一个字段就能切回全局统一，不用改代码：

```js
// meta/daily_salt 中加 mode 字段
{ "_id": "daily_salt", "salt": "GP2026v1",
  "mode": "per_user",     // "per_user" = 每人不同（当前）｜ "global" = 全球统一
  "note": "切换 mode 会重置所有玩家的今日答案，慎改" }
```

想切回全局时把 `mode` 改成 `global` 即可（此时抽签种子去掉 `openid`）。

---

## 3. 比对算法 `compare(guess, answer, refDateKey)`

### 3.1 完整实现

```js
// cloudfunctions/_shared/compare.js
const C = require('./constants');

function calcAge(birthDate, refDateKey) {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ry, rm, rd] = refDateKey.split('-').map(Number);
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age -= 1;   // 生日还没过
  return age;
}

function eqState(a, b) {
  return a === b ? 'green' : 'gray';
}

function clubState(g, a) {
  if (g.club === a.club) return 'green';
  if (g.league && g.league === a.league) return 'amber';   // 同联赛 -> 黄
  return 'gray';
}

function positionState(g, a) {
  if (g.position === a.position) return 'green';                    // 细分位置相同
  if (g.position_group === a.position_group) return 'amber';        // 同大类 -> 黄
  return 'gray';
}

function numericState(gv, av, tol) {
  // 缺失值（0 / null / undefined）不参与比较
  if (!gv || !av) return { state: 'gray', arrow: null };
  if (gv === av) return { state: 'green', arrow: 'equal' };
  return {
    state: Math.abs(gv - av) <= tol ? 'amber' : 'gray',
    arrow: gv > av ? 'up' : 'down'
  };
}

function compare(guess, answer, refDateKey) {
  const gAge = calcAge(guess.birth_date, refDateKey);
  const aAge = calcAge(answer.birth_date, refDateKey);

  return {
    nationality:    { value: guess.nationality,    state: eqState(guess.nationality, answer.nationality) },
    club:           { value: guess.club,           state: clubState(guess, answer) },
    league:         { value: guess.league,         state: eqState(guess.league, answer.league) },
    position:       { value: guess.position,       state: positionState(guess, answer) },
    age:            { value: gAge, unit: '岁',      ...numericState(gAge, aAge, C.AGE_TOL) },
    height:         { value: guess.height_cm, unit: 'cm', ...numericState(guess.height_cm, answer.height_cm, C.HEIGHT_TOL) },
    shirt_number:   { value: guess.shirt_number, prefix: '#', ...numericState(guess.shirt_number, answer.shirt_number, C.SHIRT_TOL) },
    preferred_foot: { value: guess.preferred_foot, state: eqState(guess.preferred_foot, answer.preferred_foot) }
  };
}

function isHit(guess, answer) {
  return guess.id === answer.id;
}
```

### 3.2 为什么年龄不存库

年龄段位、`data_as_of` 后的老化都指向同一个结论：**库里只存 `birth_date`，在对局的自然日实时算周岁**。这样球星过生日当天/refDate 变化无需任何数据维护。

### 3.3 边界用例表

| # | 场景 | 期望输出 | 说明 |
| --- | --- | --- | --- |
| B1 | 猜测 170cm vs 答案 173cm | `amber` + `down` | 差值 3，刚好落在公差内 |
| B2 | 猜测 170cm vs 答案 174cm | `gray` + `down` | 差值 4，越界 |
| B3 | 猜测 25 岁 vs 答案 25 岁 | `green` + `equal` | 相等必绿，且箭头为 `=`，不能出现 `amber+equal` |
| B4 | 答案 `height_cm = 0` | `gray` + `arrow: null` | 缺失值不参与比较，UI 显示「—」 |
| B5 | 猜测「前腰」vs 答案「后腰」 | `amber` | 同为 MF 大类 |
| B6 | 猜测「左后卫」vs 答案「中后卫」 | `amber` | 同为 DF |
| B7 | 猜测「门将」vs 答案「门将」 | `green` | 唯一一个 DF/MF/FW 无法触发黄色的组 |
| B8 | 猜测「中锋」vs 答案「右边锋」 | `amber` | 同为 FW |
| B9 | 猜测「左脚」vs 答案「双脚」 | `gray` | **`双脚`按独立枚举处理**，不与左/右脚等价（见下方说明） |
| B10 | 猜测「曼城」vs 答案「曼联」 | `amber` | 同英超 |
| B11 | 退役球员互相比较 | 正常比对 | `club`/`league` 是真实值，不是「已退役」 |

**关于 B9 的裁定**：`双脚` 是一个真实存在的能力描述（如孙兴慜、登贝莱），但把它和「左脚」「右脚」都判黄会让这条线索几乎失效。因此 **PRD 裁定：双脚视为独立取值，只有双方都是「双脚」才绿，其余一律灰。** 若后续希望更宽松，改 `eqState` 一处即可。

---

## 4. 云函数 API 契约

统一响应结构：

```js
{ ok: true,  code: 0,    data: {...} }
{ ok: false, code: 1001, msg: '参数错误' }
```

### 4.1 错误码

| code | 含义 | 前端处理 |
| --- | --- | --- |
| 0 | 成功 | — |
| 1001 | `INVALID_PARAM` 参数缺失/非法 | toast「操作有误」 |
| 1002 | `GAME_NOT_FOUND` 对局不存在 | 回首页重开 |
| 1003 | `FORBIDDEN` 非本人对局 | 回首页 |
| 1004 | `GAME_FINISHED` 对局已结束 | 跳结果页 |
| 1005 | `DUPLICATE_GUESS` 重复猜测 | toast「已经猜过 TA 了」，**不消耗次数** |
| 1006 | `PLAYER_NOT_FOUND` 球员不在库中 | toast「球员不存在」 |
| 2001 | `POOL_EMPTY` 答案池为空（运营事故） | 提示维护中 |
| 9999 | `INTERNAL` 服务端异常 | toast + 上报日志 |

### 4.2 `gameStart`

**入参**

```js
{ mode: 'daily' | 'endless' }
```

**出参**

```js
{
  ok: true, code: 0,
  data: {
    gameId: 'g_20261010_a1b2c3d4',
    mode: 'daily',
    dateKey: '2026-10-10',
    maxGuesses: 8,
    used: 0,                 // 已用次数
    remaining: 8,
    status: 'playing',       // playing | won | lost
    rows: []                 // 若今日已有存档，这里回带历史线索（续上次）
  }
}
```

> 幂等：`daily` 模式下同一天重复调用**永远返回同一局**。若今天已经猜完，`status` 为 `won`/`lost`，前端据此直接跳结果页。

### 4.3 `gameGuess`

**入参**

```js
{ gameId: 'g_xxx', playerId: 42 }
```

**出参**

```js
{
  ok: true, code: 0,
  data: {
    round: 1,                // 第几次猜测
    guessedId: 42,
    hit: false,              // 是否命中答案
    status: 'playing',       // playing | won | lost
    used: 1,
    remaining: 7,
    verdict: {               // 8 个字段的判定结果
      nationality:    { value: '比利时', state: 'gray'  },
      club:           { value: '曼城',   state: 'amber' },
      league:         { value: '英超',   state: 'green' },
      position:       { value: '前腰',   state: 'green' },
      age:            { value: 34, unit: '岁',  state: 'gray',  arrow: 'up' },
      height:         { value: 181, unit: 'cm', state: 'amber', arrow: 'up' },
      shirt_number:   { value: 17, prefix: '#', state: 'gray',  arrow: 'up' },
      preferred_foot: { value: '右脚',   state: 'green' }
    }
  }
}
```

> **绝不包含 `answerId`**。前端凭本地候选池里的球员数据 + 这个 `verdict` 自己渲染线索卡，数据零泄露。

### 4.4 `gameResume`

局中杀进程/切后台回来用。

**入参** `{ gameId }` → **出参** 同 `gameStart.data`，但 `rows` 带回全部历史线索（服务端重放）：

```js
rows: [
  { round: 1, guessedId: 42, verdict: {...} },
  { round: 2, guessedId: 88, verdict: {...} }
]
```

### 4.5 `gameResult`

**只在 `status != 'playing'` 时**才允许调用，否则返回 `1004`。

**入参** `{ gameId }` → **出参**

```js
{
  ok: true, code: 0,
  data: {
    gameId: 'g_20261010_9f3a2c11',
    mode: 'daily',
    dateKey: '2026-10-10',
    status: 'won',
    used: 4,
    score: 500,
    rows: [                    // 历史猜测，含 verdict 与被猜球员的展示字段
      {
        round: 1, guessedId: 4, hit: false, verdict: { ... },
        player: { /* CLIENT_FIELDS 裁剪后的对象，客户端不必依赖本地缓存即可渲染 */ }
      }
    ],
    answer: {   // 完整的答案球员对象（含 intro / fun_fact / meme）
      id: 3, name_cn: '埃尔林·哈兰德', name_en: 'Erling Haaland',
      nationality: '挪威', club: '曼城', league: '英超',
      position: '中锋', position_group: 'FW',
      birth_date: '2000-07-21', age: 26, height_cm: 195,
      preferred_foot: '左脚', shirt_number: 9,
      intro: '...', fun_fact: '...', meme: '...',
      primary_color: '#6CABDD', secondary_color: '#0B2A4A'
    }
  }
}
```

### 4.6 `getPlayers`

**入参** `{ version: '' }`（首轮传空，之后传本地缓存的版本号）

**出参**

```js
{
  ok: true, code: 0,
  data: {
    fresh: true,             // false = 本地版本已是最新，players 为空数组，不重复传输
    version: '2026-10-10',
    updatedAt: 1791676800000,
    count: 500,
    players: [ /* 见下方裁剪 */ ]
  }
}
```

**裁剪规则**（控制包体，500 条实测 **169.7 KB**，gzip 37.7 KB，单条均值 348 B）：

| 保留 | 剔除 |
| --- | --- |
| `id`, `name_cn`, `name_en`, `aliases`, `nationality`, `club`, `league`, `position`, `birth_date`, `height_cm`, `preferred_foot`, `shirt_number`, `pinyin`, `initials`, `active`, `primary_color`, `secondary_color` | `search_index`（客户端用同样规则重建）、`answerId`（任何情况下都不下发）、`intro`/`fun_fact`/`meme`（结果页再单独取） |

> **候选包里没有任何图片字段**：头像由 `player-badge` 组件用 `primary_color` /
> `secondary_color` + 姓氏首字现画，500 条实测 **169.7 KB**（gzip 37.7 KB）。
> 靠 `version` 版本号缓存压到每人只下一次（`version` 相同直接回 `fresh:false`、
> `players:[]`），所以 170 KB 是**一次性**成本，不是每次进游戏的成本。
> 真正的答案防泄露靠的是"**包里没有 answerId**" —— 这一点不因有没有图而改变。

---

## 5. 并发与幂等

### 5.1 幂等开局（防重复建房）

用户手抖连点两次「每日挑战」，可能开出两个不同答案。防线两层：

1. **应用层**：daily 模式先查 `_openid + mode + dateKey`，命中就直接复用；
2. **数据库层**：给 `games` 建 `(openid, mode, dateKey)` 的唯一索引，`add` 冲突时捕获错误再查一次复用。

```js
async function findToday(db, openid, dateKey) {
  const r = await db.collection('games')
    .where({ _openid: openid, mode: 'daily', dateKey })
    .orderBy('startedAt', 'asc')
    .limit(1)
    .get();
  return r.data[0] || null;
}
```

### 5.2 重复提交的原子性

连续快速点两次「提交」，两次 `gameGuess` 可能都读到 `status='playing'`，导致同一 `playerId` 被追加两次、消耗两次机会。用**数据库事务**解决：

```js
await db.runTransaction(async tx => {
  const gameDoc = await tx.collection('games').where({ gameId }).get();
  // ... 校验 openid / status / 重复
  await tx.collection('games').doc(docId).update({ data: {...} });
});
```

事务内部完成「读-判-写」，第二个请求会等待第一个提交后重新读取，此时 `guessIds` 已含该 id，返回 `1005 DUPLICATE_GUESS`。

---

## 6. 为什么客户端不放比对逻辑

| 理由 | 说明 |
| --- | --- |
| 防止暴力破解 | 若本地有 `compare`，攻击者可以遍历 500 人的候选池逐个试比对，瞬间反推出答案 |
| 避免双实现漂移 | 只有一处实现，不会出现"前端显示绿、后台判定不是"的诡异 bug |
| 规则可变 | 公差参数将来调服务端即可生效，不用发版 |

> `validate.py` 里的 §3.5 规则会在第 5 步做成跨端一致性测试：拿同一批 fixture 分别跑 Node 版和服务端，断言输出一致。

---

## 6.5 那客户端能做什么？—— 按线索筛候选池

红线是"不放比对逻辑"，但有一类客户端计算**既允许又必要**：拿玩家已经看到的反馈，去过滤本地候选池（就是「点右脚 → 列出所有右脚球员」）。

```
服务端给的    verdict —— 8 个字段的颜色 + 箭头 + 被猜球员自己的值
客户端做的    把这些颜色翻译成"必要条件"，过滤 500 人候选池
客户端做不到  拿答案去算颜色 —— 它压根拿不到答案
```

**关键区别：筛选不需要答案。** 它只用到"猜的那个人"和"颜色结果"，而这两样本来就印在玩家屏幕上。就算没这个功能，玩家拿张纸也能手动列出同一份名单 —— 它省的是体力，不是信息。

| 保障 | 做法 |
| --- | --- |
| 不用私有数据 | 只读 `rows[].verdict` 和本地缓存的候选池，不额外请求云端 |
| 不改判定 | 筛选只决定"显示谁给你选"，最终判定仍由 `gameGuess` 在服务端算 |
| 不会筛掉答案 | 每条约束都只是答案的必要条件；由 `scripts/test-candidates.js` 跑 1.1 万次筛选验证 |
| 不是作弊器 | 默认只应用被点的那一条；全叠加虽能缩到 1 人，但那是玩家主动选择 |

三态 → 约束的映射（`miniprogram/utils/clue.js`）：

| 标签 | 约束 | 实现要点 |
| --- | --- | --- |
| 绿 | `字段 === 值` | 数值字段要按 `refDateKey` 实时算年龄，不能读缓存的整数 |
| 黄·俱乐部 | `联赛 === 猜测者的联赛` 且 `俱乐部 !== 猜测者` | 黄灯本身就说明"不是这个俱乐部"，这条一定要用上 |
| 黄·位置 | `大类 === 猜测者的大类` 且 `细分位置 !== 猜测者` | 同上 |
| 黄·数值 | 区间 `[v-tol, v-1]`（↑）或 `[v+1, v+tol]`（↓） | 箭头给方向、公差给宽度，两头一夹比单纯 ±tol 精确 |
| 灰·文本 | `值 !== 被排除的值`（多条取交集） | 俱乐部灰还要连带排除它的联赛 |
| 灰·数值 | 单边不等式 | `arrow` 为 `null`（猜的人自己缺这个数据）时**必须跳过**，否则会把池子筛成空集 |

同字段多条线索的合并优先级：**绿 > 黄 > 灰**。因为绿的约束严格强于同字段的黄和灰，而黄绿混合时取黄也不会漏掉答案。

⚠️ 必须守住的边界：`clue.js` 里的 `TOL` / `POSITION_GROUP` 是 `_shared/constants.js` 的**副本**。它们不是秘密（帮助页就写着公差 2 岁 / 3cm / 3 号），但必须与真源一致 —— 否则玩家点「29岁↑」筛出的名单会和服务端判定的年龄对不上。`test-candidates.js` 第 1 组就是逐项对拍这两份口径。

---

## 7. 落地文件清单

```
cloudfunctions/
  _shared/          ← 单一真源，禁止直接部署
    constants.js
    compare.js
    util.js
  gameStart/        index.js  package.json
  gameGuess/        index.js  package.json
  gameResume/       index.js  package.json
  gameResult/       index.js  package.json
  getPlayers/       index.js  package.json
scripts/
  sync-shared.js    ← 每次上传前必须执行
miniprogram/
  utils/
    age.js          ← 客户端年龄/北京日期（与服务端对拍，见 §6.5）
    clue.js         ← 线索 → 候选池约束（纯客户端推理，见 §6.5）
    sfx.js          ← WebAudio 合成音效，零素材（见 01-PRD §2.5）
  components/
    candidate-sheet/  ← 点线索标签弹出的候选面板
    clue-card/        ← 线索行（chip 可点）
    search-sheet/     ← 关键字搜索面板
    player-badge/     ← 程序化头像（见 02-database §5）
```

> `_shared` 不能直接部署：微信只会上传单个云函数目录。必须跑 `node scripts/sync-shared.js` 把公共代码**物理复制**进每个函数目录。我已在脚本里加了检查，忘了同步会直接报错退出。
