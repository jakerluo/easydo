import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import urllib, { HttpClient, RequestOptions } from 'urllib'
import ProxyAgent from 'proxy-agent'
import updater from 'npm-updater'
import registryUrl from 'registry-url'
import { resolve, isAbsolute, join, basename, parse } from 'path'
import mkdirp from 'mkdirp'
import { InlineConfig, resolveConfig, ResolvedConfig } from '../config'
import logger from '../logger'
import { dirname, lookupFile } from '../utils'
import { Manifest } from '../pkg'
import prompts, { Choice } from 'prompts'
import chalk from 'chalk'
import assert from 'assert'
import { tmpdir } from 'os'
import rimraf from 'rimraf'
import compressing from 'compressing'
import { globbySync } from 'globby'
import { isText } from 'istextorbinary'

export interface Boilerplate {
  package: string
  description?: string
  name: string
  from: Manifest
}

export type BoilerplateMapping = Record<string, Boilerplate>

export interface InitOptions {
  dir?: string
  force?: boolean
  type?: string
  template?: string
  package?: string
  silent?: boolean
}

export type Questions = Record<string, Question>

export interface Question extends prompts.PromptObject {
  default?: string | (() => string)
  filter?: (val: string) => string
}

export async function init(inlineConfig: InlineConfig) {
  const config = await resolveConfig(inlineConfig, 'init', 'production')
  await new InitCommand(config).run()
}

class InitCommand {
  private readonly configName: string = '@easydo/init-config'
  private readonly needUpdate: boolean = true
  private httpClient: HttpClient & { agent?: any; httpsAgent?: any }
  private config: ResolvedConfig
  private readonly fileMapping: Record<string, string> = {
    gitignore: '.gitignore',
    _gitignore: '.gitignore',
    '_.gitignore': '.gitignore',
    '_package.json': 'package.json',
    '_.eslintrc': '.eslintrc',
    '_.eslintignore': '.eslintignore',
    '_.npmignore': '.npmignore'
  }
  private registryUrl: string = 'https://registry.npmjs.org'
  pkgInfo: string | undefined
  root: string = process.cwd()
  targetDir: string | undefined

  constructor(config: ResolvedConfig) {
    this.config = config
    this.root = config.root || this.root
    this.configName = config.configName || this.configName
    const pkgInfo = lookupFile(dirname(import.meta.url), ['package.json'])

    if (pkgInfo) {
      this.pkgInfo = JSON.parse(pkgInfo)
    }
    this.needUpdate = config.needUpdate !== false

    this.httpClient = urllib.create()
  }

  async run() {
    const proxyHost = process.env.http_proxy || process.env.HTTP_PROXY
    if (proxyHost) {
      const proxyAgent = new ProxyAgent()
      this.httpClient.agent = proxyAgent
      this.httpClient.httpsAgent = proxyAgent
      logger.info(`use http proxy: ${proxyHost}`)
    }

    this.registryUrl = await this.getRegistryByType(this.config.registry || '')

    if (this.needUpdate) {
      await updater({
        package: this.pkgInfo,
        registry: this.registryUrl,
        level: 'major'
      })
    }

    this.targetDir = await this.getTargetDirectory()

    let templateDir = this.getTemplateDir()

    if (!templateDir) {
      let pkgName = this.config.inlineConfig.package
      if (!pkgName) {
        const boilerplateMapping = await this.fetchBoilerplateMapping(this.config.inlineConfig.package)
        let boilerplate
        if (this.config.inlineConfig.type && boilerplateMapping.hasOwnProperty(this.config.inlineConfig.type)) {
          boilerplate = boilerplateMapping[this.config.inlineConfig.type]
        } else {
          boilerplate = await this.askForBoilerplateType(boilerplateMapping)
          if (!boilerplate) return
        }
        logger.info(`use boilerplate: ${boilerplate.name}(${boilerplate.package})`)
        pkgName = boilerplate.package
      }
      templateDir = await this.downloadBoilerplate(pkgName)
    }

    await this.processFiles(this.targetDir, templateDir)
    this.printUsage()
  }

  private printUsage() {
    logger.info(`\n usage:
      - cd ${this.targetDir}
      - npm install
      - npm start / npm run dev / npm test
    \n`)
  }

  private async processFiles(targetDir: string, templateDir: string) {
    const src = join(templateDir, 'boilerplate')
    const locals = await this.askForVariable(targetDir, templateDir)

    const files = globbySync('**/*', {
      cwd: src,
      dot: true,
      onlyFiles: true,
      followSymbolicLinks: true
    })

    files.forEach((file) => {
      const { dir: dirname, base: basename } = parse(file)
      const from = join(src, file)
      const fileName = this.fileMapping[basename] || basename
      const to = join(targetDir, dirname, this.replaceTemplate(fileName, locals))
      const { dir: toDirname } = parse(to)

      if (!existsSync(toDirname)) {
        mkdirp.sync(toDirname)
      }

      const stats = lstatSync(from)
      if (stats.isSymbolicLink()) {
        const target = readlinkSync(from)
        symlinkSync(target, to)
        logger.info('%s link to %s', to, target)
      } else if (stats.isDirectory()) {
        mkdirp.sync(to)
        logger.info('%s directory created', to)
      } else if (stats.isFile()) {
        const content = readFileSync(from)
        logger.info('%s file created', to)

        const result = isText(from, content) ? this.replaceTemplate(content.toString('utf8'), locals) : content

        writeFileSync(to, result)
      } else {
        logger.warn('ignore %s only support file, dir, symlink', file)
      }
    })
    return files
  }

