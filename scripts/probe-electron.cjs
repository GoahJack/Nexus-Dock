const mod = require('electron')
console.log('ELECTRON=', process.versions.electron)
console.log('TYPEOF=', typeof mod)
console.log('KEYS=', JSON.stringify(Object.keys(mod)).slice(0, 800))
if (mod && mod.default) {
  console.log('DEFAULT_TYPEOF=', typeof mod.default)
  console.log('DEFAULT_KEYS=', JSON.stringify(Object.keys(mod.default)).slice(0, 800))
}
console.log('app=', typeof (mod && mod.app), 'protocol=', typeof (mod && mod.protocol))
console.log('app2=', typeof (mod && mod.default && mod.default.app))
process.exit(0)
