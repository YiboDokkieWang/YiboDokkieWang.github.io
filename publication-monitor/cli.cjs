const fs = require('fs')
const path = require('path')
const {
  ROOT,
  applyPlan,
  inventory,
  loadFixture,
  planRecord,
} = require('./lib/core.cjs')
const { identify, scanConfiguredSources } = require('./lib/sources.cjs')
const { runSelfTests } = require('./lib/tests.cjs')
const { publicationIdentifier } = require('./lib/approval.cjs')

const STATE_PATH = path.join(__dirname, 'state.json')

function parseArgs(argv) {
  const args = { _: [] }
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]
    if (!value.startsWith('--')) {
      args._.push(value)
      continue
    }
    const key = value.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index++
    }
  }
  return args
}

function ensureOutputDirectory(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true })
}

function outputReport(report, outputPath) {
  if (outputPath) {
    ensureOutputDirectory(outputPath)
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2))
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

function identifierFor(record) {
  return publicationIdentifier(record)
}

function updateState(report, records = []) {
  const previous = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : { schemaVersion: 1, knownIdentifiers: [] }
  const known = new Set(previous.knownIdentifiers || [])
  records.forEach(record => known.add(identifierFor(record)))
  const next = {
    schemaVersion: 1,
    lastCheckedAt: new Date().toISOString(),
    knownIdentifiers: [...known].sort(),
    lastRun: {
      mode: report.mode,
      found: report.counts?.found || 0,
      missing: report.counts?.missing || 0,
      upgrades: report.counts?.upgrades || 0,
      ambiguous: report.counts?.ambiguous || 0,
    },
  }
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(next, null, 2)}\n`)
}

function containsChinese(value = '') {
  return /[\u3400-\u9fff]/.test(String(value))
}

function originalTitleForNotification(record = {}) {
  if (record.originalLanguage === 'zh' || record.titleZh || containsChinese(record.title)) {
    if (record.titleZh) return record.titleZh
    if (containsChinese(record.originalTitle)) return record.originalTitle
    if (containsChinese(record.title)) return record.title
    return record.patentNumber
      ? `${record.patentNumber}（中文题目暂未获取，请打开专利链接核对）`
      : '中文成果（中文题目暂未获取，请打开原始链接核对）'
  }
  return record.originalTitle || record.title || ''
}

function localizedStatus(value) {
  return ({ new: '新增', existing: '已存在', upgrade: '正式/授权版本更新', ambiguous: '待确认' })[value] || value
}

function localizedType(value) {
  return ({ journal: '期刊论文', conference: '会议论文', patent: '专利' })[value] || value
}

function markdownReport(report) {
  const lines = [
    `# 发表成果扫描报告`,
    '',
    `- 运行方式：${report.mode}`,
    `- 检查时间：${report.checkedAt || new Date().toISOString()}`,
  ]
  if (report.counts) {
    lines.push(
      `- 数据源成果：${report.counts.found || 0}`,
      `- 网站已有：${report.counts.existing || 0}`,
      `- 网站缺少：${report.counts.missing || 0}`,
      `- 正式/授权版本更新：${report.counts.upgrades || 0}`,
      `- 待确认：${report.counts.ambiguous || 0}`,
    )
    if (report.items) lines.push(`- 其中专利：${report.items.filter(item => item.type === 'patent').length}`)
  }
  if (report.sourceStatus?.length) {
    lines.push('', '## 数据源', '')
    report.sourceStatus.forEach(source => {
      const detail = source.skipped
        ? `SKIP (${source.message})`
        : source.ok
          ? `${source.count}${source.message ? `（${source.message}）` : ''}`
          : source.error
      lines.push(`- ${source.skipped ? 'SKIP' : source.ok ? 'PASS' : 'FAIL'} ${source.source}: ${detail}`)
    })
  }
  if (report.patentFilter) {
    lines.push(
      '',
      '## 专利身份与研究方向筛选',
      '',
      `- 检查同名专利候选：${report.patentFilter.examined || 0}`,
      `- 保留相关专利：${report.patentFilter.relevant || 0}`,
      `- 忽略无关同名专利：${report.patentFilter.ignored || 0}`,
    )
  }
  if (report.patentCoverage?.status === 'cached') {
    lines.push(
      '',
      '## ⚠️ 专利扫描使用缓存',
      '',
      `Google Patents实时检索失败，本次使用${report.patentCoverage.cacheSavedAt || '最近一次'}保存的 ${report.patentCoverage.cacheCount || 0} 条专利候选。论文扫描不受影响。`,
    )
  } else if (report.patentCoverage?.status === 'verification-only') {
    lines.push(
      '',
      '## ⚠️ 新专利发现检索未完成',
      '',
      `本次至少识别到 ${report.patentCoverage.verifiedPatentCount || 0} 条已知中国专利记录，证明专利识别、查重和报告流程可以工作；但Google Patents按姓名检索失败，因此不能据此判断没有其他新专利。`,
    )
  } else if (report.patentCoverage?.status === 'incomplete') {
    lines.push(
      '',
      '## ⚠️ 本次专利扫描未完成',
      '',
      'Google Patents实时检索失败，并且当前没有可用缓存或已知专利验证项。下面的结果不能用于判断“没有新专利”，请稍后重新运行扫描。论文扫描不受影响。',
    )
  }
  if (report.items?.length) {
    lines.push('', '## 扫描结果', '', '| 状态 | 类型 | 年份 | 原始语言题目 | 标识符 |', '|---|---|---:|---|---|')
    report.items.forEach(item => lines.push(`| ${localizedStatus(item.status)} | ${localizedType(item.type)} | ${item.year || ''} | ${String(item.notificationTitle || item.title || '').replaceAll('|', '\\|')} | ${item.doi || item.patentNumber || item.ieeeDocumentId || ''} |`))
  }
  if (report.changedPublications) {
    lines.push(
      '',
      '## 请确认后更新网站',
      '',
      '本次扫描已生成网站修改，但尚未发布。请检查本 Pull Request 的 `Files changed`，确认无误后点击 `Merge pull request`。合并后 GitHub Pages 会自动发布更新。',
      '',
      '> 手动 `scan` 与每月自动扫描使用完全相同的扫描、查重、筛选和确认流程。',
    )
  }
  return `${lines.join('\n')}\n`
}

