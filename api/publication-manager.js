const {
  inventory,
  loadConfig,
  planRecord,
} = require('../publication-monitor/lib/core.cjs')
const { identify } = require('../publication-monitor/lib/sources.cjs')

const REPOSITORY = 'YiboDokkieWang/YiboDokkieWang.github.io'
const ALLOWED_FIELDS = [
  'type', 'title', 'titleEn', 'titleZh', 'originalTitle', 'originalLanguage',
  'authors', 'authorsEn', 'authorsZh', 'venue', 'year', 'date',
  'volume', 'issue', 'pages', 'articleNumber', 'doi', 'url', 'patentNumber', 'status',
  'source', 'ieeeDocumentId', 'semanticScholarId',
  'inventors', 'applicants', 'familyKey',
  'matchScore', 'matchBreakdown', 'sourceScore',
]

function safeRecord(record = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return {}
  return Object.fromEntries(ALLOWED_FIELDS
    .filter(key => record[key] !== undefined)
    .map(key => [key, record[key]]))
}

function send(response, status, data) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.end(JSON.stringify(data))
}

function bodyOf(request) {
  if (!request.body) return {}
  if (typeof request.body === 'string') return JSON.parse(request.body)
  return request.body
}

function validateRecord(record) {
  if (!['journal', 'conference', 'patent'].includes(record.type)) throw new Error('成果类型无效')
  if (record.fixture || record.source === 'fixture') throw new Error('测试数据不能提交到正式网站')
  if (!record.title) throw new Error('没有识别到成果题目')
  if (record.type === 'patent' && !record.patentNumber) throw new Error('专利缺少专利号')
}

async function dispatchAddition(record) {
  const token = process.env.GITHUB_MANAGER_TOKEN
  if (!token) throw new Error('尚未配置GITHUB_MANAGER_TOKEN，请先在Vercel中添加加密环境变量')
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'YiboDokkieWang-Publication-Manager',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      event_type: 'publication_manager_add',
      client_payload: { record },
    }),
  })
  if (response.status !== 204) {
    const detail = await response.text()
    throw new Error(`GitHub没有接受更新请求（${response.status}）：${detail.slice(0, 300)}`)
  }
}

module.exports = async function handler(request, response) {
  try {
    const action = String(request.query?.action || '')
    if (request.method === 'GET' && action === 'health') {
      const config = loadConfig()
      return send(response, 200, {
        ok: true,
        service: 'YiboDokkieWang Publication Manager',
        mode: 'vercel-private',
        tokenConfigured: Boolean(process.env.GITHUB_MANAGER_TOKEN),
        authorizedActor: config.authorizedActor,
      })
    }
    if (request.method === 'GET' && action === 'inventory') {
      return send(response, 200, { ok: true, inventory: inventory() })
    }
    if (request.method === 'POST' && action === 'identify') {
      const result = await identify(bodyOf(request))
      return send(response, 200, {
        ok: true,
        plan: planRecord(result.record),
        candidates: (result.candidates || []).map(safeRecord),
        analysis: result.analysis || null,
        warning: result.warning || '',
      })
    }
    if (request.method === 'POST' && action === 'plan') {
      const record = safeRecord(bodyOf(request).record)
      validateRecord(record)
      return send(response, 200, { ok: true, plan: planRecord(record) })
    }
    if (request.method === 'POST' && action === 'apply') {
      const body = bodyOf(request)
      if (body.confirmation !== 'CONFIRM') throw new Error('请输入 CONFIRM 后再提交')
      const record = safeRecord(body.record)
      validateRecord(record)
      const plan = planRecord(record)
      if (!['new', 'upgrade'].includes(plan.comparison.status)) {
        throw new Error(`当前状态为${plan.comparison.status}，不允许重复写入`)
      }
      await dispatchAddition(record)
      return send(response, 202, {
        ok: true,
        queued: true,
        message: '已提交到GitHub，系统正在更新个人网站，通常需要2–5分钟。',
        actionsUrl: `https://github.com/${REPOSITORY}/actions/workflows/publication-monitor.yml`,
      })
    }
    return send(response, 404, { ok: false, error: 'API不存在' })
  } catch (error) {
    return send(response, 400, { ok: false, error: error.message || '请求失败' })
  }
}
