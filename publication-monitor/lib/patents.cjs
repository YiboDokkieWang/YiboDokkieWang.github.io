const { normalizeTitle } = require('./core.cjs')

const REQUEST_TIMEOUT_MS = 20000

function decodeXml(value = '') {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
}

function stripXml(value = '') {
  return decodeXml(String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

function decodeHtml(value = '') {
  return decodeXml(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&hellip;/gi, '…')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&#39;/g, "'")
}

function stripHtml(value = '') {
  return decodeHtml(String(value).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function tagBlocks(xml, tag) {
  const pattern = new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>[\\s\\S]*?<\\/(?:[\\w-]+:)?${tag}>`, 'gi')
  return String(xml).match(pattern) || []
}

function tagValues(xml, tag) {
  const pattern = new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, 'gi')
  return [...String(xml).matchAll(pattern)].map(match => stripXml(match[1])).filter(Boolean)
}

function localizedTagValues(xml, tag) {
  return tagBlocks(xml, tag).map(block => {
    const openingTag = block.match(new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>`, 'i'))?.[0] || ''
    return {
      language: attribute(openingTag, 'lang').toLowerCase(),
      value: stripXml(block),
    }
  }).filter(item => item.value)
}

function attribute(openingTag, name) {
  return openingTag.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'))?.[1] || ''
}

