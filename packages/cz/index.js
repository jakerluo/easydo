const options = require('cz-conventional-changelog')

module.exports = {
  prompter: function (cz, commit) {
    options.prompter(cz, function (...params) {
      commit(...params)
      setTimeout(() => {
        process.exit(1)
      }, 1000)
    })
  }
}
