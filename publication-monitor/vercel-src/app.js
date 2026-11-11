const state = {
  plan: null,
  candidates: [],
  selectedCandidateIndex: 0,
  activeLanguage: 'en',
  submitted: false,
}

const elements = {
  form: document.getElementById('identify-form'),
  type: document.getElementById('type'),
  inputKind: document.getElementById('input-kind'),
  value: document.getElementById('value'),
  emptyState: document.getElementById('empty-state'),
  resultContent: document.getElementById('result-content'),
  resultStatus: document.getElementById('result-status'),
  metadata: document.getElementById('metadata'),
  warning: document.getElementById('warning'),
  analysis: document.getElementById('analysis'),
  candidateSection: document.getElementById('candidate-section'),
  candidateList: document.getElementById('candidate-list'),
  matchLabel: document.getElementById('match-label'),
  confidence: document.getElementById('confidence'),
  entryPreview: document.getElementById('entry-preview'),
  markdownPreview: document.getElementById('markdown-preview'),
  applyArea: document.getElementById('apply-area'),
  confirmation: document.getElementById('confirmation'),
  applyButton: document.getElementById('apply-button'),
  reportPanel: document.getElementById('report-panel'),
  reportContent: document.getElementById('report-content'),
  toast: document.getElementById('toast'),
  countJournal: document.getElementById('count-journal'),
  countConference: document.getElementById('count-conference'),
  countPatent: document.getElementById('count-patent'),
}

const editElements = {
  toggle: document.getElementById('edit-toggle'),
  form: document.getElementById('edit-form'),
  cancel: document.getElementById('edit-cancel'),
  type: document.getElementById('edit-type'),
  year: document.getElementById('edit-year'),
  titleEn: document.getElementById('edit-title-en'),
  titleZh: document.getElementById('edit-title-zh'),
  authorsEn: document.getElementById('edit-authors-en'),
  authorsZh: document.getElementById('edit-authors-zh'),
  venue: document.getElementById('edit-venue'),
  doi: document.getElementById('edit-doi'),
  volume: document.getElementById('edit-volume'),
  issue: document.getElementById('edit-issue'),
  pages: document.getElementById('edit-pages'),
  articleNumber: document.getElementById('edit-article-number'),
  applicationNumber: document.getElementById('edit-application-number'),
  patentNumber: document.getElementById('edit-patent-number'),
  date: document.getElementById('edit-date'),
  patentStatus: document.getElementById('edit-patent-status'),
}

const labels = {
  new: '网站尚未收录',
  existing: '网站已经收录',
  upgrade: '可替换早期版本',
  ambiguous: '疑似重复，需要确认',
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const data = await response.json()
  if (!response.ok || data.ok === false) throw new Error(data.error || '操作失败')
  return data
}

function showToast(message, error = false) {
  elements.toast.textContent = message
  elements.toast.className = `toast show${error ? ' error' : ''}`
  window.clearTimeout(showToast.timer)
  showToast.timer = window.setTimeout(() => { elements.toast.className = 'toast' }, 4500)
}

