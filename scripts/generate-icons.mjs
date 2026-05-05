#!/usr/bin/env node

import { copyFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const source = join(root, '1024x1024.png')

if (!existsSync(source)) {
  throw new Error(`Icon source is missing: ${source}`)
}

const result = spawnSync(
  'npx',
  [
    '--yes',
    'electron-icon-maker@0.0.5',
    '--input',
    source,
    '--output',
    './build',
  ],
  {
    cwd: root,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  },
)

if (result.error) {
  throw result.error
}

if (result.status !== 0) {
  throw new Error(`electron-icon-maker exited with code ${result.status}`)
}

copyFileSync(join(root, 'build', 'icons', 'png', '512x512.png'), join(root, 'assets', 'icon.png'))
copyFileSync(join(root, 'build', 'icons', 'win', 'icon.ico'), join(root, 'assets', 'icon.ico'))
