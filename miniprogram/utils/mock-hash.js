/**
 * ⚠️⚠️⚠️ 本地 Mock 专用 —— 严禁在正式包里启用 ⚠️⚠️⚠️
 *
 * 微信小程序里没有 node 的 crypto 模块，而 cloudfunctions/_shared/util.js
 * 用到了它做抽样（sha256 + 随机数）。与其把抽样逻辑手抄一遍，
 * 不如在这里把 crypto 用到的三个 API 补齐，让 util.js 能被原样搬到客户端，
 * 继续维持「_shared/ 是单一真源」这条规矩。
 *
 * 用到它的代码会被打进前端包，等于把答案推到客户端附近的最后一步，
 * 所以只在 USE_MOCK = true 时被加载（见 app.js）。
 * 提审 / 上线前必须关掉 Mock 并删掉本文件。
 */

/* ---------------- SHA-256（纯 ES5 实现，无依赖） ---------------- */

var K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

/**
 * 字符串 -> UTF-8 字节数组。
 * 不能直接 charCodeAt 取低 8 位：中文会被截断，
 * 而每日答案的种子里将来有可能掺汉字。
 */
function utf8Bytes(str) {
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}

/**
 * @param {string} msg
 * @return {string} 64 位小写十六进制
 */
function sha256(msg) {
  var bytes = utf8Bytes(String(msg));
  var bitLen = bytes.length * 8;

  // 补位：先加一个 0x80，再补 0 直到长度 ≡ 56 (mod 64)
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);

  // 末尾追加 8 字节大端长度。输入不可能超过 2^32 位，
  // 但拆成高/低 32 位写一次，顺手省掉精度隐患。
  var hi = Math.floor(bitLen / 0x100000000);
  var lo = bitLen >>> 0;
  bytes.push(
    (hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
    (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff
  );

  var h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];
  var w = new Array(64);

  for (var off = 0; off < bytes.length; off += 64) {
    for (var t = 0; t < 16; t++) {
      var j = off + t * 4;
      w[t] = ((bytes[j] << 24) | (bytes[j + 1] << 16) |
              (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (var t2 = 16; t2 < 64; t2++) {
      var s0 = rotr(w[t2 - 15], 7) ^ rotr(w[t2 - 15], 18) ^ (w[t2 - 15] >>> 3);
      var s1 = rotr(w[t2 - 2], 17) ^ rotr(w[t2 - 2], 19) ^ (w[t2 - 2] >>> 10);
      w[t2] = (w[t2 - 16] + s0 + w[t2 - 7] + s1) >>> 0;
    }

    var a = h[0], b = h[1], c = h[2], d = h[3];
    var e = h[4], f = h[5], g = h[6], hh = h[7];

    for (var t3 = 0; t3 < 64; t3++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      var ch = (e & f) ^ (~e & g);
      var temp1 = (hh + S1 + ch + K[t3] + w[t3]) >>> 0;
      // ⚠️ Σ0 是 ROTR^2 ⊕ ROTR^13 ⊕ ROTR^22 —— 最后一位是 22 不是 15（15/25 是 Σ1 的三个数）。
      //    写错它不会报错，只会静默产出完全不同的哈希，务必别手改这几行。
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (S0 + maj) >>> 0;

      hh = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }

  var out = '';
  for (var i2 = 0; i2 < 8; i2++) {
    var s = h[i2].toString(16);
    while (s.length < 8) s = '0' + s;   // 不用 padStart，兼容老基础库
    out += s;
  }
  return out;
}

/* ---------------- crypto 模块的子集 ---------------- */

/** crypto.createHash('sha256') —— 只支持 sha256，够用即可 */
function createHash(alg) {
  if (String(alg).toLowerCase() !== 'sha256') {
    throw new Error('mock-hash 只实现了 sha256，收到：' + alg);
  }
  var buf = '';
  return {
    update: function (data) {
      // Encoding 参数忽略：本项目一律传字符串，不像 node 那样区分 buffer 拼接顺序
      buf += String(data);
      return this;
    },
    digest: function () {
      // node 的 digest(encoding) 还支持 base64/latin1，这里用不上，一律输出 hex
      return sha256(buf);
    }
  };
}

/** crypto.randomInt(min, max) —— 取 [min, max) */
function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min));
}

/** crypto.randomBytes(n) —— 只实现 .toString('hex') */
function randomBytes(n) {
  var hex = '';
  for (var i = 0; i < n; i++) {
    var v = Math.floor(Math.random() * 256).toString(16);
    hex += v.length < 2 ? '0' + v : v;
  }
  return { toString: function () { return hex; } };
}

module.exports = { createHash, randomInt, randomBytes, sha256 };
