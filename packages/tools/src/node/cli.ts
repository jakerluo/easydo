import { cac } from 'cac'
import { VERSION } from './constants'
import type { CommonOptions } from './commit/index'
import chalk from 'chalk'
import logger from './logger'
import emoji from 'node-emoji'

interface GlobalCLIOptions {
  c?: string
  config?: string
}

const tools = cac('edo')

tools.option('-c, --config <file>', `[string] use specified config file`)

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
//cow

function runTime() {
  const edoStartTime = global.__EDO_START_TIME__ ?? false

  const startupDurationString = edoStartTime
    ? chalk.dim(`ready in ${chalk.white(chalk.bold(Math.ceil(performance.now() - edoStartTime)))} ms`)
    : ''

  logger.info(`${chalk.green(emoji.get('fire'))} ${chalk.bold('Done!')} ${startupDurationString}`)
}
