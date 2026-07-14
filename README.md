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

## 在没有开发环境的 Windows 电脑上安装

适用于 Windows 10/11 64 位电脑。首次安装需要联网，但不需要安装 Git、Python、VS Code 或其他开发工具。

1. 在 GitHub 仓库页面选择 **Code > Download ZIP**，解压到本地文件夹。仓库为私有仓库，需要先登录有访问权限的 GitHub 账号。
2. 从 [Node.js 官网](https://nodejs.org/en/download) 安装 **Node.js 22 LTS** 的 Windows 安装包。安装时保持默认选项。
3. 打开解压后的项目文件夹，在地址栏输入 `powershell` 并按回车。执行以下命令确认 Node.js 可用：

   ```powershell
   node -v
   npm -v
   ```

4. 在同一 PowerShell 窗口执行首次安装：

   ```powershell
   npm ci
   npx playwright install chromium
   ```

   这会下载项目依赖和用于扫码登录、同步数据的 Chromium 浏览器。首次执行通常需要几分钟。

## 启动

安装完成后，双击根目录的 `run-local.cmd`。保持弹出的命令窗口开启，等待启动日志完成后，在浏览器打开：

```text
http://127.0.0.1:5173
```

也可以在项目目录的 PowerShell 中执行：

```powershell
npm run dev
```

- 前端默认端口：`5173`
- 后端默认端口：`8787`
- 关闭命令窗口或按 `Ctrl+C` 即可停止服务。

`run-local.cmd` 会优先使用项目目录中已有的本地 Node.js；在从 GitHub 下载的全新副本中，它会自动使用已安装的 Node.js 22 LTS。

## 常见问题

- 提示 `Node.js was not found`：重新安装 Node.js 22 LTS，然后关闭并重新打开命令窗口后再启动。
- `npx playwright install chromium` 下载失败：确认网络可访问后重新执行该命令。
- 浏览器无法打开页面：确认命令窗口仍在运行，并手动访问 `http://127.0.0.1:5173`。
- 首次启动会创建空的本地数据库和登录会话。需要保留既有数据时，离线复制 `.local-data` 目录；该目录包含账号数据和登录态，不能上传到 GitHub。

## 说明

- 登录态保存在 `.local-data/sessions/<accountId>`。
- SQLite 数据库位于 `.local-data/app.db`。
- 首版采集逻辑基于浏览器页面启发式抽取，实际页面结构变动后可能需要补 selector。
- 手工绑定接口已提供，前端允许直接输入 `videoId` 绑定；如果需要更友好的候选视频选择，可在下一版补充。
