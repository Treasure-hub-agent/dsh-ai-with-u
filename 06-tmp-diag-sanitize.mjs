import { readFile, readdir } from 'node:fs/promises'
const files = (await readdir('client')).filter(n => n.endsWith('.tsx'))
function sanitize(source) {
  const chars = source.split(''); const mask = new Uint8Array(source.length); let quote = ''
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (quote !== '') { mask[i] = 1; if (ch === '\\') { i++; if (i < source.length) mask[i] = 1; continue } if (ch === quote) quote = ''; continue }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; mask[i] = 1; continue }
    if (ch === '/' && source[i + 1] === '*') { const end = source.indexOf('*/', i + 2); const stop = end < 0 ? source.length : end + 2; for (let j = i; j < stop; j++) if (chars[j] !== '\n') chars[j] = ' '; i = stop - 1; continue }
    if (ch === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') { chars[i] = ' '; i++ } i--; }
  }
  return { text: chars.join(''), mask }
}
for (const f of files) {
  const raw = await readFile('client/' + f, 'utf8')
  const { text, mask } = sanitize(raw)
  const rawCount = (raw.match(/<button\b/g) ?? []).length
  const cleanCount = (text.match(/<button\b/g) ?? []).length
  let masked = 0
  for (const m of text.matchAll(/<button\b/g)) if (mask[m.index] === 1) { masked++; if (masked <= 1) console.log(`   ${f} 首个被掩码的 <button> 附近：…${JSON.stringify(raw.slice(Math.max(0,m.index-90), m.index+10))}`) }
  if (rawCount !== cleanCount || masked) console.log(`${f}: raw=${rawCount} clean=${cleanCount} masked=${masked}`)
}
