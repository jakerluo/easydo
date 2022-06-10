import { Rule, Linter } from 'eslint'

export interface Config {
  rules?: Record<string, Rule.RuleModule>
  configs?: Record<string, Linter.BaseConfig>
}
