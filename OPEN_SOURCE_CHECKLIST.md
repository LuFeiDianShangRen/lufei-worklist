# 开源发布检查清单

## 已完成

- 已排除 `node_modules`。
- 已排除 `release`。
- 已排除 `dist`。
- 已排除 `dist-electron`。
- 已排除 `.vscode`。
- 已添加 `README.md`。
- 已添加 `LICENSE`。
- 已添加 `.gitignore`。
- 已添加 `CONTRIBUTING.md`。
- 已添加 `SECURITY.md`。
- 已添加 `CHANGELOG.md`。

## 发布到 GitHub 前确认

- 确认仓库名。
- 确认 GitHub 账号或组织。
- 确认是否继续使用“路飞工作清单”作为公开名称。
- 确认 README 是否需要补充截图。
- 确认 Release 是否上传 `路飞工作清单免安装版 1.0.0.zip`。

## 建议发布步骤

```powershell
git init
git add .
git commit -m "Initial open source release"
git branch -M main
git remote add origin <你的 GitHub 仓库地址>
git push -u origin main
```
