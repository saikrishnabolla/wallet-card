import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import QRCode from 'qrcode'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const passDir = join(root, 'preview.pass')

const pass = JSON.parse(await readFile(join(passDir, 'pass.json'), 'utf-8'))

const fg = pass.foregroundColor || 'rgb(0,0,0)'
const bg = pass.backgroundColor || 'rgb(255,255,255)'
const labelColor = pass.labelColor || 'rgb(0,0,0)'

const escape = s =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

// --- Twemoji color SVGs (closest match to what Apple Color Emoji renders in real Wallet) ---
import { writeFile as fsWrite, mkdir } from 'node:fs/promises'
const ICON_CACHE = join(root, '.twemoji-cache')
await mkdir(ICON_CACHE, { recursive: true })

const toCodepoints = ch =>
  [...ch]
    .map(c => c.codePointAt(0).toString(16))
    .filter(c => c !== 'fe0f')
    .join('-')

const KNOWN_EMOJI = new Set(['👋', '✉️', '✉', '☎️', '☎', '📱', '💼', '🐙', '🔗', '🌐', '📅', '🗓️', '🗓'])

const emojiSvgCache = new Map()
const getEmojiSvg = async char => {
  if (emojiSvgCache.has(char)) return emojiSvgCache.get(char)
  const cp = toCodepoints(char)
  const cached = join(ICON_CACHE, `${cp}.svg`)
  let svg
  try {
    svg = await readFile(cached, 'utf-8')
  } catch {
    const url = `https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/${cp}.svg`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`emoji ${char} (${cp}) fetch failed: ${res.status}`)
    svg = await res.text()
    await fsWrite(cached, svg, 'utf-8')
  }
  emojiSvgCache.set(char, svg)
  return svg
}

// Split a label like "💼 LINKEDIN" into [emoji, rest]
const splitEmojiPrefix = label => {
  const m = label.match(/^(\p{Extended_Pictographic}(?:\p{Emoji_Modifier_Base}|️)?)\s*(.*)$/u)
  return m ? [m[1], m[2]] : ['', label]
}

const renderLabelWithEmoji = async (label, x, y, fontSize, fill) => {
  const [emoji, text] = splitEmojiPrefix(label)
  let svg = ''
  let textX = x
  if (emoji && KNOWN_EMOJI.has(emoji)) {
    const raw = await getEmojiSvg(emoji)
    const inner = raw
      .replace(/<\?xml[^>]*\?>\s*/i, '')
      .replace(/<svg[^>]*>/i, '<g>')
      .replace(/<\/svg>/i, '</g>')
    const sz = fontSize + 4
    svg += `<g transform="translate(${x}, ${y - sz + 2}) scale(${sz / 36})">${inner}</g>`
    textX = x + sz + 5
  }
  svg += `<text x="${textX}" y="${y}" font-family="-apple-system, 'SF Pro Text', system-ui, Helvetica, Arial" font-size="${fontSize}" font-weight="600" fill="${fill}" letter-spacing="0.5">${escape(text.toUpperCase())}</text>`
  return svg
}

// load embedded assets as data URIs
const toDataUri = async file => {
  const buf = await readFile(file)
  return `data:image/png;base64,${buf.toString('base64')}`
}

const logoUri = await toDataUri(join(passDir, 'logo@2x.png'))
const thumbUri = await toDataUri(join(passDir, 'thumbnail@2x.png'))

const barcode = pass.barcodes?.[0]
let qrUri = ''
if (barcode) {
  const qrBuf = await QRCode.toBuffer(barcode.message, {
    type: 'png',
    margin: 1,
    width: 360,
    color: { dark: '#000000', light: '#ffffff' },
  })
  qrUri = `data:image/png;base64,${qrBuf.toString('base64')}`
}

const W = 720
const cardX = 30
const cardY = 30
const cardW = W - 60
const cardR = 18

const logoText = escape(pass.logoText || '')
const primary = escape(pass.generic.primaryFields[0]?.value || '')
const secondary = pass.generic.secondaryFields || []
const auxiliary = pass.generic.auxiliaryFields || []

let y = cardY + 90
const headerY = y
y += 90

// primary name (bigger, more breathing room above)
const primaryY = y + 70

// thumb — bigger to match real Wallet rendering (~28% of cardW)
const thumbSize = 190
const thumbX = cardX + cardW - thumbSize - 28
const thumbY = primaryY - thumbSize / 2 - 16

// secondary fields under primary, with breathing room
y = primaryY + 140
const secondaryY = y
y += secondary.length > 0 ? 92 : 0

// auxiliary row (single row, 3 columns)
const auxY = y
y += auxiliary.length > 0 ? 92 : 0

// QR — big whitespace before it
const qrSize = 320
const qrX = cardX + (cardW - qrSize) / 2
const qrY = y + 80
const altTextY = qrY + qrSize + 40

const cardH = altTextY + 22 - cardY
const H = cardH + cardY + 30

