import { createServer, version } from 'vite'
import { reactRouterDev } from './config.ts'

console.log('vite version:', version)

const config = reactRouterDev()
const server = await createServer({
  ...config,
  configFile: './vite.config.ts',
})

await server.listen()
server.printUrls()
