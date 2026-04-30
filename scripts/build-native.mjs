#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nativeDir = join(root, 'native', 'app-loopback-capture')
const solutionPath = join(nativeDir, 'GochatAppLoopback.sln')
const outputExe = join(nativeDir, 'x64', 'Release', 'GochatAppLoopback.exe')
const packagedExe = join(root, 'assets', 'bin', 'win32-x64', 'GochatAppLoopback.exe')

if (process.platform !== 'win32') {
  console.log('[build-native] Skipping Windows application audio helper on this platform.')
  process.exit(0)
}

function programFilesX86() {
  return process.env['ProgramFiles(x86)'] || process.env.ProgramFiles || 'C:\\Program Files (x86)'
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    ...options,
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`)
  }
}

function findWithVsWhere() {
  const vswhere = join(programFilesX86(), 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (!existsSync(vswhere)) return null

  const result = spawnSync(vswhere, [
    '-latest',
    '-products',
    '*',
    '-requires',
    'Microsoft.Component.MSBuild',
    '-find',
    'MSBuild\\**\\Bin\\MSBuild.exe',
  ], {
    encoding: 'utf8',
    shell: false,
  })

  if (result.status !== 0 || !result.stdout.trim()) return null
  const firstLine = result.stdout.split(/\r?\n/).find(Boolean)
  return firstLine && existsSync(firstLine) ? firstLine : null
}

function findKnownMsBuild() {
  const base = join(programFilesX86(), 'Microsoft Visual Studio')
  const candidates = [
    join(base, '2022', 'Enterprise', 'MSBuild', 'Current', 'Bin', 'MSBuild.exe'),
    join(base, '2022', 'Professional', 'MSBuild', 'Current', 'Bin', 'MSBuild.exe'),
    join(base, '2022', 'Community', 'MSBuild', 'Current', 'Bin', 'MSBuild.exe'),
    join(base, '2022', 'BuildTools', 'MSBuild', 'Current', 'Bin', 'MSBuild.exe'),
    join(base, '2019', 'Enterprise', 'MSBuild', 'Current', 'Bin', 'MSBuild.exe'),
    join(base, '2019', 'Professional', 'MSBuild', 'Current', 'Bin', 'MSBuild.exe'),
    join(base, '2019', 'Community', 'MSBuild', 'Current', 'Bin', 'MSBuild.exe'),
    join(base, '2019', 'BuildTools', 'MSBuild', 'Current', 'Bin', 'MSBuild.exe'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function findMsBuild() {
  if (process.env.MSBUILD && existsSync(process.env.MSBUILD)) {
    return process.env.MSBUILD
  }

  return findWithVsWhere() ?? findKnownMsBuild()
}

function platformToolsetFor(msbuildPath) {
  return msbuildPath.includes('\\2022\\') ? 'v143' : 'v142'
}

function ensureElectronWinstallerSevenZip() {
  const vendorDir = join(root, 'node_modules', 'electron-winstaller', 'vendor')
  if (!existsSync(vendorDir)) return

  for (const extension of ['exe', 'dll']) {
    const destination = join(vendorDir, `7z.${extension}`)
    if (existsSync(destination)) continue

    const source = join(vendorDir, `7z-${process.arch}.${extension}`)
    if (!existsSync(source)) continue

    copyFileSync(source, destination)
    console.log(`[build-native] Restored electron-winstaller 7z.${extension}`)
  }
}

if (!existsSync(solutionPath)) {
  throw new Error(`[build-native] Missing solution: ${solutionPath}`)
}

ensureElectronWinstallerSevenZip()

const msbuild = findMsBuild()
if (!msbuild) {
  throw new Error('[build-native] MSBuild was not found. Install Visual Studio Build Tools with the C++ workload.')
}

const platformToolset = platformToolsetFor(msbuild)
const commonProps = [
  '/p:Configuration=Release',
  '/p:Platform=x64',
  `/p:PlatformToolset=${platformToolset}`,
]

console.log(`[build-native] Building Windows application audio helper with ${msbuild}`)
run(msbuild, [
  solutionPath,
  '/t:Restore',
  '/p:RestorePackagesConfig=true',
  ...commonProps,
])
run(msbuild, [
  solutionPath,
  ...commonProps,
  '/m',
])

if (!existsSync(outputExe)) {
  throw new Error(`[build-native] Expected output was not created: ${outputExe}`)
}

mkdirSync(dirname(packagedExe), { recursive: true })
copyFileSync(outputExe, packagedExe)
console.log(`[build-native] Copied helper to ${packagedExe}`)
