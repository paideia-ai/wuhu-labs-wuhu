import { reactRouter } from '@react-router/dev/vite'
import { resolveDenoImports } from '@wuhu/react-router-deno/resolver'
import tailwindcss from '@tailwindcss/vite'

export default {
  plugins: [resolveDenoImports(), tailwindcss(), reactRouter()],
  ssr: {
    target: 'webworker',
  },
  build: {
    target: 'esnext',
  },
}
