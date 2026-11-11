function publicationIdentifier(item = {}) {
  if (item.identifier) return String(item.identifier)
  if (item.doi) return `doi:${String(item.doi).toLowerCase()}`
  if (item.patentNumber) return `patent:${String(item.patentNumber).toUpperCase()}`
  if (item.ieeeDocumentId) return `ieee:${item.ieeeDocumentId}`
  return `title:${String(item.title || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}`
}

function actionableItems(report = {}) {
  return (report.items || []).filter(item => ['new', 'upgrade'].includes(item.status))
}

function localizedStatus(value) {
  return ({ new: '新增', upgrade: '正式/授权版本更新' })[value] || value
}

function localizedType(value) {
  return ({ journal: '期刊论文', conference: '会议论文', patent: '专利' })[value] || value
}

function sourceLink(item = {}) {
  if (item.url) return item.url
  if (item.doi) return `https://doi.org/${item.doi}`
  if (item.patentNumber) return `https://patents.google.com/patent/${item.patentNumber}/zh`
  return ''
}

function escapeMarkdown(value = '') {
  return String(value).replace(/[\r\n]+/g, ' ').replaceAll('|', '\\|').trim()
}

function formatCheckedAt(value = '') {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '未知'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replaceAll('/', '-').replace(' ', ' ')
}

function patentCoverageNotice(report = {}, compact = false) {
  if (report.patentCoverage?.status === 'cached') {
    const text = `⚠️ 专利实时检索失败，本次使用 ${report.patentCoverage.cacheSavedAt || '未知时间'} 保存的缓存（${report.patentCoverage.cacheCount || 0} 条候选）。`
    return compact ? text : `> ${text}`
  }
  if (report.patentCoverage?.status === 'verification-only') {
    const text = `⚠️ 本次识别到 ${report.patentCoverage.verifiedPatentCount || 0} 件已知中国专利，但国家知识产权局公开专利数据按姓名检索失败；不能据此判断没有其他新专利。`
    return compact ? text : `> **${text}**`
  }
  if (report.patentCoverage?.status === 'incomplete') {
    const text = '⚠️ 本次专利扫描未完成：国家知识产权局公开专利数据未成功返回，且没有可用缓存或已知专利验证项。因此，本次候选不能据此判断没有新专利。'
    return compact ? text : `> **${text}**`
  }
  return '✅ 论文和专利数据源扫描正常。'
}

function appendPatentScanSummary(lines, report = {}) {
  const patents = (report.items || []).filter(item => item.type === 'patent')
  lines.push('', '## 本次专利扫描结果', '')
  if (!patents.length) {
    lines.push('❌ 本次没有识别到任何专利。请查看上方扫描状态，不要把本次结果理解为“没有新专利”。')
    return
  }
  lines.push(`✅ **本次共识别到 ${patents.length} 件相关专利。**`, '')
  patents.forEach(item => {
    const title = escapeMarkdown(item.notificationTitle || item.title || item.patentNumber || '')
    const link = sourceLink(item)
    const linkedTitle = link ? `[${title}](${link})` : title
    const instruction = item.status === 'existing'
      ? '已在网站中，无需勾选'
      : '需要你在下方“第1步”决定是否勾选'
    lines.push(`- **${item.patentNumber || '专利号未知'}** — ${linkedTitle}（${instruction}）`)
  })
}