function dateFromEpo(value = '') {
  const digits = String(value).replace(/\D/g, '')
  if (digits.length !== 8) return ''
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

function patentRoot(number = '') {
  return String(number).replace(/[.\s-]/g, '').replace(/[A-Z]\d?$/i, '').toUpperCase()
}

function patentCountry(number = '') {
  return String(number).replace(/[^A-Z]/gi, '').slice(0, 2).toUpperCase()
}

function parseEpoExchangeXml(xml) {
  return tagBlocks(xml, 'exchange-document').map(block => {
    const openingTag = block.match(/<(?:[\w-]+:)?exchange-document\b[^>]*>/i)?.[0] || ''
    const country = attribute(openingTag, 'country') || tagValues(tagBlocks(block, 'publication-reference')[0] || block, 'country')[0] || ''
    const documentNumber = attribute(openingTag, 'doc-number') || tagValues(tagBlocks(block, 'publication-reference')[0] || block, 'doc-number')[0] || ''
    const kind = attribute(openingTag, 'kind') || tagValues(tagBlocks(block, 'publication-reference')[0] || block, 'kind')[0] || ''
    const patentNumber = `${country}${documentNumber}${kind}`.replace(/[.\s-]/g, '').toUpperCase()
    const titles = localizedTagValues(block, 'invention-title')
    const titleZh = titles.find(item => item.language.startsWith('zh') || /[\u3400-\u9fff]/.test(item.value))?.value || ''
    const titleEn = titles.find(item => item.language.startsWith('en'))?.value
      || titles.find(item => !/[\u3400-\u9fff]/.test(item.value))?.value
      || ''
    const title = titleEn || titleZh || titles[0]?.value || ''
    const inventors = tagBlocks(block, 'inventor').flatMap(item => tagValues(item, 'name'))
    const applicants = tagBlocks(block, 'applicant').flatMap(item => tagValues(item, 'name'))
    const classifications = [
      ...tagBlocks(block, 'classification-ipcr').flatMap(item => tagValues(item, 'text')),
      ...tagValues(block, 'main-classification'),
    ].map(value => value.replace(/\s+/g, ' ').trim()).filter(Boolean)
    const publicationBlock = tagBlocks(block, 'publication-reference')[0] || ''
    const date = dateFromEpo(tagValues(publicationBlock, 'date')[0] || '')
    const abstract = stripXml(tagBlocks(block, 'abstract')[0] || '')
    return {
      fixture: false,
      type: 'patent',
      title,
      titleEn,
      titleZh,
      originalLanguage: titleZh && String(country).toUpperCase() === 'CN' ? 'zh' : (titleEn ? 'en' : ''),
      authors: [...new Set(inventors)],
      inventors: [...new Set(inventors)],
      applicants: [...new Set(applicants)],
      abstract,
      classifications: [...new Set(classifications)],
      year: Number(date.slice(0, 4)) || null,
      date,
      patentNumber,
      status: /^B\d?$|^C\d?$|^U\d?$/i.test(kind) ? 'granted' : 'published',
      url: patentNumber ? `https://worldwide.espacenet.com/patent/search?q=pn%3D${encodeURIComponent(patentNumber)}` : '',
      familyKey: `${patentRoot(patentNumber)}:${normalizeTitle(title)}`,
      source: 'EPO OPS',
    }
  }).filter(record => record.title || record.patentNumber)
}

function parseGooglePatentResults(payload) {
  const clusters = payload?.results?.cluster || []
  return clusters.flatMap(cluster => cluster.result || []).map(item => item.patent || {}).map(patent => {
    const patentNumber = String(patent.publication_number || '').replace(/[.\s-]/g, '').toUpperCase()
    const kind = patentNumber.match(/[A-Z]\d?$/i)?.[0] || ''
    const title = stripHtml(patent.title || '').replace(/\s*…\s*$/, '').trim()
    const titleIsChinese = /[\u3400-\u9fff]/.test(title)
    const inventors = stripHtml(patent.inventor || '').split(/[;,；，]/).map(value => value.trim()).filter(Boolean)
    const applicants = stripHtml(patent.assignee || '').split(/[;,；，]/).map(value => value.trim()).filter(Boolean)
    const date = patent.grant_date || patent.publication_date || patent.filing_date || patent.priority_date || ''
    return {
      fixture: false,
      type: 'patent',
      title,
      titleEn: titleIsChinese ? '' : title,
      titleZh: titleIsChinese ? title : '',
      originalLanguage: patentNumber.startsWith('CN') || titleIsChinese ? 'zh' : 'en',
      authors: inventors,
      inventors,
      applicants,
      abstract: stripHtml(patent.snippet || ''),
      classifications: [],
      year: Number(String(date).slice(0, 4)) || null,
      date,
      patentNumber,
      status: patent.grant_date || /^B\d?$|^C\d?$|^U\d?$/i.test(kind) ? 'granted' : 'published',
      legalStatus: patent.grant_date ? 'granted' : 'published-or-pending',
      url: patentNumber ? `https://patents.google.com/patent/${encodeURIComponent(patentNumber)}/zh` : '',
      familyKey: patentRoot(patentNumber),
      source: 'Google Patents public search',
    }
  }).filter(record => record.patentNumber && record.title)
}

function parseCsvRows(text = '') {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < String(text).length; index++) {
    const character = text[index]
    if (quoted && character === '"' && text[index + 1] === '"') {
      cell += '"'
      index++
    } else if (character === '"') quoted = !quoted
    else if (character === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index++
      row.push(cell)
      if (row.some(value => value !== '')) rows.push(row)
      row = []
      cell = ''
    } else cell += character
  }
  if (cell || row.length) {
    row.push(cell)
    if (row.some(value => value !== '')) rows.push(row)
  }
  return rows
}

