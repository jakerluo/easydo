import { bootstrap } from './commit/git-cz'
import { dirname, join } from 'path'
import readPkgUp from 'read-pkg-up'

async function start() {
  const { path } = (await readPkgUp({ cwd: __dirname })) as readPkgUp.NormalizedReadResult

  bootstrap({
    cliPath: join(dirname(path), 'node_modules', 'commitizen'),
    config: {
      path: join(dirname(path), 'node_modules', '@easydo/cz')
    }
  })
}
start().then()
