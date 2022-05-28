import { cac } from 'cac'

const tools = cac('easydo')

tools
  .command('commit')
  .option('-a, --all', 'select all changed files')
  .action(async () => {
    const { commit } = await import('./commit')
    commit()
  })

tools.help()
tools.version(require('../../package.json').version)

tools.parse()
