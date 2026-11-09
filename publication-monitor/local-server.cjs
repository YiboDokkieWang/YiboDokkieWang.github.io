const http = require('http')
const fs = require('fs')
const path = require('path')
const { URL } = require('url')
const {
  applyPlan,
  fixtureNames,
  inventory,
  loadConfig,
  loadFixture,
  planRecord,
} = require('./lib/core.cjs')
const { identify, scanConfiguredSources } = require('./lib/sources.cjs')
const { runSelfTests } = require('./lib/tests.cjs')

const HOST = '127.0.0.1'
const PORT = Number(process.env.PUBLICATION_MANAGER_PORT || 4190)
const PUBLIC_DIR = path.join(__dirname, 'public')

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(data))
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', chunk => {
      size += chunk.length
      if (size > 1_000_000) {
        reject(new Error('请求内容过大'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch {
        reject(new Error('请求格式不正确'))
      }
    })
    request.on('error', reject)
  })
}

function safeRecord(record = {}) {
  const allowed = [
    'fixture', 'type', 'title', 'titleZh', 'authors', 'authorsZh', 'venue', 'year', 'date',
    'volume', 'issue', 'pages', 'articleNumber', 'doi', 'url', 'patentNumber', 'status',
    'source', 'ieeeDocumentId', 'semanticScholarId',
    'matchScore', 'matchBreakdown', 'sourceScore',
  ]
  return Object.fromEntries(allowed.filter(key => record[key] !== undefined).map(key => [key, record[key]]))
}

async function apiRoute(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/health') {
    const config = loadConfig()
    return sendJson(response, 200, {
      ok: true,
      service: 'YiboDokkieWang Publication Manager',
      localOnly: true,
      authorizedActor: config.authorizedActor,
      orcidId: config.orcidId,
      ieeeAuthorId: config.ieeeAuthorId,
    })
  }
  if (request.method === 'GET' && pathname === '/api/inventory') return sendJson(response, 200, { ok: true, inventory: inventory() })
  if (request.method === 'GET' && pathname === '/api/fixtures') return sendJson(response, 200, { ok: true, fixtures: fixtureNames() })
  if (request.method === 'POST' && pathname === '/api/self-test') return sendJson(response, 200, { ok: true, report: runSelfTests() })

  if (request.method === 'POST' && pathname === '/api/fixture') {
    const body = await readBody(request)
    const fixture = loadFixture(body.name)
    if (fixture.scenario === 'early-access-upgrade') {
      const preview = {
        record: fixture.final,
        comparison: {
          status: 'upgrade',
          match: fixture.earlyAccess,
          confidence: 1,
          reasons: ['DOI完全相同', '正式版本已包含卷期页码'],
        },
      }
      const plan = planRecord(fixture.final)
      preview.entryEn = plan.entryEn
      preview.entryZh = plan.entryZh
      preview.simulated = true
      return sendJson(response, 200, { ok: true, plan: preview })
    }
    return sendJson(response, 200, { ok: true, plan: { ...planRecord(fixture), simulated: true } })
  }

  if (request.method === 'POST' && pathname === '/api/identify') {
    const body = await readBody(request)
    const result = await identify(body)
    return sendJson(response, 200, {
      ok: true,
      plan: planRecord(result.record),
      candidates: result.candidates.map(safeRecord),
      analysis: result.analysis || null,
      warning: result.warning || '',
    })
  }

  if (request.method === 'POST' && pathname === '/api/plan') {
    const body = await readBody(request)
    return sendJson(response, 200, { ok: true, plan: planRecord(safeRecord(body.record)) })
  }

  if (request.method === 'POST' && pathname === '/api/scan') {
    const scan = await scanConfiguredSources()
    const plans = scan.records.map(record => planRecord(record))
    const counts = {
      found: plans.length,
      existing: plans.filter(plan => plan.comparison.status === 'existing').length,
      missing: plans.filter(plan => plan.comparison.status === 'new').length,
      upgrades: plans.filter(plan => plan.comparison.status === 'upgrade').length,
      ambiguous: plans.filter(plan => plan.comparison.status === 'ambiguous').length,
    }
    return sendJson(response, 200, { ok: true, scan: { ...scan, plans, counts } })
  }

  if (request.method === 'POST' && pathname === '/api/apply') {
    const body = await readBody(request)
    if (body.confirmation !== 'APPLY') throw new Error('需要输入 APPLY 才能写入本地网站')
    const record = safeRecord(body.record)
    if (record.fixture || record.source === 'fixture') throw new Error('测试数据不能写入正式网站')
    const plan = planRecord(record)
    const result = applyPlan(plan)
    return sendJson(response, 200, { ok: true, message: '已写入本地中英文发表成果文件', result, plan })
  }

  return false
}

function staticRoute(response, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname
  const filePath = path.resolve(PUBLIC_DIR, `.${requested}`)
  if (!filePath.startsWith(PUBLIC_DIR)) return false
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false
  response.writeHead(200, {
    'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
  })
  fs.createReadStream(filePath).pipe(response)
  return true
}

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`).pathname
  try {
    if (pathname.startsWith('/api/')) {
      const handled = await apiRoute(request, response, pathname)
      if (handled !== false) return
      return sendJson(response, 404, { ok: false, error: 'API不存在' })
    }
    if (staticRoute(response, pathname)) return
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  } catch (error) {
    sendJson(response, 400, { ok: false, error: error.message })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`Publication Manager available at http://${HOST}:${PORT}/`)
  console.log('Local-only mode: test fixtures cannot modify the live publication files.')
})
