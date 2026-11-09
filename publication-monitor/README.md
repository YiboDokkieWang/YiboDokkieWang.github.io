# Publication Monitor

本目录包含个人网站发表成果的本地管理器、论文与专利数据源查询、重复检测、Early Access/授权版本升级检测和GitHub Actions入口。

## 自动扫描与邮件确认

- 每月自动扫描和 GitHub Actions 页面中的手动 `scan` 使用完全相同的程序。手动 `scan` 就是对月度任务的一次即时演练。
- 发现新增论文、相关专利或正式版本更新时，工作流只创建 Pull Request，不直接发布。
- Pull Request 会请求 `YiboDokkieWang` 审核；是否收到邮件取决于 GitHub 账户的通知设置。邮件中的链接会进入需要登录的 GitHub 确认页面。
- 检查 `Files changed` 后点击 `Merge pull request`，GitHub Pages 才会自动更新公开网站。
- 月度扫描没有发现新成果时不会创建 Pull Request，也不会发送“有新成果”的通知。
- 手动 `scan` 还会把完整报告写入 `Publication Monitor Reports` Issue，便于核对哪些成果已存在、哪些缺失。

不使用“邮件中的免登录确认链接”，因为转发或泄露该链接会允许他人修改网站。确认操作始终受 GitHub 账户登录保护。

## 专利扫描与同名筛选

- ORCID 中的专利记录会与论文一起读取。
- 配置 EPO OPS 后，系统还会按发明人/申请人姓名检索专利数据库。
- 候选专利必须先匹配 `Yibo Wang / Wang Yibo / 王艺博` 等姓名，再根据题目、摘要、IPC/CPC 分类、已知合作者和单位判断是否属于电力电子、光伏、储能、电池、微电网、电能质量等研究方向。
- 无关领域的同名专利会静默过滤，不会进入网站更新 Pull Request；同族专利优先保留授权版本和中国版本。
- 筛选规则保存在 `publication-monitor/config.json` 的 `patentSearch` 中，可以继续补充关键词、合作者、单位与分类号。

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

`EPO_OPS_KEY` 和 `EPO_OPS_SECRET` 需要在 EPO Developer Portal 创建应用后，添加到仓库的 `Settings > Secrets and variables > Actions`。密钥未配置时会跳过 EPO 独立专利检索，但 DOI、Crossref、ORCID、BibTeX 和测试数据仍可使用。

## 命令行测试

```powershell
node publication-monitor/cli.cjs self-test
node publication-monitor/cli.cjs inventory
node publication-monitor/cli.cjs fixture --name new-journal
node publication-monitor/cli.cjs identify --type journal --input-kind doi --value 10.1109/TTE.2026.3684521
node publication-monitor/cli.cjs scan
```

除非明确加入 `--apply`，命令行识别与扫描不会修改网站内容。
