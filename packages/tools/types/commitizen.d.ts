declare module 'commitizen/dist/cli/git-cz' {
  export interface BootstrapConfig {
    path: string
  }

  export interface BootstrapOptions {
    cliPath: string
    config: BootstrapConfig
  }

  export function bootstrap(options: BootstrapOptions): void
}
