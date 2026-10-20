// electron-builder afterPack hook (runs before signing, for CI and local `npm run dist:mac` alike).
// node-pty's npm tarball ships prebuilds/darwin-*/spawn-helper without the exec bit, and without it
// the terminal cannot start a shell.
const { chmod, readdir } = require('node:fs/promises')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' && context.electronPlatformName !== 'mas') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const prebuilds = join(app, 'Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds')
  let dirs = []
  try {
    dirs = (await readdir(prebuilds)).filter(d => d.startsWith('darwin-'))
  } catch {
    dirs = []
  }
  if (!dirs.length) throw new Error(`afterPack: no node-pty darwin prebuilds in ${prebuilds}`)
  for (const d of dirs) await chmod(join(prebuilds, d, 'spawn-helper'), 0o755)
}
