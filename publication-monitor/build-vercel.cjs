const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const source = path.join(__dirname, 'vercel-src')
const output = path.join(root, 'dist')

fs.rmSync(output, { recursive: true, force: true })
fs.mkdirSync(output, { recursive: true })
for (const name of ['index.html', 'app.js']) {
  fs.copyFileSync(path.join(source, name), path.join(output, name))
}
fs.copyFileSync(path.join(__dirname, 'public', 'styles.css'), path.join(output, 'styles.css'))
console.log(`Vercel publication manager built in ${output}`)
