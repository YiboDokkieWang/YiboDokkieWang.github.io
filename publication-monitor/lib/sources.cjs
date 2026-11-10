const { cleanDoi, loadConfig, normalizeTitle, titleSimilarity } = require('./core.cjs')
const { deduplicatePatentFamilies, enrichGooglePatentChinese, filterRelevantPatents, searchEpoPatentsByNames, searchGooglePatentsByInventors } = require('./patents.cjs')
const { loadPatentCache, savePatentCache } = require('./patent-cache.cjs')

const REQUEST_TIMEOUT_MS = 15000

function addOriginalLanguage(record) {
  const title = String(record.title || '')
  if (/[\u3400-\u9fff]/.test(title)) {
    return { ...record, titleZh: record.titleZh || title, originalLanguage: 'zh' }
  }
  return { ...record, originalLanguage: record.originalLanguage || 'en' }
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'YiboDokkieWang-Publication-Monitor/1.0 (academic profile maintenance)',
        ...(options.headers || {}),
      },
    })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

function crossrefDate(item) {
  const parts = item?.published?.['date-parts']?.[0]
    || item?.['published-print']?.['date-parts']?.[0]
    || item?.['published-online']?.['date-parts']?.[0]
  if (!parts?.length) return { year: null, date: '' }
  const [year, month = 1, day = 1] = parts
  return { year, date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` }
}

function crossrefAuthors(item) {
  return (item.author || []).map(author => [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean)
}

function crossrefType(item, requestedType) {
  if (requestedType && requestedType !== 'auto') return requestedType
  if (['proceedings-article', 'proceedings'].includes(item.type)) return 'conference'
  return 'journal'
}

function fromCrossrefItem(item, requestedType = 'auto') {
  const published = crossrefDate(item)
  const pages = item.page || ''
  const record = {
    fixture: false,
    type: crossrefType(item, requestedType),
    title: item.title?.[0] || '',
    authors: crossrefAuthors(item),
    venue: item['container-title']?.[0] || item['event']?.name || '',
    year: published.year,
    date: published.date,
    volume: item.volume || '',
    issue: item.issue || '',
    pages,
    articleNumber: !pages && item['article-number'] ? item['article-number'] : '',
    doi: cleanDoi(item.DOI || ''),
    url: item.URL || (item.DOI ? `https://doi.org/${cleanDoi(item.DOI)}` : ''),
    publisher: item.publisher || '',
    status: item.volume || item.issue || item.page || item['article-number'] ? 'final' : 'early-access',
    source: 'Crossref',
    sourceScore: Number(item.score) || 0,
  }
  if (!record.title) throw new Error('Crossref did not return a title')
  return addOriginalLanguage(record)
}

async function lookupCrossrefDoi(doi, requestedType = 'auto') {
  const normalized = cleanDoi(doi)
  if (!normalized) throw new Error('请输入有效DOI')
  const payload = await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(normalized)}`)
  return fromCrossrefItem(payload.message, requestedType)
}

async function searchCrossrefTitle(title, requestedType = 'auto', rows = 5) {
  if (!String(title).trim()) throw new Error('请输入论文题目')
  const params = new URLSearchParams({ 'query.title': title, rows: String(rows), select: 'DOI,title,author,container-title,published,published-print,published-online,volume,issue,page,article-number,type,URL,publisher,event' })
  const payload = await fetchJson(`https://api.crossref.org/works?${params.toString()}`)
  return (payload.message?.items || []).map(item => fromCrossrefItem(item, requestedType))
}

async function searchCrossrefBibliographic(query, requestedType = 'auto', rows = 10) {
  if (!String(query).trim()) throw new Error('请输入论文或专利信息')
  const params = new URLSearchParams({
    'query.bibliographic': String(query).trim(),
    rows: String(rows),
    select: 'DOI,title,author,container-title,published,published-print,published-online,volume,issue,page,article-number,type,URL,publisher,event,score',
  })
  const payload = await fetchJson(`https://api.crossref.org/works?${params.toString()}`)
  return (payload.message?.items || []).map(item => fromCrossrefItem(item, requestedType))
}

