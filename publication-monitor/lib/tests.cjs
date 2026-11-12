const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  EN_PUBLICATIONS,
  buildEntry,
  compareRecord,
  inventory,
  loadConfig,
  loadFixture,
  parsePublicationMarkdown,
  planRecord,
} = require('./core.cjs')
const { enrichAnalysisFromCandidate, parseSmartInput, rankCandidates, recordMatchesExcludedOrganization, requirePatentResults } = require('./sources.cjs')
const {
  assessPatentRelevance,
  deduplicatePatentFamilies,
  normalizeChineseApplicationNumber,
  parseCnipaPublicResults,
  parseGooglePatentCsv,
  parseGooglePatentHtml,
  parseGooglePatentResults,
  romanizeChineseName,
  verifiedPatentRecord,
} = require('./patents.cjs')
const { parseApprovalEmailReply, parseApprovalIssue, renderApprovalIssue, renderApprovalNotification } = require('./approval.cjs')
const { loadPatentCache, savePatentCache } = require('./patent-cache.cjs')

function runSelfTests() {
  const results = []
  function test(name, fn) {
    try {
      fn()
      results.push({ name, ok: true })
    } catch (error) {
      results.push({ name, ok: false, error: error.message })
    }
  }

  test('读取现有论文、会议和专利', () => {
    const current = inventory()
    assert(current.journal >= 5)
    assert(current.conference >= 1)
    assert(current.patent >= 1)
  })

  test('识别现有会议论文，避免重复', () => {
    const existing = parsePublicationMarkdown(fs.readFileSync(EN_PUBLICATIONS, 'utf8'))
    const record = {
      type: 'conference',
      title: 'Reliability-Oriented Adaptive Control Strategy for Fusion Parallel Voltage Source Converter Topology',
      authors: ['Qiaohan Su', 'Yibo Wang', 'Qiang Yi', 'Man-Chung Wong'],
      year: 2025,
      ieeeDocumentId: '11401175',
    }
    assert.strictEqual(compareRecord(record, existing).status, 'existing')
  })

  test('测试用新期刊论文不会被误判为已有', () => {
    const plan = planRecord(loadFixture('new-journal'))
    assert.strictEqual(plan.comparison.status, 'new')
    assert(plan.entryEn.includes('<strong>Yibo Wang</strong>'))
  })

  test('测试用会议论文进入会议格式', () => {
    const record = loadFixture('new-conference')
    assert(buildEntry(record, 'en').includes(`in *${record.venue}*`))
  })

  test('测试用专利生成中英文格式', () => {
    const record = loadFixture('new-patent')
    assert(buildEntry(record, 'en').includes('Chinese Patent'))
    assert(buildEntry(record, 'zh').includes('中国专利'))
  })

  test('Early Access正式版本匹配并升级', () => {
    const scenario = loadFixture('early-access-final')
    const existing = [{ ...scenario.earlyAccess, raw: buildEntry(scenario.earlyAccess, 'en') }]
    const match = compareRecord(scenario.final, existing)
    assert.strictEqual(match.status, 'upgrade')
  })

  test('测试数据带写入保护标记', () => {
    for (const name of ['new-journal', 'new-conference', 'new-patent']) assert.strictEqual(loadFixture(name).fixture, true)
  })

  test('智能输入可拆分题目、作者、期刊和年份', () => {
    const analysis = parseSmartInput('Kai Yang, Yibo Wang, and Xinbo Ruan, "Hierarchical Power Flow Control Strategy for Railway System," IEEE Transactions on Transportation Electrification, vol. 12, 2026.')
    assert.strictEqual(analysis.kind, 'bibliographic')
    assert.strictEqual(analysis.title, 'Hierarchical Power Flow Control Strategy for Railway System')
    assert(analysis.authors.includes('Yibo Wang'))
    assert.strictEqual(analysis.venue, 'IEEE Transactions on Transportation Electrification')
    assert.strictEqual(analysis.year, 2026)
  })

  test('候选论文按题目、作者、期刊和年份综合相似度排序', () => {
    const analysis = parseSmartInput('Yibo Wang, "Test Paper for Publication Monitor," Journal of Automated Academic Profiles, 2027.')
    const ranked = rankCandidates([
      { title: 'A Different Study', authors: ['Other Author'], venue: 'Other Journal', year: 2024 },
      { title: 'Test Paper for Publication Monitor', authors: ['Yibo Wang'], venue: 'Journal of Automated Academic Profiles', year: 2027 },
    ], analysis)
    assert.strictEqual(ranked[0].title, 'Test Paper for Publication Monitor')
    assert(ranked[0].matchScore > ranked[1].matchScore)
  })

  test('无标准格式的作者加题目可根据候选结果重新拆分', () => {
    const analysis = parseSmartInput('Yibo Wang Test Paper for Publication Monitor')
    const enriched = enrichAnalysisFromCandidate(analysis, {
      title: 'Test Paper for Publication Monitor',
      authors: ['Yibo Wang', 'Test Author'],
      venue: 'Test Journal',
      year: 2027,
    })
    assert.strictEqual(enriched.title, 'Test Paper for Publication Monitor')
    assert.deepStrictEqual(enriched.authors, ['Yibo Wang'])
  })

  test('同名专利只保留与研究方向相关的候选', () => {
    const profile = loadConfig().patentSearch
    const relevant = assessPatentRelevance(loadFixture('patent-relevant-same-name'), profile)
    const irrelevant = assessPatentRelevance(loadFixture('patent-irrelevant-same-name'), profile)
    assert.strictEqual(relevant.relevant, true)
    assert.strictEqual(irrelevant.relevant, false)
    assert(relevant.score > irrelevant.score)
  })

  test('研究方向相关但发明人不同的专利不会推送', () => {
    const profile = loadConfig().patentSearch
    const record = { ...loadFixture('patent-relevant-same-name'), authors: ['Other Inventor'], inventors: ['Other Inventor'] }
    const assessment = assessPatentRelevance(record, profile)
    assert.strictEqual(assessment.identityMatched, false)
    assert.strictEqual(assessment.relevant, false)
  })

  test('东北电力大学申请的同名专利不会推送', () => {
    const config = loadConfig()
    const profile = { ...config.patentSearch, excludedOrganizations: config.excludedOrganizations }
    const record = {
      ...loadFixture('patent-relevant-same-name'),
      applicants: ['东北电力大学'],
    }
    const assessment = assessPatentRelevance(record, profile)
    assert.strictEqual(assessment.relevant, false)
    assert.strictEqual(assessment.excludedOrganization, true)
  })

  test('Yibo Wang署名单位为东北电力大学的论文不会推送', () => {
    const config = loadConfig()
    const record = {
      type: 'journal',
      title: 'Power Electronics Study by a Same-name Author',
      authors: ['Yibo Wang'],
      authorAffiliations: [{ name: 'Yibo Wang', affiliations: ['Northeast Electric Power University'] }],
    }
    assert.strictEqual(recordMatchesExcludedOrganization(record, config.excludedOrganizations, config.authorNames), true)
  })

  test('CNIPA按姓名临时返回0条时必须启用失败与缓存流程', () => {
    assert.throws(() => requirePatentResults([], '王艺博'), /临时返回0条结果/)
    assert.strictEqual(requirePatentResults([{ patentNumber: 'CN117458638A' }], '王艺博').length, 1)
  })

  test('同族专利优先保留授权版本和中国版本', () => {
    const base = loadFixture('patent-relevant-same-name')
    const selected = deduplicatePatentFamilies([
      { ...base, patentNumber: 'WO999999991A1', status: 'published' },
      { ...base, patentNumber: 'CN999999991B', status: 'granted' },
    ], ['CN', 'WO', 'EP', 'US'])
    assert.strictEqual(selected.length, 1)
    assert.strictEqual(selected[0].patentNumber, 'CN999999991B')
  })

  test('已知中国专利在实时检索失败时仍可验证扫描链路', () => {
    const seed = loadConfig().patentSearch.googlePatents.verifiedPatents[0]
    const record = verifiedPatentRecord(seed)
    assert.strictEqual(record.patentNumber, 'CN117907843B')
    assert.strictEqual(record.identityVerified, true)
    assert(record.titleZh.includes('锂电池'))
    assert(record.inventors.includes('王艺博'))
  })

  test('Google Patents结果同时识别公开实审和授权版本', () => {
    const payload = {
      results: {
        cluster: [{
          result: [
            { patent: { title: ' Adaptive battery SOC estimation method', snippet: 'Lithium battery Kalman filter', publication_number: 'CN123456789A', publication_date: '2026-01-02', inventor: '<b>王艺博</b>', assignee: '王艺博' } },
            { patent: { title: ' Power converter control method', snippet: 'Voltage source converter', publication_number: 'CN987654321B', publication_date: '2025-01-02', grant_date: '2026-03-04', inventor: '<b>王艺博</b>', assignee: 'University of Macau' } },
          ],
        }],
      },
    }
    const records = parseGooglePatentResults(payload)
    assert.strictEqual(records.length, 2)
    assert.strictEqual(records[0].status, 'published')
    assert.strictEqual(records[1].status, 'granted')
    assert.strictEqual(records[0].inventors[0], '王艺博')
  })

  test('中国申请号可识别带点和不带点的格式', () => {
    assert.strictEqual(normalizeChineseApplicationNumber('2023110042264'), 'CN202311004226.4')
    assert.strictEqual(normalizeChineseApplicationNumber('CN202311004226.4'), 'CN202311004226.4')
    const analysis = parseSmartInput('2023110042264')
    assert.strictEqual(analysis.kind, 'patent')
    assert.strictEqual(analysis.applicationNumber, 'CN202311004226.4')
  })

  test('国家公开专利数据可读取未授权的实审专利', () => {
    const records = parseCnipaPublicResults({
      patentList: [{
        an: '2023110042264',
        pn: 'CN117458638A',
        ti: '一种环式锂电池主动均衡拓扑及其主动均衡方法',
        e72: '王艺博;张文起',
        e71_73: '王艺博',
        ad: 20230810,
        pd: 20240126,
        pubtype: 1,
      }],
    })
    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].applicationNumber, 'CN202311004226.4')
    assert.strictEqual(records[0].patentNumber, 'CN117458638A')
    assert.strictEqual(records[0].status, 'published')
    assert.strictEqual(records[0].legalStatus, 'published-or-pending')
    assert.deepStrictEqual(records[0].inventors, ['王艺博', '张文起'])
  })

  test('中文发明人姓名可转换成英文姓名顺序', () => {
    assert.strictEqual(romanizeChineseName('王艺博'), 'Yibo Wang')
    assert.strictEqual(romanizeChineseName('张文起'), 'Wenqi Zhang')
    assert.strictEqual(romanizeChineseName('欧阳元兵'), 'Yuanbing Ouyang')
  })

  test('未授权专利在中英文条目中显示实审状态', () => {
    const record = {
      type: 'patent',
      title: 'An active balancing topology of ring lithium battery and its active balancing method',
      titleEn: 'An active balancing topology of ring lithium battery and its active balancing method',
      titleZh: '一种环式锂电池主动均衡拓扑及其主动均衡方法',
      authors: ['Yibo Wang', 'Wenqi Zhang'],
      authorsEn: ['Yibo Wang', 'Wenqi Zhang'],
      authorsZh: ['王艺博', '张文起'],
      patentNumber: 'CN117458638A',
      date: '2024-01-26',
      status: 'published',
    }
    const english = buildEntry(record, 'en')
    const chinese = buildEntry(record, 'zh')
    assert(english.includes('Yibo Wang'))
    assert(english.includes('Wenqi Zhang'))
    assert(english.includes('An active balancing topology'))
    assert(english.includes('(Under Substantive Examination)'))
    assert(!english.includes('王艺博'))
    assert(chinese.includes('王艺博'))
    assert(chinese.includes('一种环式锂电池'))
    assert(chinese.includes('(实审)'))
    assert(!chinese.includes('Yibo Wang'))
  })

  test('在线管理器提供识别结果手动修改入口', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'vercel-src', 'index.html'), 'utf8')
    const script = fs.readFileSync(path.join(__dirname, '..', 'vercel-src', 'app.js'), 'utf8')
    for (const id of ['edit-form', 'edit-title-en', 'edit-title-zh', 'edit-authors-en', 'edit-authors-zh', 'edit-patent-number', 'edit-patent-status']) {
      assert(html.includes(`id="${id}"`), `缺少手动修改字段：${id}`)
    }
    assert(script.includes("api('/api/plan'"))
    assert(script.includes('手动修改已应用'))
  })

  test('Google Patents单次CSV导出可读取完整发明人字段', () => {
    const csv = 'search URL,https://patents.google.com/\nid,title,assignee,inventor,priority date,filing/creation date,publication date,grant date,result link\nCN117907843A,"Adaptive battery SOC estimation","王艺博","王艺博, 欧阳元兵, 刘继文",2024-02-16,2024-02-16,2024-04-19,,https://patents.google.com/patent/CN117907843A\n'
    const rows = parseGooglePatentCsv(csv)
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0].publication_number, 'CN117907843A')
    assert(rows[0].inventor.includes('欧阳元兵'))
  })

  test('中文专利页面可保留中文原题用于通知', () => {
    const html = '<html lang="zh"><head><meta name="DC.title" content="一种适用于锂电池SOC估计的自适应卡尔曼滤波算法"><meta name="DC.description" content="本发明属于锂电池技术领域"><meta name="DC.contributor" scheme="inventor" content="王艺博"><meta scheme="inventor" name="DC.contributor" content="欧阳元兵"><meta name="DC.relation" scheme="CPC" content="G01R31/367"></head></html>'
    const metadata = parseGooglePatentHtml(html, 'zh')
    assert.strictEqual(metadata.title, '一种适用于锂电池SOC估计的自适应卡尔曼滤波算法')
    assert.deepStrictEqual(metadata.inventors, ['王艺博', '欧阳元兵'])
    assert(metadata.classifications.includes('G01R31/367'))
  })

  test('网站条目分别使用中英文专利标题', () => {
    const record = {
      ...loadFixture('patent-relevant-same-name'),
      title: 'Adaptive battery SOC estimation method',
      titleEn: 'Adaptive battery SOC estimation method',
      titleZh: '一种自适应锂电池SOC估计方法',
    }
    assert(buildEntry(record, 'en').includes('Adaptive battery SOC estimation method'))
    assert(buildEntry(record, 'zh').includes('一种自适应锂电池SOC估计方法'))
  })

  test('确认页保留中文原题并只读取已勾选成果', () => {
    const report = {
      checkedAt: '2026-11-09T00:00:00.000Z',
      items: [
        { status: 'new', type: 'patent', year: 2026, title: 'English translation', notificationTitle: '一种中文专利', patentNumber: 'CN123B' },
        { status: 'new', type: 'journal', year: 2026, title: 'An English paper', notificationTitle: 'An English paper', doi: '10.1000/test' },
        { status: 'existing', type: 'conference', year: 2025, title: 'Existing paper', doi: '10.1000/existing' },
      ],
    }
    const issue = renderApprovalIssue(report)
    assert(issue.includes('一种中文专利'))
    assert(!issue.includes('English translation'))
    assert(!issue.includes('Existing paper'))
    const checked = issue
      .replace('- [ ] <!-- publication-id:patent%3ACN123B -->', '- [x] <!-- publication-id:patent%3ACN123B -->')
      .replace('- [ ] <!-- publication-confirm -->', '- [x] <!-- publication-confirm -->')
    assert.deepStrictEqual(parseApprovalIssue(checked), {
      confirmed: true,
      selectedIdentifiers: ['patent:CN123B'],
    })
  })

  test('邮件回复可按编号选择成果', () => {
    const report = {
      items: [
        { status: 'new', type: 'journal', year: 2026, title: 'First paper', doi: '10.1000/first' },
        { status: 'new', type: 'patent', year: 2026, titleZh: '第二项专利', notificationTitle: '第二项专利', patentNumber: 'CN456B' },
        { status: 'new', type: 'conference', year: 2025, title: 'Third paper', doi: '10.1000/third' },
      ],
    }
    const issue = renderApprovalIssue(report)
    assert(issue.includes('**1. 期刊论文'))
    assert(issue.includes('**2. 专利'))
    assert.deepStrictEqual(parseApprovalEmailReply(issue, '确认：1，3'), {
      confirmed: true,
      selectedIdentifiers: ['doi:10.1000/first', 'doi:10.1000/third'],
      invalidSelections: [],
    })
    assert.deepStrictEqual(parseApprovalEmailReply(issue, '确认：2,9'), {
      confirmed: false,
      selectedIdentifiers: ['patent:CN456B'],
      invalidSelections: [9],
    })
    assert.deepStrictEqual(parseApprovalEmailReply(issue, '确认：全部'), {
      confirmed: true,
      selectedIdentifiers: ['doi:10.1000/first', 'patent:CN456B', 'doi:10.1000/third'],
      invalidSelections: [],
    })
    assert.deepStrictEqual(parseApprovalEmailReply(issue, '确认：无'), {
      confirmed: true,
      selectedIdentifiers: [],
      invalidSelections: [],
    })
    assert.deepStrictEqual(parseApprovalEmailReply(issue, '确认：2\r\n\r\n1138363737\r\n***@***.***\r\n------------------ 原始邮件 ------------------\r\n确认：1,2,5'), {
      confirmed: true,
      selectedIdentifiers: ['patent:CN456B'],
      invalidSelections: [],
    })
  })

  test('通知邮件包含醒目的本次确认页直达链接', () => {
    const notification = renderApprovalNotification({
      checkedAt: '2026-11-10T01:35:29.737Z',
      items: [
        { status: 'new', type: 'journal', year: 2026, title: 'First paper', doi: '10.1000/first' },
        { status: 'new', type: 'patent', year: 2026, notificationTitle: '一种中文专利', patentNumber: 'CN456B', authors: ['王艺博', '张文起'], applicants: ['王艺博'] },
      ],
      patentCoverage: { status: 'complete' },
    }, {
      issueUrl: 'https://github.com/YiboDokkieWang/YiboDokkieWang.github.io/issues/99',
      runUrl: 'https://github.com/YiboDokkieWang/YiboDokkieWang.github.io/actions/runs/123',
    })
    assert(notification.includes('打开本次扫描与确认页面（2 项待确认）'))
    assert(notification.includes('issues/99'))
    assert(notification.includes('确认：全部'))
    assert(notification.includes('确认：无'))
    assert(notification.includes('专利号：** CN456B'))
    assert(notification.includes('发明人：** 王艺博、张文起'))
    assert(notification.includes('申请人/单位：** 王艺博'))
    assert(notification.includes('### 候选 2. 一种中文专利'))
    assert(notification.includes('方式1：打开 GitHub 确认页面'))
    assert(notification.includes('方式2：直接回复本邮件'))
    assert(notification.includes('本邮件只展示信息，不提供勾选操作'))
    assert(!notification.includes('邮件里的候选列表只用于查看'))
    assert(!notification.includes('- [ ]'))
  })

  test('确认页区分成果选择框与唯一最终提交框，并显示已有专利', () => {
    const issue = renderApprovalIssue({
      checkedAt: '2026-11-10T01:35:29.737Z',
      items: [
        { status: 'new', type: 'journal', year: 2026, title: 'New paper', doi: '10.1000/new' },
        { status: 'existing', type: 'patent', year: 2026, notificationTitle: '一种已知专利', patentNumber: 'CN117907843B' },
      ],
      patentCoverage: { status: 'complete', verifiedPatentCount: 1 },
    })
    assert(issue.includes('本次共识别到 1 件相关专利'))
    assert(issue.includes('CN117907843B'))
    assert(issue.includes('第1步：勾选属于你的新增成果'))
    assert(issue.includes('第2步：提交选择（唯一的确认位置）'))
    assert(issue.includes('下面这个复选框才是“确定并提交”'))
    assert.strictEqual((issue.match(/publication-confirm/g) || []).length, 1)
  })

  test('最近一次成功的专利扫描可以写入并读取缓存', () => {
    const filePath = path.join(os.tmpdir(), `publication-monitor-patent-cache-${process.pid}.json`)
    const records = [{ type: 'patent', title: 'Cached patent', patentNumber: 'CN123B' }]
    savePatentCache(records, filePath, '2026-11-10T00:00:00.000Z')
    assert.deepStrictEqual(loadPatentCache(filePath), {
      schemaVersion: 1,
      savedAt: '2026-11-10T00:00:00.000Z',
      records,
    })
    fs.unlinkSync(filePath)
  })

  test('专利数据源全部失败时确认邮件显示未完成警告', () => {
    const issue = renderApprovalIssue({
      checkedAt: '2026-11-10T00:00:00.000Z',
      items: [{ status: 'new', type: 'journal', title: 'Paper', year: 2026, doi: '10.1000/paper' }],
      patentCoverage: { status: 'incomplete', cacheCount: 0 },
    })
    assert(issue.includes('本次专利扫描未完成'))
    assert(issue.includes('不能据此判断没有新专利'))
  })

  test('专利公开版本可被授权版本替换', () => {
    const final = loadFixture('patent-relevant-same-name')
    const existing = [{ ...final, patentNumber: 'CN999999991A', status: 'published', raw: 'existing patent' }]
    assert.strictEqual(compareRecord(final, existing).status, 'upgrade')
  })

  test('已授权专利不会被检索到的公开版本降级', () => {
    const publicVersion = { ...loadFixture('patent-relevant-same-name'), patentNumber: 'CN999999991A', status: 'published' }
    const existing = [{ ...publicVersion, patentNumber: 'CN999999991B', status: 'granted', raw: 'existing granted patent' }]
    assert.strictEqual(compareRecord(publicVersion, existing).status, 'existing')
  })

  return {
    ok: results.every(result => result.ok),
    passed: results.filter(result => result.ok).length,
    failed: results.filter(result => !result.ok).length,
    results,
  }
}

module.exports = { runSelfTests }
