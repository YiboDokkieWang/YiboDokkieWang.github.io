const crypto = require('crypto')
const { pinyin } = require('pinyin-pro')
const { normalizeTitle } = require('./core.cjs')
const PATENT_TRANSLATION_CACHE = require('../config.json').patentSearch?.translationCache || {}

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

function patentRoot(number = '') {
  return String(number).replace(/[.\s-]/g, '').replace(/[A-Z]\d?$/i, '').toUpperCase()
}

function patentCountry(number = '') {
  return String(number).replace(/[^A-Z]/gi, '').slice(0, 2).toUpperCase()
}

function normalizeChineseApplicationNumber(value = '') {
  const compact = String(value).toUpperCase().replace(/^CN\s*/i, '').replace(/[^0-9X]/g, '')
  if (!/^(?:19|20)\d{10}[0-9X]$/.test(compact)) return ''
  return `CN${compact.slice(0, -1)}.${compact.slice(-1)}`
}

function parseCnipaDate(value = '') {
  const digits = String(value).replace(/\D/g, '')
  if (!/^\d{8}$/.test(digits)) return ''
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

function splitCnipaParties(value = '') {
  return String(value).split(/[;,；，]/).map(item => item.trim()).filter(Boolean)
}

const COMPOUND_CHINESE_SURNAMES = new Set([
  '欧阳', '司马', '上官', '诸葛', '东方', '皇甫', '尉迟', '公孙', '慕容', '司徒', '司空',
])

function capitalizeRomanization(value = '') {
  return value ? value[0].toUpperCase() + value.slice(1).toLowerCase() : ''
}

function romanizeChineseName(value = '') {
  const name = String(value).trim()
  if (!/[\u3400-\u9fff]/.test(name)) return name
  if (name === '王艺博') return 'Yibo Wang'
  const surnameLength = COMPOUND_CHINESE_SURNAMES.has(name.slice(0, 2)) ? 2 : 1
  const surnameParts = pinyin(name.slice(0, surnameLength), { toneType: 'none', type: 'array' })
  const givenParts = pinyin(name.slice(surnameLength), { toneType: 'none', type: 'array' })
  const surname = capitalizeRomanization(surnameParts.join(''))
  const given = capitalizeRomanization(givenParts.join(''))
  return [given, surname].filter(Boolean).join(' ')
}

function parseCnipaPublicResults(payload = {}) {
  return (payload.patentList || []).map(item => {
    const patentNumber = String(item.pn || '').replace(/[.\s-]/g, '').toUpperCase()
    const applicationNumber = normalizeChineseApplicationNumber(item.an)
    const inventors = splitCnipaParties(item.e72)
    const applicants = splitCnipaParties(item.e71_73)
    const title = stripHtml(item.ti || '')
    const date = parseCnipaDate(item.pd || item.ad)
    const granted = /[BCU]\d?$/i.test(patentNumber) || [2, 4, 6, 8, 10].includes(Number(item.pubtype))
    return {
      fixture: false,
      type: 'patent',
      title,
      titleZh: title,
      titleEn: '',
      originalLanguage: 'zh',
      authors: inventors,
      authorsZh: inventors,
      inventors,
      applicants,
      abstract: stripHtml(item.abs || ''),
      classifications: splitCnipaParties(item.e51),
      year: Number(date.slice(0, 4)) || null,
      date,
      filingDate: parseCnipaDate(item.ad),
      publicationDate: parseCnipaDate(item.pd),
      applicationNumber,
      patentNumber,
      status: granted ? 'granted' : 'published',
      legalStatus: granted ? 'granted' : 'published-or-pending',
      url: patentNumber ? `https://patents.google.com/patent/${encodeURIComponent(patentNumber)}/zh` : 'https://app.gjzwfw.gov.cn/jmopen/webapp/html5/zlgbggcx/index.html',
      familyKey: patentRoot(patentNumber || applicationNumber),
      source: 'CNIPA public patent data',
    }
  }).filter(record => record.applicationNumber && record.patentNumber && record.title)
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
  const byPublicationFamily = new Map()
  for (const record of records) {
    const root = patentRoot(record.patentNumber)
    const key = root || `${normalizeTitle(record.title)}:${(record.inventors || record.authors || []).map(normalizePartyName).sort().join(':')}`
    if (!byPublicationFamily.has(key)) byPublicationFamily.set(key, record)
    else byPublicationFamily.set(key, choosePreferredPatent(byPublicationFamily.get(key), record, countryPriority))
  }
  const grouped = new Map()
  for (const record of byPublicationFamily.values()) {
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
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...fetchOptions, signal: controller.signal })
    if (!response.ok) {
      const error = new Error(`${response.status} ${response.statusText}`)
      error.status = response.status
      const retryAfter = response.headers.get('retry-after')
      if (retryAfter) {
        const seconds = Number(retryAfter)
        const dateDelay = Date.parse(retryAfter) - Date.now()
        error.retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, dateDelay || 0)
      }
      throw error
    }
    return response
  } finally {
    clearTimeout(timeout)
  }
}

