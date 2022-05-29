import { bootstrap } from './git-cz'
import git from 'isomorphic-git'
import { dirname, join } from 'path'
import readPkgUp from 'read-pkg-up'
import * as fs from 'fs'
import * as process from 'process'
import prompts, { Choice } from 'prompts'
import logger from '../logger'

export async function commit() {
  const gitFlow = new GitFlow()
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

  async init() {
    const files = await git.listFiles({ fs, dir: '' })
    await this.filterChangedFiles(files)
    await this.selectAddFiles()
    await this.addToStaged()
    await this.preCommit()
    await this.commit()
    await this.pushToRemote()
  }

  private async pushToRemote() {
    const currentBranch = await git.currentBranch({ fs, dir: '', fullname: false })
    logger.log('currentBranch', currentBranch)
  }

  private async preCommit() {
    const { need } = await prompts({
      type: 'confirm',
      message: 'do you need commit?',
      name: 'need'
    })
    return need
  }

  private async commit() {
    const { path } = (await readPkgUp({ cwd: __dirname })) as readPkgUp.NormalizedReadResult
    return new Promise<void>((resolve) => {
      bootstrap({
        cliPath: join(dirname(path), 'node_modules', 'commitizen'),
        config: {
          path: join(dirname(path), 'node_modules', '@easydo/cz'),
          done: () => {
            console.log(1)
          }
        }
      })
    })
  }

  private async addToStaged() {
    if (this.needAddFiles.length) {
      await git.add({ fs, dir: process.cwd(), filepath: this.needAddFiles })
      return
    }
    logger.info('no file change')
    process.exit(1)
  }

  private async selectAddFiles() {
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
    if (!this.allChangedFiles.length) {
      logger.info('no file change')
      process.exit(1)
    }
  }

  private async filterChangedFile(file: string): Promise<FileStatus> {
    const status = await git.status({ fs, dir: process.cwd(), filepath: file })
    return [status, file]
  }
}
