import { join, resolve } from 'path'
import { readFileSync } from 'fs'
import { parse } from 'dotenv'
import { expand } from 'dotenv-expand'
import { arraify, lookupFile, normalizePath } from './utils'
import * as process from 'process'
import logger, { Logger } from './logger'

export interface UserConfig {
  mode?: string
  envDir?: string
  root?: string
  envPrefix?: string
}

export interface InlineConfig extends UserConfig {
  configFile?: string | false
  envFile?: false
  all?: boolean
}

export type ResolvedConfig = Readonly<
  UserConfig & {
    configFile: string | undefined
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
  let mode = inlineConfig.mode || defaultMode

  if (mode === 'production') {
    process.env.NODE_ENV = 'production'
  }

  const { configFile } = config

  const resolvedRoot = normalizePath(config.root ? resolve(config.root) : process.cwd())

  // load .env files
  const envDir = config.envDir ? normalizePath(resolve(resolvedRoot, config.envDir)) : resolvedRoot
  const userEnv = inlineConfig.envFile !== false && loadEnv(mode, envDir, resolveEnvPrefix(config))

  const isProduction = (process.env.EDO_USER_NODE_ENV || mode) === 'production'

  const resolved: ResolvedConfig = {
    ...config,
    configFile: configFile ? normalizePath(configFile) : undefined,
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