function googlePatentSearchUrl(alias) {
  const query = `inventor="${String(alias).replace(/["\\]/g, ' ').trim()}"`
  return `https://patents.google.com/xhr/query?url=${encodeURIComponent(query)}&exp=&download=true`
}

async function fetchGooglePatentCsv(alias) {
  const fallbackDelays = [0, 10000, 30000, 60000]
  let lastError
  for (let attempt = 0; attempt < fallbackDelays.length; attempt++) {
    const delay = attempt === 0
      ? 0
      : Math.min(120000, Math.max(fallbackDelays[attempt], Number(lastError?.retryAfterMs) || 0))
    if (delay) await new Promise(resolve => setTimeout(resolve, delay))
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
      if (![429, 500, 502, 503, 504].includes(error.status) && !/^(429|5\d\d)\b/.test(error.message)) break
    }
  }
  throw lastError
}

async function fetchCnipaPublicPatentPage(query, options = {}) {
  const searchStr = String(query).trim()
  if (!searchStr) return { allCount: 0, records: [] }
  const requestTime = Date.now()
  const sign = crypto.createHash('md5').update(`zscqgbgg${requestTime}`).digest('hex')
  const condition = {
    from: '1',
    key: '6f0c5ce612ba4471acce875dd7e6f6a2',
    sign,
    requestTime,
    raw: {
      searchStr: normalizeChineseApplicationNumber(searchStr).replace(/^CN|\./g, '') || searchStr,
      from: Math.max(0, Number(options.from) || 0),
      size: Math.min(100, Math.max(1, Number(options.size) || 10)),
      pubtypeList: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    },
  }
  const response = await fetchWithTimeout('https://app.gjzwfw.gov.cn/jimps/link.do', {
    method: 'POST',
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Referer: 'https://app.gjzwfw.gov.cn/jmopen/webapp/html5/zlgbggcx/index.html',
      'User-Agent': 'Mozilla/5.0 (compatible; YiboDokkieWang-Publication-Manager/1.0)',
    },
    body: new URLSearchParams({ param: JSON.stringify(condition) }),
  })
  let payload = JSON.parse(await response.text())
  if (typeof payload === 'string') payload = JSON.parse(payload)
  return {
    allCount: Math.max(0, Number(payload.allCount) || 0),
    records: parseCnipaPublicResults(payload),
  }
}

async function searchCnipaPublicPatents(query, options = {}) {
  const size = Math.min(100, Math.max(1, Number(options.size) || 10))
  const maxResults = Math.min(5000, Math.max(size, Number(options.maxResults) || size))
  const first = await fetchCnipaPublicPatentPage(query, { from: 0, size })
  const records = [...first.records]
  const target = Math.min(first.allCount, maxResults)
  for (let from = size; from < target; from += size) {
    const page = await fetchCnipaPublicPatentPage(query, { from, size })
    records.push(...page.records)
  }
  const byNumber = new Map()
  records.forEach(record => byNumber.set(record.patentNumber, record))
  return [...byNumber.values()]
}

async function translateChineseText(value = '') {
  const text = String(value).trim()
  if (!text || !/[\u3400-\u9fff]/.test(text)) return text
  const params = new URLSearchParams({ client: 'gtx', sl: 'zh-CN', tl: 'en', dt: 't', q: text })
  try {
    const response = await fetchWithTimeout(`https://translate.googleapis.com/translate_a/single?${params.toString()}`, {
      timeoutMs: 10000,
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; YiboDokkieWang-Publication-Manager/1.0)',
      },
    })
    const payload = JSON.parse(await response.text())
    const translated = (payload?.[0] || []).map(part => part?.[0] || '').join('').trim()
    if (translated) return translated
  } catch {
    // Try the independent backup service below.
  }
  const backupParams = new URLSearchParams({ q: text, langpair: 'zh-CN|en' })
  const backup = await fetchWithTimeout(`https://api.mymemory.translated.net/get?${backupParams.toString()}`, {
    timeoutMs: 10000,
    headers: { Accept: 'application/json', 'User-Agent': 'YiboDokkieWang-Publication-Manager/1.0' },
  })
  const backupPayload = JSON.parse(await backup.text())
  return String(backupPayload?.responseData?.translatedText || '').trim()
}

