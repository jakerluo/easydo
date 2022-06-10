import { existsSync } from 'fs'
import chalk from 'chalk'
import { join, resolve as resolve$0 } from 'path'
import type {
  RollupBuild,
  RollupOptions,
  OutputOptions,
  ModuleFormat,
  RollupError,
  RollupWatchOptions,
  WatcherOptions,
  Plugin as RollupPlugin
} from 'rollup'
import { InlineConfig, resolveConfig, ResolvedConfig } from '../config'
import { emptyDir, lookupFile, normalizePath } from '../utils'
import BasicCommand from '../basic'
import assert from 'assert'
import { PackageData } from '../packages'
import { Plugin } from '../plugins'
type JsExt = 'js' | 'cjs' | 'mjs'

export interface LibraryOptions {
  /**
   * Path of library entry
   */
  entry: string

  /**
   * Output bundle formats
   * @default ['esm']
   */
  formats?: ModuleFormat[]

  /**
   * The name of the exposed global variable. Required when the `formats` option includes
   * `umd` or `iife`
   */
  name?: string

  /**
   * mulitiple package
   * Directory relative from `root` where build output will be placed. If the
   * directory exists, it will be removed before the build.
   * @default 'dist'
   */
  outDir?: BuildOptions['outDir']

  fileName?: string | ((format: ModuleFormat) => string)
}

export interface BuildOptions {
  /**
   * Produce SSR oriented build. Note this requires specifying SSR entry via
   * `rollupOptions.input`.
   */
  ssr?: boolean

  /**
   * Build in library mode. The value should be the global name of the lib in
   * UMD mode. This will produce esm + cjs + umd bundle formats with default
   * configurations that are suitable for distributing libraries.
   */
  lib?: LibraryOptions | LibraryOptions[] | false

  /**
   * Directory relative from `root` where build output will be placed. If the
   * directory exists, it will be removed before the build.
   * @default 'dist'
   */
  outDir?: string

  /**
   * Directory relative from `outDir` where the built js/css/image assets will
   * be placed.
   * @default 'assets'
   */
  assetsDir?: string
  /**
   * Whether to write bundle to disk
   * @default true
   */
  write?: boolean

  /**
   * If `true`, a separate sourcemap file will be created. If 'inline', the
   * sourcemap will be appended to the resulting output file as data URI.
   * 'hidden' works like `true` except that the corresponding sourcemap
   * comments in the bundled files are suppressed.
   * @default false
   */
  sourcemap?: boolean | 'inline' | 'hidden'

  /**
   * Will be merged with internal rollup options.
   * https://rollupjs.org/guide/en/#big-list-of-options
   */
  rollupOptions?: RollupOptions

  /**
   * Empty outDir on write.
   * @default true when outDir is a sub directory of project root
   */
  emptyOutDir?: boolean | null

  /**
   * Rollup watch options
   * https://rollupjs.org/guide/en/#watchoptions
   */
  watch?: WatcherOptions | null
}

export type ResolvedBuildOptions = Required<BuildOptions>

export async function build(inlineConfig: InlineConfig = {}) {
  const resolvedConfig = await resolveConfig(inlineConfig, 'build', 'production')
  new BuildCommand(resolvedConfig)
}

export function resolveBuildPlugins(config: ResolvedConfig) {
  const options = config.build

  return {
    pre: [...(options.rollupOptions?.plugins ? (options.rollupOptions.plugins.filter(Boolean) as Plugin[]) : [])],
    post: []
  }
}

class BuildCommand extends BasicCommand {
  override config: ResolvedConfig & { build: ResolvedBuildOptions }

  private parallelCallCounts = 0

  private parallelBuilds: RollupBuild[] = []

  constructor(config: ResolvedConfig) {
    super(config)
    this.config = {
      ...config,
      build: this.resolveBuildOptions(config.build)
    }
  }

  private resolveBuildOptions(raw?: BuildOptions): ResolvedBuildOptions {
    const resolved: ResolvedBuildOptions = {
      ssr: false,
      lib: false,
      rollupOptions: {},
      outDir: 'dist',
      assetsDir: 'assets',
      write: true,
      sourcemap: false,
      emptyOutDir: null,
      watch: null,
      ...raw
    }

    return resolved
  }

  async run() {
    this.build()
  }