function setBusy(button, busy, text = '处理中…') {
  if (!button) return
  if (busy) {
    button.dataset.originalText = button.textContent
    button.textContent = text
    button.disabled = true
  } else {
    button.textContent = button.dataset.originalText || button.textContent
    button.disabled = false
  }
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderEntry(markdown) {
  let html = escapeHtml(String(markdown || '').replace(/^1\.\s+/, ''))
  html = html
    .replace(/&lt;strong&gt;([\s\S]*?)&lt;\/strong&gt;/gi, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[\[([^\]]+)\]\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">[$1]</a>')
  return `<p>${html}</p>`
}

function metadataRows(record) {
  const patentStatus = record.status === 'granted' ? '已授权' : '已公开 / 未授权（含实审阶段）'
  const values = [
    ['类型', record.type === 'journal' ? '期刊论文' : record.type === 'conference' ? '会议论文' : '专利'],
    ['题目', record.title || '未识别'],
    ['作者', (record.authors || record.inventors || []).join(', ') || '未识别'],
    [record.type === 'conference' ? '会议' : record.type === 'patent' ? '公开号' : '期刊', record.type === 'patent' ? record.patentNumber : record.venue],
    ['申请号', record.type === 'patent' ? record.applicationNumber : ''],
    ['专利状态', record.type === 'patent' ? patentStatus : ''],
    ['年份', record.year || '未识别'],
    ['卷期页码', [record.volume && `Vol. ${record.volume}`, record.issue && `No. ${record.issue}`, record.pages && `pp. ${record.pages}`, record.articleNumber && `Art. ${record.articleNumber}`].filter(Boolean).join(', ') || '尚无'],
    ['DOI', record.doi || '无'],
    ['数据来源', record.source || '未知'],
  ]
  return values.filter(([, value]) => value !== '').map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || '—')}</dd>`).join('')
}

function editNames(values = []) {
  return (values || []).join('; ')
}

function parseEditedNames(value = '') {
  const separator = /[;；]/
  const parts = separator.test(value) ? String(value).split(separator) : String(value).split(/[,，]/)
  return parts.map(name => name.trim()).filter(Boolean)
}

function updateEditFields() {
  const patent = editElements.type.value === 'patent'
  document.querySelectorAll('[data-edit-for="patent"]').forEach(item => item.classList.toggle('hidden', !patent))
  document.querySelectorAll('[data-edit-for="paper"]').forEach(item => item.classList.toggle('hidden', patent))
}

function populateEditForm(record = {}) {
  editElements.type.value = record.type || 'journal'
  editElements.year.value = record.year || ''
  editElements.titleEn.value = record.titleEn || (!/[\u3400-\u9fff]/.test(record.title || '') ? record.title : '')
  editElements.titleZh.value = record.titleZh || (/[\u3400-\u9fff]/.test(record.title || '') ? record.title : '')
  editElements.authorsEn.value = editNames(record.authorsEn?.length ? record.authorsEn : record.authors)
  editElements.authorsZh.value = editNames(record.authorsZh || [])
  editElements.venue.value = record.venue || ''
  editElements.doi.value = record.doi || ''
  editElements.volume.value = record.volume || ''
  editElements.issue.value = record.issue || ''
  editElements.pages.value = record.pages || ''
  editElements.articleNumber.value = record.articleNumber || ''
  editElements.applicationNumber.value = record.applicationNumber || ''
  editElements.patentNumber.value = record.patentNumber || ''
  editElements.date.value = /^\d{4}-\d{2}-\d{2}$/.test(record.date || '') ? record.date : ''
  editElements.patentStatus.value = record.status === 'granted' ? 'granted' : 'published'
  updateEditFields()
}

function editedRecord() {
  const base = { ...state.plan.record }
  const type = editElements.type.value
  const authorsEn = parseEditedNames(editElements.authorsEn.value)
  const authorsZh = parseEditedNames(editElements.authorsZh.value)
  const titleEn = editElements.titleEn.value.trim()
  const titleZh = editElements.titleZh.value.trim()
  const year = Number(editElements.year.value) || null
  const record = {
    ...base,
    type,
    title: titleEn || titleZh,
    titleEn,
    titleZh,
    authors: authorsEn.length ? authorsEn : authorsZh,
    authorsEn,
    authorsZh,
    year,
    source: `${base.source || 'Online lookup'} (manually corrected)`,
  }
  if (type === 'patent') {
    record.inventors = authorsZh.length ? authorsZh : authorsEn
    record.applicationNumber = editElements.applicationNumber.value.trim().toUpperCase()
    record.patentNumber = editElements.patentNumber.value.trim().toUpperCase()
    record.date = editElements.date.value
    record.status = editElements.patentStatus.value
    record.legalStatus = record.status === 'granted' ? 'granted' : 'published-or-pending'
    if (record.patentNumber) record.url = `https://patents.google.com/patent/${encodeURIComponent(record.patentNumber)}/zh`
  } else {
    record.venue = editElements.venue.value.trim()
    record.doi = editElements.doi.value.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    record.volume = editElements.volume.value.trim()
    record.issue = editElements.issue.value.trim()
    record.pages = editElements.pages.value.trim()
    record.articleNumber = editElements.articleNumber.value.trim()
    if (record.doi) record.url = `https://doi.org/${record.doi}`
  }
  return record
}

function renderAnalysis(analysis) {
  if (!analysis) {
    elements.analysis.classList.add('hidden')
    elements.analysis.replaceChildren()
    return
  }
  const items = [
    ['题目', analysis.title],
    ['作者', (analysis.authors || []).join(', ')],
    ['期刊/会议', analysis.venue],
    ['年份', analysis.year],
    ['DOI', analysis.doi],
    ['IEEE编号', analysis.ieeeDocumentId],
    ['专利公开号', analysis.patentNumber],
    ['中国申请号', analysis.applicationNumber],
  ].filter(([, value]) => value)
  elements.analysis.innerHTML = `<strong>从输入内容中拆分得到</strong><dl>${items.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl>`
  elements.analysis.classList.remove('hidden')
}

