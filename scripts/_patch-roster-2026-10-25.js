/**
 * 2026-10-25 roster 源文件补丁（一次性脚本，跑完可删）
 *
 * 把 25 处 2026-27 赛季校准同步进 database/roster_{a..g}.py，
 * 随后由 build-players.py 重新生成 players.full.jsonl。
 * 所有改动均经 2026-10-25 web 检索核实（详见各条注释）。
 */
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'database');

// id -> { file, club?, ce?, lg?, sn? }
const PATCH = {
  // 加纳乔 → 切尔西 #49（2025 夏 £40m，最新确认号码 49）
  29:  { f: 'a', club: '切尔西', ce: 'Chelsea', lg: '英超', sn: 49 },
  // 弗拉霍维奇 → 贝西克塔斯（2026 自由转会，保留 9 号）
  41:  { f: 'a', club: '贝西克塔斯', ce: 'Besiktas', lg: '土超', sn: 9 },
  // 埃德森 → 费内巴切 #1（2025-08-31 成行）
  23:  { f: 'a', club: '费内巴切', ce: 'Fenerbahce', lg: '土超', sn: 1 },
  // 莱万多夫斯基 → 芝加哥火焰 #9（2026-06 自由转会，官方 9 号）
  51:  { f: 'b', club: '芝加哥火焰', ce: 'Chicago Fire', lg: '美职联', sn: 9 },
  // 亚马尔 2026-27 接巴萨 10 号（官方 9/2 名单）
  52:  { f: 'b', sn: 10 },
  // 穆西亚拉 2026-27 改穿拜仁 10 号
  71:  { f: 'b', sn: 10 },
  // 阿德耶米 → 巴塞罗那 #14（2026 官方名单）
  81:  { f: 'b', club: '巴塞罗那', ce: 'Barcelona', lg: '西甲', sn: 14 },
  // 多纳鲁马 → 曼城 #1（2025-09，Wikipedia 2026-27 名单 1 号）
  97:  { f: 'b', club: '曼城', ce: 'Manchester City', lg: '英超', sn: 1 },
  // 巴尔科拉 → 利物浦 #29（2026 官方 squad）
  98:  { f: 'b', club: '利物浦', ce: 'Liverpool', lg: '英超', sn: 29 },
  // 孙兴慜 → 洛杉矶FC #7（2025-08，MLS 纪录转会，官方 7 号）
  101: { f: 'c', club: '洛杉矶FC', ce: 'Los Angeles FC', lg: '美职联', sn: 7 },
  // 伊萨克 → 利物浦 #9（2025-09 £125m 英国纪录）
  106: { f: 'c', club: '利物浦', ce: 'Liverpool', lg: '英超', sn: 9 },
  // 布鲁诺·吉马良斯 → 阿森纳 #39（2026-27 官方名单）
  107: { f: 'c', club: '阿森纳', ce: 'Arsenal', lg: '英超', sn: 39 },
  // 戈登 → 巴塞罗那 #17（2026-05 €70m，官方 17 号）
  108: { f: 'c', club: '巴塞罗那', ce: 'Barcelona', lg: '西甲', sn: 17 },
  // 埃泽 → 阿森纳 #10（2025 夏，2026-27 官方 10 号）
  119: { f: 'c', club: '阿森纳', ce: 'Arsenal', lg: '英超', sn: 10 },
  // 特奥 → 利雅得新月（2025-07，三年合同，保留 19 号）
  352: { f: 'f', club: '利雅得新月', ce: 'Al Hilal', lg: '沙特联', sn: 19 },
  // 弗林蓬 → 利物浦 #30（2025 夏，BBC 确认 30 号）
  361: { f: 'f', club: '利物浦', ce: 'Liverpool', lg: '英超', sn: 30 },
  // 坎塞洛 → 巴塞罗那 #2（2026-27 官方名单）
  362: { f: 'f', club: '巴塞罗那', ce: 'Barcelona', lg: '西甲', sn: 2 },
  // 阿克 → 费内巴切（2026 夏，保留 6 号）
  372: { f: 'f', club: '费内巴切', ce: 'Fenerbahce', lg: '土超', sn: 6 },
  // 拉什福德 2026-27 留曼联改穿 9 号（官方 squad）
  381: { f: 'f', sn: 9 },
  // 塔 → 拜仁 #4（2025 夏自由转会，官方 4 号）
  391: { f: 'f', club: '拜仁慕尼黑', ce: 'Bayern Munich', lg: '德甲', sn: 4 },
  // 若昂·佩德罗 2026-27 改穿切尔西 9 号（官方 8/19 名单）
  473: { f: 'g', sn: 9 },
  // 赫伊森 2026-27 改穿皇马 4 号（官方 + beIN）
  477: { f: 'g', sn: 4 },
  // 奥纳纳 → 特拉布宗体育（2025-09 租借，保留 24 号）
  480: { f: 'g', club: '特拉布宗体育', ce: 'Trabzonspor', lg: '土超', sn: 24 },
  // 约克雷斯 → 阿森纳 #14（2025 夏，Footy Headlines 确认 14 号）
  481: { f: 'g', club: '阿森纳', ce: 'Arsenal', lg: '英超', sn: 14 },
  // 艾特-努里 → 曼城 #21（2025 夏，俱乐部官方 21 号）
  484: { f: 'g', club: '曼城', ce: 'Manchester City', lg: '英超', sn: 21 },
};

const byFile = {};
Object.keys(PATCH).forEach(id => {
  const p = PATCH[id];
  (byFile[p.f] = byFile[p.f] || []).push({ id: Number(id), ...p });
});

let total = 0;
for (const letter of Object.keys(byFile)) {
  const file = path.join(DIR, `roster_${letter}.py`);
  let src = fs.readFileSync(file, 'utf8');
  for (const patch of byFile[letter]) {
    // 定位该球员的 dict 块：从 "dict(id=NN," 起到块尾 "),"
    const startRe = new RegExp(`dict\\(id=${patch.id},`);
    const m = src.match(startRe);
    if (!m) { console.error(`!! roster_${letter} 里找不到 id=${patch.id}`); process.exit(1); }
    const start = m.index;
    const end = src.indexOf('),', start);
    if (end === -1) { console.error(`!! id=${patch.id} 块尾找不到`); process.exit(1); }
    let block = src.slice(start, end);
    const orig = block;
    if (patch.club) block = block.replace(/club='[^']*'/, `club='${patch.club}'`);
    if (patch.ce)    block = block.replace(/ce='[^']*'/, `ce='${patch.ce}'`);
    if (patch.lg)    block = block.replace(/lg='[^']*'/, `lg='${patch.lg}'`);
    if (patch.sn != null) block = block.replace(/sn=\d+/, `sn=${patch.sn}`);
    if (block === orig) { console.error(`!! id=${patch.id} 一个字段都没替换上`); process.exit(1); }
    src = src.slice(0, start) + block + src.slice(end);
    const cn = block.match(/cn='([^']*)'/);
    console.log(`[ok] roster_${letter} id=${patch.id} ${cn ? cn[1] : ''} -> ${[patch.club, patch.lg, patch.sn != null ? '#' + patch.sn : ''].filter(Boolean).join(' ')}`);
    total++;
  }
  fs.writeFileSync(file, src, 'utf8');
}
console.log(`DONE. ${total}/${Object.keys(PATCH).length} roster entries patched.`);
