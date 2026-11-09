const assert = require('assert')
const fs = require('fs')
const {
  EN_PUBLICATIONS,
  buildEntry,
  compareRecord,
  inventory,
  loadFixture,
  parsePublicationMarkdown,
  planRecord,
} = require('./core.cjs')
const { enrichAnalysisFromCandidate, parseSmartInput, rankCandidates } = require('./sources.cjs')

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

  return {
    ok: results.every(result => result.ok),
    passed: results.filter(result => result.ok).length,
    failed: results.filter(result => !result.ok).length,
    results,
  }
}

module.exports = { runSelfTests }
