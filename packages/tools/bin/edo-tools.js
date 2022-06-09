#!/usr/bin/env node

import { performance } from 'perf_hooks'

if (!import.meta.url.includes('node_modules')) {
  try {
    import('source-map-support').install()
  } catch (e) {}
}

global.__EDO_START_TIME__ = performance.now()

const debugIndex = process.argv.findIndex((arg) => /^(?:-d|--debug)$/.test(arg))

if (debugIndex >= 0) {
  process.env.EASYDO_TOOLS_LOG_LEVEL = 'debug'
}

async function start() {
  const importLocal = await import('import-local').then((r) => r.default)
  if (importLocal(import.meta.url)) {
    console.log('using local version of cli')
  } else {
    import('../dist/node/cli.js')
  }
}

start().then()
