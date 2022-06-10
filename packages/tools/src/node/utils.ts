import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'fs'
import { platform } from 'os'
import { createRequire } from 'module'
import { posix, join, dirname as dirname$0, resolve } from 'path'
import { fileURLToPath, URL } from 'url'

export const queryRE = /\?.*$/s
export const hashRE = /#.*$/s

export const cleanUrl = (url: string): string => url.replace(hashRE, '').replace(queryRE, '')

export function slash(p: string): string {
  return p.replace(/\\/g, '/')
}

export const isWindows = platform() === 'win32'

// TODO: use import()
const _require = createRequire(import.meta.url)

export function normalizePath(id: string): string {
  return posix.normalize(isWindows ? slash(id) : id)
}

export function lookupFile(dir: string, formats: string[], pathOnly = false): string | undefined {
  for (const format of formats) {
    const fullPath = join(dir, format)
    if (existsSync(fullPath) && statSync(fullPath).isFile()) {
      return pathOnly ? fullPath : readFileSync(fullPath, 'utf-8')
    }
  }
  const parentDir = dirname$0(dir)
  if (parentDir !== dir) {
    return lookupFile(parentDir, formats, pathOnly)
  }
}

export function arraify<T>(target: T | T[]): T[] {
  return Array.isArray(target) ? target : [target]
}

export function isObject(value: unknown): value is Record<string, any> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

// @ts-expect-error
export const usingDynamicImport = typeof jest === 'undefined'

/**
 * Dynamically import files. It will make sure it's not being compiled away by TS/Rollup.
 *
 * As a temporary workaround for Jest's lack of stable ESM support, we fallback to require
 * if we're in a Jest environment.
 * See https://github.com/vitejs/vite/pull/5197#issuecomment-938054077
 *
 * @param file File path to import.
 */
export const dynamicImport = usingDynamicImport ? new Function('file', 'return import(file)') : _require

export function dirname(path: string | URL) {
  const filename = fileURLToPath(path)
  return dirname$0(filename)
}

function mergeConfigRecursively(defaults: Record<string, any>, overrides: Record<string, any>, rootPath: string) {
  const merged: Record<string, any> = { ...defaults }
  for (const key in overrides) {
    const value = overrides[key]
    if (value == null) {
      continue
    }

    const existing = merged[key]

    if (existing == null) {
      merged[key] = value
      continue
    }

    // fields that require special handling
    if (key === 'alias' && (rootPath === 'resolve' || rootPath === '')) {
      // TODO merge alise
      continue
    } else if (key === 'assetsInclude' && rootPath === '') {
      merged[key] = [].concat(existing, value)
      continue
    } else if (key === 'noExternal' && rootPath === 'ssr' && (existing === true || value === true)) {
      merged[key] = true
      continue
    }

    if (Array.isArray(existing) || Array.isArray(value)) {
      merged[key] = [...arraify(existing ?? []), ...arraify(value ?? [])]
      continue
    }
    if (isObject(existing) && isObject(value)) {
      merged[key] = mergeConfigRecursively(existing, value, rootPath ? `${rootPath}.${key}` : key)
      continue
    }

    merged[key] = value
  }
  return merged
}

export function mergeConfig(
  defaults: Record<string, any>,
  overrides: Record<string, any>,
  isRoot = true
): Record<string, any> {
  return mergeConfigRecursively(defaults, overrides, isRoot ? '' : '.')
}

export function emptyDir(dir: string, skip?: string[]): void {
  for (const file of readdirSync(dir)) {
    if (skip?.includes(file)) {
      continue
    }
    rmSync(resolve(dir, file), { recursive: true, force: true })
  }
}

export function isFileReadable(filename: string): boolean {
  try {
    const stat = statSync(filename, { throwIfNoEntry: false })
    return !!stat
  } catch {
    return false
  }
}

export function toUpperCaseDriveLetter(pathName: string): string {
  return pathName.replace(/^\w:/, (letter) => letter.toUpperCase())
}

const splitRE = /\r?\n/
const range: number = 2

export function posToNumber(source: string, pos: number | { line: number; column: number }): number {
  if (typeof pos === 'number') return pos
  const lines = source.split(splitRE)
  const { line, column } = pos
  let start = 0
  for (let i = 0; i < line - 1; i++) {
    if (lines[i]) {
      start += lines[i].length + 1
    }
  }
  return start + column
}

export function generateCodeFrame(
  source: string,
  start: number | { line: number; column: number } = 0,
  end?: number
): string {
  start = posToNumber(source, start)
  end = end || start
  const lines = source.split(splitRE)
  let count = 0
  const res: string[] = []
  for (let i = 0; i < lines.length; i++) {
    count += lines[i].length + 1
    if (count >= start) {
      for (let j = i - range; j <= i + range || end > count; j++) {
        if (j < 0 || j >= lines.length) continue
        const line = j + 1
        res.push(`${line}${' '.repeat(Math.max(3 - String(line).length, 0))}|  ${lines[j]}`)
        const lineLength = lines[j].length
        if (j === i) {
          // push underline
          const pad = start - (count - lineLength) + 1
          const length = Math.max(1, end > count ? lineLength - pad : end - start)
          res.push(`   |  ` + ' '.repeat(pad) + '^'.repeat(length))
        } else if (j > i) {
          if (end > count) {
            const length = Math.max(Math.min(end - count, lineLength), 1)
            res.push(`   |  ` + '^'.repeat(length))
          }
          count += lineLength + 1
        }
      }
      break
    }
  }
  return res.join('\n')
}
