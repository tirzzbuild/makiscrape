/**
 * Name  : CapCut Template Downloader (link mp4, JSON only)
 * Owner : Zane
 * SL    : https://whatsapp.com/channel/0029VbBe2Xt1t90gnNzfxc1F
 * Base Web : https://www.capcut.com
 * Type  : Scraper
 * Function : downloader capcut
 * Note  : error fix sendiri.
 */

import { request as httpsReq } from 'node:https'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

const BASE = 'https://www.capcut.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const TIMEOUT = 30_000
const RETRIES = 3

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Request HTTPS native, ikut redirect, retry 429/5xx/timeout. */
async function req(url, { method = 'GET', headers = {}, body, maxRedirect = 5, timeout = TIMEOUT, retries = RETRIES } = {}) {
  let currentUrl = url

  for (let hop = 0; hop <= maxRedirect; hop++) {
    const parsedUrl = new URL(currentUrl)
    let out = null

    for (let attempt = 0; attempt <= retries; attempt++) {
      out = await new Promise((resolve) => {
        const request = httpsReq(
          {
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || 443,
            path: parsedUrl.pathname + parsedUrl.search,
            method,
            servername: parsedUrl.hostname,
            headers: {
              'User-Agent': UA,
              Accept: '*/*',
              'Accept-Language': 'en-US,en;q=0.9',
              Referer: `${BASE}/`,
              ...headers,
            },
          },
          (response) => {
            const chunks = []
            response.on('data', (chunk) => chunks.push(chunk))
            response.on('end', () => {
              resolve({
                status: response.statusCode,
                headers: response.headers,
                text: Buffer.concat(chunks).toString('utf8'),
                finalUrl: currentUrl,
              })
            })
          },
        )

        request.setTimeout(timeout, () => request.destroy(new Error('timeout')))
        request.on('error', (error) => resolve({ status: 0, error: error.message }))
        if (body) request.write(body)
        request.end()
      })

      if (out.status === 429 && attempt < retries) {
        await sleep(Math.min(Number(out.headers?.['retry-after'] || 1) * 1000 || 1200 * (attempt + 1), 8000))
        continue
      }
      if ((out.status >= 500 || out.status === 0) && attempt < retries) {
        await sleep(700 * (attempt + 1))
        continue
      }
      break
    }

    if (!out) throw new Error('request gagal terus-terusan')
    const location = out.headers?.location
    if (out.status >= 300 && out.status < 400 && location) {
      currentUrl = new URL(location, currentUrl).toString()
      continue
    }
    if (out.status === 0) throw new Error(out.error || 'koneksi gagal')
    if (out.status >= 400) {
      const responseBody = out.text || ''
      const detail = /<html/i.test(responseBody)
        ? (out.status === 404 ? 'halaman tidak ditemukan' : 'respons HTML error')
        : responseBody.slice(0, 160)
      throw new Error(`HTTP ${out.status} — ${detail}`)
    }
    return out
  }

  throw new Error('terlalu banyak redirect')
}

// ── SSR DATA ──────────────────────────────────────────────
const ROUTER_RE = /<script[^>]*id="__MODERN_ROUTER_DATA__"[^>]*>([\s\S]*?)<\/script>/

function loaderData(html) {
  const match = html.match(ROUTER_RE)
  if (!match) throw new Error('data SSR ga ketemu (__MODERN_ROUTER_DATA__) — halaman berubah/bukan template')

  let data
  try {
    data = JSON.parse(match[1])
  } catch (error) {
    throw new Error(`JSON SSR korup: ${error.message}`)
  }

  return data.loaderData || {}
}

/** Cari objek templateDetail di dalam loaderData. */
function findDetail(loader) {
  for (const value of Object.values(loader)) {
    if (value && typeof value === 'object' && value.templateDetail && value.templateDetail.templateId) return value
  }
  return null
}

