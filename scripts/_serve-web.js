// 临时静态服务器：给浏览器实测网页版用（node scripts/_serve-web.js，Ctrl+C 关）
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
http.createServer((req, res) => {
  const p = decodeURIComponent((req.url || '/').split('?')[0]);
  const file = path.join(ROOT, p === '/' ? 'index.html' : p);
  fs.readFile(file, (e, buf) => {
    if (e) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(8741, '127.0.0.1', () => console.log('serving http://127.0.0.1:8741/'));
