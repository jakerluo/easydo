const options = require('cz-conventional-changelog')

module.exports = {
  prompter: function (cz, commit) {
    options.prompter(cz, function (...params) {
      commit(...params)
      process.exit(1)
    })
  }
}
