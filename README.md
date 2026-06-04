# 路飞-强提醒会议任务清单

Strong Reminder Meeting Task List

路飞-强提醒会议任务清单是一款 Windows 桌面提醒工具。软件名称为“路飞工作清单”，支持添加会议、任务和待办事项，并在指定时间前通过置顶飘动提醒条进行提醒。

## 功能

- 添加、编辑、删除提醒事项
- 支持提前 `5 / 10 / 15 / 20 / 25 / 30 / 60 / 120` 分钟提醒
- 支持每日、每周、每月、每年和间隔重复
- 支持中国法定节假日、调休和工作日判断
- 支持开机启动
- 支持托盘后台运行
- 支持本地 JSON 导入和导出
- 支持完成任务并移动到已完成列表
- 支持标记任务为“进行中”，并用黄色状态集中显示
- 支持停用任务并移动到已停用列表
- 支持超时未完成任务红色显示
- 支持新建任务默认显示在列表最上方
- 支持“之前”列表，集中查看昨天及以前任务
- 支持同步滴答清单任务到本地提醒
- 支持网页版本；桌面版运行时，网页可同步读写同一份本地数据
- 支持多屏幕置顶飘动提醒条
- 点击“我马上去做”后，未完成任务会继续按间隔提醒
- 支持免安装版和安装包打包

## 系统要求

- Windows 10 或更高版本
- Node.js 22 或更高版本
- npm

## 开发运行

```powershell
npm install
npm run dev
```

## 下载

最新 Windows 免安装版：

- [strongremindermeetingtasklist-v1.0.9-windows-portable.zip](https://github.com/LuFeiDianShangRen/strongremindermeetingtasklist/releases/download/v1.0.9/strongremindermeetingtasklist-v1.0.9-windows-portable.zip)

全部版本：

- [GitHub Releases](https://github.com/LuFeiDianShangRen/strongremindermeetingtasklist/releases)

## 测试

```powershell
npm test
```

## 构建

```powershell
npm run build
```

## 生成免安装版

```powershell
npm run package:portable
```

生成结果：

```text
release/1.0.9/win-unpacked/路飞工作清单.exe
release/路飞工作清单免安装版 1.0.9.zip
```

## 生成安装包

```powershell
npm run package:installer
```

生成结果：

```text
release/路飞工作清单安装包 1.0.9.exe
```

## 数据存储

提醒数据保存在 Electron 的用户数据目录中，文件名为 `reminders.json`。软件提供 JSON 备份导入和导出功能。

本项目不包含账号系统、手机端、微信通知或邮件通知。滴答清单同步只用于把任务拉取到本地提醒。

## 系统限制

普通桌面应用无法覆盖以下场景：

- Windows 锁屏
- UAC 安全桌面
- 部分独占全屏游戏

这些限制属于 Windows 系统行为，不是本项目功能异常。

## 开源协议

本项目使用 [MIT License](./LICENSE)。
