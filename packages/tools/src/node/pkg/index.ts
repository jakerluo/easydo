import { InlineConfig, resolveConfig, ResolvedConfig } from '../config'
import logger from '../logger'
import { join, dirname, relative } from 'path'
import { sortPackageJson } from 'sort-package-json'
import { existsSync, writeFileSync } from 'fs'
import type { BaseManifest } from '@pnpm/types'
import type { Project } from '@pnpm/find-workspace-packages'
import prompts from 'prompts'
import chalk from 'chalk'
import { getConfig } from 'isomorphic-git'
import * as fs from 'fs'

export async function pkg(inlineConfig: InlineConfig = {}) {
  const config = await resolveConfig(inlineConfig)
  await new Pkg(config).run()
}

export interface Repository {
  type?: string
  url: string
  directory?: string
}

export interface Manifest extends BaseManifest {
  private?: boolean
  repository?: Repository | string
}

export type QuestionKey = 'private' | 'author' | 'license' | 'homepage' | 'repository' | 'bugs'

export interface WorkspaceInfo {
  dir: string
  pkgPath: string
  manifest: Manifest
}

class Pkg {
  private readonly config: ResolvedConfig
  private root: string = process.cwd()
  private rootPkgPath: string = ''
  private packageManager: 'pnpm' | 'yarn' | 'npm' | 'lerna' = 'npm'
  private workspaceInfo: WorkspaceInfo[] = []

  constructor(config: ResolvedConfig) {
    this.config = config
  }

  async run() {
    this.root = this.config.root || this.root
    await this.checkWorkspace()
    await this.handleWorkspacePkgFiles()
  }

  private async checkWorkspace(): Promise<void> {
    if (this.config.packageManager) {
      this.packageManager = this.config.packageManager
    } else {
      const pnpmYaml = join(this.root, 'pnpm-workspace.yaml')
      const npmLock = join(this.root, 'package-lock.json')
      const yarnLock = join(this.root, 'yarn.lock')
      const lernaJson = join(this.root, 'lerna.json')

      if (existsSync(yarnLock)) {
        this.packageManager = 'yarn'
      }

      if (existsSync(npmLock)) {
        this.packageManager = 'npm'
      }

      if (existsSync(lernaJson)) {
        this.packageManager = 'lerna'
      }

      if (pnpmYaml) {
        this.packageManager = 'pnpm'
      }
    }
    logger.info('package manager: ', this.packageManager)
  }

  private async checkPnpmWorkspace() {
    const findWorkspacePackages = await import('@pnpm/find-workspace-packages').then((m) => (m.default as any).default)
    const wpInfo: Project[] = await findWorkspacePackages(this.root)

    if (wpInfo.length > 0) {
      logger.debug('workspace packages: ', wpInfo)
      this.workspaceInfo = wpInfo.map((wp) => ({
        dir: wp.dir,
        manifest: wp.manifest,
        pkgPath: join(wp.dir, 'package.json')
      }))
    }
  }

  private async handleWorkspacePkgFiles() {
    if (this.packageManager === 'pnpm') {
      await this.checkPnpmWorkspace()
    }

    if (this.workspaceInfo.length > 0) {
      await this.workspaceInfo.reduce((prev, wp) => {
        return prev.then(async () => {
          const newPkgInfo = await this.completionPkg(wp.manifest, wp.pkgPath)
          console.log(wp.pkgPath)
          Pkg.sortPkgFile(newPkgInfo, wp.pkgPath)
        })
      }, Promise.resolve())
    }
  }

  static sortPkgFile(pkgInfo: string | Manifest, pkgPath: string) {
    pkgInfo = typeof pkgInfo === 'string' ? pkgInfo : JSON.stringify(pkgInfo, null, 2)
    if (pkgInfo) {
      const sortedPkg = sortPackageJson(pkgInfo)
      if (sortedPkg) {
        writeFileSync(pkgPath, typeof sortedPkg === 'string' ? sortedPkg : JSON.stringify(sortedPkg, null, 2))
        logger.info('sorted pkg file path: ', pkgPath)
      }
    }
  }

  static answer: Manifest = {}

  async completionPkg(pkgInfo: any, pkgPath: string): Promise<Manifest> {
    const isRootPkg = pkgPath === this.rootPkgPath
    const rootPkgDir = dirname(this.rootPkgPath)
    const pkgDir = dirname(pkgPath)
    const remoteUrl = await getConfig({
      fs,
      dir: join(this.root, relative(rootPkgDir, pkgDir)),
      gitdir: join('.git'),
      path: 'remote.origin.url'
    })

    const repository: Repository = {
      type: 'git',
      url: remoteUrl
    }

    if (!isRootPkg) {
      repository.directory = relative(rootPkgDir, pkgDir)
    }

    let homepage = pkgInfo.homepage

    if (!homepage) {
      if (remoteUrl) {
        if (isRootPkg) {
          homepage = remoteUrl.replace(/\.git$/, '#readme')
        } else {
          homepage = `${join(remoteUrl.replace(/\.git$/, ''), 'tree', 'main', relative(rootPkgDir, pkgDir))}#readme`
        }
      }
    }
    homepage = homepage.replace(/git@github.com:/, 'https://github.com/')

    const question: Array<prompts.PromptObject<QuestionKey>> = [
      {
        type: 'confirm',
        name: 'private',
        initial: pkgInfo.private || false,
        message: `please confirm your ${chalk.cyan(pkgInfo.name)} package is private?`
      },
      {
        type: 'text',
        name: 'author',
        initial: pkgInfo.author || Pkg.answer.author || '',
        message: `please input your ${chalk.cyan(pkgInfo.name)} package author`
      },
      {
        type: 'text',
        name: 'license',
        initial: pkgInfo.license || Pkg.answer.license || 'MIT',
        message: `please input your ${chalk.cyan(pkgInfo.name)} package license`
      },
      {
        type: 'text',
        name: 'homepage',
        initial: homepage,
        message: `please input your ${chalk.cyan(pkgInfo.name)} package homepage`
      },
      {
        type: 'text',
        name: 'bugs',
        initial:
          pkgInfo.bugs?.url ||
          join(remoteUrl.replace(/\.git$/, ''), 'issues').replace(/git@github.com:/, 'https://github.com/'),
        message: `please input your ${chalk.cyan(pkgInfo.name)} package bugs`
      }
    ]

    const answer = await prompts<QuestionKey>(question, {
      onCancel: () => process.exit(0)
    })
    Pkg.answer = { ...Pkg.answer, ...answer }
    return { ...pkgInfo, ...answer, repository, bugs: { url: answer.bugs } }
  }
}
