import { dirname, join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { isFileReadable } from '../utils'
// https://github.com/vitejs/vite/issues/2820#issuecomment-812495079
const ROOT_FILES = [
  // '.git',

  // https://pnpm.js.org/workspaces/
  'pnpm-workspace.yaml',

  // https://rushjs.io/pages/advanced/config_files/
  // 'rush.json',

  // https://nx.dev/latest/react/getting-started/nx-setup
  // 'workspace.json',
  // 'nx.json',

  // https://github.com/lerna/lerna#lernajson
  'lerna.json'
]

function hasWorkspacePacakgeJSON(root: string): boolean {
  const path = join(root, 'package.json')
  if (!isFileReadable(path)) {
    return false
  }
  const content = JSON.parse(readFileSync(path, 'utf8')) || {}
  return !!content.workspaces
}

function hasPackageJson(root: string) {
  const path = join(root, 'package.json')
  return existsSync(path)
}

function hasRootFile(root: string): boolean {
  return ROOT_FILES.some((file) => existsSync(join(root, file)))
}

export function searchForPackageRoot(current: string, root = current): string {
  if (hasPackageJson(current)) return current

  const dir = dirname(current)
  if (!dir || dir === current) return root

  return searchForPackageRoot(dir, root)
}

export function searchForWorkspaceRoot(current: string, root = searchForPackageRoot(current)): string {
  if (hasRootFile(current)) return current
  if (hasWorkspacePacakgeJSON(current)) return current

  const dir = dirname(current)
  if (!dir || dir === current) return root
  return searchForWorkspaceRoot(dir, root)
}
