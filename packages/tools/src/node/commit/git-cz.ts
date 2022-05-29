import { configLoader } from 'commitizen/dist/commitizen'
import { BootstrapEnv, git as useGitStrategy, gitCz as useGitCzStrategy } from 'commitizen/dist/cli/strategies'

/**
 * This is the main cli entry point.
 * environment may be used for debugging.
 */
export function bootstrap(environment: BootstrapEnv = {}, argv = process.argv) {
  // Get cli args
  let rawGitArgs = argv.slice(3, argv.length)

  let adapterConfig = environment.config || configLoader.load()

  // Choose a strategy based on the existance the adapter config
  if (typeof adapterConfig !== 'undefined') {
    // This tells commitizen we're in business
    useGitCzStrategy(rawGitArgs, environment, adapterConfig)
  } else {
    // This tells commitizen that it is not needed, just use git
    useGitStrategy(rawGitArgs, environment)
  }
}
