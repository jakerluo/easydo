import { bootstrap } from './commit/git-cz'
import { join, dirname as dirname$0 } from 'path'
import { readPackageUp, ReadResult } from 'read-pkg-up'
import { dirname } from './utils'

async function start() {
  const { path } = (await readPackageUp({ cwd: dirname(import.meta.url) })) as ReadResult

  bootstrap({
    cliPath: join(dirname$0(path), 'node_modules', 'commitizen'),
    config: {
      path: join(dirname$0(path), 'node_modules', '@easydo/cz')
    }
  })
}
start().then()
