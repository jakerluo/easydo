import type { Plugin as RollupPlugin } from 'rollup'
import type { UserConfig, ConfigEnv, ResolvedConfig } from '../config'
import { esbuildPlugin } from './esbuild'
import { ServerHook } from '../server'

export interface Plugin extends RollupPlugin {
  enforce?: 'pre' | 'post'
  apply?: 'serve' | 'build' | ((config: UserConfig, env: ConfigEnv) => boolean)
  config?: (config: UserConfig, env: ConfigEnv) => UserConfig | null | void | Promise<UserConfig | null | void>
  configResolved?: (config: ResolvedConfig) => void | Promise<void>
  configureServer?: ServerHook
}

export async function resolvePlugins(
  config: ResolvedConfig,
  prePlugins: Plugin[],
  normalPlugins: Plugin[],
  postPlugins: Plugin[]
): Promise<Plugin[]> {
  const isBuild = config.command === 'build'
  const isWatch = isBuild && !!config.build.watch

  const buildPlugins = isBuild ? (await import('../build')).resolveBuildPlugins(config) : { pre: [], post: [] }

  return [config.esbuild !== false ? esbuildPlugin(config.esbuild) : undefined].filter(Boolean) as Plugin[]
}