const secondaryFieldsSvg = (await Promise.all(secondary.map(async (f, i) => {
  const x = cardX + 28 + i * 220
  const labelSvg = await renderLabelWithEmoji(f.label || '', x, secondaryY, 13, labelColor)
  return `
    ${labelSvg}
    <text x="${x}" y="${secondaryY + 30}" font-family="-apple-system, 'SF Pro Display', system-ui, Helvetica, Arial" font-size="26" fill="${fg}">${escape(f.value)}</text>
  `
}))).join('\n')

const COL_W = 220
const auxiliaryFieldsSvg = (await Promise.all(auxiliary.map(async (f, i) => {
  const x = cardX + 28 + i * COL_W
  const labelSvg = await renderLabelWithEmoji(f.label || '', x, auxY, 13, labelColor)
  return `
    ${labelSvg}
    <text x="${x}" y="${auxY + 30}" font-family="-apple-system, 'SF Pro Display', system-ui, Helvetica, Arial" font-size="22" fill="${fg}">${escape(f.value)}</text>
  `
}))).join('\n')

// logo text with emoji support
const [logoEmoji, logoRest] = splitEmojiPrefix(pass.logoText || '')
let logoTextSvg = ''
{
  const tx0 = cardX + 84
  const ty = cardY + 80
  if (logoEmoji && KNOWN_EMOJI.has(logoEmoji)) {
    const raw = await getEmojiSvg(logoEmoji)
    const inner = raw
      .replace(/<\?xml[^>]*\?>\s*/i, '')
      .replace(/<svg[^>]*>/i, '<g>')
      .replace(/<\/svg>/i, '</g>')
    const sz = 28
    logoTextSvg += `<g transform="translate(${tx0}, ${ty - sz + 4}) scale(${sz / 36})">${inner}</g>`
    logoTextSvg += `<text x="${tx0 + sz + 8}" y="${ty}" font-family="-apple-system, 'SF Pro Display', system-ui, Helvetica, Arial" font-size="22" font-weight="700" fill="${fg}">${escape(logoRest)}</text>`
  } else {
    logoTextSvg = `<text x="${tx0}" y="${ty}" font-family="-apple-system, 'SF Pro Display', system-ui, Helvetica, Arial" font-size="22" font-weight="700" fill="${fg}">${logoText}</text>`
  }
}

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="8"/>
      <feOffset dx="0" dy="4"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.25"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="#1c1c1e"/>

  <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${cardR}" ry="${cardR}" fill="${bg}" filter="url(#shadow)"/>

  <!-- header logo + logoText -->
  <image href="${logoUri}" x="${cardX + 28}" y="${cardY + 50}" width="42" height="42"/>
  ${logoTextSvg}

  <!-- primary name -->
  <text x="${cardX + 28}" y="${primaryY}" font-family="-apple-system, 'SF Pro Display', system-ui, Helvetica, Arial" font-size="56" font-weight="400" fill="${fg}">${primary}</text>

  <!-- thumbnail (rounded) -->
  <image href="${thumbUri}" x="${thumbX}" y="${thumbY}" width="${thumbSize}" height="${thumbSize}"/>

  ${secondaryFieldsSvg}
  ${auxiliaryFieldsSvg}

  ${qrUri ? `<image href="${qrUri}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}"/>` : ''}
  ${barcode ? `<text x="${W / 2}" y="${altTextY}" text-anchor="middle" font-family="-apple-system, 'SF Pro Text', system-ui, Helvetica, Arial" font-size="14" fill="#000">${escape(barcode.altText || '')}</text>` : ''}

  <!-- info button (bottom-right, Wallet always draws this on the front of a pass) -->
  <g transform="translate(${cardX + cardW - 50}, ${cardY + cardH - 50})">
    <circle cx="18" cy="18" r="17" fill="none" stroke="${fg}" stroke-width="1.5" stroke-opacity="0.6"/>
    <text x="18" y="25" text-anchor="middle" font-family="-apple-system, 'SF Pro Display', Times, serif" font-size="22" font-weight="500" font-style="italic" fill="${fg}" fill-opacity="0.7">i</text>
  </g>
</svg>`

// ---- BACK OF PASS ----
const backFields = pass.generic.backFields || []
const stripHtmlTags = s => String(s ?? '').replace(/<[^>]*>/g, '')
const extractHref = s => {
  const m = String(s ?? '').match(/href="([^"]+)"/)
  return m ? m[1] : null
}

// Real Wallet back-of-pass:
//   - Black/dark background, full screen
//   - Top-left back-arrow circle, top-right share circle
//   - Small thumbnail/preview of front pass (centered, ~30% width)
//   - Big bold title (pass description)
//   - Dark rounded group container with rows
//   - Each row: label left in light gray, value right in system blue (tappable) or white
//   - Title-case labels (not uppercase)

const SYSTEM_BLUE = '#0A84FF' // dark-mode system blue
const DARK_BG = '#000000'
const GROUP_BG = '#1c1c1e'
const TEXT_WHITE = '#ffffff'
const DIVIDER = '#38383a'
const SHARE_BG = '#1c1c1e'

// We'll render the front-pass-preview as a smaller image of the front canvas
// Render a smaller thumbnail-sized copy of the front SVG content later.
const PREVIEW_W = 280
const PREVIEW_H = Math.round(PREVIEW_W * (H / W))

const NAV_H = 80
const PREVIEW_BLOCK = PREVIEW_H + 70 // preview + title spacing
const ROW_H = 78
const GROUP_TOP_PAD = 8
const groupH = GROUP_TOP_PAD + backFields.length * ROW_H
const backH = NAV_H + PREVIEW_BLOCK + 90 + groupH + 80

const backRowsSvg = backFields.map((f, i) => {
  const rowY = NAV_H + PREVIEW_BLOCK + 90 + GROUP_TOP_PAD + i * ROW_H
  const display = stripHtmlTags(f.attributedValue || f.value || '')
  const href = extractHref(f.attributedValue)
  const valueColor = href ? SYSTEM_BLUE : TEXT_WHITE
  const labelX = 28 + 30
  const valueX = W - 28 - 30
  const rowMidY = rowY + ROW_H / 2 + 7
  return `
    <text x="${labelX}" y="${rowMidY}" font-family="-apple-system, 'SF Pro Display', system-ui, Helvetica, Arial" font-size="22" font-weight="400" fill="${TEXT_WHITE}">${escape(f.label || '')}</text>
    <text x="${valueX}" y="${rowMidY}" text-anchor="end" font-family="-apple-system, 'SF Pro Display', system-ui, Helvetica, Arial" font-size="22" font-weight="400" fill="${valueColor}">${escape(display)}</text>
    ${i < backFields.length - 1 ? `<line x1="${labelX}" y1="${rowY + ROW_H}" x2="${valueX}" y2="${rowY + ROW_H}" stroke="${DIVIDER}" stroke-width="1"/>` : ''}
  `
}).join('\n')

// Render the front card as a separate buffer first, then embed it as a data URI in the back SVG
const frontPreviewBuf = await sharp(Buffer.from(svg)).resize(PREVIEW_W).png().toBuffer()
const frontPreviewUri = `data:image/png;base64,${frontPreviewBuf.toString('base64')}`

const backSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${backH}" viewBox="0 0 ${W} ${backH}">
  <rect width="${W}" height="${backH}" fill="${DARK_BG}"/>

  <!-- top-left back arrow chip -->
  <circle cx="56" cy="${NAV_H / 2 + 8}" r="22" fill="${SHARE_BG}"/>
  <path d="M${56 + 6},${NAV_H/2 + 8 - 8} L${56 - 6},${NAV_H/2 + 8} L${56 + 6},${NAV_H/2 + 8 + 8}" fill="none" stroke="${TEXT_WHITE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- top-right share chip -->
  <circle cx="${W - 56}" cy="${NAV_H / 2 + 8}" r="22" fill="${SHARE_BG}"/>
  <path d="M${W - 56},${NAV_H/2 + 14} L${W - 56},${NAV_H/2}  M${W - 56 - 6},${NAV_H/2 + 6} L${W - 56},${NAV_H/2}  L${W - 56 + 6},${NAV_H/2 + 6}" fill="none" stroke="${TEXT_WHITE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="${W - 56 - 9}" y="${NAV_H/2 + 4}" width="18" height="14" rx="3" fill="none" stroke="${TEXT_WHITE}" stroke-width="2"/>

  <!-- mini preview of the front pass -->
  <image href="${frontPreviewUri}" x="${(W - PREVIEW_W) / 2}" y="${NAV_H}" width="${PREVIEW_W}" height="${PREVIEW_H}"/>

  <!-- title -->
  <text x="${W / 2}" y="${NAV_H + PREVIEW_H + 60}" text-anchor="middle"
        font-family="-apple-system, 'SF Pro Display', system-ui, Helvetica, Arial"
        font-size="32" font-weight="700" fill="${TEXT_WHITE}">${escape(pass.description || pass.organizationName)}</text>

  <!-- grouped container -->
  <rect x="28" y="${NAV_H + PREVIEW_BLOCK + 90}" width="${W - 56}" height="${groupH}" rx="18" fill="${GROUP_BG}"/>
  ${backRowsSvg}
</svg>`

// Compose front + back stacked
const frontBuf = await sharp(Buffer.from(svg)).png().toBuffer()
const backBuf = await sharp(Buffer.from(backSvg)).png().toBuffer()

const frontMeta = await sharp(frontBuf).metadata()
const backMeta = await sharp(backBuf).metadata()

const gap = 30
const combinedH = frontMeta.height + gap + backMeta.height
const combined = await sharp({
  create: { width: W, height: combinedH, channels: 4, background: '#000000' },
})
  .composite([
    { input: frontBuf, left: 0, top: 0 },
    { input: backBuf, left: 0, top: frontMeta.height + gap },
  ])
  .png()
  .toBuffer()

const out = join(root, 'pass-mockup.png')
await writeFile(out, combined)
await writeFile(join(root, 'pass-mockup.svg'), svg, 'utf-8')
console.log(`Wrote ${out}`)
