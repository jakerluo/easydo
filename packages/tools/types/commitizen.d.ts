declare module 'commitizen/dist/commitizen.js' {
  export class configLoader {
    static load(): void
  }
}
declare module 'commitizen/dist/cli/strategies.js' {
  export interface BootstrapConfig {
    path?: string
    commitizen?: BootstrapConfig
  }

  export interface BootstrapEnv {
    config?: BootstrapConfig
    cliPath?: string
  }

  export function git(rawGitArgs: string[], environment: BootstrapEnv): void

  export function gitCz(rawGitArgs: string[], environment: BootstrapEnv, adapterConfig: BootstrapConfig): void
}
