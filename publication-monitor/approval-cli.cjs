const fs = require('fs')
const path = require('path')
const { parseApprovalEmailReply, parseApprovalIssue, renderApprovalIssue, renderApprovalNotification } = require('./lib/approval.cjs')

function parseArgs(argv) {
  const args = { _: [] }
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]
    if (!value.startsWith('--')) {
      args._.push(value)
      continue
    }
    const key = value.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index++
    }
  }
  return args
}

function writeFile(filePath, value) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true })
  fs.writeFileSync(filePath, value)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = args._[0]
  if (command === 'render') {
    if (!args.report || !args.output) throw new Error('render requires --report and --output')
    const report = JSON.parse(fs.readFileSync(args.report, 'utf8'))
    writeFile(args.output, renderApprovalIssue(report, {
      runUrl: args['run-url'] || '',
      issueUrl: args['issue-url'] || '',
    }))
    return
  }
  if (command === 'render-notification') {
    if (!args.report || !args.output) throw new Error('render-notification requires --report and --output')
    const report = JSON.parse(fs.readFileSync(args.report, 'utf8'))
    writeFile(args.output, renderApprovalNotification(report, {
      runUrl: args['run-url'] || '',
      issueUrl: args['issue-url'] || '',
    }))
    return
  }
  if (command === 'parse') {
    if (!args.body || !args.output) throw new Error('parse requires --body and --output')
    const issueBody = fs.readFileSync(args.body, 'utf8')
    const selection = args.comment
      ? parseApprovalEmailReply(issueBody, fs.readFileSync(args.comment, 'utf8'))
      : parseApprovalIssue(issueBody)
    writeFile(args.output, `${JSON.stringify(selection, null, 2)}\n`)
    return
  }
  throw new Error('Commands: render|render-notification --report <json> --output <md> [--run-url <url>] [--issue-url <url>] | parse --body <md> [--comment <md>] --output <json>')
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`)
  process.exitCode = 1
}