  private async build() {
    this.parallelCallCounts++
    try {
      return await this.doBuild()
    } finally {
      this.parallelCallCounts--
      if (this.parallelCallCounts <= 0) {
        await Promise.all(this.parallelBuilds.map((bundle) => bundle.close()))
        this.parallelBuilds.length = 0
      }
    }
  }

  private async doBuild() {
    const options = this.config.build
    const libOptions = options.lib

    if (Array.isArray(libOptions)) {
      for (const libOption of libOptions) {
        assert(libOption.outDir, 'when lib is array, every item need has outDir')
        await this.doBuildItem({ ...options, lib: libOption, outDir: libOption.outDir }, true)
      }
    } else {
      await this.doBuildItem(options)
    }
  }

  private async doBuildItem(options: Required<BuildOptions>, showPrefix = false) {
    const ssr = !!options.ssr
    const libOptions = options.lib as LibraryOptions
    this.logger.info(
      showPrefix ? chalk.yellowBright(libOptions.entry) : '',
      chalk.cyan(`building${ssr ? ` SSR bundle ` : ' '}for ${this.config.mode}...`)
    )

    const resolve = (p: string) => resolve$0(this.config.root, p)
    const input = libOptions
      ? resolve(libOptions.entry)
      : typeof ssr === 'string'
      ? resolve(ssr)
      : options.rollupOptions?.input || resolve('index.html')

    if (ssr && typeof input === 'string' && input.endsWith('.html')) {
      this.logger.error(
        showPrefix ? chalk.yellowBright(libOptions.entry) : '',
        `rollupOptions.input should not be an html file when building for SSR. Please specify a dedicated SSR entry.`
      )
      process.exit(1)
    }

    const outDir = resolve(options.outDir)

    // TODO plugin, external;

    const plugins = this.config.plugins as RollupPlugin[]

    const rollupOptions: RollupOptions = {
      input,
      context: 'globalThis',
      preserveEntrySignatures: ssr ? 'allow-extension' : libOptions ? 'strict' : false,
      ...options.rollupOptions,
      plugins,
      onwarn(warning, warn) {
        console.log('1', warning, warn)
      }
    }

    try {
      const buildOutputOptions = (output: OutputOptions = {}): OutputOptions => {
        const format = output.format || 'esm'

        const jsExt = libOptions ? this.resolveOutputJsExtension(format, this.getPkgJson()?.type) : 'js'
        return {
          dir: outDir,
          format,
          exports: 'auto',
          sourcemap: options.sourcemap,
          name: libOptions ? libOptions.name : undefined,
          generatedCode: 'es2015',
          entryFileNames: libOptions
            ? this.resolveLibFilename(libOptions, format, jsExt)
            : join(options.assetsDir, `[name].[hash].js`),
          chunkFileNames: libOptions ? `[name].[hash].${jsExt}` : join(options.assetsDir, `[name].[hash].js`),
          assetFileNames: libOptions ? `[name].[ext]` : join(options.assetsDir, `[name].[hash].[ext]`),
          namespaceToStringTag: true,
          inlineDynamicImports: output.format === 'umd' || output.format === 'iife',
          ...output
        }
      }
      const outputs = this.resolveBuildOutputs(options.rollupOptions.output, libOptions)

      if (this.config.build.watch) {
        this.logger.info(
          showPrefix ? chalk.yellowBright(libOptions.entry) : '',
          chalk.cyan('watching for file changes...')
        )
        const output: OutputOptions[] = []
        if (Array.isArray(outputs)) {
          for (const resolvedOutput of outputs) {
            output.push(buildOutputOptions(resolvedOutput))
          }
        } else {
          output.push(buildOutputOptions(outputs as OutputOptions))
        }

        const watchConfigOptions = this.config.build.watch
        const watcherOptions: RollupWatchOptions = {
          ...rollupOptions,
          output,
          watch: {
            ...watchConfigOptions,
            chokidar: {
              ignoreInitial: true,
              ignorePermissionErrors: true,
              ...watchConfigOptions.chokidar,
              ignored: ['**/node_modules/**', '**/.git/**', ...(watchConfigOptions?.chokidar?.ignored || [])]
            }
          }
        }
        const { watch } = await import('rollup')
        const watcher = watch(watcherOptions)

        watcher.on('event', (event) => {
          if (event.code === 'BUNDLE_START') {
            this.logger.info(showPrefix ? chalk.yellowBright(libOptions.entry) : '', chalk.cyan('build started'))
            if (options.write) {
              this.prepareOutDir(outDir, options.emptyOutDir)
            }
          } else if (event.code === 'BUNDLE_END') {
            event.result.close()
            this.logger.info(
              showPrefix ? chalk.yellowBright(libOptions.entry) : '',
              chalk.cyan(`built in ${event.duration}ms.`)
            )
          } else if (event.code === 'ERROR') {
            this.outputBuildError(event.error)
          }
        })

        return watcher
      }
      const { rollup } = await import('rollup')
      const bundle = await rollup(rollupOptions)
      this.parallelBuilds.push(bundle)

      const generate = (output: OutputOptions = {}) => {
        return bundle[options.write ? 'write' : 'generate'](buildOutputOptions(output))
      }

      if (options.write) {
        this.prepareOutDir(outDir, options.emptyOutDir)
      }

      if (Array.isArray(outputs)) {
        const res = []
        for (const output of outputs) {
          res.push(await generate(output))
        }
        return res
      } else {
        return await generate(outputs as OutputOptions)
      }
    } catch (error) {
      this.outputBuildError(error)
      process.exit(0)
    }
  }

