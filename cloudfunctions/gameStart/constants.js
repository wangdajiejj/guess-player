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

// getPlayers 下发给客户端的字段白名单（控制包体）
const CLIENT_FIELDS = [
  'id', 'name_cn', 'name_en', 'aliases',
  'nationality', 'club', 'league', 'position',
  'birth_date', 'height_cm', 'preferred_foot', 'shirt_number',
  'pinyin', 'initials', 'active',
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
  CLUE_ORDER, POSITION_GROUP, STATE, ARROW,
  CLIENT_FIELDS, DETAIL_FIELDS,
  CODE, CODE_MSG
};
