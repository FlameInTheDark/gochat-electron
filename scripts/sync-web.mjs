#!/usr/bin/env node
/**
 * sync-web.mjs
 *
 * Copies changed files from the web React project → src/,
 * skipping files listed in electron-patches.json.
 *
 * Usage:
 *   npm run sync-web              — sync from local ../gochat-react/src/
 *   npm run sync-web:dry          — dry run (local)
 *   npm run sync-web:remote       — clone from GitHub and sync
 *   npm run sync-web:remote:dry   — dry run (remote)
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(__dirname, '..')
const ELECTRON_SRC = join(ROOT, 'src')
const DRY = process.argv.includes('--dry')
const REMOTE = process.argv.includes('--remote')
const REMOTE_REPO = 'https://github.com/FlameInTheDark/gochat-react.git'
const LOCAL_SRC = join(ROOT, '..', 'gochat-react', 'src')

const { new: newFiles, patched } = JSON.parse(
  readFileSync(join(ROOT, 'electron-patches.json'), 'utf-8'),
)

// ── Resolve source directory ──────────────────────────────────────────────────
let webSrc
let tmpDir = null

if (REMOTE) {
  tmpDir = mkdtempSync(join(tmpdir(), 'gochat-sync-'))
  console.log(`Cloning ${REMOTE_REPO} …`)
  try {
    execSync(`git clone --depth 1 ${REMOTE_REPO} "${tmpDir}"`, { stdio: 'inherit' })
  } catch {
    rmSync(tmpDir, { recursive: true, force: true })
    console.error('Failed to clone repository.')
    process.exit(1)
  }
  webSrc = join(tmpDir, 'src')
} else {
  if (!existsSync(LOCAL_SRC)) {
    console.error(`Local source not found: ${LOCAL_SRC}`)
    console.error('Use --remote to sync from GitHub instead.')
    process.exit(1)
  }
  webSrc = LOCAL_SRC
}

// ── Core sync ─────────────────────────────────────────────────────────────────
function walk(dir, base = dir) {
  const result = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) result.push(...walk(full, base))
    else result.push(relative(base, full).replace(/\\/g, '/'))
  }
  return result
}

let synced = 0, unchanged = 0, skippedNew = 0, skippedPatched = 0

try {
  for (const file of walk(webSrc)) {
    const electronRelPath = `src/${file}`

    if (newFiles.includes(electronRelPath)) {
      skippedNew++
      continue
    }

    if (patched.includes(electronRelPath)) {
      skippedPatched++
      console.log(`⚠  PATCHED (review manually): ${electronRelPath}`)
      continue
    }

    const src = join(webSrc, file)
    const dst = join(ELECTRON_SRC, file)
    const srcContent = readFileSync(src)

    let dstContent = null
    try { dstContent = readFileSync(dst) } catch { /* new file */ }

    if (dstContent && srcContent.equals(dstContent)) {
      unchanged++
      continue
    }

    const label = dstContent ? 'UPDATE' : 'NEW   '
    console.log(`✓  ${label}: ${electronRelPath}`)

    if (!DRY) {
      mkdirSync(dirname(dst), { recursive: true })
      writeFileSync(dst, srcContent)
    }
    synced++
  }
} finally {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
}

// ── Summary ───────────────────────────────────────────────────────────────────
const source = REMOTE ? REMOTE_REPO : LOCAL_SRC

console.log(`
Source:  ${source}
Summary: ${synced} file(s) ${DRY ? 'would be ' : ''}synced, ${unchanged} unchanged, ${skippedNew} Electron-only skipped, ${skippedPatched} patched file(s) skipped.
`)

if (skippedPatched > 0) {
  console.log('Patched files may need manual merging. Suggested diffs:')
  for (const f of patched) {
    const webFile = f.replace(/^src\//, '')
    const webPath = REMOTE ? `<cloned>/src/${webFile}` : `${LOCAL_SRC}/${webFile}`
    console.log(`  diff ${f} ${webPath}`)
  }
}
