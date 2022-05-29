const options = require('cz-conventional-changelog')

module.exports = {
  prompter: function (cz, commit) {
    options.prompter(cz, function (...params) {
      commit(...params)
      console.log('commit exec')
      setTimeout(() => {
        process.exit(1)
      }, 1000)
    })
  }
}
