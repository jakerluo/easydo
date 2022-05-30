import { listFiles, currentBranch, push, add, status } from 'isomorphic-git'
import http from 'isomorphic-git/http/node/index.js'
import * as fs from 'fs'
import * as process from 'process'
import prompts, { Choice } from 'prompts'
import logger from '../logger'
import cfork from 'cfork'
import { join } from 'path'
import { ChildProcess } from 'child_process'
import type { InlineConfig, ResolvedConfig } from '../config'
import { resolveConfig } from '../config'
import { dirname } from '../utils'

export async function commit(inlineConfig: InlineConfig = {}) {
  const config = await resolveConfig(inlineConfig)
  const gitFlow = new GitFlow(config)
  await gitFlow.init()
}

export type Status =
  | 'modified'
  | 'ignored'
  | 'unmodified'
  | '*modified'
  | '*deleted'
  | '*added'
  | 'absent'
  | 'deleted'
  | 'added'
  | '*unmodified'
  | '*absent'
  | '*undeleted'
  | '*undeletemodified'

export type FileStatus = [Status, string]

class GitFlow {
  filterKeys: Status[] = ['*modified', '*deleted', '*added']
  allChangedFiles: FileStatus[] = []
  allFilesStatus: FileStatus[] = []

  private needAddFiles: string[] = []
  private config: ResolvedConfig

  constructor(config: ResolvedConfig) {
    this.config = config
  }

  async init() {
    const files = await listFiles({ fs, dir: '' })
    await this.filterChangedFiles(files)
    if (this.allChangedFiles.length) {
      await this.selectAddFiles()
      await this.addToStaged()
      await this.preCheck()
    } else {
      await this.preCheck('will push the staged files. please confirm have changed files not has staged?')
    }
    await this.commit()
    await this.preCheck('do you need push to remote?')
    await this.pushToRemote()
  }

  private async pushToRemote() {
    const currentBranchName = await currentBranch({ fs, dir: '', fullname: false })
    logger.debug('GITHUB_TOKEN', this.config.env.GITHUB_TOKEN)

    const GITHUB_TOKEN = this.config.env.GITHUB_TOKEN
    if (!GITHUB_TOKEN) {
      logger.error('push to remote should be have GITHUB_TOKEN')
    }

    if (!currentBranchName) return
    const pushResult = await push({
      fs,
      http,
      dir: '',
      onAuth: () => ({ username: GITHUB_TOKEN }),
      onAuthFailure: (url, auth) => {
        console.log(url, auth)
      }
    })
    if (pushResult.ok) {
      logger.info(`push to remote, current branch is ${currentBranchName}`)
    }
  }

  private async preCheck(msg: string = 'please confirm!!!') {
    const { need } = await prompts(
      {
        type: 'confirm',
        message: msg,
        name: 'need',
        initial: true
      },
      {
        onCancel() {
          process.exit(1)
        }
      }
    )
    if (!need) {
      process.exit(1)
    }
  }

  private async commit() {
    return new Promise<void>((onFulfilled) => {
      cfork({
        exec: join(dirname(import.meta.url), '../commit.js'),
        count: 1,
        refork: false,
        windowsHide: true
      })
        .on('fork', (worker: { process: ChildProcess }) => {
          logger.info(' new worker start', worker.process.pid)
        })
        .on('disconnect', (worker: { process: ChildProcess }) => {
          logger.info(' new worker disconnect', worker.process.pid)
          onFulfilled()
        })
        .on('exit', (worker: { process: ChildProcess }, code: number) => {
          if (code === null) {
            logger.info(' worker exit', worker.process.pid)
            process.exit(1)
          }
        })
    })
  }

  private async addToStaged() {
    if (this.needAddFiles.length) {
      await add({ fs, dir: process.cwd(), filepath: this.needAddFiles })
      return
    }
    logger.info('no file change')
  }

  private async selectAddFiles() {
    if (this.config.inlineConfig.all) {
      this.needAddFiles = this.allChangedFiles.map(([, file]) => file)
      return
    }
    const choices: Choice[] = this.allChangedFiles.map(([status, file]) => ({
      title: `${status} - ${file}`,
      value: file,
      selected: true
    }))
    const { select } = await prompts(
      {
        type: 'multiselect',
        name: 'select',
        message: 'select add files',
        choices,
        hint: 'aaa'
      },
      {
        onCancel() {
          process.exit(1)
        }
      }
    )
    this.needAddFiles = select
  }

  private async filterChangedFiles(files: string[]) {
    this.allFilesStatus = await Promise.all(files.map((file) => this.filterChangedFile(file)))
    this.allChangedFiles = this.allFilesStatus.filter(([status]) => this.filterKeys.includes(status))
  }

  private async filterChangedFile(file: string): Promise<FileStatus> {
    const _status = await status({ fs, dir: process.cwd(), filepath: file })
    return [_status, file]
  }
}
