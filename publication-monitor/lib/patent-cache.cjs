const fs = require('fs')
const path = require('path')
const { ROOT } = require('./core.cjs')

const PATENT_CACHE_PATH = path.join(ROOT, 'publication-monitor', 'cache', 'patents.json')

function emptyPatentCache() {
  return { schemaVersion: 1, savedAt: null, records: [] }
}

function loadPatentCache(filePath = PATENT_CACHE_PATH) {
  if (!fs.existsSync(filePath)) return emptyPatentCache()
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return {
      schemaVersion: 1,
      savedAt: payload.savedAt || null,
      records: Array.isArray(payload.records) ? payload.records.filter(record => record?.type === 'patent') : [],
    }
  } catch {
    return emptyPatentCache()
  }
}

function savePatentCache(records, filePath = PATENT_CACHE_PATH, savedAt = new Date().toISOString()) {
  const payload = {
    schemaVersion: 1,
    savedAt,
    records: Array.isArray(records) ? records.filter(record => record?.type === 'patent') : [],
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`)
  fs.renameSync(temporaryPath, filePath)
  return payload
}

module.exports = {
  PATENT_CACHE_PATH,
  emptyPatentCache,
  loadPatentCache,
  savePatentCache,
}
