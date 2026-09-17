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
- 右键悬浮球可打开原生菜单；也可以通过快捷面板右上角直接安全退出
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

仓库同时支持源码运行和 Windows 安装包构建。普通用户安装包内置桌面程序与本地后端，不需要另行安装 Python 或 Node.js。个人数据库、运行日志、测试输出和本机构建产物不会提交到 GitHub。

## 下载与安装（普通用户推荐）

安装包与源码分开发放：

| 内容 | 获取位置 | 适合人群 |
| --- | --- | --- |
| Windows 安装包 `DailyPlan-Setup-0.1.0.exe` | [GitHub Releases](https://github.com/yanjunlin828-dotcom/Daily_Plan/releases/latest) | 只想直接使用 Daily Plan 的 Windows 用户 |
| 原始代码 | 仓库首页的 `Code`，或 Release 中 GitHub 自动生成的 Source code | 需要查看、修改或自行构建项目的开发者 |

安装步骤：

1. 打开 [Releases 页面](https://github.com/yanjunlin828-dotcom/Daily_Plan/releases/latest)，展开 `Assets`。
2. 下载 `DailyPlan-Setup-0.1.0.exe`。不要把 `Source code (zip)` 当作安装包。
3. 如果旧版悬浮球正在运行，右键悬浮球选择“退出 Daily Plan”。
4. 双击安装程序一次并等待完成；不要连续重复启动安装程序。
5. 通过桌面或开始菜单中的 `Daily Plan` 快捷方式启动。应用已经运行时再次点击快捷方式，只会唤醒现有悬浮球。

当前安装包尚未购买 Windows 代码签名证书，因此 Windows 可能显示 SmartScreen 提示。请确认下载来源为本仓库 Release 后，再选择“更多信息”→“仍要运行”。安装包不要求管理员权限。

### 使用悬浮球

- 单击悬浮球：展开或收起快捷面板。
- 拖动悬浮球：调整位置；靠近左右边缘时会自动吸附。
- 右键悬浮球：显示、隐藏、打开完整网页或退出应用。
- 面板右上角电源按钮：安全退出悬浮球与内置后端。
- 打开完整网页：在浏览器中使用每日任务、Goal、Todo、备忘录、日志和热力图等完整功能。

### 数据、备份与卸载

- 用户数据：`%APPDATA%\Daily Plan\data.db`
- 运行日志：`%APPDATA%\Daily Plan\logs`
- 备份前请先退出 Daily Plan，再复制整个 `%APPDATA%\Daily Plan` 文件夹。
- 卸载可通过 Windows“设置 → 应用 → 已安装的应用”完成。
- 普通卸载不会把源码仓库作为数据目录；重新安装或升级时仍会继续使用原有 AppData 数据。若要彻底清除个人数据，请在确认不再需要备份后手动删除 `%APPDATA%\Daily Plan`。

## 环境要求

- Windows 10/11
- Python 3.10 或更高版本
- Node.js 与 npm

## 安装源码版（开发者）

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

启动器会打开 Electron 悬浮球；Electron 会在空闲动态端口启动并管理内置 FastAPI 服务，退出应用时同步关闭该服务。重复运行会复用兼容的已有服务和桌面实例。

源码快捷方式与安装版统一使用 `%APPDATA%\Daily Plan` 作为单实例域。应用已经运行时再次点击快捷方式，只会唤醒现有悬浮球，不会创建第二个悬浮球或第二套后端。

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

通过 `python desktop/launch.py` 启动桌面版时，数据保存在 `%APPDATA%\Daily Plan\data.db`，日志保存在 `%APPDATA%\Daily Plan\logs`。第一次使用新的数据目录时，启动器会将已有的 `backend/data.db` 一致性复制过去；旧数据库不会被移动、覆盖或删除。

直接运行 Uvicorn 的源码开发模式仍使用 `backend/data.db`。也可以通过 `DAILY_PLAN_DATA_DIR` 或 `DAILY_PLAN_DB_PATH` 环境变量指定测试、便携开发所需的数据位置。备份时请先从托盘退出应用，再复制数据库文件。

计时器、任务、目标、备忘录和学习记录由 FastAPI 与 SQLite 统一保存。网页、悬浮球和快捷面板通过 revision 版本号协同写入，避免多个窗口静默覆盖数据。

## 验证

```powershell
python -m pytest tests/test_s2_backend.py tests/test_desktop_launcher.py tests/test_backend_server.py -q
node --test tests/floating-clock.test.cjs
npm run backend:manager:test
npm run desktop:smoke
npm run desktop:native-smoke
npm run desktop:singleton-smoke
```

## 构建独立后端

生成无需用户安装 Python 的后端目录：

```powershell
npm run backend:build
npm run backend:smoke
```

构建脚本会在 `.tmp/backend-build-venv` 创建隔离环境并安装锁定版本的构建依赖，避免把开发电脑中无关的 Python 包带进发布文件。

产物位于 `output/backend-dist/daily-plan-backend/`。可以用独立临时数据目录启动验证：

```powershell
output/backend-dist/daily-plan-backend/daily-plan-backend.exe --data-dir .tmp/backend-data --port 8000
```

构建产物内包含完整网页资源，不包含 `backend/data.db`、日志或任何个人数据。Electron 会优先使用这个后端目录，在动态本地端口启动服务、等待健康检查通过，并在异常退出时尝试自动恢复。

## 构建 Windows 安装包

在 Windows x64 环境运行：

```powershell
npm run make
```

命令会重新构建独立后端、打包 Electron、检查发布内容，再生成：

- `output/forge/make/squirrel.windows/x64/DailyPlan-Setup-0.1.0.exe`：普通用户双击安装
- `output/forge/make/squirrel.windows/x64/*-full.nupkg`：Squirrel 升级包
- `output/forge/make/squirrel.windows/x64/RELEASES`：升级版本索引
- `output/forge/make/squirrel.windows/x64/release-manifest.json`：文件大小和 SHA-256 校验值

发布检查会拒绝包含 `data.db`、数据库 WAL、日志、环境变量文件或 Python 缓存的应用包。当前生成的是未签名安装包；公开发布前建议配置 Windows 代码签名，否则部分电脑可能显示 SmartScreen 提示。

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

独立后端、AppData 数据迁移、Electron 生命周期管理、Windows 安装包构建和 GitHub Release 发布流程已经完成。后续工作是配置 GitHub Actions 自动构建、在更多干净 Windows 环境验证安装与升级，并按需要接入 Windows 代码签名。
