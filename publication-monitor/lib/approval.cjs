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

function renderApprovalIssue(report = {}, options = {}) {
  const items = actionableItems(report)
  const lines = [
    '# 请选择属于你的新增成果',
    '',
    '@YiboDokkieWang，扫描已完成。请先勾选确实属于你的成果，最后再勾选页面底部的“确认选择并更新网站”。',
    '',
    '> 此确认页需要登录 GitHub。只有仓库所有者的确认操作能够触发网站更新；未勾选的成果不会写入网站。',
    '',
    `- 扫描时间：${report.checkedAt || ''}`,
    `- 待确认数量：${items.length}`,
  ]
  if (options.runUrl) lines.push(`- [查看本次扫描运行记录](${options.runUrl})`)
  lines.push('', '## 待确认成果', '')
  for (const item of items) {
    const identifier = publicationIdentifier(item)
    const marker = encodeURIComponent(identifier)
    const title = escapeMarkdown(item.notificationTitle || item.title || identifier)
    const link = sourceLink(item)
    const linkedTitle = link ? `[${title}](${link})` : title
    lines.push(`- [ ] <!-- publication-id:${marker} --> **${localizedType(item.type)} · ${item.year || '年份未知'} · ${localizedStatus(item.status)}** — ${linkedTitle}`)
  }
  lines.push(
    '',
    '## 最终确认',
    '',
    '- [ ] <!-- publication-confirm --> **确认以上选择并自动更新个人网站**',
    '',
    '> 请最后勾选本项。勾选后，GitHub 将只添加上面已勾选的成果，并自动关闭本确认页。',
  )
  return `${lines.join('\n')}\n`
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
  publicationIdentifier,
  renderApprovalIssue,
}
