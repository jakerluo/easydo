import { cleanUrl } from '../utils'
import { TransformOptions, transform, Loader } from 'esbuild'
import { createFilter } from '@rollup/pluginutils'
import { Plugin } from './index'
import { extname } from 'path'
import { parse } from 'tsconfck'

type TSConfigJSON = {
  extends?: string
  compilerOptions?: {
    target?: string
    jsxFactory?: string
    jsxFragmentFactory?: string
    useDefineForClassFields?: boolean
    importsNotUsedAsValues?: 'remove' | 'preserve' | 'error'
    preserveValueImports?: boolean
  }
  [key: string]: any
}

type TSCompilerOptions = NonNullable<TSConfigJSON['compilerOptions']>

export interface ESBuildOptions extends TransformOptions {
  include?: string | RegExp | string[] | RegExp[]
  exclude?: string | RegExp | string[] | RegExp[]
  jsxInject?: string
}

async function transformWithEsbuild(code: string, filename: string, options: TransformOptions, isMap?: object) {
  let loader = options?.loader
  if (!loader) {
    const ext = extname(/\.\w+$/.test(filename) ? filename : cleanUrl(filename)).slice(1)
    if (ext === 'cjs' || ext === 'mjs') {
      loader = 'js'
    } else {
      loader = ext as Loader
    }
  }
  let tsconfigRaw = options?.tsconfigRaw

  if (typeof tsconfigRaw === 'string') {
    const meaningfulFields: Array<keyof TSCompilerOptions> = [
      'target',
      'jsxFactory',
      'jsxFragmentFactory',
      'useDefineForClassFields',
      'importsNotUsedAsValues',
      'preserveValueImports'
    ]
    const compilerOptionsForFile: TSCompilerOptions = {}
    if (loader === 'ts' || loader === 'tsx') {
      const loadedTsConfig = await loadTsconfigJsonForFile(tsconfigRaw)
    }
  }

  const result = await transform(code, {})

  console.log(result, options)
}

export function esbuildPlugin(options: ESBuildOptions = {}): Plugin {
  const filter = createFilter(options.include || /\.(tsx?|jsx)$/, options.exclude || /\.js$/)
  return {
    name: 'edo:esbuild',
    configureServer(_server) {
      console.log(_server)
    },
    async configResolved() {
      console.log(1)
    },
    async transform(code, id) {
      if (filter(id) || filter(cleanUrl(id))) {
        const result = await transformWithEsbuild(code, id, options)
        console.log(result)
      }
      console.log('code, id: ', code, id)
    }
  }
}

async function loadTsconfigJsonForFile(filename: string) {
  try {
    const result = await parse(filename)
  } catch (e) {}
}
