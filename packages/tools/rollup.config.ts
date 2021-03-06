import { resolve } from 'path'
import { defineConfig, Plugin } from 'rollup'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import pkg from './package.json'

const isProd = process.env.NODE_ENV === 'production'

const sharedNodeOptions = defineConfig({
  treeshake: {
    moduleSideEffects: 'no-external',
    propertyReadSideEffects: false,
    tryCatchDeoptimization: false
  },
  output: {
    dir: resolve(__dirname, 'dist'),
    entryFileNames: 'node/[name].js',
    chunkFileNames: isProd ? 'node/chunks/[name]-[hash].js' : 'node/chunks/[name].js',
    exports: 'named',
    format: 'esm',
    externalLiveBindings: false,
    freeze: false,
    sourcemap: true
  }
})

function createNodePlugins(isProduction: boolean, sourceMap: boolean, declarationDir: string | false): Plugin[] {
  return [
    nodeResolve({ preferBuiltins: true }),
    typescript({
      tsconfig: 'src/node/tsconfig.json',
      module: 'esnext',
      target: 'es2020',
      include: ['src/**/*.ts', 'types/**'],
      esModuleInterop: true,
      sourceMap,
      declaration: declarationDir !== false,
      declarationDir: declarationDir !== false ? declarationDir : undefined
    }),
    commonjs({
      extensions: ['.js']
    }),
    json()
  ]
}

function createNodeConfig(isProduction: boolean) {
  return defineConfig({
    ...sharedNodeOptions,
    input: {
      index: resolve(__dirname, 'src/node/index.ts'),
      cli: resolve(__dirname, 'src/node/cli.ts'),
      commit: resolve(__dirname, 'src/node/commit.ts')
    },
    output: {
      ...sharedNodeOptions.output,
      sourcemap: !isProduction
    },
    external: [
      'commitizen/dist/commitizen.js',
      'commitizen/dist/cli/strategies.js',
      'isomorphic-git/http/node',
      ...Object.keys(pkg.dependencies),
      ...(isProduction ? [] : Object.keys(pkg.devDependencies))
    ],
    plugins: createNodePlugins(isProduction, !isProduction, isProduction ? false : resolve(__dirname, 'dist/node'))
  })
}

export default function (commandLineArgs: any) {
  const isDev = commandLineArgs.watch
  const isProduction = !isDev

  return defineConfig([createNodeConfig(isProduction)])
}
