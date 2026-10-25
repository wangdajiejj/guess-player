const fs = require('fs');
const path = require('path');
const ALL = fs.readFileSync(path.join(__dirname, '..', 'database', 'players.full.jsonl'), 'utf8')
  .split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
const cnt = k => new Set(ALL.map(p => p[k]).filter(Boolean)).size;
console.log(JSON.stringify({
  total: ALL.length,
  active: ALL.filter(p => p.active !== false).length,
  retired: ALL.filter(p => p.active === false).length,
  nationalities: cnt('nationality'),
  clubs: cnt('club'),
  leagues: cnt('league'),
  fame5: ALL.filter(p => p.fame_level === 5).length,
  fame4: ALL.filter(p => p.fame_level >= 4).length
}, null, 1));
