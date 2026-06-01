# 贡献指南

感谢你愿意参与路飞工作清单。

## 开发流程

1. Fork 本仓库。
2. 创建功能分支。
3. 修改代码。
4. 执行测试和构建。
5. 提交 Pull Request。

## 本地验证

```powershell
npm install
npm test
npm run build
```

## 代码要求

- 保持改动聚焦。
- 不提交 `node_modules`、`release`、`dist`、`dist-electron`。
- 不提交个人数据、密钥、日志和本地备份文件。
- 修改提醒计算、重复规则、导入导出或桌面行为时，需要补充或更新测试。

## 问题反馈

提交 Issue 时请说明：

- 操作系统版本
- 软件版本
- 复现步骤
- 期望结果
- 实际结果
- 相关截图或错误信息
