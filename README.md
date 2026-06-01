# 每日规划 Daily Plan

一个极简风格的本地日程管理工具，支持每日任务、长期目标、备忘录和计时器。

## 功能

- 每日任务管理，支持标签、时间段、子任务
- 长期目标 / Todo 列表，支持截止日期
- 内置倒计时计时器
- 每日备忘录
- 跨日期浏览，支持任务延续
- 数据全部存储在本地，不联网

## 环境要求

- Python 3.10 或更高版本
- Windows 系统（启动脚本为 `.vbs` / `.bat` 格式）

## 安装

**1. 克隆项目**

```bash
git clone https://github.com/你的用户名/daily_plan.git
cd daily_plan
```

**2. 安装 Python 依赖**

```bash
pip install -r backend/requirements.txt
```

## 启动

**方式一：双击快捷方式（推荐）**

右键 `backend/start_silent.vbs` → 发送到 → 桌面快捷方式，之后双击桌面图标即可。

- 首次启动会自动创建数据库文件 `backend/data.db`
- 再次双击时，若服务已在运行则直接打开浏览器
- 关闭浏览器不会停止后端，下次双击直接打开

**方式二：命令行启动**

```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000
```

然后在浏览器打开 [http://localhost:8000](http://localhost:8000)

## 数据存储

所有数据保存在 `backend/data.db`（SQLite 文件），首次启动自动生成。

备份数据只需复制这一个文件。
