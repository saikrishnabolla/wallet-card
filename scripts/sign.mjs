#!/usr/bin/env node
// Sign preview.pass/ into a .pkpass using cert paths from config/card.json.
// Run: node scripts/sign.mjs  [path/to/config.json] [output.pkpass]
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PKPass } from 'passkit-generator'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const configPath = process.argv[2] || join(root, 'config/card.json')
const outPath = resolve(root, process.argv[3] || process.env.OUT || 'card.pkpass')

const cfg = JSON.parse(await readFile(configPath, 'utf-8'))
const resolveRelative = p => (p.startsWith('/') ? p : resolve(root, p))

const passDir = join(root, 'preview.pass')
const passJson = JSON.parse(await readFile(join(passDir, 'pass.json'), 'utf-8'))

const files = await readdir(passDir)
const buffers = {}
for (const name of files) {
  if (name === 'pass.json') continue
  buffers[name] = await readFile(join(passDir, name))
}

const pass = new PKPass(
  {
    'pass.json': Buffer.from(JSON.stringify(passJson)),
    ...buffers,
  },
  {
    wwdr: await readFile(resolveRelative(cfg.certs.wwdr)),
    signerCert: await readFile(resolveRelative(cfg.certs.signerCert)),
    signerKey: await readFile(resolveRelative(cfg.certs.signerKey)),
    ...(cfg.certs.signerKeyPassphrase ? { signerKeyPassphrase: cfg.certs.signerKeyPassphrase } : {}),
  },
)

await writeFile(outPath, pass.getAsBuffer())
console.log(`Signed → ${outPath}`)