function matchReasons(candidate) {
  const names = { identifier: '号码', title: '题目', authors: '作者', venue: '期刊/会议', year: '年份' }
  return Object.entries(candidate.matchBreakdown || {})
    .filter(([, score]) => score > 0)
    .map(([field, score]) => `${names[field] || field}${Math.round(score * 100)}%`)
    .join(' · ')
}

function renderCandidates(candidates) {
  elements.candidateList.replaceChildren()
  if (!candidates?.length) {
    elements.candidateSection.classList.add('hidden')
    return
  }
  elements.candidateSection.classList.remove('hidden')
  candidates.forEach((candidate, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `candidate-item${index === state.selectedCandidateIndex ? ' selected' : ''}`
    const heading = document.createElement('div')
    heading.className = 'candidate-heading'
    const title = document.createElement('b')
    title.textContent = candidate.title || '未命名成果'
    const score = document.createElement('strong')
    score.className = 'candidate-score'
    score.textContent = `${Math.round((candidate.matchScore || 0) * 100)}%`
    heading.append(title, score)
    const detail = document.createElement('span')
    const patentStatus = candidate.type === 'patent' ? (candidate.status === 'granted' ? '已授权' : '已公开/未授权') : ''
    detail.textContent = candidate.type === 'patent'
      ? `${candidate.year || '未知年份'} · 申请号 ${candidate.applicationNumber || '未知'} · 公开号 ${candidate.patentNumber || '未知'} · ${patentStatus}`
      : `${candidate.year || '未知年份'} · ${candidate.venue || '未知来源'} · ${candidate.doi || '无标识符'}`
    const reasons = document.createElement('small')
    reasons.textContent = matchReasons(candidate) || '根据检索相关性排序'
    button.append(heading, detail, reasons)
    button.addEventListener('click', () => selectCandidate(index))
    elements.candidateList.append(button)
  })
}

async function selectCandidate(index) {
  const candidate = state.candidates[index]
  if (!candidate) return
  state.selectedCandidateIndex = index
  renderCandidates(state.candidates)
  try {
    const data = await api('/api/plan', { method: 'POST', body: JSON.stringify({ record: candidate }) })
    showPlan(data.plan, `已选择第${index + 1}个候选结果`)
  } catch (error) {
    showToast(error.message, true)
  }
}

function showPlan(plan, warning = '') {
  state.plan = plan
  state.activeLanguage = 'en'
  state.submitted = false
  elements.emptyState.classList.add('hidden')
  elements.resultContent.classList.remove('hidden')
  elements.metadata.innerHTML = metadataRows(plan.record)
  populateEditForm(plan.record)
  editElements.form.classList.add('hidden')
  editElements.toggle.textContent = '手动修改识别结果'
  const status = plan.comparison.status
  elements.resultStatus.textContent = labels[status] || status
  elements.resultStatus.className = `status ${status}`
  elements.matchLabel.textContent = labels[status] || status
  elements.confidence.textContent = `${Math.round((plan.comparison.confidence || 0) * 100)}%`
  elements.warning.textContent = warning
  elements.warning.classList.toggle('hidden', !warning)
  document.querySelectorAll('.preview-tabs button').forEach(button => button.classList.toggle('active', button.dataset.tab === 'en'))
  renderActiveEntry()
  elements.applyArea.classList.toggle('hidden', !['new', 'upgrade'].includes(status))
  elements.confirmation.value = ''
}

function renderActiveEntry() {
  if (!state.plan) return
  const entry = state.activeLanguage === 'zh' ? state.plan.entryZh : state.plan.entryEn
  elements.entryPreview.innerHTML = renderEntry(entry)
  elements.markdownPreview.textContent = entry
}

