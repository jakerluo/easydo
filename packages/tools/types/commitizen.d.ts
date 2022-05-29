declare module 'commitizen/dist/commitizen' {
  export class configLoader {
    static load(): void
  }
}
declare module 'commitizen/dist/cli/strategies' {
  export interface BootstrapConfig {
    path: string
  }

  export interface BootstrapEnv {
    config?: BootstrapConfig
    cliPath?: string
  }

  export function git(rawGitArgs: string[], environment: BootstrapEnv): void

  export function gitCz(rawGitArgs: string[], environment: BootstrapEnv, adapterConfig: BootstrapConfig): void
}