function renderApprovalIssue(report = {}, options = {}) {
  const items = actionableItems(report)
  const lines = [
    items.length ? '# 请选择属于你的新增成果' : '# 本次扫描完成：没有需要新增的成果',
    '',
    items.length
      ? '这是本次扫描的正式确认页面。请只勾选确实属于你的成果。'
      : '这是本次手动扫描的结果页面。你仍可查看专利识别结果，并在第2步关闭本次确认。',
    '',
  ]
  if (options.issueUrl) {
    lines.push(`> 📌 **[打开或重新载入本次确认页面](${options.issueUrl})**`, '')
  }
  lines.push(
    '## 操作方法',
    '',
    '1. 勾选下面属于你的成果。',
    '2. 检查无误后，再勾选页面底部“第2步”中的“我已完成上方选择”。',
    '3. GitHub 将只添加你勾选的内容，随后自动关闭本确认页面。',
    '',
    `- **扫描时间：** ${formatCheckedAt(report.checkedAt)}（北京时间）`,
    `- **待确认数量：** ${items.length}`,
    `- **扫描状态：** ${patentCoverageNotice(report, true)}`,
  )
  if (options.runUrl) lines.push(`- [查看本次扫描运行记录](${options.runUrl})`)
  appendPatentScanSummary(lines, report)
  lines.push('', '---', '', '## 第1步：勾选属于你的新增成果', '')
  if (!items.length) lines.push('本次没有需要加入网站的新增成果。请直接前往第2步关闭本次确认。', '')
  items.forEach((item, index) => {
    const identifier = publicationIdentifier(item)
    const marker = encodeURIComponent(identifier)
    const title = escapeMarkdown(item.notificationTitle || item.title || identifier)
    const link = sourceLink(item)
    const linkedTitle = link ? `[${title}](${link})` : title
    lines.push(`- [ ] <!-- publication-id:${marker} --> **${index + 1}. ${localizedType(item.type)} · ${item.year || '年份未知'} · ${localizedStatus(item.status)}** — ${linkedTitle}`)
  })
  lines.push(
    '',
    '---',
    '',
    '## 第2步：提交选择（唯一的确认位置）',
    '',
    '> **请注意：第1步的复选框只是选择成果；下面这个复选框才是“确定并提交”。勾选后会立即触发更新，不需要再点击其他按钮。**',
    '',
    '- [ ] <!-- publication-confirm --> **我已完成上方选择，现在确定并自动更新个人网站**',
    '',
    '> 若没有任何新增成果属于你，可以不选第1步的项目，直接勾选本项关闭本次确认。',
  )
  return `${lines.join('\n')}\n`
}

function renderApprovalNotification(report = {}, options = {}) {
  const items = actionableItems(report)
  const issueUrl = options.issueUrl || ''
  const lines = [
    items.length ? '# 新增成果等待你的确认' : '# 手动扫描已完成',
    '',
    items.length
      ? '@YiboDokkieWang，本次自动扫描发现了可能属于你的新增成果。网站目前**尚未修改**，只有经过你的确认才会更新。'
      : '@YiboDokkieWang，本次手动扫描没有发现需要加入网站的新增成果。你可以打开结果页面查看本次专利识别情况。',
    '',
    '## 推荐：打开确认页面勾选',
    '',
    issueUrl
      ? `### 👉 [打开本次扫描与确认页面（${items.length} 项待确认）](${issueUrl})`
      : `### 本次共有 ${items.length} 项成果等待确认`,
    '',
    '进入页面后，先在“第1步”勾选属于你的成果，再到页面最底部勾选“第2步：确定并提交”。第2步的复选框就是提交操作，没有额外按钮。',
    '',
    '## 网络不稳定时：直接回复本邮件',
    '',
    '- 选择部分成果：只回复一行，例如 `确认：1,2,5`',
    '- 全部属于你：回复 `确认：全部`',
    '- 都不属于你：回复 `确认：无`',
    '',
    '> 邮件里的候选列表只用于查看，不能直接点击勾选。这是 GitHub 通知邮件的限制；请使用上面的确认页面，或直接回复编号。',
    '',
  ]
  appendPatentScanSummary(lines, report)
  lines.push(
    '',
    '## 本次待确认候选',
    '',
  )
  if (!items.length) lines.push('本次没有需要加入网站的新增成果。', '')
  items.forEach((item, index) => {
    const identifier = publicationIdentifier(item)
    const title = escapeMarkdown(item.notificationTitle || item.title || identifier)
    const link = sourceLink(item)
    const linkedTitle = link ? `[${title}](${link})` : title
    lines.push(`${index + 1}. **${localizedType(item.type)} · ${item.year || '年份未知'} · ${localizedStatus(item.status)}**`)
    lines.push(`   - **题目：** ${linkedTitle}`)
    const authors = Array.isArray(item.authors) ? item.authors.filter(Boolean).join('、') : ''
    const creatorLabel = item.type === 'patent' ? '发明人' : '作者'
    if (authors) lines.push(`   - **${creatorLabel}：** ${escapeMarkdown(authors)}`)
    if (item.doi) lines.push(`   - **DOI：** ${escapeMarkdown(item.doi)}`)
    else if (item.patentNumber) lines.push(`   - **专利号：** ${escapeMarkdown(item.patentNumber)}`)
    lines.push('')
  })
  lines.push(
    '',
    '## 扫描信息',
    '',
    `- **时间：** ${formatCheckedAt(report.checkedAt)}（北京时间）`,
    `- **待确认：** ${items.length} 项`,
    `- **数据状态：** ${patentCoverageNotice(report, true)}`,
  )
  if (options.runUrl) lines.push(`- [查看详细扫描记录](${options.runUrl})`)
  lines.push('', '未选择的成果不会写入网站。')
  return `${lines.join('\n')}\n`
}