function parseGooglePatentCsv(text) {
  const rows = parseCsvRows(text)
  const headerIndex = rows.findIndex(row => String(row[0]).trim().toLowerCase() === 'id')
  if (headerIndex === -1) throw new Error('Google Patents未返回可识别的CSV表头')
  return rows.slice(headerIndex + 1).map(row => ({
    title: row[1] || '',
    assignee: row[2] || '',
    inventor: row[3] || '',
    priority_date: row[4] || '',
    filing_date: row[5] || '',
    publication_date: row[6] || '',
    grant_date: row[7] || '',
    publication_number: String(row[0] || '').replace(/^patent\//i, '').replace(/\/(?:en|zh)$/i, ''),
    snippet: '',
  })).filter(item => item.publication_number && item.title)
}

function metaAttributes(tag) {
  const attributes = {}
  for (const match of tag.matchAll(/([\w:-]+)=["']([\s\S]*?)["']/g)) attributes[match[1].toLowerCase()] = decodeHtml(match[2])
  return attributes
}

function parseGooglePatentHtml(html, language = 'zh') {
  const metadata = [...String(html).matchAll(/<meta\b[^>]*>/gi)].map(match => metaAttributes(match[0]))
  const value = (name, scheme = '') => metadata.find(item =>
    String(item.name || '').toLowerCase() === name.toLowerCase()
    && (!scheme || String(item.scheme || '').toLowerCase() === scheme.toLowerCase()))?.content || ''
  const values = (name, scheme = '') => metadata.filter(item =>
    String(item.name || '').toLowerCase() === name.toLowerCase()
    && (!scheme || String(item.scheme || '').toLowerCase() === scheme.toLowerCase()))
    .map(item => stripHtml(item.content || ''))
    .filter(Boolean)
  const title = stripHtml(value('DC.title'))
  return {
    language,
    title,
    abstract: stripHtml(value('DC.description')),
    inventors: values('DC.contributor', 'inventor'),
    applicants: values('DC.contributor', 'assignee'),
    classifications: [...new Set([
      ...values('DC.relation', 'CPC'),
      ...values('DC.relation', 'IPC'),
    ])],
  }
}

function normalizePartyName(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function partyMatchesAlias(party, aliases) {
  const normalized = normalizePartyName(party)
  return aliases.some(alias => {
    const wanted = normalizePartyName(alias)
    return wanted && (normalized === wanted || normalized.startsWith(wanted) || normalized.endsWith(wanted))
  })
}

function keywordHits(text, keywords = []) {
  const haystack = normalizeTitle(text)
  return keywords.filter(keyword => {
    const needle = normalizeTitle(keyword)
    return needle && haystack.includes(needle)
  })
}

function classificationHits(classifications = [], prefixes = []) {
  const normalized = classifications.map(value => String(value).replace(/\s+/g, '').toUpperCase())
  return prefixes.filter(prefix => normalized.some(value => value.startsWith(String(prefix).toUpperCase())))
}

function assessPatentRelevance(record, profile = {}) {
  const aliases = profile.nameAliases || ['Yibo Wang', 'Wang Yibo', 'Wang, Yibo', '王艺博']
  const inventors = record.inventors?.length ? record.inventors : record.authors || []
  const applicants = record.applicants || []
  const inventorMatches = inventors.filter(name => partyMatchesAlias(name, aliases))
  const applicantMatches = applicants.filter(name => partyMatchesAlias(name, aliases))
  const identityMatched = Boolean(record.identityVerified || inventorMatches.length || applicantMatches.length)
  if (!identityMatched) {
    return { relevant: false, identityMatched: false, score: 0, reasons: ['发明人和申请人均未匹配本人姓名'], matchedKeywords: [] }
  }

  const title = record.title || ''
  const abstract = record.abstract || ''
  const strongTitle = keywordHits(title, profile.strongKeywords)
  const strongAbstract = keywordHits(abstract, profile.strongKeywords)
  const supportingTitle = keywordHits(title, profile.supportingKeywords)
  const supportingAbstract = keywordHits(abstract, profile.supportingKeywords)
  const classes = classificationHits(record.classifications, profile.classificationPrefixes)
  const collaboratorMatches = [...inventors, ...applicants].filter(name => partyMatchesAlias(name, profile.knownCollaborators || []))
  const affiliationMatches = applicants.filter(name => keywordHits(name, profile.affiliations || []).length)

  let score = 0
  const reasons = []
  if (strongTitle.length) {
    score += Math.min(8, strongTitle.length * 4)
    reasons.push(`题目命中核心方向：${strongTitle.join('、')}`)
  }
  if (strongAbstract.length) {
    score += Math.min(5, strongAbstract.length * 1.5)
    reasons.push(`摘要命中核心方向：${strongAbstract.slice(0, 4).join('、')}`)
  }
  if (supportingTitle.length) {
    score += Math.min(4, supportingTitle.length * 2)
    reasons.push(`题目命中相关技术：${supportingTitle.join('、')}`)
  }
  if (supportingAbstract.length) score += Math.min(2, supportingAbstract.length * 0.5)
  if (classes.length) {
    score += Math.min(6, classes.length * 3)
    reasons.push(`IPC/CPC分类相关：${classes.join('、')}`)
  }
  if (collaboratorMatches.length) {
    score += 2
    reasons.push(`命中已知合作者：${collaboratorMatches.join('、')}`)
  }
  if (affiliationMatches.length) {
    score += 2
    reasons.push(`申请人单位与履历相符：${affiliationMatches.join('、')}`)
  }
  if (applicantMatches.length) {
    score += 2
    reasons.push(`申请人姓名匹配本人：${applicantMatches.join('、')}`)
  }
  const threshold = Number(profile.minimumRelevanceScore) || 5
  const matchedKeywords = [...new Set([...strongTitle, ...strongAbstract, ...supportingTitle, ...supportingAbstract])]
  return {
    relevant: score >= threshold,
    identityMatched: true,
    identityMatches: [...new Set([...inventorMatches, ...applicantMatches])],
    score,
    threshold,
    reasons: reasons.length ? reasons : ['姓名匹配，但未发现与主要研究方向足够相关的技术特征'],
    matchedKeywords,
  }
}

function choosePreferredPatent(left, right, countryPriority = ['CN', 'WO', 'EP', 'US']) {
  const rank = record => {
    const granted = record.status === 'granted' ? 100 : 0
    const countryIndex = countryPriority.indexOf(patentCountry(record.patentNumber))
    const country = countryIndex === -1 ? 0 : countryPriority.length - countryIndex
    const date = Number(String(record.date || '').replace(/\D/g, '')) || 0
    return granted * 1e12 + country * 1e10 + date
  }
  return rank(right) > rank(left) ? right : left
}

function deduplicatePatentFamilies(records, countryPriority) {
  const grouped = new Map()
  for (const record of records) {
    const inventorKey = (record.inventors || record.authors || []).map(normalizePartyName).sort().join(':')
    const titleKey = normalizeTitle(record.title)
    const key = titleKey ? `${titleKey}:${inventorKey}` : patentRoot(record.patentNumber)
    if (!grouped.has(key)) grouped.set(key, record)
    else grouped.set(key, choosePreferredPatent(grouped.get(key), record, countryPriority))
  }
  return [...grouped.values()]
}

function filterRelevantPatents(records, profile = {}) {
  const deduplicated = deduplicatePatentFamilies(records, profile.countryPriority)
  const relevant = []
  const ignored = []
  for (const record of deduplicated) {
    const assessment = assessPatentRelevance(record, profile)
    const enriched = {
      ...record,
      relevanceScore: assessment.score,
      relevanceReasons: assessment.reasons,
      matchedKeywords: assessment.matchedKeywords,
    }
    if (assessment.relevant) relevant.push(enriched)
    else ignored.push(enriched)
  }
  return { examined: deduplicated.length, relevant, ignored }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return response
  } finally {
    clearTimeout(timeout)
  }
}

async function requestEpoToken(key, secret) {
  if (!key || !secret) throw new Error('尚未配置EPO_OPS_KEY和EPO_OPS_SECRET')
  const basic = Buffer.from(`${key}:${secret}`).toString('base64')
  const response = await fetchWithTimeout('https://ops.epo.org/3.2/auth/accesstoken', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  const payload = await response.json()
  if (!payload.access_token) throw new Error('EPO OPS未返回访问令牌')
  return payload.access_token
}

function epoNameQuery(name) {
  const escaped = String(name).replace(/["\\]/g, ' ').trim()
  return `(inventor="${escaped}" or applicant="${escaped}")`
}

async function searchEpoPatentsByNames(names, options = {}) {
  const key = options.key || process.env.EPO_OPS_KEY || ''
  const secret = options.secret || process.env.EPO_OPS_SECRET || ''
  const token = await requestEpoToken(key, secret)
  const uniqueNames = [...new Set((names || []).map(String).map(value => value.trim()).filter(Boolean))]
  const query = uniqueNames.map(epoNameQuery).join(' or ')
  const endpoint = `https://ops.epo.org/3.2/rest-services/published-data/search/biblio,abstract?q=${encodeURIComponent(query)}`
  const response = await fetchWithTimeout(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/exchange+xml',
      'X-OPS-Range': '1-100',
    },
  })
  return parseEpoExchangeXml(await response.text())
}

function googlePatentSearchUrl(alias) {
  const query = `inventor="${String(alias).replace(/["\\]/g, ' ').trim()}"`
  return `https://patents.google.com/xhr/query?url=${encodeURIComponent(query)}&exp=&download=true`
}

async function fetchGooglePatentCsv(alias) {
  const delays = [0, 2500, 6000]
  let lastError
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await new Promise(resolve => setTimeout(resolve, delays[attempt]))
    try {
      const response = await fetchWithTimeout(googlePatentSearchUrl(alias), {
        headers: {
          Accept: 'text/csv,*/*;q=0.8',
          Referer: 'https://patents.google.com/',
          'User-Agent': 'Mozilla/5.0 (compatible; YiboDokkieWang-Publication-Monitor/1.0)',
        },
      })
      return response.text()
    } catch (error) {
      lastError = error
      if (!/^(429|5\d\d)\b/.test(error.message)) break
    }
  }
  throw lastError
}

async function enrichGooglePatentChinese(record) {
  if (!record?.patentNumber || record.titleZh) return record
  const response = await fetchWithTimeout(`https://patents.google.com/patent/${encodeURIComponent(record.patentNumber)}/zh`, {
    headers: {
      Accept: 'text/html,*/*;q=0.8',
      Referer: 'https://patents.google.com/',
      'User-Agent': 'Mozilla/5.0 (compatible; YiboDokkieWang-Publication-Monitor/1.0)',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
    },
  })
  const metadata = parseGooglePatentHtml(await response.text(), 'zh')
  if (!metadata.title || !/[\u3400-\u9fff]/.test(metadata.title)) return record
  return {
    ...record,
    titleZh: metadata.title,
    authorsZh: metadata.inventors.length ? metadata.inventors : record.authorsZh,
    abstractZh: metadata.abstract,
    applicantsZh: metadata.applicants,
    classifications: metadata.classifications.length ? metadata.classifications : record.classifications,
    originalLanguage: 'zh',
  }
}

async function searchGooglePatentsByInventors(names, options = {}) {
  const aliases = [...new Set((options.aliases || names || []).map(String).map(value => value.trim()).filter(Boolean))]
  const records = []

  for (const alias of aliases) {
    const csv = await fetchGooglePatentCsv(alias)
    const items = parseGooglePatentCsv(csv)
    records.push(...parseGooglePatentResults({ results: { cluster: [{ result: items.map(patent => ({ patent })) }] } }))
  }

  const byNumber = new Map()
  records.forEach(record => byNumber.set(record.patentNumber, record))
  return [...byNumber.values()]
}

module.exports = {
  assessPatentRelevance,
  deduplicatePatentFamilies,
  enrichGooglePatentChinese,
  filterRelevantPatents,
  parseGooglePatentCsv,
  parseGooglePatentHtml,
  parseGooglePatentResults,
  parseEpoExchangeXml,
  patentRoot,
  requestEpoToken,
  searchEpoPatentsByNames,
  searchGooglePatentsByInventors,
}
