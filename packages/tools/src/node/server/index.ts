import { ResolvedConfig } from '../config'

export interface DevServer {
  config: ResolvedConfig
}

export type ServerHook = (server: DevServer) => (() => void) | void | Promise<(() => void) | void>
