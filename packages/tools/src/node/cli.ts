import { cac } from 'cac'

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
tools.version(require('../../package.json').version)
tools.parse()