function allCandidateIdentifiers(body = '') {
  const identifiers = []
  const pattern = /^- \[[ xX]\]\s+<!--\s*publication-id:([^>]+)\s*-->/gm
  for (const match of String(body).matchAll(pattern)) {
    try {
      identifiers.push(decodeURIComponent(match[1].trim()))
    } catch {
      identifiers.push(match[1].trim())
    }
  }
  return identifiers
}

function parseApprovalEmailReply(issueBody = '', commentBody = '') {
  const command = String(commentBody).match(/^\s*确认\s*[:：]\s*([0-9０-９,，、\s]+|全部|无)\s*$/mi)
  if (!command) return { confirmed: false, selectedIdentifiers: [], invalidSelections: [] }
  const candidates = allCandidateIdentifiers(issueBody)
  if (command[1].trim() === '全部') {
    return { confirmed: true, selectedIdentifiers: candidates, invalidSelections: [] }
  }
  if (command[1].trim() === '无') {
    return { confirmed: true, selectedIdentifiers: [], invalidSelections: [] }
  }
  const normalized = command[1].replace(/[０-９]/g, character => String(character.charCodeAt(0) - 0xFEE0))
  const numbers = [...new Set((normalized.match(/\d+/g) || []).map(Number))]
  const invalidSelections = numbers.filter(number => number < 1 || number > candidates.length)
  const selectedIdentifiers = numbers
    .filter(number => number >= 1 && number <= candidates.length)
    .map(number => candidates[number - 1])
  return {
    confirmed: numbers.length > 0 && invalidSelections.length === 0,
    selectedIdentifiers,
    invalidSelections,
  }
}

function parseApprovalIssue(body = '') {
  const selectedIdentifiers = []
  const pattern = /^- \[[xX]\]\s+<!--\s*publication-id:([^>]+)\s*-->/gm
  for (const match of String(body).matchAll(pattern)) {
    try {
      selectedIdentifiers.push(decodeURIComponent(match[1].trim()))
    } catch {
      selectedIdentifiers.push(match[1].trim())
    }
  }
  return {
    confirmed: /^- \[[xX]\]\s+<!--\s*publication-confirm\s*-->/m.test(String(body)),
    selectedIdentifiers: [...new Set(selectedIdentifiers)],
  }
}

module.exports = {
  actionableItems,
  parseApprovalIssue,
  parseApprovalEmailReply,
  publicationIdentifier,
  renderApprovalIssue,
  renderApprovalNotification,
}
