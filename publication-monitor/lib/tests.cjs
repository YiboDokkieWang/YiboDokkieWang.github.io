const assert = require('assert')
const fs = require('fs')
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
const { enrichAnalysisFromCandidate, parseSmartInput, rankCandidates } = require('./sources.cjs')
const { assessPatentRelevance, deduplicatePatentFamilies, parseEpoExchangeXml, parseGooglePatentCsv, parseGooglePatentHtml, parseGooglePatentResults } = require('./patents.cjs')
const { parseApprovalEmailReply, parseApprovalIssue, renderApprovalIssue } = require('./approval.cjs')

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

  test('同族专利优先保留授权版本和中国版本', () => {
    const base = loadFixture('patent-relevant-same-name')
    const selected = deduplicatePatentFamilies([
      { ...base, patentNumber: 'WO999999991A1', status: 'published' },
      { ...base, patentNumber: 'CN999999991B', status: 'granted' },
    ], ['CN', 'WO', 'EP', 'US'])
    assert.strictEqual(selected.length, 1)
    assert.strictEqual(selected[0].patentNumber, 'CN999999991B')
  })

  test('EPO OPS XML可提取专利号、发明人、申请人和分类', () => {
    const xml = `<?xml version="1.0"?><ops:world-patent-data xmlns:ops="ops" xmlns:exch="exch"><exch:exchange-documents><exch:exchange-document country="CN" doc-number="999999991" kind="B"><exch:bibliographic-data><exch:publication-reference><exch:document-id><exch:country>CN</exch:country><exch:doc-number>999999991</exch:doc-number><exch:kind>B</exch:kind><exch:date>20270618</exch:date></exch:document-id></exch:publication-reference><exch:invention-title lang="en">Battery SOC estimation using an adaptive Kalman filter</exch:invention-title><exch:parties><exch:applicants><exch:applicant><exch:applicant-name><exch:name>UNIVERSITY OF MACAU</exch:name></exch:applicant-name></exch:applicant></exch:applicants><exch:inventors><exch:inventor><exch:inventor-name><exch:name>WANG YIBO</exch:name></exch:inventor-name></exch:inventor></exch:inventors></exch:parties><exch:classifications-ipcr><exch:classification-ipcr><exch:text>G01R 31/367</exch:text></exch:classification-ipcr></exch:classifications-ipcr></exch:bibliographic-data><exch:abstract lang="en"><exch:p>A lithium battery state-of-charge estimation method.</exch:p></exch:abstract></exch:exchange-document></exch:exchange-documents></ops:world-patent-data>`
    const records = parseEpoExchangeXml(xml)
    assert.strictEqual(records.length, 1)
    assert.strictEqual(records[0].patentNumber, 'CN999999991B')
    assert(records[0].inventors.includes('WANG YIBO'))
    assert(records[0].applicants.includes('UNIVERSITY OF MACAU'))
    assert(records[0].classifications.includes('G01R 31/367'))
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
