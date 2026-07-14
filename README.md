# 本地抖音/星图任务统计网页

本项目是一个本地运行的网页工具，包含：

- `frontend`：React + Vite 页面，提供账号管理和任务视频列表。
- `backend`：Fastify + SQLite + Playwright，本地 API、登录态保存和数据采集。

## 当前实现范围

- 新增账号
- 为账号打开 Playwright Chromium 扫码登录
- 使用保存的会话执行一次手动同步
- 存储星图任务、抖音视频、自动/手工绑定关系
- 展示星图播放量、当前实际播放量、差值、视频状态、任务状态

## 安装

当前机器的 `node` 可用，但 `npm` 不在 `PATH`。如果你的环境已安装标准 Node.js，请先确保能直接执行 `npm`：

```powershell
npm install
npx playwright install chromium
```

如果仍然不能执行 `npm`，先安装标准版 Node.js，再回到项目目录执行上述命令。

## 启动

```powershell
npm run dev
```

或分别启动：

```powershell
npm run dev:backend
npm run dev:frontend
```

- 前端默认端口：`5173`
- 后端默认端口：`8787`

如果系统 `npm` 仍然不可用，直接运行根目录的 `run-local.cmd`。

## 说明

- 登录态保存在 `.local-data/sessions/<accountId>`。
- SQLite 数据库位于 `.local-data/app.db`。
- 首版采集逻辑基于浏览器页面启发式抽取，实际页面结构变动后可能需要补 selector。
- 手工绑定接口已提供，前端允许直接输入 `videoId` 绑定；如果需要更友好的候选视频选择，可在下一版补充。
