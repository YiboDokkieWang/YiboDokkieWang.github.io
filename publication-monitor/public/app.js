const state = {
  plan: null,
  candidates: [],
  analysis: null,
  selectedCandidateIndex: 0,
  activeLanguage: 'en',
}

const elements = {
  form: document.getElementById('identify-form'),
  type: document.getElementById('type'),
  inputKind: document.getElementById('input-kind'),
  value: document.getElementById('value'),
  valueLabel: document.getElementById('value-label'),
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

const labels = {
  new: '网站尚未收录',
  existing: '网站已经收录',
  upgrade: '可替换Early Access',
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
  showToast.timer = window.setTimeout(() => { elements.toast.className = 'toast' }, 3500)
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
  let html = escapeHtml(markdown.replace(/^1\.\s+/, ''))
  html = html
    .replace(/&lt;strong&gt;([\s\S]*?)&lt;\/strong&gt;/gi, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[\[([^\]]+)\]\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">[$1]</a>')
  return `<p>${html}</p>`
}

function metadataRows(record) {
  const values = [
    ['类型', record.type === 'journal' ? '期刊论文' : record.type === 'conference' ? '会议论文' : '专利'],
    ['题目', record.title || '未识别'],
    ['作者', (record.authors || []).join(', ') || '未识别'],
    [record.type === 'conference' ? '会议' : record.type === 'patent' ? '专利号' : '期刊', record.type === 'patent' ? record.patentNumber : record.venue],
    ['年份', record.year || '未识别'],
    ['卷期页码', [record.volume && `Vol. ${record.volume}`, record.issue && `No. ${record.issue}`, record.pages && `pp. ${record.pages}`, record.articleNumber && `Art. ${record.articleNumber}`].filter(Boolean).join(', ') || '尚无'],
    ['DOI', record.doi || '无'],
    ['数据来源', record.source || '未知'],
  ]
  return values.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || '—')}</dd>`).join('')
}

function renderAnalysis(analysis) {
  state.analysis = analysis || null
  if (!analysis) {
    elements.analysis.classList.add('hidden')
    elements.analysis.replaceChildren()
    return
  }
  const kindLabels = {
    bibliographic: '参考文献信息',
    doi: 'DOI',
    ieee: 'IEEE文献编号',
    bibtex: 'BibTeX',
    patent: '专利信息',
  }
  const items = [
    ['输入类型', kindLabels[analysis.kind] || '自动判断'],
    ['题目', analysis.title],
    ['作者', (analysis.authors || []).join(', ')],
    ['期刊/会议', analysis.venue],
    ['年份', analysis.year],
    ['DOI', analysis.doi],
    ['IEEE编号', analysis.ieeeDocumentId],
    ['专利号', analysis.patentNumber],
  ].filter(([, value]) => value)
  elements.analysis.innerHTML = `<strong>从输入内容中识别到</strong><dl>${items.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl>`
  elements.analysis.classList.remove('hidden')
}

function matchReasons(candidate) {
  const labels = { title: '题目', authors: '作者', venue: '期刊/会议', year: '年份' }
  return Object.entries(candidate.matchBreakdown || {})
    .filter(([, score]) => score > 0)
    .map(([field, score]) => `${labels[field] || field}${Math.round(score * 100)}%`)
    .join(' · ')
}

function renderCandidates(candidates) {
  elements.candidateList.replaceChildren()
  if (!candidates?.length || candidates.length === 1) {
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
    title.textContent = candidate.title || '未命名论文'
    const score = document.createElement('strong')
    score.className = 'candidate-score'
    score.textContent = `${Math.round((candidate.matchScore || 0) * 100)}%`
    heading.append(title, score)
    const detail = document.createElement('span')
    detail.textContent = `${candidate.year || '未知年份'} · ${candidate.venue || '未知期刊'} · ${candidate.doi || '无DOI'}`
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
  try {
    state.selectedCandidateIndex = index
    renderCandidates(state.candidates)
    const data = await api('/api/plan', { method: 'POST', body: JSON.stringify({ record: candidate }) })
    showPlan(data.plan, '已选择候选论文')
  } catch (error) {
    showToast(error.message, true)
  }
}

function showPlan(plan, warning = '') {
  state.plan = plan
  state.activeLanguage = 'en'
  elements.emptyState.classList.add('hidden')
  elements.resultContent.classList.remove('hidden')
  elements.metadata.innerHTML = metadataRows(plan.record)
  const status = plan.comparison.status
  elements.resultStatus.textContent = plan.simulated ? `测试 · ${labels[status] || status}` : (labels[status] || status)
  elements.resultStatus.className = `status ${status}`
  elements.matchLabel.textContent = labels[status] || status
  elements.confidence.textContent = `${Math.round((plan.comparison.confidence || 0) * 100)}%`
  elements.warning.textContent = warning
  elements.warning.classList.toggle('hidden', !warning)
  document.querySelectorAll('.preview-tabs button').forEach(button => button.classList.toggle('active', button.dataset.tab === 'en'))
  renderActiveEntry()

  const canApply = !plan.simulated
    && !plan.record.fixture
    && plan.record.source !== 'fixture'
    && ['new', 'upgrade'].includes(status)
  elements.applyArea.classList.toggle('hidden', !canApply)
  elements.confirmation.value = ''
  if (plan.simulated || plan.record.fixture) {
    elements.warning.textContent = `${warning ? `${warning} ` : ''}这是测试数据，只能预览，无法写入正式网站。`
    elements.warning.classList.remove('hidden')
  }
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
    showReportPanel(`
      <div class="report-grid">
        <article><span>网站成果总数</span><strong>${current.total}</strong></article>
        <article><span>期刊论文</span><strong>${current.journal}</strong></article>
        <article><span>会议论文</span><strong>${current.conference}</strong></article>
        <article><span>专利</span><strong>${current.patent}</strong></article>
      </div>
      <p>已成功读取中英文发表成果文件。本次检查没有修改任何内容。</p>
    `)
  }
}

function showReportPanel(html) {
  elements.reportContent.innerHTML = html
  elements.reportPanel.classList.remove('hidden')
  elements.reportPanel.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

elements.form.addEventListener('submit', async event => {
  event.preventDefault()
  const button = event.submitter
  setBusy(button, true, '正在查询…')
  try {
    const payload = { type: elements.type.value, inputKind: elements.inputKind.value, value: elements.value.value }
    const data = await api('/api/identify', { method: 'POST', body: JSON.stringify(payload) })
    state.candidates = data.candidates || []
    state.selectedCandidateIndex = 0
    renderAnalysis(data.analysis)
    renderCandidates(state.candidates)
    showPlan(data.plan, data.warning || '')
    showToast('识别完成')
  } catch (error) {
    showToast(error.message, true)
  } finally {
    setBusy(button, false)
  }
})

document.querySelectorAll('[data-fixture]').forEach(button => {
  button.addEventListener('click', async () => {
    setBusy(button, true)
    try {
      const data = await api('/api/fixture', { method: 'POST', body: JSON.stringify({ name: button.dataset.fixture }) })
      state.candidates = []
      renderAnalysis(null)
      renderCandidates([])
      showPlan(data.plan)
      showToast('测试场景已加载')
    } catch (error) {
      showToast(error.message, true)
    } finally {
      setBusy(button, false)
    }
  })
})

document.querySelectorAll('.preview-tabs button').forEach(button => {
  button.addEventListener('click', () => {
    state.activeLanguage = button.dataset.tab
    document.querySelectorAll('.preview-tabs button').forEach(item => item.classList.toggle('active', item === button))
    renderActiveEntry()
  })
})

document.getElementById('clear-button').addEventListener('click', () => {
  elements.form.reset()
  state.plan = null
  state.candidates = []
  renderAnalysis(null)
  elements.emptyState.classList.remove('hidden')
  elements.resultContent.classList.add('hidden')
  elements.resultStatus.textContent = '等待输入'
  elements.resultStatus.className = 'status neutral'
})

document.getElementById('inventory-button').addEventListener('click', async event => {
  setBusy(event.currentTarget, true)
  try { await loadInventory(true) } catch (error) { showToast(error.message, true) } finally { setBusy(event.currentTarget, false) }
})

document.getElementById('self-test-button').addEventListener('click', async event => {
  setBusy(event.currentTarget, true)
  try {
    const data = await api('/api/self-test', { method: 'POST', body: '{}' })
    const report = data.report
    showReportPanel(`
      <div class="report-grid">
        <article><span>总体状态</span><strong class="${report.ok ? 'pass' : 'fail'}">${report.ok ? '通过' : '失败'}</strong></article>
        <article><span>通过</span><strong>${report.passed}</strong></article>
        <article><span>失败</span><strong>${report.failed}</strong></article>
        <article><span>正式文件修改</span><strong>0</strong></article>
      </div>
      <ul class="test-list">${report.results.map(item => `<li class="${item.ok ? 'pass' : 'fail'}">${item.ok ? '✓' : '✕'} ${escapeHtml(item.name)}${item.error ? ` — ${escapeHtml(item.error)}` : ''}</li>`).join('')}</ul>
    `)
    showToast(report.ok ? '完整系统自检通过' : '自检发现问题', !report.ok)
  } catch (error) {
    showToast(error.message, true)
  } finally {
    setBusy(event.currentTarget, false)
  }
})

document.getElementById('live-scan-button').addEventListener('click', async event => {
  setBusy(event.currentTarget, true, '正在联网检查…')
  try {
    const data = await api('/api/scan', { method: 'POST', body: '{}' })
    const { scan } = data
    showReportPanel(`
      <div class="report-grid">
        <article><span>数据源记录</span><strong>${scan.counts.found}</strong></article>
        <article><span>网站已有</span><strong>${scan.counts.existing}</strong></article>
        <article><span>网站缺少</span><strong>${scan.counts.missing}</strong></article>
        <article><span>正式版本更新</span><strong>${scan.counts.upgrades}</strong></article>
      </div>
      <ul class="source-list">${scan.sourceStatus.map(item => `<li class="${item.skipped ? '' : item.ok ? 'pass' : 'fail'}">${escapeHtml(item.source)}：${item.skipped ? escapeHtml(item.message) : item.ok ? `成功，找到${item.count}条` : `失败，${escapeHtml(item.error)}`}</li>`).join('')}</ul>
      <p><b>专利领域筛选：</b>检查${scan.patentFilter?.examined || 0}条同名候选，保留${scan.patentFilter?.relevant || 0}条与本人研究方向相关的专利，静默过滤${scan.patentFilter?.ignored || 0}条无关专利。</p>
      <p>本次联网检查只生成报告，没有修改网站。数据源结果会在后续GitHub版本中用于创建待确认更新。</p>
    `)
    showToast('联网检查完成')
  } catch (error) {
    showToast(error.message, true)
  } finally {
    setBusy(event.currentTarget, false)
  }
})

elements.applyButton.addEventListener('click', async () => {
  if (!state.plan) return
  setBusy(elements.applyButton, true, '正在写入…')
  try {
    const data = await api('/api/apply', {
      method: 'POST',
      body: JSON.stringify({ record: state.plan.record, confirmation: elements.confirmation.value }),
    })
    showToast(data.message)
    await loadInventory()
    elements.applyArea.classList.add('hidden')
    elements.resultStatus.textContent = '已写入本地网站'
    elements.resultStatus.className = 'status existing'
  } catch (error) {
    showToast(error.message, true)
  } finally {
    setBusy(elements.applyButton, false)
  }
})

document.getElementById('close-report').addEventListener('click', () => elements.reportPanel.classList.add('hidden'))

loadInventory().catch(error => showToast(error.message, true))
