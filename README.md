# 空战棋盘（Airplane Battle）

面向 iPhone Safari 的 10×10 空战棋盘游戏，支持：

- Cloudflare Workers + Durable Objects 两人联网对战
- 人机对战
- 同机双人轮流对战
- 每方 3 架或 4 架飞机
- 对战中分屏显示攻击棋盘和本方布局，标出对方的攻击位置
- 彩色圆角轮廓区分紧密相邻的飞机；布阵时点击格子即设为机头，默认朝下，并可顺/逆时针旋转后逐架确认
- 待确认飞机以虚化轮廓预览；越界或与已有飞机重叠时整机标红并禁止确认
- 本方飞机被击毁后整机灰显，并用高对比回合提示标明当前行动方
- 可在攻击棋盘上用虚化预览放置推测飞机，并可移动机头、旋转、确认、重新编辑或删除
- 战后公开双方布局及完整攻击历史

## 架构

- `public/`：静态前端，由 GitHub Pages 发布。
- `src/worker.js`：房间和回合逻辑，由 Cloudflare Worker 运行。
- Durable Object：每个 6 位房间号映射到一个独立对象，串行处理加入、布阵和攻击。

飞机布局只保存在 Durable Object 中。游戏进行期间，接口仅向玩家返回自己的布局、自己的攻击结果以及对方对自己的攻击记录；对手布局只在游戏结束后返回。每个玩家使用独立的高熵访问令牌恢复房间身份。

攻击棋盘上的推测飞机只存在当前设备的浏览器本地存储中，不会上传到 Worker，也不会同步给对手。

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