function num(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const iso = (timestamp) => (num(timestamp) ? new Date(num(timestamp) * 1000).toISOString() : null)

function cleanTemplate(template = {}) {
  const author = template.author || {}
  return {
    id: template.templateId || null,
    title: template.title || null,
    desc: template.desc || null,
    tagTitle: template.tagTitle || null,
    url: template.templateId ? `${BASE}/template-detail/${template.templateId}` : null,
    canonicalPath: template.canonicalPath || null,
    cover: template.coverUrl || null,
    video: {
      url: template.videoUrl || null,
      ratio: template.videoRatio || null,
      width: num(template.videoWidth),
      height: num(template.videoHeight),
      durationMs: num(template.templateDuration),
      durationSec: num(template.templateDuration) ? Math.round(num(template.templateDuration) / 1000) : null,
    },
    stats: {
      uses: num(template.usageAmount),
      likes: num(template.likeAmount),
      plays: num(template.playAmount),
      comments: num(template.commentAmount),
      segments: num(template.segmentAmount),
    },
    author: author.name ? {
      name: author.name,
      avatar: author.avatarUrl || null,
      profileUrl: author.profileUrl ? `${BASE}${author.profileUrl}` : null,
      secUid: author.secUid || null,
      bio: author.description || null,
    } : null,
    language: template.ugcLang || template.templateLanguage || null,
    capability: template.capabilityName || null,
    createdAt: iso(template.createTime),
    seo: template.structuredData ? {
      name: template.structuredData.name || null,
      description: template.structuredData.description || null,
      thumbnail: template.structuredData.thumbnailUrl || null,
      contentUrl: template.structuredData.contentUrl || null,
      uploadDate: iso(template.structuredData.uploadDate),
      duration: num(template.structuredData.duration),
    } : null,
  }
}

// ── ID DARI MACAM-MACAM LINK ──────────────────────────────
async function resolveInput(input) {
  const value = String(input || '').trim()
  if (!value) throw new Error('butuh link/id template')
  if (/^\d{10,}$/.test(value)) return value

  let url = value
  if (!/^https?:\/\//i.test(value)) {
    if (/capcut:\/\//i.test(value)) url = value
    else if (value.includes('/') || value.includes('.')) url = `https://${value.replace(/^\/+/, '')}`
    else url = value
  }

  let match = url.match(/template_id=(\d{10,})/) || url.match(/template-detail\/(?:[^/?#]+\/)?(\d{10,})/)
  if (match) return match[1]

  // Link pendek (mis. /t/..., /tv2/...) diarahkan lalu ID dibaca dari URL final.
  if (/capcut\.com\//i.test(url) || /^capcut:\/\//i.test(url)) {
    const response = await req(url)
    const finalUrl = response.finalUrl || ''
    const finalMatch = finalUrl.match(/template_id=(\d{10,})/) || finalUrl.match(/template-detail\/(?:[^/?#]+\/)?(\d{10,})/)
    if (finalMatch && !/template-detail\/default-tool/i.test(finalUrl)) return finalMatch[1]
    throw new Error(`link itu ga nunjuk template (${finalUrl || response.status})`)
  }

  // Path mentah seperti "nama-template/1234567890123456789".
  match = value.match(/(\d{10,})/)
  if (match) return match[1]
  throw new Error(`bukan link template CapCut: ${input}`)
}

// ── COMMANDS ──────────────────────────────────────────────
/** Ambil data lengkap template (SSR) + info halaman. */
export async function info(input, { log } = {}) {
  const id = await resolveInput(input)
  log?.(`info: ${id}`)
  const response = await req(`${BASE}/template-detail/${id}`)
  const loader = loaderData(response.text)
  const found = findDetail(loader)
  if (!found) throw new Error(`template ${id} ga ketemu (404/region-lock)`)

  const template = cleanTemplate(found.templateDetail)
  return {
    template,
    page: {
      url: `${BASE}${found.canonicalPath || `/template-detail/${id}`}`,
      canonicalPath: found.canonicalPath || null,
      isValidRegion: found.templateDetail?.is_valid_template_region ?? null,
      useAvailable: found.templateDetail?.useAvailable ?? null,
      isDefault: found.templateDetail?.isDefault ?? null,
      query: found.query || null,
    },
    relatedCount: (found.recommendList || []).length,
    api: `${BASE}/template-detail/${id}`,
  }
}

/** Link MP4 langsung + ukuran/jenis. Tidak menyimpan file ke disk. */
export async function download(input, { log } = {}) {
  const infoData = await info(input, { log })
  const template = infoData.template
  const url = template.video.url
  if (!url) throw new Error('template ga punya videoUrl')

  log?.(`cek video: ${url.slice(0, 80)}...`)
  let head = await req(url, { method: 'HEAD' }).catch((error) => ({ status: 0, error: error.message, headers: {} }))

  if (head.status !== 200) {
    // Fallback satu byte untuk CDN yang menolak HEAD.
    head = await req(url, { headers: { Range: 'bytes=0-0' } }).catch((error) => ({ status: 0, error: error.message, headers: {} }))
    if (head.status === 206) {
      const contentRange = String(head.headers?.['content-range'] || '').split('/')[1]
      head.headers['content-length'] = contentRange && contentRange !== '*' ? contentRange : head.headers['content-length']
      head.headers['content-type'] = head.headers['content-type'] || 'video/mp4'
    }
  }

  const size = num(head.headers?.['content-length'])
  const type = head.headers?.['content-type'] || null
  return {
    id: template.id,
    title: template.title,
    durationSec: template.video.durationSec,
    ratio: template.video.ratio,
    resolution: template.video.width && template.video.height ? `${template.video.width}x${template.video.height}` : null,
    video: { url, status: head.status, sizeBytes: size, sizeHr: human(size), contentType: type, watermark: 'baked-in (CapCut ID)' },
    cover: template.cover,
    page: infoData.page.url,
    relatedCount: infoData.relatedCount,
  }
}

// ── HELPERS ───────────────────────────────────────────────
const human = (bytes) => {
  if (!bytes && bytes !== 0) return null
  const units = ['B', 'KB', 'MB', 'GB']
  let index = 0
  let value = bytes
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index++
  }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`
}

// ── CLI (hanya jalan saat file dipanggil langsung) ──
const USAGE = `pakai:

  node capcut-template-downloader.mjs <link>  data template + link video -> JSON

contoh:

  node capcut-template-downloader.mjs https://www.capcut.com/tv2/ZSbtXffJ6/
  node capcut-template-downloader.mjs 7637761575813729537
  node capcut-template-downloader.mjs <link> -q  -q: matikan log di stderr (stdout tetap JSON)

catatan: tidak ada file yang ditulis ke disk — keluaran hanya JSON; videoUrl CDN bertanda
         tangan bisa kedaluwarsa, ambil ulang saat dibutuhkan. Hak penggunaan konten tetap berlaku.`

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const { values, positionals } = parseArgs({
    options: { quiet: { type: 'boolean', short: 'q', default: false } },
    allowPositionals: true,
  })
  const log = values.quiet ? null : (message) => console.error('[*]', message)

  try {
    const [first] = positionals
    if (!first || first === 'help' || first === '--help') {
      console.log(USAGE)
      process.exit(0)
    }

    const output = await download(positionals.join(' '), { log })
    console.log(JSON.stringify(output, null, 2))
  } catch (error) {
    console.error('[!]', error.message || error)
    process.exit(1)
  }
}