async function commandScan(args) {
  const scan = await scanConfiguredSources({ includeVerifiedPatents: Boolean(args['verify-known-patent']) })
  const plans = scan.records.map(record => planRecord(record))
  const selectedIdentifiers = args['selected-file']
    ? new Set(JSON.parse(fs.readFileSync(args['selected-file'], 'utf8')).selectedIdentifiers || [])
    : null
  const counts = {
    found: plans.length,
    existing: plans.filter(plan => plan.comparison.status === 'existing').length,
    missing: plans.filter(plan => plan.comparison.status === 'new').length,
    upgrades: plans.filter(plan => plan.comparison.status === 'upgrade').length,
    ambiguous: plans.filter(plan => plan.comparison.status === 'ambiguous').length,
  }
  const changed = []
  if (args.apply) {
    const actionablePlans = plans
      .filter(plan => ['new', 'upgrade'].includes(plan.comparison.status))
      .filter(plan => !selectedIdentifiers || selectedIdentifiers.has(identifierFor(plan.record)))
      .sort((left, right) => {
        const leftDate = Date.parse(left.record.date || `${left.record.year || 0}-01-01`) || 0
        const rightDate = Date.parse(right.record.date || `${right.record.year || 0}-01-01`) || 0
        return leftDate - rightDate
      })
    if (selectedIdentifiers) {
      const foundIdentifiers = new Set(actionablePlans.map(plan => identifierFor(plan.record)))
      const missingSelections = [...selectedIdentifiers].filter(identifier => !foundIdentifiers.has(identifier))
      if (missingSelections.length) throw new Error(`本次重新扫描未找到已选择的成果：${missingSelections.join(', ')}`)
    }
    for (const initialPlan of actionablePlans) {
      const currentPlan = planRecord(initialPlan.record)
      if (!['new', 'upgrade'].includes(currentPlan.comparison.status)) continue
      const result = applyPlan(currentPlan)
      changed.push(...result.changed)
    }
  }
  const report = {
    mode: 'scan',
    checkedAt: new Date().toISOString(),
    counts,
    sourceStatus: scan.sourceStatus,
    patentFilter: scan.patentFilter,
    patentCoverage: scan.patentCoverage,
    items: plans.map(plan => ({
      status: plan.comparison.status,
      type: plan.record.type,
      title: plan.record.title,
      identifier: identifierFor(plan.record),
      notificationTitle: originalTitleForNotification(plan.record),
      originalLanguage: plan.record.originalLanguage,
      year: plan.record.year,
      doi: plan.record.doi,
      patentNumber: plan.record.patentNumber,
      ieeeDocumentId: plan.record.ieeeDocumentId,
      url: plan.record.url,
      authors: plan.record.authors,
      source: plan.record.source,
    })),
    changedPublications: [...new Set(changed)].length > 0,
    selectedIdentifiers: selectedIdentifiers ? [...selectedIdentifiers] : [],
  }
  updateState(report, scan.records)
  return report
}

