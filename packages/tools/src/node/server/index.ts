import { ResolvedConfig } from '../config'

export { searchForWorkspaceRoot } from './searchRoot'

export interface DevServer {
  config: ResolvedConfig
}

export type ServerHook = (server: DevServer) => (() => void) | void | Promise<(() => void) | void>
