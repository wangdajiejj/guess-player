/**
 * ⚠️⚠️⚠️ 本地 Mock 专用 —— 严禁在正式包里启用 ⚠️⚠️⚠️
 *
 * 本文件由 scripts/gen-mock-core.py 从 cloudfunctions/_shared/ 复制而来，
 * 目的是让「不想配云环境、只想先看一眼界面」的人能立刻跑通全局。
 *
 * 它违反了一条架构红线：比对逻辑不允许出现在客户端
 * （有了它，别人就能离线遍历候选池把答案试出来）。
 * 所以：
 *   1. 只有 app.js 里 USE_MOCK = true 时才会被加载；
 *   2. 提审 / 上线前必须把 USE_MOCK 改回 false，并删掉本文件；
 *   3. scripts/check-mp.js 会在 Mock 开启时给出醒目告警。
 *
 * 不要手改这里 —— 改请改 _shared/ 的真源，然后重跑生成脚本。
 */

/**
 * 判定与游戏常量 —— 单一真源
 * 由 scripts/sync-shared.js 复制到各云函数目录，请勿直接编辑副本。
 */

// 每局最多猜测次数
const MAX_GUESSES = 8;

// 数值字段的"黄色"公差：差值 <= tol 判 amber，否则 gray
const AGE_TOL = 2;      // 岁
const HEIGHT_TOL = 3;   // cm
const SHIRT_TOL = 3;    // 号

// 进入答案池的最低知名度（低于此值只作可猜对象，不作答案）
const MIN_FAME = 3;

/**
 * 「每日一题」专用的知名度门槛：比 MIN_FAME 高一档。
 *
 * 原因：答案池里混进 fame=3 的冷门球员时，没听说过他的人靠推理也猜不出来
 * —— 信息再多也唤不出一个你根本不认识的人名，只剩挫败感。
 * 自由练习是玩家主动选择的模式，愿意挑战冷门就让他挑战，所以维持 MIN_FAME。
 *
 * 由 meta/answer_pool 的 minFameDaily / minFameEndless 覆盖，可线上调。
 */
const MIN_FAME_DAILY = 4;

/**
 * 自由练习的难度分档（2026-10-25 新增，按知名度分级）：
 *   star   明星局 —— 只抽家喻户晓的巨星（fame = 5）
 *   normal 标准局 —— 知名球员（fame >= 4，与每日一题同档）
 *   all    全员局 —— 整个答案池，含冷门（走 minFameEndless 配置，默认 3）
 *
 * 不传 difficulty 时保持原行为（all），老客户端与既有测试不受影响。
 * 线上可用 meta/answer_pool 的 minFameStar / minFameNormal 覆盖前两档。
 */
const DIFFICULTIES = ['star', 'normal', 'all'];
const MIN_FAME_STAR = 5;
const MIN_FAME_NORMAL = 4;

/**
 * 答案池 / 候选池拉取上限。
 *
 * ⚠️ 这个数必须 >= 题库总人数，否则会出致命 bug：
 *    候选池是「玩家能在搜索框里选到的全部球员」。一旦答案落在被截断的那部分，
 *    玩家根本搜不到正确答案 —— 游戏无解，且违反 clue.js 的黄金不变量
 *    「筛选结果必含答案」（scripts/test-candidates.js 守着）。
 *    题库 200 人时 300 够用；扩到 500 人后被截掉 200，由 test-flow 的
 *    「下发条数正确」抓出。
 *    取 1000 是给未来继续扩池留余量，改题库时只要不超过 1000 就不用动这里。
 */
const MAX_POOL_SIZE = 1000;

// 线索字段渲染顺序，前后端必须一致
const CLUE_ORDER = [
  'nationality', 'club', 'league', 'position',
  'age', 'height', 'shirt_number', 'preferred_foot'
];

/**
 * 「反向猜球」（mode = 'reveal'）的线索揭晓顺序（2026-10-25 新玩法）：
 * 由宽到窄 —— 国籍 → 联赛 → 俱乐部 → 位置 → 年龄 → 身高 → 球衣号 → 惯用脚。
 * 系统逐条公布**答案自身**的属性，玩家随时可猜；揭晓越少就猜中，得分越高
 * （(9 - 已揭条数) × 100，与常规模式「越少步猜中分越高」同构）。
 * 每条揭晓的线索都是答案的精确值（客户端可以拿去做绿色筛选，不变量依旧成立）。
 */
const REVEAL_ORDER = [
  'nationality', 'league', 'club', 'position',
  'age', 'height', 'shirt_number', 'preferred_foot'
];