async function commandIdentify(args) {
  const result = await identify({ type: args.type || 'auto', inputKind: args['input-kind'] || 'auto', value: args.value || '' })
  const plan = planRecord(result.record)
  const changed = []
  if (args.apply && ['new', 'upgrade'].includes(plan.comparison.status)) changed.push(...applyPlan(plan).changed)
  return {
    mode: 'identify',
    checkedAt: new Date().toISOString(),
    counts: {
      found: 1,
      existing: Number(plan.comparison.status === 'existing'),
      missing: Number(plan.comparison.status === 'new'),
      upgrades: Number(plan.comparison.status === 'upgrade'),
      ambiguous: Number(plan.comparison.status === 'ambiguous'),
    },
    items: [{ ...plan.record, status: plan.comparison.status, notificationTitle: originalTitleForNotification(plan.record) }],
    plan,
    changedPublications: changed.length > 0,
    warning: result.warning || '',
  }
}

function commandApplyRecord(args) {
  if (!args['record-file']) throw new Error('apply-record requires --record-file')
  const record = JSON.parse(fs.readFileSync(args['record-file'], 'utf8'))
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('在线成果记录格式无效')
  if (!['journal', 'conference', 'patent'].includes(record.type)) throw new Error('在线成果类型无效')
  if (record.fixture || record.source === 'fixture') throw new Error('测试数据禁止写入正式网站')
  if (!record.title) throw new Error('在线成果缺少题目')
  if (record.type === 'patent' && !record.patentNumber) throw new Error('在线专利缺少专利号')
  const plan = planRecord(record)
  const changed = []
  if (['new', 'upgrade'].includes(plan.comparison.status)) changed.push(...applyPlan(plan).changed)
  return {
    mode: 'online-add',
    checkedAt: new Date().toISOString(),
    counts: {
      found: 1,
      existing: Number(plan.comparison.status === 'existing'),
      missing: Number(plan.comparison.status === 'new'),
      upgrades: Number(plan.comparison.status === 'upgrade'),
      ambiguous: Number(plan.comparison.status === 'ambiguous'),
    },
    items: [{ ...plan.record, status: plan.comparison.status, notificationTitle: originalTitleForNotification(plan.record) }],
    plan,
    changedPublications: changed.length > 0,
  }
}

function commandFixture(args) {
  const fixture = loadFixture(args.name || 'new-journal')
  if (fixture.scenario === 'early-access-upgrade') {
    return {
      mode: 'fixture',
      checkedAt: new Date().toISOString(),
      counts: { found: 1, existing: 0, missing: 0, upgrades: 1, ambiguous: 0 },
      items: [{ ...fixture.final, status: 'upgrade', notificationTitle: originalTitleForNotification(fixture.final) }],
      changedPublications: false,
      testOnly: true,
    }
  }
  const plan = planRecord(fixture)
  return {
    mode: 'fixture',
    checkedAt: new Date().toISOString(),
    counts: { found: 1, existing: 0, missing: 1, upgrades: 0, ambiguous: 0 },
    items: [{ ...fixture, status: plan.comparison.status, notificationTitle: originalTitleForNotification(fixture) }],
    plan,
    changedPublications: false,
    testOnly: true,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = args._[0] || 'help'
  let report
  if (command === 'self-test') {
    const test = runSelfTests()
    report = { mode: 'self-test', checkedAt: new Date().toISOString(), test, counts: { found: 0, existing: 0, missing: 0, upgrades: 0, ambiguous: 0 }, changedPublications: false }
    if (!test.ok) process.exitCode = 1
  } else if (command === 'inventory') {
    const current = inventory()
    report = { mode: 'inventory', checkedAt: new Date().toISOString(), inventory: current, counts: { found: current.total, existing: current.total, missing: 0, upgrades: 0, ambiguous: 0 }, changedPublications: false }
  } else if (command === 'fixture') report = commandFixture(args)
  else if (command === 'identify') report = await commandIdentify(args)
  else if (command === 'apply-record') report = commandApplyRecord(args)
  else if (command === 'scan') report = await commandScan(args)
  else {
    process.stdout.write('Commands: self-test | inventory | fixture --name <fixture> | identify --type <type> --input-kind <kind> --value <value> [--apply] | apply-record --record-file <file> | scan [--apply]\n')
    return
  }
  if (args['markdown-output']) {
    ensureOutputDirectory(args['markdown-output'])
    fs.writeFileSync(args['markdown-output'], markdownReport(report))
  }
  outputReport(report, args.output)
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`)
  process.exitCode = 1
})
