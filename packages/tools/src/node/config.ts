import { extname, join, resolve } from 'path'
import { existsSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'fs'
import { parse } from 'dotenv'
import { expand } from 'dotenv-expand'
import { arraify, dynamicImport, isObject, lookupFile, mergeConfig, normalizePath } from './utils'
import * as process from 'process'
import { performance } from 'perf_hooks'
import { build, BuildOptions, OutputFile } from 'esbuild'
import chalk from 'chalk'
import { pathToFileURL } from 'url'

import logger, { Logger } from './logger'
import { createRequire } from 'module'
import { InitOptions } from './init'

export interface ConfigEnv {
  command?: string
  mode?: string
}

export type UserConfigFn = (env: ConfigEnv) => UserConfig | Promise<UserConfig>

export type UserConfigExport = UserConfig | Promise<UserConfig> | UserConfigFn

export interface UserConfig {
  mode?: string
  envDir?: string
  root?: string
  envPrefix?: string
  logLevel?: string
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'lerna'
  configName?: string
  needUpdate?: boolean
  registry?: string
}

export interface InlineConfig extends UserConfig, InitOptions {
  configFile?: string | false
  envFile?: false
  all?: boolean
}

export type ResolvedConfig = Readonly<
  UserConfig & {
    configFile: string | undefined
    configFileDependencies: string[]
    inlineConfig: InlineConfig
    isProduction: boolean
    logger: Logger
    env: Record<string, any>
  }
>

export type SupportCommand = 'commit'

export async function resolveConfig(
  inlineConfig: InlineConfig,
  command?: SupportCommand,
  defaultMode = 'development'
): Promise<ResolvedConfig> {
  let config = inlineConfig
  let configFileDependencies: string[] = []
  let mode = inlineConfig.mode || defaultMode

  if (mode === 'production') {
    process.env.NODE_ENV = 'production'
  }

  const configEnv: ConfigEnv = {
    mode,
    command
  }

  let { configFile } = config
  if (configFile !== false) {
    const loadResult = await loadConfigFromFile(configEnv, configFile, config.root)
    if (loadResult) {
      config = mergeConfig(loadResult.config, config)
      configFile = loadResult.path
      configFileDependencies = loadResult.dependencies
    }
  }

  logger.level = config.logLevel || logger.level

  mode = inlineConfig.mode || config.mode || mode
  configEnv.mode = mode

  const resolvedRoot = normalizePath(config.root ? resolve(config.root) : process.cwd())

  // load .env files
  const envDir = config.envDir ? normalizePath(resolve(resolvedRoot, config.envDir)) : resolvedRoot
  const userEnv = inlineConfig.envFile !== false && loadEnv(mode, envDir, resolveEnvPrefix(config))

  const isProduction = (process.env.EDO_USER_NODE_ENV || mode) === 'production'

  const resolved: ResolvedConfig = {
    ...config,
    configFile: configFile ? normalizePath(configFile) : undefined,
    configFileDependencies: configFileDependencies.map((name) => normalizePath(resolve(name))),
    inlineConfig: inlineConfig,
    root: resolvedRoot,
    mode,
    isProduction,
    logger,
    env: {
      ...userEnv,
      MODE: mode,
      DEV: !isProduction,
      PROD: isProduction
    }
  }

  logger.debug('resolved config', resolved)

  return resolved
}

export async function loadConfigFromFile(
  configEnv?: ConfigEnv,
  configFile?: string | boolean,
  configRoot: string = process.cwd()
): Promise<{
  path: string
  config: UserConfig
  dependencies: string[]
} | null> {
  const start = performance.now()
  const getTime = () => `${(performance.now() - start).toFixed(2)}ms`

  let resolvedPath: string | undefined
  let isTS = false
  let isESM = false
  let dependencies: string[] = []

  try {
    const pkg = lookupFile(configRoot, ['package.json'])
    if (pkg && JSON.parse(pkg).type === 'module') {
      isESM = true
      logger.info(`${getTime()} ${chalk.cyan('esm module package')}`)
    }
  } catch (e) {}

  if (configFile) {
    if (typeof configFile === 'string') {
      resolvedPath = resolve(configFile)
      isTS = configFile.endsWith('.ts')

      if (configFile.endsWith('.mjs')) {
        isESM = true
      }
    }
  } else {
    const jsConfigFile = resolve(configRoot, 'edo.config.js')
    if (existsSync(jsConfigFile)) {
      resolvedPath = jsConfigFile
    }

    if (!resolvedPath) {
      const mjsConfigFile = resolve(configRoot, 'edo.config.mjs')
      if (existsSync(mjsConfigFile)) {
        resolvedPath = mjsConfigFile
        isESM = true
      }
    }

    if (!resolvedPath) {
      const tsConfigFile = resolve(configRoot, 'edo.config.ts')
      if (existsSync(tsConfigFile)) {
        resolvedPath = tsConfigFile
        isTS = true
      }
    }

    if (!resolvedPath) {
      const cjsConfigFile = resolve(configRoot, 'edo.config.cjs')
      if (existsSync(cjsConfigFile)) {
        resolvedPath = cjsConfigFile
        isESM = false
      }
    }
  }

  if (!resolvedPath) {
    logger.error('no config file found')
    return null
  }

  try {
    let userConfig: UserConfigExport | undefined

    if (isESM) {
      const fileUrl = pathToFileURL(resolvedPath)
      const bundle = await bundleConfigFile(resolvedPath, true)
      dependencies = bundle.dependencies
      if (isTS) {
        writeFileSync(`${resolvedPath}.js`, bundle.code)
        userConfig = (await dynamicImport(`${fileUrl}.js?t=${Date.now()}`)).default
        unlinkSync(`${resolvedPath}.js`)
        logger.info(`TS + native esm config loaded in ${getTime()}`, fileUrl)
      } else {
        userConfig = (await dynamicImport(`${fileUrl}.js?t=${Date.now()}`)).default
        logger.info(`native esm config loaded in ${getTime()}`, fileUrl)
      }
    }

    if (!userConfig) {
      const bundled = await bundleConfigFile(resolvedPath)
      dependencies = bundled.dependencies
      userConfig = await loadConfigFromBundledFile(resolvedPath, bundled.code)
      logger.info(`bundled config file loaded in ${getTime()}`)
    }

    if (configEnv) {
      const config = await (typeof userConfig === 'function' ? userConfig(configEnv) : userConfig)

      if (!isObject(config)) {
        logger.error('config must export or return an object.')
        process.exit(1)
      }
      return {
        path: normalizePath(resolvedPath),
        config,
        dependencies
      }
    }
    return null
  } catch (e) {
    logger.error(`failed to load config from ${resolvedPath}`)
    logger.error(e)
    process.exit(1)
  }
}

async function bundleConfigFile(fileName: string, isESM = false): Promise<{ code: string; dependencies: string[] }> {
  const options: BuildOptions = {
    absWorkingDir: process.cwd(),
    entryPoints: [fileName],
    outfile: 'out.js',
    write: false,
    platform: 'node',
    bundle: true,
    format: isESM ? 'esm' : 'cjs',
    sourcemap: 'inline',
    metafile: true
  }
  const result = await build(options)
  const { text } = result.outputFiles?.[0] as OutputFile

  return {
    code: text,
    dependencies: result.metafile ? Object.keys(result.metafile.inputs) : []
  }
}

export function loadEnv(mode: string, envDir: string, prefixes: string | string[] = 'EDO_'): Record<string, string> {
  if (mode === 'local') {
    throw new Error(
      `"local" cannot be used as a mode name because it conflicts with ` + `the .local postfix for .env files.`
    )
  }
  prefixes = arraify(prefixes)
  const env: Record<string, string> = {}
  const envFiles = [
    /** mode local file */ `.env.${mode}.local`,
    /** mode file */ `.env.${mode}`,
    /** local file */ `.env.local`,
    /** default file */ `.env`
  ]
  for (const key in process.env) {
    if (prefixes.some((prefix) => prefix && key.startsWith(prefix)) && env[key] === undefined) {
      env[key] = process.env[key] as string
    }
  }

  for (const file of envFiles) {
    const path = lookupFile(envDir, [file], true)
    logger.debug('env file', join(envDir, file))
    if (path) {
      const parsed = parse(readFileSync(path))

      // let environment variables use each other
      expand({
        parsed,
        // prevent process.env mutation
        ignoreProcessEnv: true
      })

      // only keys that start with prefix are exposed to client
      for (const [key, value] of Object.entries(parsed)) {
        if (prefixes.some((prefix) => key.startsWith(prefix)) && env[key] === undefined) {
          env[key] = value
        } else if (key === 'NODE_ENV') {
          // NODE_ENV override in .env file
          process.env.EDO_USER_NODE_ENV = value
        }
      }
    }
  }
  return env
}

export function resolveEnvPrefix({ envPrefix = '' }: UserConfig): string[] {
  const newEnvPrefix = arraify(envPrefix)
  if (newEnvPrefix.some((prefix) => prefix === '')) {
    logger.warn(`envPrefix option contains value '', which could lead unexpected exposure of sensitive information.`)
  }
  return newEnvPrefix
}

interface NodeModuleWithCompile extends NodeModule {
  _compile(code: string, filename: string): any
}

const _require = createRequire(import.meta.url)

async function loadConfigFromBundledFile(fileName: string, bundledCode: string): Promise<UserConfig> {
  const extension = extname(fileName)
  const realFileName = realpathSync(fileName)
  const defaultLoader = _require.extensions[extension]!
  _require.extensions[extension] = (module: NodeModule, filename: string) => {
    if (filename === realFileName) {
      ;(module as NodeModuleWithCompile)._compile(bundledCode, filename)
    } else {
      defaultLoader(module, filename)
    }
  }
  // clear cache in case of server restart
  delete _require.cache[_require.resolve(fileName)]
  const raw = _require(fileName)
  const config = raw.__esModule ? raw.default : raw
  _require.extensions[extension] = defaultLoader
  return config
}
