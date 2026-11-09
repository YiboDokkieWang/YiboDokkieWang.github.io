# Publication Monitor

本目录包含个人网站发表成果的本地管理器、数据源查询、重复检测、Early Access升级检测和GitHub Actions入口。

## 本地验证

在仓库根目录运行：

```powershell
node publication-monitor/local-server.cjs
```

然后打开 `http://127.0.0.1:4190/`。

也可以双击仓库根目录的 `start-publication-manager.cmd`，它会同时启动个人网站预览和发表成果管理器。

本地界面只有一个智能输入框。可以直接粘贴题目、作者加题目、完整参考文献、DOI、BibTeX、IEEE链接或专利信息。程序会拆分题目、作者、期刊/会议、年份和标识符，并按综合相似度排列候选结果。

## 安全规则

- 测试数据带有 `fixture` 标记，核心程序拒绝将其写入正式网站。
- 真实数据只有在本地界面输入 `APPLY` 后才能写入。
- 写入前自动备份中英文 `publications.md`。
- API密钥只通过环境变量或GitHub Secrets提供。
- 通知邮箱不写入公开代码；正式环境使用GitHub账户通知或 `NOTIFICATION_EMAIL` Secret。
- GitHub手动工作流仅允许 `YiboDokkieWang` 运行。

## 可选环境变量

在本地可通过 `publication-monitor/.env.local` 自行管理，但不要提交该文件。当前版本使用以下环境变量：

- `IEEE_API_KEY`
- `SEMANTIC_SCHOLAR_API_KEY`
- `EPO_OPS_KEY`
- `EPO_OPS_SECRET`
- `NOTIFICATION_EMAIL`

未配置密钥时，DOI、Crossref、ORCID、BibTeX和模拟测试仍可使用。

## 命令行测试

```powershell
node publication-monitor/cli.cjs self-test
node publication-monitor/cli.cjs inventory
node publication-monitor/cli.cjs fixture --name new-journal
node publication-monitor/cli.cjs identify --type journal --input-kind doi --value 10.1109/TTE.2026.3684521
node publication-monitor/cli.cjs scan
```

除非明确加入 `--apply`，命令行识别与扫描不会修改网站内容。