  private replaceTemplate(content: any, scope: Record<string, unknown> = {}) {
    return content.toString().replace(/(\\)?{{ *(\w+) *}}/g, (block: string, skip: string, key: string) => {
      if (skip) {
        return block.substring(skip.length)
      }
      return scope.hasOwnProperty(key) ? scope[key] : block
    })
  }

  private async askForVariable(targetDir: string, templateDir: string) {
    let questions: Questions | ((arg: InitCommand) => Questions)
    try {
      questions = await import(join(templateDir, 'index.js')).then((m) => m.default)
      if (typeof questions === 'function') {
        questions = await questions(this)
      }
      if (questions.name && !questions.name.default) {
        questions.name.default = basename(targetDir).replace(/^edo-/, '')
      }
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        logger.info(chalk.yellow(`load boilerplate config got trouble, skip and use defaults, ${error.message}`))
      }
      return {}
    }

    logger.info('collection boilerplate config...')

    const keys = Object.keys(questions)

    if (this.config.inlineConfig.silent) {
      const result = keys.reduce((result, key) => {
        const defaultFn = (questions as Questions)[key].default
        const filterFn = (questions as Questions)[key].filter

        if (typeof defaultFn === 'function') {
          result[key] = defaultFn() || ''
        } else {
          result[key] = (questions as Questions)[key].default || ''
        }
        if (typeof filterFn === 'function') {
          result[key] = filterFn(result[key]) || ''
        }
        return result
      }, {} as any)
      logger.info('use default due to --silent, %j', result)
      return result
    } else {
      const asks: Array<prompts.PromptObject<keyof Questions>> = keys.map((key) => {
        const question = (questions as Questions)[key]
        return {
          ...question,
          type: question.type || 'text',
          name: key
        }
      })
      const result = await prompts(asks, {
        onCancel: () => {
          logger.info('cancelled by user')
          process.exit(1)
        }
      })

      if (!result?.name) {
        logger.error('name is required')
        process.exit(1)
      }
      logger.info('collection boilerplate config done, %j', result)
      return result
    }
  }

  private rimraf(path: string) {
    return new Promise<void>((resolve, reject) => {
      rimraf(path, (err) => {
        if (err) {
          reject()
        }
        resolve()
      })
    })
  }

  private async downloadBoilerplate(pkgName?: string): Promise<string> {
    const result = await this.getPackageInfo(pkgName, false)
    const tgzUrl = result.dist.tarball
    const saveDir = join(this.config.cacheDir || tmpdir(), 'edo-init-boilerplate')
    await this.rimraf(saveDir)
    const response = await this.curl(tgzUrl, {
      streaming: true,
      followRedirect: true
    })
    await compressing.tgz.uncompress(response.res as any, saveDir)
    logger.info(`download success, unzip to ${saveDir}`)
    return join(saveDir, '/package')
  }

  private async askForBoilerplateType(mapping: BoilerplateMapping) {
    const groupMapping = this.groupBy<BoilerplateMapping>(mapping, 'category', 'other')
    const groupNames = Object.keys(groupMapping)
    let group: BoilerplateMapping

    if (groupNames.length > 1) {
      const choices: Choice[] = groupNames.map<Choice>((k) => ({ title: k, value: k }))
      const answer = await prompts(
        {
          name: 'group',
          type: 'select',
          message: 'please select boilerplate group',
          choices
        },
        {
          onCancel: () => process.exit(0)
        }
      )

      group = groupMapping[answer.group]
    } else {
      group = groupMapping[groupNames[0]]
    }
    const choices = Object.keys(group).map((key) => {
      const item = group[key]
      return {
        title: `${key} (${item.description})`,
        value: item
      }
    })

    const { boilerplateInfo } = await prompts(
      {
        name: 'boilerplateInfo',
        type: 'select',
        choices,
        message: 'please select a boilerplate type'
      },
      {
        onCancel: () => process.exit(0)
      }
    )

    if (!boilerplateInfo.deprecate) {
      return boilerplateInfo
    }

    const { shouldInstall } = await prompts(
      {
        name: 'shouldInstall',
        type: 'confirm',
        message: `package is ${chalk.red('deprecated')}, still want to continue installing?`,
        initial: false
      },
      { onCancel: () => process.exit(0) }
    )
    if (shouldInstall) {
      return boilerplateInfo
    }
    logger.error(`Exit due to: ${boilerplateInfo?.package} is deprecated`)
  }

  private groupBy<T extends any = any>(obj: T, key: string, otherKey: string) {
    const result: any = {}

    for (const key$0 in obj) {
      let isMatch = false
      for (const key$1 in obj[key$0]) {
        if (key$1 === key) {
          const mappingItem = obj[key$0][key$1]
          if (typeof result[mappingItem] === 'undefined') {
            result[mappingItem] = {}
          }
          result[mappingItem][key$0] = obj[key$0]
          isMatch = true
          break
        }
      }
      if (!isMatch) {
        if (typeof result[otherKey] === 'undefined') {
          result[otherKey] = {}
        }
        result[otherKey][key$0] = obj[key$0]
      }
    }

    return result
  }

  private async fetchBoilerplateMapping(pkgName?: string) {
    const pkgInfo = await this.getPackageInfo(pkgName || this.configName, true)
    const mapping = pkgInfo.config?.boilerplate

    if (mapping) {
      Object.keys(mapping).forEach((key) => {
        const item = mapping[key]
        item.name = item.name || key
        item.from = pkgInfo
      })

      return mapping
    }
    logger.error(`${pkgName} should contain boilerplate mapping`)
  }

  private async curl(url: string, options: RequestOptions = {}) {
    return this.httpClient.curl(url, options)
  }

  private async getPackageInfo(pkgName?: string, withFallback: boolean = false) {
    logger.info(`fetching ${pkgName} info for ${this.registryUrl}`)

    try {
      const result = await this.curl(`${this.registryUrl}/${pkgName}/latest`, {
        dataType: 'json',
        followRedirect: true,
        maxRedirects: 5,
        timeout: 5000
      })
      assert(result.status === 200, `fetch ${pkgName} info error: ${result.status}, ${result.data.reason}`)
      return result.data
    } catch (err) {
      if (withFallback) {
        logger.warn(`use fallback from ${pkgName}`)
        return JSON.parse(readFileSync(join(this.root, 'node_modules', <string>pkgName, 'package.json'), 'utf-8'))
      }
      logger.error(err.message)
      process.exit(1)
    }
  }

  private getTemplateDir() {
    let templateDir
    const template = this.config.inlineConfig.template
    if (template) {
      templateDir = isAbsolute(template) ? template : resolve(this.root, template)

      if (!existsSync(templateDir)) {
        logger.error(`${templateDir} is not exists`)
      } else if (!existsSync(join(templateDir, 'boilerplate'))) {
        logger.error(`${templateDir} should contain boilerplate folder`)
      } else {
        logger.info(`local template dir is ${chalk.green(templateDir)}`)
        return templateDir
      }
    }
  }

  private async getTargetDirectory() {
    const dir = this.config.inlineConfig.dir || ''
    const force = this.config.inlineConfig.force || false
    let targetDir = resolve(this.root, dir)

    function validate(dir: string) {
      if (!existsSync(dir)) {
        mkdirp.sync(dir)
        return true
      }

      if (!statSync(dir).isDirectory()) {
        return logger.error(`${dir} already exists as a file`)
      }

      const files = readdirSync(dir).filter((name) => name[0] !== '.')
      if (files.length) {
        if (force) {
          logger.warn(`${dir} already exists and will be override due to --force`)
          return true
        }

        return logger.error(`${dir} already exists and not empty: ${JSON.stringify(files)}`)
      }

      return true
    }

    const isValid = validate(targetDir)
    if (isValid !== true) {
      const answer = await prompts<'dir'>({
        type: 'text',
        name: 'dir',
        message: 'please enter target dir: ',
        initial: dir || '.',
        format: (dir) => resolve(this.root, dir),
        validate: (prev) => {
          return validate(prev) ? true : '名称不正确'
        }
      })
      targetDir = answer.dir
    }
    logger.info(`target dir is ${targetDir}`)
    return targetDir
  }

  async getRegistryByType(key: string): Promise<string> {
    let url = 'https://registry.npmjs.org'

    switch (key) {
      case 'taobao':
        url = 'https://registry.npmmirror.com'
        break
      case 'npm':
        url = 'https://registry.npmjs.org'
        break
      default:
        if (/^https?:/.test(key)) {
          url = key.replace(/\/$/, '')
        } else {
          const pkgInfo: string | Manifest = lookupFile(this.root, ['package.json']) as string
          let pkg: Manifest = {}

          if (pkgInfo) {
            pkg = JSON.parse(pkgInfo as string) as Manifest
          }

          if (pkg.publishConfig?.registry) {
            url = pkg.publishConfig?.registry as string
          } else {
            url = process.env.npm_registry || process.env.npm_config_registry || registryUrl() || url
          }
        }
        break
    }

    logger.info('use registry: %s', url)

    return url.replace(/\/$/, '')
  }
}
