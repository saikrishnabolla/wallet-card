#!/usr/bin/env node
// Build the unsigned pass directory (preview.pass/) from config/card.json.
// Run: node scripts/build.mjs  [path/to/config.json]
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { v4 as uuidv4 } from 'uuid'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const configPath = process.argv[2] || join(root, 'config/card.json')
let cfg
try {
  cfg = JSON.parse(await readFile(configPath, 'utf-8'))
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error(`No config found at ${configPath}.`)
    console.error(`Copy config/card.example.json → config/card.json and fill in your details.`)
    process.exit(1)
  }
  throw err
}

const data = cfg
const resolveRelative = p => (p.startsWith('/') ? p : resolve(root, p))

const normalizeLinkedIn = v =>
  !v ? '' : /^https?:\/\//i.test(v) ? v : `https://www.linkedin.com/in/${v.replace(/^@/, '')}`

const linkedinUrl = normalizeLinkedIn(data.linkedin)
const githubUrl = data.github ? `https://github.com/${data.github.replace(/^@/, '')}` : ''
const calUrl = data.cal ? `https://cal.com/${data.cal.replace(/^@/, '')}` : ''
const websiteUrl = data.website
  ? (/^https?:\/\//i.test(data.website) ? data.website : `https://${data.website.replace(/^www\./, 'www.')}`)
  : ''
const phoneTel = data.phone ? data.phone.replace(/[^\d+]/g, '') : ''

const pass = {
  formatVersion: 1,
  passTypeIdentifier: data.apple.passTypeIdentifier,
  teamIdentifier: data.apple.teamIdentifier,
  serialNumber: uuidv4(),
  organizationName: data.name,
  description: data.name,
  logoText: data.style?.logoText ?? '',
  foregroundColor: data.style?.foregroundColor ?? 'rgb(15, 27, 61)',
  backgroundColor: data.style?.backgroundColor ?? 'rgb(255, 255, 255)',
  labelColor: data.style?.labelColor ?? 'rgb(120, 120, 125)',
  generic: {
    primaryFields: [{ key: 'name', value: data.name }],
    secondaryFields: data.email ? [{ key: 'email', label: 'EMAIL', value: data.email }] : [],
    auxiliaryFields: [
      data.linkedin && { key: 'linkedin', label: 'LINKEDIN', value: data.linkedin },
      data.github && { key: 'github', label: 'GITHUB', value: data.github },
      data.cal && { key: 'cal', label: 'CAL.COM', value: data.cal },
    ].filter(Boolean),
    backFields: [
      data.email && {
        key: 'email_back', label: 'Email', value: data.email,
        attributedValue: `<a href="mailto:${data.email}">${data.email}</a>`,
      },
      data.phone && {
        key: 'phone_back', label: 'Phone', value: data.phone,
        attributedValue: `<a href="tel:${phoneTel}">${data.phone}</a>`,
      },
      linkedinUrl && {
        key: 'linkedin_back', label: 'LinkedIn', value: linkedinUrl,
        attributedValue: `<a href="${linkedinUrl}">${data.linkedin}</a>`,
      },
      githubUrl && {
        key: 'github_back', label: 'GitHub', value: githubUrl,
        attributedValue: `<a href="${githubUrl}">${data.github}</a>`,
      },
      calUrl && {
        key: 'cal_back', label: 'Cal.com', value: calUrl,
        attributedValue: `<a href="${calUrl}">${data.cal}</a>`,
      },
      websiteUrl && {
        key: 'website_back', label: 'Website', value: websiteUrl,
        attributedValue: `<a href="${websiteUrl}">${data.website}</a>`,
      },
    ].filter(Boolean),
  },
  barcodes: [{
    message: linkedinUrl || data.email || data.name,
    ...(data.style?.qrAltText ? { altText: data.style.qrAltText } : {}),
    format: 'PKBarcodeFormatQR',
    messageEncoding: 'utf-8',
  }],
}

const dir = join(root, 'preview.pass')
await rm(dir, { recursive: true, force: true })
await mkdir(dir, { recursive: true })

const circleMask = size => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
)

const makeCircle = async (buf, size) => {
  const base = await sharp(buf)
    .resize(size, size, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer()
  return sharp(base)
    .composite([{ input: circleMask(size), blend: 'dest-in' }])
    .png()
    .toBuffer()
}

const writePng = (name, buf) => writeFile(join(dir, name), buf)

const photoBuf = await readFile(resolveRelative(data.assets.photo))
await writePng('thumbnail@2x.png', await makeCircle(photoBuf, 180))
await writePng('thumbnail.png', await makeCircle(photoBuf, 90))

const logoBuf = await readFile(resolveRelative(data.assets.logo))
await writePng('icon@2x.png', await makeCircle(logoBuf, 58))
await writePng('logo@2x.png', await makeCircle(logoBuf, 58))
await writePng('icon.png', await makeCircle(logoBuf, 29))
await writePng('logo.png', await makeCircle(logoBuf, 29))

await writeFile(join(dir, 'pass.json'), JSON.stringify(pass, null, 2), 'utf-8')

console.log(`Built ${dir}`)
