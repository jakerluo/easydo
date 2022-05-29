import chalk from 'chalk'
import * as log4js from 'log4js'
import type { Logger as Logger$0 } from 'log4js'
import { v4 } from 'uuid'

export type Logger = Logger$0

const key = `${chalk.magentaBright('easydo')}`

log4js.configure({
  appenders: {
    [key]: { type: 'stdout' }
  },
  categories: {
    default: { appenders: [key], level: 'info' },
    [key]: { appenders: [key], level: 'info' }
  }
})

const logger: Logger = log4js.getLogger(key)

logger.level = process.env.TITIAN_LOG_LEVEL || 'info'

logger.addContext('uid', v4())

export default logger
