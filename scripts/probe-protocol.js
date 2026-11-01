const { app } = require('electron')

const keys = Object.keys(require('electron'))
console.log('BEFORE_READY protocol=', typeof require('electron').protocol)
console.log('BEFORE_READY session=', typeof require('electron').session)
console.log('HAS_REGISTER_SCHEMES=', typeof (require('electron').protocol || {}).registerSchemesAsPrivileged)
console.log('KEYS_WITH_PROTOCOL=', keys.filter((key) => key.toLowerCase().includes('protocol')))
console.log('ELECTRON_VERSION=', process.versions.electron)

app.whenReady().then(() => {
  console.log('AFTER_READY protocol=', typeof require('electron').protocol)
  console.log('AFTER_READY session.protocol=', typeof require('electron').session.defaultSession.protocol)
  app.quit()
})
