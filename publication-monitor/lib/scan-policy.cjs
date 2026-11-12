function recordTimestamp(record = {}) {
  for (const value of [record.date, record.publicationDate, record.filingDate]) {
    if (!value) continue
    const timestamp = Date.parse(value)
    if (Number.isFinite(timestamp)) return timestamp
  }
  const year = Number(record.year)
  return year ? Date.UTC(year, 11, 31, 23, 59, 59) : NaN
}

function subtractCalendarMonths(value, months) {
  const date = new Date(value)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() - months)
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
  return date
}

function isWithinRecentWindow(record, months = 3, now = new Date()) {
  const current = new Date(now)
  const cutoff = subtractCalendarMonths(current, Math.max(1, Number(months) || 3))
  cutoff.setUTCHours(0, 0, 0, 0)
  const hasExactDate = [record.date, record.publicationDate, record.filingDate].some(Boolean)
  if (!hasExactDate && Number(record.year)) {
    return Number(record.year) >= cutoff.getUTCFullYear() && Number(record.year) <= current.getUTCFullYear()
  }
  const timestamp = recordTimestamp(record)
  if (!Number.isFinite(timestamp)) return false
  return timestamp >= cutoff.getTime() && timestamp <= current.getTime()
}

function reviewedIdentifierSet(state = {}) {
  return new Set(Object.keys(state.reviewedResults || {}))
}

function applyReviewDecision(state = {}, selection = {}, reviewedAt = new Date().toISOString()) {
  const reviewedResults = { ...(state.reviewedResults || {}) }
  const selected = new Set(selection.selectedIdentifiers || [])
  for (const identifier of selection.candidateIdentifiers || []) {
    reviewedResults[identifier] = {
      decision: selected.has(identifier) ? 'approved' : 'dismissed',
      reviewedAt,
    }
  }
  return {
    ...state,
    schemaVersion: 2,
    reviewedResults,
  }
}

module.exports = {
  applyReviewDecision,
  isWithinRecentWindow,
  recordTimestamp,
  reviewedIdentifierSet,
  subtractCalendarMonths,
}
