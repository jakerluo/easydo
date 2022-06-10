import { UserConfig } from '@easydo/tools'

const config: UserConfig = {
  build: {
    lib: [
      {
        entry: 'packages/eslint-plugin/lib/index.ts',
        outDir: 'packages/eslint-plugin/dist',
        name: 'index'
      }
    ]
  }
}

export default config