/**
 * 专题练习（2026-10-25）：按主题从答案池里切子集开局。
 *
 * 条件字段只用库里现成的（league / nationality / active / preferred_foot /
 * position_group / 出生年份），不新增数据字段。
 * ⚠️ 专题练习**不叠加难度档**（固定 fame>=3 全员池再切主题）：
 *    明星档(5星)再切"门将专场"只剩几个人，抽两局就重复，干脆不组合。
 * 客户端展示口径（label/顺序/人数）在 miniprogram/utils/themes.js，
 * 两份表由 test-flow.js 的「主题口径对拍」守着，改这里必须同步那边。
 */
const THEMES = {
  epl:       { label: '英超专场', league: '英超' },
  laliga:    { label: '西甲专场', league: '西甲' },
  seriea:    { label: '意甲专场', league: '意甲' },
  bundes:    { label: '德甲专场', league: '德甲' },
  legends:   { label: '退役传奇', active: false },
  lefty:     { label: '左脚将', foot: '左脚' },
  gk:        { label: '门将专场', group: 'GK' },
  fw:        { label: '前锋专场', group: 'FW' },
  brazil:    { label: '巴西球员', nationality: '巴西' },
  argentina: { label: '阿根廷球员', nationality: '阿根廷' },
  england:   { label: '英格兰球员', nationality: '英格兰' },
  genz:      { label: '00后新星', bornAfter: 1999 }
};

// 细分位置 -> 位置大类（黄色判定基准）
const POSITION_GROUP = {
  '门将': 'GK',
  '中后卫': 'DF', '左后卫': 'DF', '右后卫': 'DF', '清道夫': 'DF',
  '后腰': 'MF', '中前卫': 'MF', '前腰': 'MF', '左边前卫': 'MF', '右边前卫': 'MF',
  '中锋': 'FW', '影锋': 'FW', '左边锋': 'FW', '右边锋': 'FW'
};

// 三态
const STATE = { GREEN: 'green', AMBER: 'amber', GRAY: 'gray' };
// 数值箭头
const ARROW = { UP: 'up', DOWN: 'down', EQUAL: 'equal' };

// getPlayers 下发给客户端的字段白名单（控制包体）。
// fame_level 2026-10-25 加入：首页「按难度开球」要显示各档人数。
// position_group 2026-10-25 加入：首页「专题练习」要显示门将/前锋专场的人数。
const CLIENT_FIELDS = [
  'id', 'name_cn', 'name_en', 'aliases',
  'nationality', 'club', 'league', 'position', 'position_group',
  'birth_date', 'height_cm', 'preferred_foot', 'shirt_number',
  'pinyin', 'initials', 'active', 'fame_level',
  'primary_color', 'secondary_color'
];

// 结果页才下发的字段（不进 200 人候选包）
const DETAIL_FIELDS = [
  'id', 'name_cn', 'name_en', 'aliases',
  'nationality', 'nationality_code', 'club', 'club_en', 'league',
  'position', 'position_group', 'birth_date', 'height_cm',
  'preferred_foot', 'shirt_number',
  'active',
  'intro', 'fun_fact', 'meme',
  'primary_color', 'secondary_color'
];

const CODE = {
  OK: 0,
  INVALID_PARAM: 1001,
  GAME_NOT_FOUND: 1002,
  FORBIDDEN: 1003,
  GAME_FINISHED: 1004,
  DUPLICATE_GUESS: 1005,
  PLAYER_NOT_FOUND: 1006,
  POOL_EMPTY: 2001,
  INTERNAL: 9999
};

const CODE_MSG = {
  [CODE.INVALID_PARAM]: '操作有误',
  [CODE.GAME_NOT_FOUND]: '对局不存在',
  [CODE.FORBIDDEN]: '无权访问该对局',
  [CODE.GAME_FINISHED]: '本局已结束',
  [CODE.DUPLICATE_GUESS]: '已经猜过 TA 了',
  [CODE.PLAYER_NOT_FOUND]: '球员不在题库中',
  [CODE.POOL_EMPTY]: '题库维护中，稍后再来',
  [CODE.INTERNAL]: '出了点小问题，请重试'
};

module.exports = {
  MAX_GUESSES, AGE_TOL, HEIGHT_TOL, SHIRT_TOL,
  MIN_FAME, MIN_FAME_DAILY, MAX_POOL_SIZE,
  DIFFICULTIES, MIN_FAME_STAR, MIN_FAME_NORMAL,
  CLUE_ORDER, REVEAL_ORDER, POSITION_GROUP, STATE, ARROW,
  THEMES,
  CLIENT_FIELDS, DETAIL_FIELDS,
  CODE, CODE_MSG
};
