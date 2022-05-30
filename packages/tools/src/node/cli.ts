import { cac } from 'cac'
import { VERSION } from './constants'

const tools = cac('easydo')

tools.option('-c, --config <file>', `[string] use specified config file`)

tools
  .command('commit')
  .option('-a, --all', 'select all changed files')
  .action(async () => {
    const { commit } = await import('./commit/index')
    await commit()
  })

tools.help()
tools.version(VERSION)
tools.parse()
