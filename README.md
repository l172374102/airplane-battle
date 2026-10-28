# 空战棋盘（Airplane Battle）

面向 iPhone Safari 的 10×10 空战棋盘游戏，支持：

- Cloudflare Workers + Durable Objects 两人联网对战
- 人机对战
- 同机双人轮流对战
- 每方 3 架或 4 架飞机
- 战后公开双方布局及完整攻击历史

## 架构

- `public/`：静态前端，由 GitHub Pages 发布。
- `src/worker.js`：房间和回合逻辑，由 Cloudflare Worker 运行。
- Durable Object：每个 6 位房间号映射到一个独立对象，串行处理加入、布阵和攻击。

飞机布局只保存在 Durable Object 中。游戏进行期间，接口仅向玩家返回自己的布局、自己的攻击结果以及对方对自己的攻击记录；对手布局只在游戏结束后返回。每个玩家使用独立的高熵访问令牌恢复房间身份。

## 玩法

- A–J 列，1–10 行；飞机为 1–5–1–3 结构，可向四个方向旋转。
- 机头中弹为击毁，机身中弹为命中，空格为未击中。
- 所有机头被击毁即获胜。

## 本地验证

```bash
npm test
npx wrangler dev
```

## 部署

1. `npx wrangler login` 后运行 `npx wrangler deploy`。
2. 将仓库推送到 GitHub，并通过 Actions 发布 `public/`。

正式前端地址：<https://l172374102.github.io/airplane-battle/>

正式后端地址：<https://airplane-battle-online.airplane-battle.workers.dev>
