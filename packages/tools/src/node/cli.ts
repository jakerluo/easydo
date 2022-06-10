import { cac } from 'cac'
import { VERSION } from './constants'
import chalk from 'chalk'
import logger from './logger'
import emoji from 'node-emoji'
import type { InitOptions } from './init'
import type { CommonOptions } from './commit/index'

interface GlobalCLIOptions {
  c?: string
  config?: string
}

const tools = cac('edo')

tools.option('-c, --config <file>', `[string] use specified config file`)

tools.command('release [packageName]').action(async (packageName: string, options: GlobalCLIOptions) => {
  console.log(packageName, options)
})

tools.command('build').action(async () => {
  const { build } = await import('./build')
  await build()
  process.on('SIGINT', function () {
    process.exit(0)
  })
  process.on('exit', function () {
    runTime('all run time')
  })
})

tools
  .command('init [configName]')
  .option('--type', '[string] boilerplate type')
  .option('-d, --dir <dir>', '[string] target directory')
  .option('-f, --force', '[boolean] force to override directory')
  .option('--template <dir>', '[String] use specified local template')
  .option('-u, --needUpdate', '[boolean] need update cli')
  .option('--package <name>', '[string] boilerplate package name')
  .option('--silent', `[boolean] don't ask, just use default value`)
  .action(async (configName: string, options: GlobalCLIOptions & InitOptions) => {
    const { init } = await import('./init')
    await init({
      dir: options.dir,
      silent: options.silent,
      type: options.type,
      force: options.force,
      configName,
      package: options.package,
      template: options.template,
      configFile: options.config
    })
  })

tools
  .command('pkg')
  .option('-m, --manager', '[string] use package manager')
  .action(async () => {
    const { pkg } = await import('./pkg')
    await pkg()
    runTime()
  })

tools.command('work [branchName]').action(async () => {
  const { work } = await import('./work')
  work()
  runTime()
})

tools
  .command('commit')
  .option('-a, --all', '[boolean] select all changed files')
  .option('-f, --focus', '[boolean] choose focus push')
  .action(async (options: CommonOptions & GlobalCLIOptions) => {
    const { commit } = await import('./commit/index')
    await commit({
      all: options.all,
      configFile: options.config
    })
    runTime()
  })

tools.help()
tools.version(VERSION)
tools.parse()

function runTime(messagePrefix = 'ready in') {
  const edoStartTime = global.__EDO_START_TIME__ ?? false

  const startupDurationString = edoStartTime
    ? chalk.dim(`${messagePrefix} ${chalk.white(chalk.bold(Math.ceil(performance.now() - edoStartTime)))} ms`)
    : ''

  logger.info(`${chalk.green(emoji.get('fire'))} ${chalk.bold('Done!')} ${startupDurationString}`)
}
