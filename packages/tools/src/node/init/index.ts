import { existsSync, readdirSync, statSync } from 'fs'
import urllib, { HttpClient } from 'urllib'
import ProxyAgent from 'proxy-agent'
import updater from 'npm-updater'
import registryUrl from 'registry-url'
import { resolve } from 'path'
import mkdirp from 'mkdirp'
import { InlineConfig, resolveConfig, ResolvedConfig } from '../config'
import logger from '../logger'
import { dirname, lookupFile } from '../utils'
import { Manifest } from '../pkg'
import prompts from 'prompts'

export interface InitOptions {
  dir?: string
  force?: boolean
}

export async function init(inlineConfig: InlineConfig) {
  const config = await resolveConfig(inlineConfig)
  await new InitCommand(config).run()
}

class InitCommand {
  private readonly configName: string = '@easydo/init-config'
  private needUpdate: boolean = true
  private httpClient: HttpClient & { agent?: any; httpsAgent?: any }
  private config: ResolvedConfig

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

    return url
  }
}
