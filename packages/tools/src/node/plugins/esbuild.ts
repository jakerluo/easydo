import { cleanUrl, generateCodeFrame, toUpperCaseDriveLetter } from '../utils'
import { TransformOptions, transform, Loader, Message } from 'esbuild'
import { createFilter } from '@rollup/pluginutils'
import { Plugin } from './index'
import { extname } from 'path'
import { findAll, parse, TSConfckParseOptions, TSConfckParseResult } from 'tsconfck'
import { ResolvedConfig } from '../config'
import { searchForWorkspaceRoot } from '../server'
import { SourceMap } from 'rollup'
import logger from '../logger'
import chalk from 'chalk'

export interface ESBuildOptions extends TransformOptions {
  include?: string | RegExp | string[] | RegExp[]
  exclude?: string | RegExp | string[] | RegExp[]
  jsxInject?: string
}

type TSConfigJSON = {
  extends?: string
  compilerOptions?: {
    target?: string
    jsxFactory?: string
    jsxFragmentFactory?: string
    useDefineForClassFields?: boolean
    importsNotUsedAsValues?: 'remove' | 'preserve' | 'error'
    preserveValueImports?: boolean
  }
  [key: string]: any
}

type TSCompilerOptions = NonNullable<TSConfigJSON['compilerOptions']>

export interface ESBuildOptions extends TransformOptions {
  include?: string | RegExp | string[] | RegExp[]
  exclude?: string | RegExp | string[] | RegExp[]
  jsxInject?: string
}

async function transformWithEsbuild(code: string, filename: string, options: TransformOptions, inMap?: object) {
  let loader = options?.loader
  if (!loader) {
    const ext = extname(/\.\w+$/.test(filename) ? filename : cleanUrl(filename)).slice(1)
    if (ext === 'cjs' || ext === 'mjs') {
      loader = 'js'
    } else {
      loader = ext as Loader
    }
  }
  let tsconfigRaw = options?.tsconfigRaw

  if (typeof tsconfigRaw !== 'string') {
    const meaningfulFields: Array<keyof TSCompilerOptions> = [
      'target',
      'jsxFactory',
      'jsxFragmentFactory',
      'useDefineForClassFields',
      'importsNotUsedAsValues',
      'preserveValueImports'
    ]
    const compilerOptionsForFile: TSCompilerOptions = {}
    if (loader === 'ts' || loader === 'tsx') {
      const loadedTsConfig = await loadTsconfigJsonForFile(filename)
      const loadedCompilerOptions = loadedTsConfig.compilerOptions ?? {}

      for (const field of meaningfulFields) {
        if (field in loadedCompilerOptions) {
          // @ts-ignore
          compilerOptionsForFile[field] = loadedCompilerOptions[field]
        }
      }
    }

    tsconfigRaw = {
      ...tsconfigRaw,
      compilerOptions: {
        ...compilerOptionsForFile,
        ...tsconfigRaw?.compilerOptions
      }
    }
  }

  const resolvedOptions: ESBuildOptions = {
    sourcemap: true,
    sourcefile: filename,
    ...options,
    loader,
    tsconfigRaw
  }

  delete resolvedOptions.include
  delete resolvedOptions.exclude
  delete resolvedOptions.jsxInject

  try {
    const result = await transform(code, resolvedOptions)

    let map: SourceMap = {
      file: '',
      mappings: '',
      names: [],
      sources: [],
      sourcesContent: [],
      version: 0,
      toUrl: function (): string {
        throw new Error('Function not implemented.')
      }
    }

    if (inMap && resolvedOptions.sourcemap) {
      const nextMap = JSON.parse(result.map)
      nextMap.sourcesContent = []
    } else {
      map = resolvedOptions.sourcemap ? JSON.parse(result.map) : { mappings: '' }
    }

    if (Array.isArray(map.sources)) {
      map.sources = map.sources.map((it) => toUpperCaseDriveLetter(it))
    }

    return {
      ...result,
      map
    }
  } catch (error) {
    logger.error(`esbuild error with options used: %j`, resolvedOptions)
    if (error.errors) {
      error.frame = ''
      error.errors.forEach((m: Message) => {
        error.frame += `\n` + prettifyMessage(m, code)
      })
      error.loc = error.errors[0].location
    }
    throw error
  }
}

export function esbuildPlugin(options: ESBuildOptions = {}): Plugin {
  const filter = createFilter(options.include || /\.(tsx?|jsx)$/, options.exclude || /\.js$/)

  return {
    name: 'edo:esbuild',
    configureServer(_server) {
      console.log(_server)
    },
    async configResolved(config) {
      await initTSConfck(config)
    },
    async transform(code, id) {
      if (filter(id) || filter(cleanUrl(id))) {
        const result = await transformWithEsbuild(code, id, options)

        if (result.warnings.length) {
          result.warnings.forEach((m) => {
            this.warn(prettifyMessage(m, code))
          })
        }
        if (options.jsxInject && /\.(?:j|t)sx\b/.test(id)) {
          result.code = `${options.jsxInject};${result.code}`
        }
        return { code: result.code, map: result.map }
      }
    }
  }
}

const tsconfckParseOptions: TSConfckParseOptions = {
  cache: new Map<string, TSConfckParseResult>(),
  tsConfigPaths: undefined,
  root: undefined,
  resolveWithEmptyIfConfigNotFound: true
}

async function initTSConfck(config: ResolvedConfig) {
  tsconfckParseOptions.cache?.clear()
  const workspaceRoot = searchForWorkspaceRoot(config.root)
  tsconfckParseOptions.root = workspaceRoot
  tsconfckParseOptions.tsConfigPaths = new Set([
    ...(await findAll(workspaceRoot, {
      skip: (dir) => dir === 'node_modules' || dir === '.git'
    }))
  ])
}

async function loadTsconfigJsonForFile(filename: string): Promise<TSConfigJSON> {
  try {
    const result = await parse(filename, tsconfckParseOptions)
    return result.tsconfig
  } catch (e) {
    throw e
  }
}

function prettifyMessage(m: Message, code: string): string {
  let res = chalk.yellow(m.text)
  if (m.location) {
    const lines = code.split(/\r?\n/g)
    const line = Number(m.location.line)
    const column = Number(m.location.column)
    const offset =
      lines
        .slice(0, line - 1)
        .map((l) => l.length)
        .reduce((total, l) => total + l + 1, 0) + column
    res += `\n` + generateCodeFrame(code, offset, offset + 1)
  }
  return res + `\n`
}
