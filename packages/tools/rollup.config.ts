import { resolve } from 'path'
import { defineConfig } from 'rollup'
import typescript from '@rollup/plugin-typescript'

const sharedNodeOptions = defineConfig({
  output: {
    dir: resolve(__dirname, 'dist'),
    entryFileNames: 'node/[name].js',
    chunkFileNames: 'node/chunks/[name]-[hash].js',
    exports: 'named',
    format: 'cjs',
    freeze: false,
    sourcemap: true
  }
})

function createNodeConfig(isProduction: boolean) {
  return defineConfig({
    ...sharedNodeOptions,
    input: {
      cli: resolve(__dirname, 'src/node/cli.ts')
    },
    output: {
      ...sharedNodeOptions.output,
      sourcemap: !isProduction
    },
    external: [
      'commitizen/dist/commitizen',
      'commitizen/dist/cli/strategies',
      ...Object.keys(require('./package.json').dependencies),
      ...(isProduction ? [] : Object.keys(require('./package.json').devDependencies))
    ],
    plugins: [
      typescript({
        tsconfig: 'src/node/tsconfig.json',
        module: 'esnext',
        target: 'es2019',
        include: ['src/**/*.ts', 'types/**'],
        esModuleInterop: true,
        ...(isProduction ? {} : { declaration: true, declarationDir: resolve(__dirname, 'dist/') })
      })
    ]
  })
}

export default function (commandLineArgs: any) {
  const isDev = commandLineArgs.watch
  const isProduction = !isDev

  return defineConfig([createNodeConfig(isProduction)])
}
