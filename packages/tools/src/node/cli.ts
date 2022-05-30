import { cac } from 'cac'
import { VERSION } from './constants'

const tools = cac('easydo')

tools.option('-c, --config <file>', `[string] use specified config file`)

tools.command('task [branchName]')

tools
  .command('commit')
  .option('-a, --all', '[boolean] select all changed files')
  .action(async (options) => {
    const { commit } = await import('./commit/index')
    await commit({
      all: options.all,
      configFile: options.config
    })
  })

tools.help()
tools.version(VERSION)
tools.parse()