async function localizePatentRecord(record = {}) {
  if (record.type !== 'patent') return record
  const chineseInventors = record.authorsZh?.length
    ? record.authorsZh
    : (record.inventors?.length ? record.inventors : record.authors || [])
  const cached = PATENT_TRANSLATION_CACHE[String(record.patentNumber || '').toUpperCase()] || {}
  let titleEn = record.titleEn || cached.titleEn || (!/[\u3400-\u9fff]/.test(record.title || '') ? record.title : '')
  let authorsEn = record.authorsEn?.length ? record.authorsEn : (cached.authorsEn || chineseInventors.map(romanizeChineseName))
  let translationSource = record.translationSource || (cached.titleEn ? 'Verified local translation cache' : '')

  if (record.patentNumber && (!titleEn || !authorsEn.length)) {
    try {
      const response = await fetchWithTimeout(`https://patents.google.com/patent/${encodeURIComponent(record.patentNumber)}/en`, {
        timeoutMs: 7000,
        headers: {
          Accept: 'text/html,*/*;q=0.8',
          Referer: 'https://patents.google.com/',
          'User-Agent': 'Mozilla/5.0 (compatible; YiboDokkieWang-Publication-Manager/1.0)',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      })
      const metadata = parseGooglePatentHtml(await response.text(), 'en')
      if (metadata.title && !/[\u3400-\u9fff]/.test(metadata.title)) {
        titleEn = metadata.title
        translationSource = 'Google Patents English metadata'
      }
      if (metadata.inventors.length) authorsEn = metadata.inventors.map(romanizeChineseName)
    } catch {
      // Fall through to machine translation while retaining the official Chinese metadata.
    }
  }

  if (!titleEn) {
    try {
      titleEn = await translateChineseText(record.titleZh || record.title)
      if (titleEn) translationSource = 'Machine translation'
    } catch {
      titleEn = record.titleZh || record.title || ''
      translationSource = 'Chinese original (English translation unavailable)'
    }
  }

  return {
    ...record,
    title: titleEn || record.title,
    titleEn: titleEn || record.title,
    titleZh: record.titleZh || record.title,
    authors: authorsEn.length ? authorsEn : record.authors,
    authorsEn,
    authorsZh: chineseInventors,
    inventors: chineseInventors,
    translationSource,
  }
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

function verifiedPatentRecord(seed = {}, metadata = {}, source = 'Verified patent record') {
  const patentNumber = String(seed.patentNumber || '').replace(/[.\s-]/g, '').toUpperCase()
  const liveInventors = metadata.inventors || []
  const inventors = liveInventors.length ? liveInventors : (seed.inventors || [])
  const titleZh = metadata.title || seed.titleZh || ''
  const titleEn = seed.titleEn || ''
  const date = seed.date || ''
  return {
    fixture: false,
    type: 'patent',
    title: titleEn || titleZh,
    titleEn,
    titleZh,
    originalLanguage: 'zh',
    authors: inventors,
    authorsZh: inventors,
    authorsEn: seed.inventorsEn || [],
    inventors,
    applicants: metadata.applicants?.length ? metadata.applicants : (seed.applicants || []),
    abstract: metadata.abstract || '',
    classifications: metadata.classifications || [],
    year: Number(String(date).slice(0, 4)) || null,
    date,
    patentNumber,
    status: seed.status || (/[BCU]\d?$/i.test(patentNumber) ? 'granted' : 'published'),
    legalStatus: seed.status || 'published-or-pending',
    url: patentNumber ? `https://patents.google.com/patent/${encodeURIComponent(patentNumber)}/zh` : '',
    familyKey: patentRoot(patentNumber),
    source,
    identityVerified: true,
  }
}

async function verifyKnownGooglePatent(seed = {}) {
  const patentNumber = String(seed.patentNumber || '').replace(/[.\s-]/g, '').toUpperCase()
  if (!patentNumber) throw new Error('已知专利缺少专利号')
  try {
    const response = await fetchWithTimeout(`https://patents.google.com/patent/${encodeURIComponent(patentNumber)}/zh`, {
      headers: {
        Accept: 'text/html,*/*;q=0.8',
        Referer: 'https://patents.google.com/',
        'User-Agent': 'Mozilla/5.0 (compatible; YiboDokkieWang-Publication-Monitor/1.0)',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
      },
    })
    const metadata = parseGooglePatentHtml(await response.text(), 'zh')
    if (!metadata.title) throw new Error('Google Patents页面未返回专利题目')
    return {
      live: true,
      record: verifiedPatentRecord(seed, metadata, 'Google Patents known-patent verification'),
    }
  } catch (error) {
    return {
      live: false,
      error: error.message,
      record: verifiedPatentRecord(seed, {}, 'Verified local patent fallback'),
    }
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
  localizePatentRecord,
  normalizeChineseApplicationNumber,
  parseCnipaPublicResults,
  parseGooglePatentCsv,
  parseGooglePatentHtml,
  parseGooglePatentResults,
  patentRoot,
  romanizeChineseName,
  searchCnipaPublicPatents,
  searchGooglePatentsByInventors,
  verifyKnownGooglePatent,
  verifiedPatentRecord,
}
