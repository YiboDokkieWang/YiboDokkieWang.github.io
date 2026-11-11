# Publication Monitor

本目录包含个人网站发表成果的本地管理器、论文与专利数据源查询、重复检测、Early Access/授权版本升级检测和GitHub Actions入口。

## 自动扫描与邮件确认

- 每月自动扫描和 GitHub Actions 页面中的手动 `scan` 使用完全相同的程序。手动 `scan` 就是对月度任务的一次即时演练。
- 发现新增论文、相关专利或正式版本更新时，工作流创建一个分配给 `YiboDokkieWang` 的 GitHub 勾选确认页；是否收到邮件取决于 GitHub 账户的通知设置。
- 邮件会给待确认成果编号。可以直接回复邮件一行 `确认：1,2,5`，也可以点击邮件中的链接进入 GitHub 勾选；邮件正文中的复选框本身不能点击。
- 邮件回复或确认页只选择属于自己的成果。GitHub确认页分为两步：第1步勾选成果，第2步勾选页面最下方唯一的“确定并提交”复选框；第2步勾选后立即提交，不需要再点击按钮。
- 确认工作流只接受 GitHub 操作者 `YiboDokkieWang` 的操作；其他访客不能触发网站更新。
- 月度扫描没有发现新成果时不会创建 Pull Request，也不会发送“有新成果”的通知。
- 手动 `scan` 无论是否发现新增成果，都会创建一次带直达链接的扫描结果页并发送GitHub通知；完整报告也保存在 workflow summary 中。
- 扫描报告、Pull Request 和邮件通知保留成果的原始语言：中文论文或专利显示中文，英文成果显示英文。只有确认更新网站时，程序才分别生成中文页和英文页所需的条目。

不使用“邮件中的免登录确认链接”或邮件内表单，因为转发、伪造或邮件客户端兼容性会带来安全问题。确认操作始终受 GitHub 账户登录保护。

## 专利扫描与同名筛选

- ORCID 中的专利记录会与论文一起读取。
- 默认使用无需密钥的 Google Patents 公开检索按中文发明人姓名导出候选专利，同时覆盖公开/实审阶段的 `A` 类申请和 `B/C/U` 类授权版本。
- Google Patents 返回 `429` 或临时服务器错误时会按照 `Retry-After` 响应头或递增间隔延迟重试。
- 每次实时专利检索成功后，会把通过姓名和研究方向筛选的结果保存到 `publication-monitor/cache/patents.json`。临时限流时使用最近一次成功缓存，并在报告中明确标记缓存时间。
- GitHub手动运行时可选择一次性的 `scan-with-known-patent`，它会加入已确认专利 `CN117907843B`，用于验证专利识别、查重、邮件和报告链路，保证该次测试至少显示一件真实专利。该验证项不会被误报为新专利。
- 正常手动 `scan` 和每月自动扫描不会加入已知专利验证项，只显示数据源实际返回的结果。
- 如果一次性验证扫描中Google Patents按姓名检索失败，系统仍显示已知专利验证结果，但会明确警告“新专利发现检索未完成”，不会把已知专利验证等同于完整扫描。
- EPO OPS 和 Lens 不参与当前自动扫描。
- 候选专利必须先匹配 `Yibo Wang / Wang Yibo / 王艺博` 等姓名，再根据题目、摘要、IPC/CPC 分类、已知合作者和单位判断是否属于电力电子、光伏、储能、电池、微电网、电能质量等研究方向。
- 无关领域的同名专利会静默过滤，不会进入网站更新 Pull Request；同族专利优先保留授权版本和中国版本。
- 尚未公开的专利申请不可能从公共数据库发现；进入实审且已经公开的申请可以被检索。
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
- `NOTIFICATION_EMAIL`

## 命令行测试

```powershell
node publication-monitor/cli.cjs self-test
node publication-monitor/cli.cjs inventory
node publication-monitor/cli.cjs fixture --name new-journal
node publication-monitor/cli.cjs identify --type journal --input-kind doi --value 10.1109/TTE.2026.3684521
node publication-monitor/cli.cjs scan
```

除非明确加入 `--apply`，命令行识别与扫描不会修改网站内容。
