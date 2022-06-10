import { ResolvedConfig } from '../config'
import logger, { Logger } from '../logger'

export default abstract class BasicCommand {
  logger: Logger
  config: ResolvedConfig
  runner: Promise<unknown>

  constructor(config: ResolvedConfig) {
    this.logger = logger
    this.config = {
      ...config
    }

    this.runner = new Promise(async (resolve, reject) => {
      let chain = Promise.resolve()

      chain = chain.then(() => this.run())
      chain.then(resolve)
      chain.catch(reject)
    })
  }

  abstract run(): Promise<void>
}