async function loadInventory(showReport = false) {
  const data = await api('/api/inventory')
  const current = data.inventory
  elements.countJournal.textContent = current.journal
  elements.countConference.textContent = current.conference
  elements.countPatent.textContent = current.patent
  if (showReport) {
    elements.reportContent.innerHTML = `<div class="report-grid">
      <article><span>网站成果总数</span><strong>${current.total}</strong></article>
      <article><span>期刊论文</span><strong>${current.journal}</strong></article>
      <article><span>会议论文</span><strong>${current.conference}</strong></article>
      <article><span>网站已收录专利</span><strong>${current.patent}</strong></article>
    </div><p>已读取当前部署版本中的网站成果。本次检查没有修改任何内容。</p>`
    elements.reportPanel.classList.remove('hidden')
    elements.reportPanel.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

elements.form.addEventListener('submit', async event => {
  event.preventDefault()
  const button = event.submitter
  setBusy(button, true, '正在联网查询…')
  try {
    const payload = { type: elements.type.value, inputKind: elements.inputKind.value, value: elements.value.value }
    const data = await api('/api/identify', { method: 'POST', body: JSON.stringify(payload) })
    state.candidates = data.candidates || []
    state.selectedCandidateIndex = 0
    renderAnalysis(data.analysis)
    renderCandidates(state.candidates)
    showPlan(data.plan, data.warning || '')
    showToast('识别完成，请检查右侧候选和格式')
  } catch (error) {
    showToast(error.message, true)
  } finally {
    setBusy(button, false)
  }
})

document.querySelectorAll('.preview-tabs button').forEach(button => {
  button.addEventListener('click', () => {
    state.activeLanguage = button.dataset.tab
    document.querySelectorAll('.preview-tabs button').forEach(item => item.classList.toggle('active', item === button))
    renderActiveEntry()
  })
})

editElements.toggle.addEventListener('click', () => {
  const opening = editElements.form.classList.contains('hidden')
  if (opening && state.plan) populateEditForm(state.plan.record)
  editElements.form.classList.toggle('hidden', !opening)
  editElements.toggle.textContent = opening ? '收起手动修改' : '手动修改识别结果'
})

editElements.cancel.addEventListener('click', () => {
  editElements.form.classList.add('hidden')
  editElements.toggle.textContent = '手动修改识别结果'
})

editElements.type.addEventListener('change', updateEditFields)

editElements.form.addEventListener('submit', async event => {
  event.preventDefault()
  const button = event.submitter
  if (!state.plan) return
  setBusy(button, true, '正在重新生成…')
  try {
    const record = editedRecord()
    if (!record.title) throw new Error('英文题目和中文题目不能同时为空')
    const data = await api('/api/plan', { method: 'POST', body: JSON.stringify({ record }) })
    showPlan(data.plan, '已应用手动修改。请重新检查中英文预览，确认后再提交。')
    showToast('手动修改已应用，预览已更新')
  } catch (error) {
    showToast(error.message, true)
  } finally {
    setBusy(button, false)
  }
})

document.getElementById('clear-button').addEventListener('click', () => {
  elements.form.reset()
  state.plan = null
  state.candidates = []
  renderAnalysis(null)
  elements.candidateList.replaceChildren()
  elements.candidateSection.classList.add('hidden')
  elements.emptyState.classList.remove('hidden')
  elements.resultContent.classList.add('hidden')
  elements.resultStatus.textContent = '等待输入'
  elements.resultStatus.className = 'status neutral'
  editElements.form.classList.add('hidden')
  editElements.toggle.textContent = '手动修改识别结果'
})

document.getElementById('inventory-button').addEventListener('click', async event => {
  setBusy(event.currentTarget, true)
  try { await loadInventory(true) } catch (error) { showToast(error.message, true) } finally { setBusy(event.currentTarget, false) }
})

elements.applyButton.addEventListener('click', async () => {
  if (!state.plan || state.submitted) return
  setBusy(elements.applyButton, true, '正在提交到GitHub…')
  try {
    const data = await api('/api/apply', {
      method: 'POST',
      body: JSON.stringify({ record: state.plan.record, confirmation: elements.confirmation.value }),
    })
    state.submitted = true
    elements.applyArea.classList.add('hidden')
    elements.resultStatus.textContent = '已提交更新'
    elements.resultStatus.className = 'status existing'
    elements.warning.innerHTML = `${escapeHtml(data.message)} <a href="${escapeHtml(data.actionsUrl)}" target="_blank" rel="noreferrer">查看GitHub更新进度</a>`
    elements.warning.classList.remove('hidden')
    showToast(data.message)
  } catch (error) {
    showToast(error.message, true)
  } finally {
    setBusy(elements.applyButton, false)
  }
})

document.getElementById('close-report').addEventListener('click', () => elements.reportPanel.classList.add('hidden'))

loadInventory().catch(error => showToast(error.message, true))
