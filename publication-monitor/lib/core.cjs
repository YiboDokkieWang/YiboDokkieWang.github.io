const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const EN_PUBLICATIONS = path.join(ROOT, 'contents', 'publications.md')
const ZH_PUBLICATIONS = path.join(ROOT, 'contents', 'zh', 'publications.md')
const CONFIG_PATH = path.join(ROOT, 'publication-monitor', 'config.json')
const FIXTURES_DIR = path.join(ROOT, 'publication-monitor', 'fixtures')

const SECTION_HEADINGS = {
  en: { journal: 'Journal Articles', conference: 'Conference Papers', patent: 'Patents' },
  zh: { journal: '期刊论文', conference: '会议论文', patent: '专利' },
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function loadConfig() {
  return readJson(CONFIG_PATH)
}

function cleanDoi(value = '') {
  let doi = String(value)
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[\s.,;]+$/g, '')
    .toLowerCase()
  while (doi.endsWith(')') && (doi.match(/\)/g) || []).length > (doi.match(/\(/g) || []).length) doi = doi.slice(0, -1)
  return doi
}

function normalizeTitle(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleTokens(value = '') {
  return new Set(normalizeTitle(value).split(' ').filter(Boolean))
}

function titleSimilarity(left, right) {
  const a = titleTokens(left)
  const b = titleTokens(right)
  if (!a.size || !b.size) return 0
  let intersection = 0
  a.forEach(token => b.has(token) && intersection++)
  const union = new Set([...a, ...b]).size
  return intersection / union
}

function normalizeName(value = '') {
  return String(value)
    .replace(/<\/?strong>/gi, '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function isSelfAuthor(name) {
  const normalized = normalizeName(name)
  return ['yibowang', 'wangyibo', '王艺博'].includes(normalized)
}

function authorOverlap(left = [], right = []) {
  const a = new Set(left.map(normalizeName).filter(Boolean))
  const b = new Set(right.map(normalizeName).filter(Boolean))
  if (!a.size || !b.size) return 0
  let match = 0
  a.forEach(name => b.has(name) && match++)
  return match / Math.min(a.size, b.size)
}

function extractTitle(raw = '') {
  const quoted = raw.match(/[“"]([^”"]{8,})[”"]/)
  if (quoted) return quoted[1].replace(/[,，;；\s]+$/g, '').trim()
  const chinese = raw.match(/(?:<strong>[^<]+<\/strong>|^[^.]+)[,，.]?\s*([^\n]+?)\[J\]/i)
  if (chinese) return chinese[1].replace(/^[,，.\s]+/, '').trim()
  return ''
}

function extractAuthors(raw = '') {
  const title = extractTitle(raw)
  const prefix = title ? raw.slice(0, raw.indexOf(title)) : raw
  return prefix
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/<\/?strong>/gi, '')
    .split(/,|，|\band\b/i)
    .map(value => value.replace(/[“".]/g, '').trim())
    .filter(value => value && value.length < 80)
}

function extractIdentifiers(raw = '') {
  const doiMatch = raw.match(/10\.\d{4,9}\/[\w.()/:;-]+/i)
  const ieeeMatch = raw.match(/ieeexplore\.ieee\.org\/document\/(\d+)/i)
  const patentMatch = raw.match(/\b(?:CN|EP|US|WO)\s?\d+[A-Z]\d?\b/i)
  return {
    doi: doiMatch ? cleanDoi(doiMatch[0]) : '',
    ieeeDocumentId: ieeeMatch ? ieeeMatch[1] : '',
    patentNumber: patentMatch ? patentMatch[0].replace(/\s/g, '').toUpperCase() : '',
  }
}

function extractYear(raw = '') {
  const matches = [...raw.matchAll(/\b(19|20)\d{2}\b/g)].map(match => Number(match[0]))
  return matches.length ? Math.max(...matches) : null
}

function patentRoot(value = '') {
  return String(value).replace(/[.\s-]/g, '').replace(/[A-Z]\d?$/i, '').toUpperCase()
}

function sectionTypeFromHeading(heading) {
  const normalized = heading.trim().toLowerCase()
  for (const language of Object.keys(SECTION_HEADINGS)) {
    for (const [type, title] of Object.entries(SECTION_HEADINGS[language])) {
      if (normalized === title.toLowerCase()) return type
    }
  }
  return null
}

function parsePublicationMarkdown(markdown) {
  const entries = []
  let currentType = null
  for (const line of String(markdown).split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/)
    if (heading) {
      currentType = sectionTypeFromHeading(heading[1])
      continue
    }
    if (!currentType || !/^\s*\d+\.\s+/.test(line)) continue
    const ids = extractIdentifiers(line)
    const parsedStatus = currentType === 'patent'
      ? (/[BCU]\d?$/i.test(ids.patentNumber) ? 'granted' : 'published')
      : (/early access|early-access/i.test(line) ? 'early-access' : 'final')
    entries.push({
      type: currentType,
      raw: line,
      title: extractTitle(line),
      authors: extractAuthors(line),
      year: extractYear(line),
      ...ids,
      status: parsedStatus,
    })
  }
  return entries
}

function readExistingEntries() {
  const enMarkdown = fs.readFileSync(EN_PUBLICATIONS, 'utf8')
  const zhMarkdown = fs.readFileSync(ZH_PUBLICATIONS, 'utf8')
  return {
    enMarkdown,
    zhMarkdown,
    en: parsePublicationMarkdown(enMarkdown),
    zh: parsePublicationMarkdown(zhMarkdown),
  }
}

function hasFinalMetadata(record = {}) {
  if (record.type !== 'journal') return true
  return record.status === 'final' || Boolean(record.volume || record.issue || record.pages || record.articleNumber)
}

function compareRecord(record, existingEntries) {
  const candidates = existingEntries.map(existing => {
    let score = 0
    const reasons = []
    const doi = cleanDoi(record.doi)
    if (doi && existing.doi && doi === cleanDoi(existing.doi)) {
      score = 1
      reasons.push('DOI完全相同')
    } else if (record.patentNumber && existing.patentNumber && record.patentNumber.toUpperCase() === existing.patentNumber.toUpperCase()) {
      score = 1
      reasons.push('专利号完全相同')
    } else if (record.patentNumber && existing.patentNumber && patentRoot(record.patentNumber) === patentRoot(existing.patentNumber)) {
      score = 0.99
      reasons.push('专利公开与授权版本属于同一编号')
    } else if (record.ieeeDocumentId && existing.ieeeDocumentId && record.ieeeDocumentId === existing.ieeeDocumentId) {
      score = 1
      reasons.push('IEEE文献编号完全相同')
    } else {
      const titleScore = titleSimilarity(record.title, existing.title)
      const authorsScore = authorOverlap(record.authors, existing.authors)
      score = titleScore * 0.82 + authorsScore * 0.18
      if (titleScore >= 0.9) reasons.push(`题目相似度${Math.round(titleScore * 100)}%`)
      if (authorsScore >= 0.5) reasons.push(`作者重合度${Math.round(authorsScore * 100)}%`)
    }
    return { existing, score, reasons }
  }).sort((a, b) => b.score - a.score)

  const best = candidates[0]
  if (!best || best.score < 0.72) return { status: 'new', match: null, confidence: best?.score || 0, reasons: [] }

  const newFinal = hasFinalMetadata(record)
  const oldFinal = hasFinalMetadata(best.existing)
  const patentUpgrade = record.type === 'patent'
    && record.status === 'granted'
    && best.existing.status !== 'granted'
  const upgrade = patentUpgrade || (newFinal && (!oldFinal || best.existing.status === 'early-access'))
  if (best.score >= 0.9) {
    return {
      status: upgrade ? 'upgrade' : 'existing',
      match: best.existing,
      confidence: best.score,
      reasons: best.reasons,
    }
  }
  return { status: 'ambiguous', match: best.existing, confidence: best.score, reasons: best.reasons }
}

function monthName(month) {
  return ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'][month - 1] || ''
}

function englishDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return value || ''
  return `${monthName(Number(match[2]))} ${Number(match[3])}, ${match[1]}`
}

function joinEnglishNames(names) {
  if (names.length <= 1) return names[0] || ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

function formatAuthors(authors = [], language = 'en') {
  const formatted = authors.map(name => {
    if (isSelfAuthor(name)) return `<strong>${language === 'zh' && /[\u3400-\u9fff]/.test(name) ? '王艺博' : 'Yibo Wang'}</strong>`
    return name
  })
  if (language === 'zh' && formatted.some(name => /[\u3400-\u9fff]/.test(name))) return formatted.join(', ')
  return joinEnglishNames(formatted)
}

function paperLink(record, language) {
  const url = record.url || (record.doi ? `https://doi.org/${cleanDoi(record.doi)}` : '')
  if (!url) return ''
  return ` [[${language === 'zh' ? '论文' : 'Paper'}]](${url})`
}

function buildEntry(record, language = 'en') {
  const localizedAuthors = language === 'zh'
    ? (record.authorsZh?.length ? record.authorsZh : record.authors)
    : (record.authorsEn?.length ? record.authorsEn : record.authors)
  const authors = formatAuthors(localizedAuthors, language)
  const title = language === 'zh'
    ? (record.titleZh || record.title)
    : (record.titleEn || record.title)
  if (record.type === 'patent') {
    const number = record.patentNumber || '【专利号】'
    const date = language === 'zh' ? record.date : englishDate(record.date)
    const link = record.url ? ` [[${language === 'zh' ? '专利' : 'Patent'}]](${record.url})` : ''
    if (language === 'zh') return `1. ${authors}. ${title}. 中国专利, ${number}, ${date}.${link}`
    return `1. ${authors}, "${title}," Chinese Patent ${number}, ${date}.${link}`
  }

  const venue = record.venue || '【Venue】'
  const year = record.year || '【Year】'
  const details = []
  if (record.volume) details.push(`vol. ${record.volume}`)
  if (record.issue) details.push(`no. ${record.issue}`)
  if (record.pages) details.push(`pp. ${record.pages}`)
  if (record.articleNumber) details.push(`Art. no. ${record.articleNumber}`)
  const detailText = details.length ? `, ${details.join(', ')}` : ''
  const prefix = record.type === 'conference' ? 'in ' : ''
  return `1. ${authors}, "${title}," ${prefix}*${venue}*${detailText}, ${year}.${paperLink(record, language)}`
}

function headingFor(type, language) {
  return SECTION_HEADINGS[language][type]
}

function normalizeListMarkers(sectionText) {
  return sectionText.replace(/^\s*\d+\.\s+/gm, '1. ')
}

function insertIntoSection(markdown, type, language, entry, year) {
  const heading = headingFor(type, language)
  const headingPattern = new RegExp(`(^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$)`, 'm')
  const match = headingPattern.exec(markdown)
  if (!match) throw new Error(`Missing section: ${heading}`)
  const start = match.index + match[0].length
  const nextHeadingRelative = markdown.slice(start).search(/\n##\s+/)
  const end = nextHeadingRelative === -1 ? markdown.length : start + nextHeadingRelative
  const before = markdown.slice(0, start)
  const section = markdown.slice(start, end)
  const after = markdown.slice(end)
  const lines = section.split(/\r?\n/)
  const entryLines = []
  const otherLines = []
  lines.forEach(line => (/^\s*\d+\.\s+/.test(line) ? entryLines : otherLines).push(line))
  const newYear = Number(year) || 9999
  let inserted = false
  const sorted = []
  for (const line of entryLines) {
    const lineYear = extractYear(line) || 0
    if (!inserted && newYear >= lineYear) {
      sorted.push(entry)
      inserted = true
    }
    sorted.push(line)
  }
  if (!inserted) sorted.push(entry)
  const rebuilt = `\n\n${normalizeListMarkers(sorted.join('\n\n'))}\n`
  return `${before}${rebuilt}${after.replace(/^\n+/, '\n\n')}`
}

function replaceEntry(markdown, oldRaw, newEntry) {
  if (!oldRaw || !markdown.includes(oldRaw)) throw new Error('Unable to find the Early Access entry to replace')
  return markdown.replace(oldRaw, newEntry)
}

function planRecord(record) {
  const existing = readExistingEntries()
  const comparison = compareRecord(record, existing.en)
  return {
    record,
    comparison,
    entryEn: buildEntry(record, 'en'),
    entryZh: buildEntry(record, 'zh'),
    counts: {
      journal: existing.en.filter(entry => entry.type === 'journal').length,
      conference: existing.en.filter(entry => entry.type === 'conference').length,
      patent: existing.en.filter(entry => entry.type === 'patent').length,
    },
  }
}

function applyPlan(plan) {
  if (plan.record.fixture || plan.record.source === 'fixture') throw new Error('测试数据禁止写入正式网站')
  if (!['new', 'upgrade'].includes(plan.comparison.status)) throw new Error(`当前状态为${plan.comparison.status}，不允许写入`)
  const existing = readExistingEntries()
  let en = existing.enMarkdown
  let zh = existing.zhMarkdown
  if (plan.comparison.status === 'upgrade') {
    en = replaceEntry(en, plan.comparison.match.raw, plan.entryEn)
    const zhMatch = compareRecord(plan.record, existing.zh)
    if (zhMatch.match) zh = replaceEntry(zh, zhMatch.match.raw, plan.entryZh)
    else zh = insertIntoSection(zh, plan.record.type, 'zh', plan.entryZh, plan.record.year)
  } else {
    en = insertIntoSection(en, plan.record.type, 'en', plan.entryEn, plan.record.year)
    zh = insertIntoSection(zh, plan.record.type, 'zh', plan.entryZh, plan.record.year)
  }
  const backupDir = path.join(ROOT, '.publication-monitor-backups')
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.writeFileSync(path.join(backupDir, `${stamp}-publications-en.md`), existing.enMarkdown)
  fs.writeFileSync(path.join(backupDir, `${stamp}-publications-zh.md`), existing.zhMarkdown)
  fs.writeFileSync(EN_PUBLICATIONS, en)
  fs.writeFileSync(ZH_PUBLICATIONS, zh)
  return { changed: [EN_PUBLICATIONS, ZH_PUBLICATIONS], backupDir }
}

function fixtureNames() {
  return fs.readdirSync(FIXTURES_DIR).filter(name => name.endsWith('.json')).map(name => name.replace(/\.json$/, ''))
}

function loadFixture(name) {
  const safeName = path.basename(String(name)).replace(/\.json$/, '')
  const filePath = path.join(FIXTURES_DIR, `${safeName}.json`)
  if (!fs.existsSync(filePath)) throw new Error(`Unknown fixture: ${safeName}`)
  return readJson(filePath)
}

function inventory() {
  const existing = readExistingEntries()
  return {
    total: existing.en.length,
    journal: existing.en.filter(entry => entry.type === 'journal').length,
    conference: existing.en.filter(entry => entry.type === 'conference').length,
    patent: existing.en.filter(entry => entry.type === 'patent').length,
    entries: existing.en,
  }
}

module.exports = {
  ROOT,
  EN_PUBLICATIONS,
  ZH_PUBLICATIONS,
  loadConfig,
  cleanDoi,
  normalizeTitle,
  titleSimilarity,
  parsePublicationMarkdown,
  readExistingEntries,
  compareRecord,
  buildEntry,
  planRecord,
  applyPlan,
  fixtureNames,
  loadFixture,
  inventory,
  hasFinalMetadata,
}