  private outputBuildError(e: RollupError) {
    let msg = chalk.red((e.plugin ? `[${e.plugin}] ` : '') + e.message)
    if (e.id) {
      msg += `\nfile: ${chalk.cyan(`${e.id}${e.loc ? `:${e.loc?.line}:${e.loc?.column}` : ''}`)}`
    }
    if (e.frame) {
      msg += `\n${chalk.yellow(e.frame)}`
    }
    this.logger.error(msg, e)
  }

  private resolveBuildOutputs(
    outputs: OutputOptions | OutputOptions[] | undefined,
    libOptions: LibraryOptions | false
  ): OutputOptions | OutputOptions[] | undefined {
    if (libOptions) {
      const formats = libOptions.formats || ['esm']

      if (formats.includes('umd') || (formats.includes('iife') && !libOptions.name)) {
        this.logger.error('Option "build.lib.name" is required when output formats include "umd" or "iife".')
      }

      if (!outputs) {
        return formats.map((format) => ({ format }))
      } else if (!Array.isArray(outputs)) {
        return formats.map((format) => ({ ...outputs, format }))
      } else if (libOptions.formats) {
        this.logger.warn(
          chalk.yellow(
            `"build.lib.formats" will be ignored because "build.rollupOptions.output" is already an array format`
          )
        )
      }
    }
    return outputs
  }

  private prepareOutDir(outDir: string, emptyOutDir: boolean | null) {
    if (existsSync(outDir)) {
      if (emptyOutDir == null && !normalizePath(outDir).startsWith(join(this.config.root, '/'))) {
        this.logger.warn(
          chalk.yellow(
            `\n${chalk.bold(`(!)`)} outDir ${chalk.white(
              chalk.dim(outDir)
            )} is not inside project root and will not be emptied.\n` + `Use --emptyOutDir to override.\n`
          )
        )
      } else if (emptyOutDir !== false) {
        emptyDir(outDir, ['.git'])
      }
    }
  }

  private resolveLibFilename(libOptions: LibraryOptions, format: ModuleFormat, extension?: JsExt) {
    if (typeof libOptions.fileName === 'function') {
      return libOptions.fileName(format)
    }

    const packageJson = this.getPkgJson()
    const name = libOptions.name || this.getPkgName(packageJson.name)
    if (!name) {
      this.logger.error('Name in package.json is required if option "build.lib.fileName" is not provided.')
      process.exit(1)
    }

    extension ??= this.resolveOutputJsExtension(format, packageJson.type)

    if (format === 'cjs' || format === 'es') {
      return `${name}.${extension}`
    }

    return `${name}.${format}.${extension}`
  }

  private getPkgJson(): PackageData['data'] {
    return JSON.parse(lookupFile(this.config.root, ['package.json']) || `{}`)
  }

  private getPkgName(name: string) {
    return name?.startsWith('@') ? name.split('/')[1] : name
  }

  private resolveOutputJsExtension(format: ModuleFormat, type: string = 'commonjs'): JsExt {
    if (type === 'module') {
      return format === 'cjs' || format === 'umd' ? 'cjs' : 'js'
    } else {
      return format === 'es' ? 'mjs' : 'js'
    }
  }
}
