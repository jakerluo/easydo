import chalk from 'chalk'
import pkg from 'log4js'
import type { Logger as Logger$0 } from 'log4js'
import { v4 } from 'uuid'
import emoji from 'node-emoji'

const { configure, getLogger } = pkg
export type Logger = Logger$0

const key = `${emoji.random().emoji} ${chalk.magentaBright('easydo')}`

configure({
  appenders: {
    [key]: { type: 'stdout' }
  },
  categories: {
    default: { appenders: [key], level: 'info' },
    [key]: { appenders: [key], level: 'info' }
  }
})

const logger: Logger = getLogger(key)

logger.level = process.env.TITIAN_LOG_LEVEL || 'info'

logger.addContext('uid', v4())

export default logger
