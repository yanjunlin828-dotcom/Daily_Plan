# 每日规划 Daily Plan

一个本地优先的每日任务与专注计时工具。它同时提供完整网页和 Windows 桌面悬浮球：平时停靠在屏幕边缘，需要时展开任务或计时面板，所有操作与原网页共享同一份 SQLite 数据。

## 桌面悬浮球演示

![Daily Plan 悬浮球、任务面板与完成动效](gifs/floating-orb.gif)

悬浮球会根据当前状态变化：空闲时显示今日完成进度，专注时显示经过时间，暂停时冻结节奏。它支持自由拖动、左右边缘吸附、闲置缩起和悬停恢复。

## 主要功能

### 悬浮球与快捷面板

- 系统级置顶的透明悬浮球，不占任务栏位置
- 外环显示今日任务完成率，内环显示当前一分钟的计时进度
- 拖到屏幕左右边缘自动吸附，离开后缩成侧边把手
- 单击展开快捷面板，支持固定面板、收起和打开完整网页
- 任务完成时显示勾选反馈，并平滑移动到自动展开的“已完成”区域
- 记住悬浮球位置；支持托盘显示、隐藏和退出

### 今日任务与 Todo

- 在浮窗内新增今日任务或 Todo，输入 `#标签` 可同时创建标签
- 点击任务标题直接改名，`Enter` 保存、`Esc` 取消
- 完成和恢复任务；已完成任务独立折叠
- 展示优先级、置顶、截止日期、时间段、标签和子任务进度
- Todo 与长期 Goal 保持独立，不会在浮窗保存时互相覆盖
- 操作先在界面即时反馈，再与后端同步；版本冲突时保留输入并提示重试

### 专注计时

- 从具体任务开始计时，或直接开始自由专注
- 开始、暂停、继续、结束并保存，以及确认后放弃
- 采用本地单调时钟平滑显示，不会因后台轮询出现两秒一跳
- 计时状态持久化，刷新页面或收起浮窗不会清零
- 结束后写入原有每日学习记录，并同步到网页的 Log 和热力图
- 完成正在计时的关联任务时，会先暂停计时再完成任务

### 完整网页

- 每日任务、长期 Goal 与 Todo 管理
- 标签筛选、时间段、子任务和当前任务高亮
- 从长期目标拖入每日任务
- 未完成任务延续到下一天
- 每日备忘录、目标备忘录和 WorkHard 标记
- 日历历史、学习记录和时段热力图

## 原有网页功能演示

| 长期目标拖入每日任务 | 目标日期与计时器 |
| --- | --- |
| ![拖拽目标](gifs/draw.gif) | ![目标日期与计时器](gifs/timer.gif) |

| 任务延续到第二天 | WorkHard 标注 |
| --- | --- |
| ![任务延续](gifs/carry.gif) | ![WorkHard 标注](gifs/work%20hard.gif) |

## 当前发布状态

目前仓库提供的是源码版本，还没有生成面向普通用户的 Windows 安装包。运行源码需要 Python 和 Node.js。个人数据库、运行日志和测试输出不会提交到 GitHub。

## 环境要求

- Windows 10/11
- Python 3.10 或更高版本
- Node.js 与 npm

## 安装源码版

```powershell
git clone https://github.com/yanjunlin828-dotcom/Daily_Plan.git
cd Daily_Plan
python -m pip install -r backend/requirements.txt
npm install
```

## 启动

### 一键启动

```powershell
python desktop/launch.py
```

启动器会静默启动本地 FastAPI 服务和 Electron 悬浮球；重复运行会复用已有服务和桌面实例。

### 安装桌面快捷方式与开机自启

在 PowerShell 中运行：

```powershell
powershell -ExecutionPolicy Bypass -File desktop/install-shortcuts.ps1
```

脚本会创建桌面“每日规划”快捷方式，并在当前 Windows 用户的启动目录中加入开机自启。取消自启时，按 `Win + R`，输入 `shell:startup`，删除其中的 `Daily Plan` 快捷方式即可。

### 分别启动后端和桌面端

终端一：

```powershell
python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
```

终端二：

```powershell
npm run desktop
```

完整网页地址为 [http://127.0.0.1:8000](http://127.0.0.1:8000)。

## 数据存储

源码版数据保存在 `backend/data.db`。首次启动会自动创建数据库；备份时先退出应用，再复制该文件即可。

计时器、任务、目标、备忘录和学习记录由 FastAPI 与 SQLite 统一保存。网页、悬浮球和快捷面板通过 revision 版本号协同写入，避免多个窗口静默覆盖数据。

## 验证

```powershell
python -m pytest tests/test_s2_backend.py tests/test_desktop_launcher.py -q
node --test tests/floating-clock.test.cjs
npm run desktop:smoke
```

自动检查覆盖共享数据写入、版本冲突、计时持久化、结束和放弃、启动器、平滑计时，以及浮窗的任务与计时交互。

## 项目结构

```text
backend/     FastAPI、SQLite 与启动脚本
desktop/     Electron 主进程、受限 IPC、启动器和桌面检查
floating/    悬浮球与快捷面板
shared/      网页与浮窗共用的 API 封装
style/       完整网页样式
tests/       后端、启动器与计时回归测试
gifs/        README 演示素材
```

## 后续发布计划

要提供无需 Python 和 Node.js 的普通用户安装包，还需要将后端打包为独立程序、把数据目录迁移到 `%APPDATA%`，并由 Electron 管理后端生命周期。之后可通过 Electron Forge 生成 Windows 安装程序，并上传到 GitHub Releases。
