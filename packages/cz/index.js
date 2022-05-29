'format cjs'

const options = require('cz-conventional-changelog')
const path = require('path')
const configLoader = require('commitizen').configLoader

const toolPath = path.join(process.cwd(), 'node_modules', '@easydo/tools')

const config = configLoader.load(undefined, __dirname) || {}

console.log(toolPath, config)

module.exports = options
