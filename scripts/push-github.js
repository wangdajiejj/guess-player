#!/usr/bin/env node
/**
 * 把本地仓库推到 GitHub —— 对应 scripts\推送到GitHub.bat
 *
 * ⚠️ PAT 为什么不写进 remote：
 *    `git remote set-url origin https://user:token@github.com/...` 会把 token 明文
 *    写进 .git/config，删不掉，还可能跟着仓库目录一起被打包分享出去。
 *    这里只在 push 那一条命令里用一次带 token 的地址，remote 里始终留干净地址，
 *    token 用完即弃，不落任何文件。
 *
 * 前置条件（都是网页上点几下的事，各 1 分钟）：
 *   1) https://github.com/new 建空仓库：Name = guess-player、Public、
 *      **什么初始化选项都别勾**（不要 README / .gitignore / LICENSE，本地已经有了）
 *   2) https://github.com/settings/tokens → Generate new token (classic)
 *      → 勾选 repo → 生成后复制那串 ghp_ 开头的值
 */
const { execFileSync } = require('child_process');
const readline = require('readline');

const DEFAULT_USER = 'wangdajiejj';
const REPO = 'guess-player';

/** 直接把 git 的输出透给用户（push 进度条要能看见） */
function git(...args) {
  return execFileSync('git', args, { stdio: 'inherit' });
}

function gitOut(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/**
 * 读一行。stdin 被关掉（比如被管道喂进来、或用户直接关窗）时也要有交代 ——
 * 否则 Promise 永远挂着，进程一声不吭就退了。
 */
const ask = (rl, q) => new Promise(resolve => {
  let answered = false;
  rl.question(q, v => { answered = true; resolve(v); });
  rl.once('close', () => { if (!answered) resolve(''); });
});

(async () => {
  console.log('');
  console.log('============================================================');
  console.log('  推送 guess-player 到 GitHub');
  console.log('============================================================');
  console.log('');
  console.log('  开始前确认两件事都做完了：');
  console.log('    1) 已在 https://github.com/new 建好空仓库 guess-player（Public，不勾选任何初始化）');
  console.log('    2) 已生成 PAT：https://github.com/settings/tokens → classic → 勾选 repo');
  console.log('');
  console.log('  还没做的话现在去做，做完回来继续。');
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const userInput = (await ask(rl, `  GitHub 用户名（直接回车用 ${DEFAULT_USER}）: `)).trim();
  const user = userInput || DEFAULT_USER;
  const token = (await ask(rl, '  粘贴刚才生成的 PAT（只用于这一次 push，不写进任何文件）: ')).trim();
  rl.close();

  if (!token) {
    console.log('\n  没有拿到 PAT，已取消。什么都不用改，下次再跑这个脚本就行。\n');
    // 用 exitCode 而不是 process.exit()：后者会截断还没 flush 出去的 stdout，
    // 表现就是这句提示根本没显示出来。
    process.exitCode = 1;
    return;
  }

  console.log('');

  /* 分支统一到 main（GitHub 现在的默认分支名） */
  const branch = gitOut('branch', '--show-current');
  if (branch !== 'main') {
    console.log(`  分支 ${branch} -> main`);
    git('branch', '-M', 'main');
  }

  /* remote 里放干净地址 */
  const clean = `https://github.com/${user}/${REPO}.git`;
  try { git('remote', 'remove', 'origin'); } catch (e) { /* 本来就没有 */ }
  git('remote', 'add', 'origin', clean);
  console.log(`  remote origin = ${clean}`);
  console.log('');

  /* 这一次 push 才带上 token。
   *
   * ⚠️ 千万别加 -u：git 会把「分支追踪的 remote」直接存成这一整串带 token 的 URL，
   *    写进 .git/config（branch.main.remote），于是 token 就落盘了 ——
   *    正是文件头那段注释里要避免的事。实测踩过一次。
   *    正确做法是：不带 -u 推，推完再把上游指回干净的 origin。 */
  const withToken = `https://${user}:${encodeURIComponent(token)}@github.com/${user}/${REPO}.git`;
  try {
    git('push', withToken, 'main');
  } catch (e) {
    console.log('');
    console.log('  -----------------------------------------------');
    console.log('  推送失败。最常见三种原因：');
    console.log('    · 仓库还没建（提示 repository not found / 404）');
    console.log('      -> 去 https://github.com/new 建一个空的 guess-player，Public，别勾初始化');
    console.log('    · PAT 没勾 repo 权限，或粘的时候粘少了字符');
    console.log('    · 仓库名 / 用户名填错（要和网页上的完全一致）');
    console.log('  -----------------------------------------------');
    console.log('');
    process.exitCode = 1;
    return;
  }

  /* 把上游指回干净的 origin（不带 token 的那个） */
  git('remote', 'set-branches', 'origin', 'main');
  try { git('branch', '--set-upstream-to=origin/main', 'main'); } catch (e) { /* 首次可能已设好 */ }

  /* 兜底自检：.git/config 里绝不能出现 token */
  try {
    const cfg = gitOut('config', '--local', '--list');
    if (/gh[pousr]_/.test(cfg)) {
      console.log('  -----------------------------------------------');
      console.log('  ⚠️ token 被写进了 .git/config，正在清理…');
      console.log('  -----------------------------------------------');
      git('config', '--local', '--unset-all', 'branch.main.remote');
      git('config', '--local', 'branch.main.remote', 'origin');
      git('config', '--local', 'branch.main.merge', 'refs/heads/main');
    }
  } catch (e) { /* 读不到就算了 */ }

  console.log('');
  console.log('============================================================');
  console.log(`  成功！打开看：https://github.com/${user}/${REPO}`);
  console.log('============================================================');
  console.log('');
  console.log('  以后再推新改动：git push（会再问一次 PAT，也可以去装个 GitHub Desktop 免输）');
  console.log('');
  console.log('  若报 schannel: CRYPT_E_NO_REVOCATION_CHECK，见 README-启动.md 的排障表：');
  console.log('    git config --local http.sslBackend schannel');
  console.log('    git config --local http.schannelCheckRevoke false');
  console.log('');
})();
