import { createBuilder, version } from 'vite'

console.log('vite version:', version)

const builder = await createBuilder({
  root: '.',
  configFile: './vite.config.ts',
  mode: 'production',
})

await builder.buildApp()
