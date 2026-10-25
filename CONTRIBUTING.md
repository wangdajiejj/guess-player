# 参与贡献

欢迎题库纠错、转会/号码更新、新玩法、界面改进——Fork 后提 PR 即可，无需事先打招呼
（大改动建议先开 Issue 对齐思路）。

## 三种运行方式

| 想干什么 | 怎么跑 |
| --- | --- |
| 只想玩网页版 | 下载 ZIP 解压，双击 `index.html`；或改 `web/` 后 `node scripts/build-web.js` 重新生成 |
| 想跑小程序 | 微信开发者工具导入项目根目录（当前为本地测试模式，无需云环境即可玩通全局） |
| 想部署自己的云版本 | 见 [README-启动.md](README-启动.md) 与 [docs/05-deployment.md](docs/05-deployment.md) |

## 数据流向（改题库必读）

```
database/roster_{a..h}.py     名册真源（Python 字典，按此校对数据）
        │ scripts/build-players.py
        ▼
database/players.full.jsonl   全量数据（548 人 × 27 字段）
        │ scripts/gen-mock-core.js
        ▼
miniprogram/utils/mock-*.js   小程序本地测试用引擎副本（不要手改）
        │ scripts/build-web.js
        ▼
index.html                    网页版单文件（生成物，不要手改）
```

- **改球员数据**：改 `roster_*.py`，跑 `scripts/build-players.py`（需要 Python），
  再跑 `node scripts/gen-mock-core.js` 和 `node scripts/build-web.js`。
- **改判定/开局/筛选逻辑**：真源在 `cloudfunctions/_shared/`（云函数侧）与
  `miniprogram/utils/clue.js`、`theme.js`（客户端推理）。`mock-*.js` 由脚本从
  `_shared/` 生成，**改它会被覆盖**。
- **改网页版界面**：改 `web/app.js` / `web/style.css`，然后 `node scripts/build-web.js`。

## 提 PR 前自查

```bash
node scripts/check-mp.js          # 小程序静态检查
node scripts/test-flow.js         # 对局流程 150 条（含难度/专题/反向）
node scripts/test-candidates.js   # 线索筛选 41 条（黄金不变量：筛完必含答案）
node scripts/test-mock.js         # 本地引擎 67 条
node scripts/build-web.js         # 重新生成网页版（改了引擎或题库时必须跑）
```

全部通过再提交。没有 Node 的话装一个 LTS 版即可（>=16）。

## 数据口径约定

- 转会/球衣号按**当赛季开季名单**为准，数据页脚的「数据校准日期」随之更新；
- 退役判定：无合同且未官宣退役的，按「退役口径」处理并在 PR 里说明依据；
- 每人 27 个字段的结构见 [docs/02-database.md](docs/02-database.md)，
  字段合法性由 `database/validate.py` 阻断式校验。

## 红线（PR 会被拒的原因）

1. `games.answerId` 不能出现在任何客户端下发路径里（判定必须留在服务端/引擎侧）；
2. 不能引入位图素材（头像程序化绘制、音效现场合成是刻意设计，见 PRD §7.1）；
3. 小程序提审包不允许携带 `mock-*.js`（`scripts/关闭本地测试-提审前必点.bat`），
   但**仓库里保留它们没问题**——网页版和小程序本地模式都靠它跑。