async function lookupSemanticScholar(identifier, requestedType = 'auto') {
  const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY || ''
  const id = cleanDoi(identifier) ? `DOI:${cleanDoi(identifier)}` : identifier
  const fields = 'title,authors,venue,year,publicationDate,publicationTypes,journal,externalIds,url'
  const payload = await fetchJson(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`, {
    headers: apiKey ? { 'x-api-key': apiKey } : {},
  })
  const journal = payload.journal || {}
  const type = requestedType !== 'auto'
    ? requestedType
    : (payload.publicationTypes || []).some(value => /conference/i.test(value)) ? 'conference' : 'journal'
  return {
    fixture: false,
    type,
    title: payload.title || '',
    authors: (payload.authors || []).map(author => author.name).filter(Boolean),
    venue: journal.name || payload.venue || '',
    year: payload.year || null,
    date: payload.publicationDate || '',
    volume: journal.volume || '',
    pages: journal.pages || '',
    doi: cleanDoi(payload.externalIds?.DOI || ''),
    url: payload.url || '',
    semanticScholarId: payload.paperId || '',
    status: journal.volume || journal.pages ? 'final' : 'early-access',
    source: 'Semantic Scholar',
  }
}

async function lookupIeeeDocument(documentId, requestedType = 'auto') {
  const apiKey = process.env.IEEE_API_KEY || ''
  if (!apiKey) throw new Error('尚未配置IEEE_API_KEY；可以先使用DOI、题目或测试数据验证')
  const params = new URLSearchParams({ apikey: apiKey, article_number: String(documentId), format: 'json', max_records: '5' })
  const payload = await fetchJson(`https://ieeexploreapi.ieee.org/api/v1/search/articles?${params.toString()}`)
  const item = payload.articles?.[0]
  if (!item) throw new Error(`IEEE Xplore未找到文献编号 ${documentId}`)
  return fromIeeeItem(item, requestedType, documentId)
}

function fromIeeeItem(item, requestedType = 'auto', fallbackDocumentId = '') {
  const documentId = item.article_number || String(fallbackDocumentId || '')
  return {
    fixture: false,
    type: requestedType !== 'auto' ? requestedType : (/conference/i.test(item.content_type || '') ? 'conference' : 'journal'),
    title: item.title || '',
    authors: (item.authors?.authors || []).map(author => author.full_name).filter(Boolean),
    venue: item.publication_title || '',
    year: Number(item.publication_year) || null,
    volume: item.volume || '',
    issue: item.issue || '',
    pages: item.start_page && item.end_page ? `${item.start_page}-${item.end_page}` : '',
    articleNumber: item.article_number || '',
    ieeeDocumentId: documentId,
    doi: cleanDoi(item.doi || ''),
    url: item.html_url || (documentId ? `https://ieeexplore.ieee.org/document/${documentId}` : ''),
    status: item.volume || item.issue || item.start_page ? 'final' : 'early-access',
    source: 'IEEE Xplore',
  }
}

async function listIeeeByAuthor(authorName) {
  const apiKey = process.env.IEEE_API_KEY || ''
  if (!apiKey) throw new Error('尚未配置IEEE_API_KEY')
  const params = new URLSearchParams({
    apikey: apiKey,
    author: authorName,
    format: 'json',
    max_records: '200',
    sort_field: 'publication_year',
    sort_order: 'desc',
  })
  const payload = await fetchJson(`https://ieeexploreapi.ieee.org/api/v1/search/articles?${params.toString()}`)
  const wanted = normalizeTitle(authorName)
  return (payload.articles || [])
    .filter(item => (item.authors?.authors || []).some(author => normalizeTitle(author.full_name) === wanted))
    .map(item => fromIeeeItem(item, 'auto'))
}

function parseBibtexAuthors(value = '') {
  return value.split(/\s+and\s+/i).map(name => {
    const parts = name.split(',').map(part => part.trim())
    return parts.length > 1 ? `${parts.slice(1).join(' ')} ${parts[0]}`.trim() : name.trim()
  }).filter(Boolean)
}

function bibtexField(text, field) {
  const pattern = new RegExp(`${field}\\s*=\\s*[{"]([\\s\\S]*?)[}"]\\s*,?`, 'i')
  return text.match(pattern)?.[1]?.replace(/\s+/g, ' ').trim() || ''
}

function parseBibtex(text, requestedType = 'auto') {
  const entryType = text.match(/^\s*@([A-Za-z]+)/)?.[1]?.toLowerCase() || ''
  const type = requestedType !== 'auto' ? requestedType : (/inproceedings|conference/.test(entryType) ? 'conference' : /patent/.test(entryType) ? 'patent' : 'journal')
  const pages = bibtexField(text, 'pages').replace(/--/g, '-')
  return {
    fixture: false,
    type,
    title: bibtexField(text, 'title').replace(/[{}]/g, ''),
    authors: parseBibtexAuthors(bibtexField(text, 'author')),
    venue: bibtexField(text, type === 'conference' ? 'booktitle' : 'journal'),
    year: Number(bibtexField(text, 'year')) || null,
    volume: bibtexField(text, 'volume'),
    issue: bibtexField(text, 'number'),
    pages,
    doi: cleanDoi(bibtexField(text, 'doi')),
    url: bibtexField(text, 'url') || (bibtexField(text, 'doi') ? `https://doi.org/${cleanDoi(bibtexField(text, 'doi'))}` : ''),
    status: bibtexField(text, 'volume') || pages ? 'final' : 'early-access',
    source: 'BibTeX',
  }
}

function parsePatentText(text) {
  const patentNumber = String(text).match(/\b(?:CN|EP|US|WO)\s?\d+[A-Z]\d?\b/i)?.[0]?.replace(/\s/g, '').toUpperCase() || ''
  const date = String(text).match(/\b(19|20)\d{2}[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/)?.[0]?.replace(/[/.]/g, '-') || ''
  const quoted = String(text).match(/[“"]([^”"]{5,})[”"]/)
  return {
    fixture: false,
    type: 'patent',
    title: quoted?.[1] || '',
    authors: [],
    year: Number(date.slice(0, 4)) || null,
    date,
    patentNumber,
    status: /\bB\d?\b/i.test(patentNumber) ? 'granted' : 'published',
    source: 'Manual patent input',
  }
}

function extractDoiFromText(text = '') {
  const match = String(text).match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)
  return match ? cleanDoi(match[0]) : ''
}

function cleanReferenceText(value = '') {
  return String(value)
    .replace(/<\/?(?:strong|em|i|b)>/gi, '')
    .replace(/\[\[([^\]]+)\]\]\([^)]+\)/g, '$1')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseReferenceAuthors(prefix = '') {
  return cleanReferenceText(prefix)
    .replace(/^\s*\[?\d+\]?\.?\s*/, '')
    .replace(/[,，;；.。\s]+$/g, '')
    .split(/\s*(?:,|，|;|；|\band\b|&|和)\s*/i)
    .map(name => name.trim())
    .filter(name => name.length >= 2 && name.length <= 80)
}

function extractVenueFromSuffix(suffix = '') {
  return cleanReferenceText(suffix)
    .replace(/^[,，.。\s]+/, '')
    .replace(/^in\s+/i, '')
    .split(/,\s*(?:vol\.|no\.|pp\.|art\.|19\d{2}|20\d{2})|，\s*(?:19\d{2}|20\d{2}|第?\d+[卷期])/i)[0]
    .replace(/[,，.。\s]+$/g, '')
    .trim()
}

function parseSmartInput(value = '') {
  const raw = String(value).trim()
  if (!raw) throw new Error('请粘贴论文、会议论文或专利信息')
  if (/^\s*@[A-Za-z]+\s*[{(]/.test(raw)) {
    const record = parseBibtex(raw, 'auto')
    return {
      kind: 'bibtex',
      raw,
      title: record.title,
      authors: record.authors,
      venue: record.venue,
      year: record.year,
      doi: record.doi,
      record,
    }
  }

  const doi = extractDoiFromText(raw)
  const patentNumber = raw.match(/\b(?:CN|EP|US|WO)\s?\d+[A-Z]\d?\b/i)?.[0]?.replace(/\s/g, '').toUpperCase() || ''
  const ieeeDocumentId = raw.match(/ieeexplore\.ieee\.org\/(?:document\/|author\/)?(\d{7,})/i)?.[1]
    || (/^\d{7,}$/.test(raw) ? raw : '')
  if (patentNumber) {
    const record = parsePatentText(raw)
    return { kind: 'patent', raw, patentNumber, title: record.title, authors: record.authors, year: record.year, record }
  }
  if (doi) return { kind: 'doi', raw, doi }
  if (ieeeDocumentId) return { kind: 'ieee', raw, ieeeDocumentId }

  const cleaned = cleanReferenceText(raw)
  const quoted = (
    cleaned.match(/[“"]([^”"]{6,}?)[”"]/)
  )
  let title = ''
  let authors = []
  let venue = ''
  if (quoted) {
    title = quoted[1].replace(/[,，;；\s]+$/g, '').trim()
    const start = quoted.index || 0
    authors = parseReferenceAuthors(cleaned.slice(0, start))
    venue = extractVenueFromSuffix(cleaned.slice(start + quoted[0].length))
  } else {
    const chinese = cleaned.match(/^\s*(?:\[?\d+\]?\.?\s*)?(.+?)[.。]\s*(.+?)\s*\[([JC])\]\s*[.。]?\s*(.*)$/i)
    if (chinese) {
      authors = parseReferenceAuthors(chinese[1])
      title = chinese[2].trim()
      venue = extractVenueFromSuffix(chinese[4])
    } else {
      title = cleaned
    }
  }
  const years = [...cleaned.matchAll(/\b(19|20)\d{2}\b/g)].map(match => Number(match[0]))
  return {
    kind: 'bibliographic',
    raw,
    title,
    authors,
    venue,
    year: years.length ? years[years.length - 1] : null,
  }
}

function normalizePerson(value = '') {
  return normalizeTitle(value).replace(/\s+/g, '')
}

function authorSimilarity(expected = [], actual = []) {
  if (!expected.length || !actual.length) return 0
  const actualNames = actual.map(normalizePerson)
  const matched = expected.filter(name => {
    const wanted = normalizePerson(name)
    return actualNames.some(candidate => candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate))
  }).length
  return matched / Math.max(expected.length, 1)
}

function containedTitleSimilarity(input, candidateTitle) {
  const left = normalizeTitle(input)
  const right = normalizeTitle(candidateTitle)
  if (!left || !right) return 0
  if (left.includes(right) || right.includes(left)) return 1
  return titleSimilarity(left, right)
}

function rankCandidates(candidates, analysis) {
  return candidates.map((candidate, index) => {
    const breakdown = {}
    let weightedScore = 0
    let totalWeight = 0
    const titleScore = containedTitleSimilarity(analysis.title || analysis.raw, candidate.title)
    breakdown.title = titleScore
    weightedScore += titleScore * 0.68
    totalWeight += 0.68
    if (analysis.authors?.length) {
      breakdown.authors = authorSimilarity(analysis.authors, candidate.authors)
      weightedScore += breakdown.authors * 0.18
      totalWeight += 0.18
    }
    if (analysis.venue) {
      breakdown.venue = containedTitleSimilarity(analysis.venue, candidate.venue)
      weightedScore += breakdown.venue * 0.09
      totalWeight += 0.09
    }
    if (analysis.year) {
      breakdown.year = Number(candidate.year) === Number(analysis.year) ? 1 : 0
      weightedScore += breakdown.year * 0.05
      totalWeight += 0.05
    }
    const structuredScore = totalWeight ? weightedScore / totalWeight : 0
    const sourceRankScore = Math.max(0, 1 - index * 0.08)
    const matchScore = Math.min(1, structuredScore * 0.92 + sourceRankScore * 0.08)
    return { ...candidate, matchScore, matchBreakdown: breakdown }
  }).sort((left, right) => right.matchScore - left.matchScore)
}

function enrichAnalysisFromCandidate(analysis, candidate) {
  if (!candidate) return analysis
  const rawNormalized = normalizeTitle(analysis.raw)
  const enriched = { ...analysis }
  if (rawNormalized.includes(normalizeTitle(candidate.title))) enriched.title = candidate.title
  if (!enriched.authors?.length) {
    enriched.authors = (candidate.authors || []).filter(author => rawNormalized.includes(normalizeTitle(author)))
  }
  if (!enriched.venue && candidate.venue && rawNormalized.includes(normalizeTitle(candidate.venue))) enriched.venue = candidate.venue
  if (!enriched.year && candidate.year && new RegExp(`\\b${candidate.year}\\b`).test(analysis.raw)) enriched.year = candidate.year
  return enriched
}

async function identifySmart(value, requestedType = 'auto') {
  const analysis = parseSmartInput(value)
  if (analysis.kind === 'bibtex') return { record: analysis.record, candidates: [], analysis }
  if (analysis.kind === 'patent') return { record: analysis.record, candidates: [], analysis }
  if (analysis.kind === 'doi') {
    try {
      return { record: await lookupCrossrefDoi(analysis.doi, requestedType), candidates: [], analysis }
    } catch {
      throw new Error('没有通过该DOI找到论文，请检查DOI是否完整或改为粘贴完整参考文献')
    }
  }
  if (analysis.kind === 'ieee') {
    return { record: await lookupIeeeDocument(analysis.ieeeDocumentId, requestedType), candidates: [], analysis }
  }
  const sourceCandidates = await searchCrossrefBibliographic(analysis.raw, requestedType)
  let candidates = rankCandidates(sourceCandidates, analysis)
  if (!candidates.length) throw new Error('没有找到相关文献，请补充题目、作者或DOI后重试')
  const enrichedAnalysis = enrichAnalysisFromCandidate(analysis, candidates[0])
  candidates = rankCandidates(sourceCandidates, enrichedAnalysis)
  return { record: candidates[0], candidates, analysis: enrichedAnalysis }
}

async function identify({ type = 'auto', inputKind = 'auto', value = '' }) {
  const requestedType = type || 'auto'
  if (inputKind === 'auto') return identifySmart(value, requestedType)
  if (inputKind === 'doi') {
    try {
      return { record: await lookupCrossrefDoi(value, requestedType), candidates: [] }
    } catch (crossrefError) {
      try {
        return { record: await lookupSemanticScholar(value, requestedType), candidates: [], warning: `Crossref查询失败，已使用Semantic Scholar：${crossrefError.message}` }
      } catch {
        throw crossrefError
      }
    }
  }
  if (inputKind === 'title') {
    let analysis = parseSmartInput(value)
    const sourceCandidates = await searchCrossrefBibliographic(value, requestedType)
    let candidates = rankCandidates(sourceCandidates, analysis)
    if (!candidates.length) throw new Error('没有找到匹配的论文')
    analysis = enrichAnalysisFromCandidate(analysis, candidates[0])
    candidates = rankCandidates(sourceCandidates, analysis)
    return { record: candidates[0], candidates, analysis }
  }
  if (inputKind === 'ieee') return { record: await lookupIeeeDocument(value, requestedType), candidates: [] }
  if (inputKind === 'bibtex') return { record: parseBibtex(value, requestedType), candidates: [] }
  if (inputKind === 'patent' || requestedType === 'patent') return { record: parsePatentText(value), candidates: [] }
  throw new Error(`暂不支持的输入方式：${inputKind}`)
}

async function listCrossrefByOrcid(orcidId) {
  const params = new URLSearchParams({ filter: `orcid:${orcidId}`, rows: '100', sort: 'published', order: 'desc' })
  const payload = await fetchJson(`https://api.crossref.org/works?${params.toString()}`)
  return (payload.message?.items || []).map(item => fromCrossrefItem(item, 'auto'))
}

async function listOrcidWorks(orcidId) {
  const payload = await fetchJson(`https://pub.orcid.org/v3.0/${encodeURIComponent(orcidId)}/works`, {
    headers: { Accept: 'application/vnd.orcid+json' },
  })
  const records = []
  for (const group of payload.group || []) {
    const summary = group['work-summary']?.[0]
    if (!summary) continue
    const ids = summary['external-ids']?.['external-id'] || []
    const doi = ids.find(id => id['external-id-type']?.toLowerCase() === 'doi')?.['external-id-value'] || ''
    const type = /conference/i.test(summary.type || '') ? 'conference' : /patent/i.test(summary.type || '') ? 'patent' : 'journal'
    if (type === 'patent') {
      let detail = null
      if (summary['put-code']) {
        try {
          detail = await fetchJson(`https://pub.orcid.org/v3.0/${encodeURIComponent(orcidId)}/work/${summary['put-code']}`, {
            headers: { Accept: 'application/vnd.orcid+json' },
          })
        } catch {}
      }
      const detailIds = detail?.['external-ids']?.['external-id'] || ids
      const externalValues = detailIds.map(item => item['external-id-value']).filter(Boolean)
      const patentNumber = externalValues
        .map(value => String(value).match(/\b(?:CN|EP|US|WO)\s?\d+[A-Z]\d?\b/i)?.[0] || '')
        .find(Boolean)?.replace(/\s/g, '').toUpperCase() || ''
      const contributors = (detail?.contributors?.contributor || [])
        .map(item => item['credit-name']?.value)
        .filter(Boolean)
      const dateValue = summary['publication-date']
      const year = Number(dateValue?.year?.value) || null
      const month = Number(dateValue?.month?.value) || 1
      const day = Number(dateValue?.day?.value) || 1
      records.push(addOriginalLanguage({
        fixture: false,
        type: 'patent',
        title: detail?.title?.title?.value || summary.title?.title?.value || '',
        authors: contributors,
        inventors: contributors,
        applicants: [],
        abstract: detail?.['short-description'] || '',
        classifications: [],
        year,
        date: year ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '',
        patentNumber,
        url: summary.url?.value || '',
        status: /[BCU]\d?$/i.test(patentNumber) ? 'granted' : 'published',
        source: 'ORCID',
      }))
      continue
    }
    const record = {
      fixture: false,
      type,
      title: summary.title?.title?.value || '',
      authors: [],
      venue: summary['journal-title']?.value || '',
      year: Number(summary['publication-date']?.year?.value) || null,
      doi: cleanDoi(doi),
      url: summary.url?.value || (doi ? `https://doi.org/${cleanDoi(doi)}` : ''),
      status: 'early-access',
      source: 'ORCID',
    }
    if (record.doi) {
      try {
        records.push(await lookupCrossrefDoi(record.doi, type))
        continue
      } catch {}
    }
    records.push(addOriginalLanguage(record))
  }
  return records
}

async function scanConfiguredSources() {
  const config = loadConfig()
  const all = []
  const sourceStatus = []
  let googleLiveSucceeded = false
  let epoLiveSucceeded = false
  let cachedPatentRecords = []
  let patentCacheSavedAt = null
  if (config.orcidId) {
    for (const [name, loader] of [
      ['Crossref ORCID', () => listCrossrefByOrcid(config.orcidId)],
      ['ORCID', () => listOrcidWorks(config.orcidId)],
    ]) {
      try {
        const records = await loader()
        all.push(...records)
        sourceStatus.push({ source: name, ok: true, count: records.length })
      } catch (error) {
        sourceStatus.push({ source: name, ok: false, count: 0, error: error.message })
      }
    }
  }
  if (config.ieeeAuthorName) {
    if (process.env.IEEE_API_KEY) {
      try {
        const records = await listIeeeByAuthor(config.ieeeAuthorName)
        all.push(...records)
        sourceStatus.push({ source: 'IEEE Xplore', ok: true, count: records.length })
      } catch (error) {
        sourceStatus.push({ source: 'IEEE Xplore', ok: false, count: 0, error: error.message })
      }
    } else {
      sourceStatus.push({ source: 'IEEE Xplore', ok: true, count: 0, skipped: true, message: '等待配置IEEE_API_KEY' })
    }
  }
  if (config.patentSearch?.enabled) {
    if (config.patentSearch.googlePatents?.enabled !== false) {
      try {
        const records = await searchGooglePatentsByInventors(
          config.patentSearch.nameAliases || config.authorNames,
          {
            aliases: config.patentSearch.googlePatents?.aliases,
          },
        )
        all.push(...records)
        googleLiveSucceeded = true
        sourceStatus.push({ source: 'Google Patents public search', ok: true, count: records.length })
      } catch (error) {
        sourceStatus.push({ source: 'Google Patents public search', ok: false, count: 0, error: error.message })
        const cache = loadPatentCache()
        cachedPatentRecords = cache.records.map(record => ({
          ...record,
          source: 'Google Patents cached fallback',
          cachedSource: record.source || 'Google Patents public search',
          cachedAt: cache.savedAt,
        }))
        patentCacheSavedAt = cache.savedAt
        sourceStatus.push({
          source: 'Patent cache fallback',
          ok: cachedPatentRecords.length > 0,
          count: cachedPatentRecords.length,
          skipped: cachedPatentRecords.length === 0,
          message: cachedPatentRecords.length ? `使用${cache.savedAt || '未知时间'}的最近成功结果` : '尚无可用的成功扫描缓存',
        })
      }
    }
    if (process.env.EPO_OPS_KEY && process.env.EPO_OPS_SECRET) {
      try {
        const records = await searchEpoPatentsByNames(config.patentSearch.nameAliases || config.authorNames)
        all.push(...records)
        epoLiveSucceeded = true
        sourceStatus.push({ source: 'EPO OPS patents', ok: true, count: records.length })
      } catch (error) {
        sourceStatus.push({ source: 'EPO OPS patents', ok: false, count: 0, error: error.message })
      }
    } else {
      sourceStatus.push({ source: 'EPO OPS patents', ok: true, count: 0, skipped: true, message: '等待配置EPO_OPS_KEY和EPO_OPS_SECRET' })
    }
  }
  const patentCandidates = all.filter(record => record.type === 'patent')
  const patentFilter = filterRelevantPatents(patentCandidates, config.patentSearch || {})
  if (cachedPatentRecords.length) {
    patentFilter.relevant = deduplicatePatentFamilies(
      [...patentFilter.relevant, ...cachedPatentRecords],
      config.patentSearch?.countryPriority,
    )
    patentFilter.examined += cachedPatentRecords.length
  }
  let localizedChinesePatents = 0
  for (let index = 0; index < patentFilter.relevant.length; index++) {
    const record = patentFilter.relevant[index]
    if (record.source !== 'Google Patents public search' || record.originalLanguage !== 'zh' || record.titleZh) continue
    try {
      patentFilter.relevant[index] = await enrichGooglePatentChinese(record)
      if (patentFilter.relevant[index].titleZh) localizedChinesePatents++
    } catch {}
  }
  if (googleLiveSucceeded) {
    const googleRecords = patentFilter.relevant.filter(record => record.source === 'Google Patents public search')
    if (googleRecords.length) {
      const cache = savePatentCache(googleRecords)
      patentCacheSavedAt = cache.savedAt
    }
  }
  sourceStatus.push({
    source: 'Patent identity and research filter',
    ok: true,
    count: patentFilter.relevant.length,
    ignored: patentFilter.ignored.length,
    examined: patentFilter.examined,
    localizedChinesePatents,
  })
  const eligibleRecords = [
    ...all.filter(record => record.type !== 'patent'),
    ...patentFilter.relevant,
  ]
  const deduplicated = []
  const seen = new Set()
  eligibleRecords.forEach(record => {
    const key = record.doi ? `doi:${cleanDoi(record.doi)}` : `title:${normalizeTitle(record.title)}`
    if (!seen.has(key)) {
      seen.add(key)
      deduplicated.push(record)
    }
  })
  return {
    records: deduplicated,
    sourceStatus,
    patentFilter: {
      examined: patentFilter.examined,
      relevant: patentFilter.relevant.length,
      ignored: patentFilter.ignored.length,
    },
    patentCoverage: {
      status: googleLiveSucceeded || epoLiveSucceeded ? 'complete' : cachedPatentRecords.length ? 'cached' : 'incomplete',
      googleLiveSucceeded,
      epoLiveSucceeded,
      cacheUsed: cachedPatentRecords.length > 0,
      cacheCount: cachedPatentRecords.length,
      cacheSavedAt: patentCacheSavedAt,
    },
  }
}

module.exports = {
  fetchJson,
  fromCrossrefItem,
  lookupCrossrefDoi,
  searchCrossrefTitle,
  searchCrossrefBibliographic,
  lookupSemanticScholar,
  lookupIeeeDocument,
  listIeeeByAuthor,
  parseBibtex,
  parsePatentText,
  parseSmartInput,
  rankCandidates,
  enrichAnalysisFromCandidate,
  identifySmart,
  identify,
  listCrossrefByOrcid,
  listOrcidWorks,
  scanConfiguredSources,
}
