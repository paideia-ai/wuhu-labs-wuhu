import {
  createRequestHandler,
  RouterContextProvider,
  type ServerBuild,
} from 'react-router'

const BUILD_PATH = './build/server/index.js'
const PORT = parseInt(Deno.env.get('PORT') ?? '3000')

const serverBuild: ServerBuild = await import(BUILD_PATH)
const requestHandler = createRequestHandler(serverBuild, 'production')

const clientDir = new URL('./build/client', import.meta.url).pathname
const API_URL = Deno.env.get('API_URL')?.replace(/\/+$/, '')

declare module 'react-router' {
  interface Future {
    v8_middleware: true
  }
}

Deno.serve({ port: PORT }, async (request) => {
  const url = new URL(request.url)

  if (url.pathname.startsWith('/api/sandboxes')) {
    if (!API_URL) {
      return new Response('API_URL environment variable is not configured', {
        status: 500,
      })
    }

    const proxiedPath = url.pathname.replace(/^\/api/, '')
    const targetUrl = new URL(API_URL)
    targetUrl.pathname = proxiedPath
    targetUrl.search = url.search

    const headers = new Headers(request.headers)
    headers.delete('host')

    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'manual',
    })

    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    })
  }

  // Serve static assets from /assets
  if (url.pathname.startsWith('/assets/')) {
    const filePath = `${clientDir}${url.pathname}`
    try {
      const file = await Deno.readFile(filePath)
      const contentType = filePath.endsWith('.js')
        ? 'application/javascript'
        : filePath.endsWith('.css')
        ? 'text/css'
        : 'application/octet-stream'
      return new Response(file, {
        headers: {
          'content-type': contentType,
          'cache-control': 'public, max-age=31536000, immutable',
        },
      })
    } catch {
      // File not found, fall through to router
    }
  }

  // Handle all other routes with React Router
  try {
    const routerContext = new RouterContextProvider()
    return await requestHandler(request, routerContext)
  } catch (error) {
    console.error('Error handling request:', error)
    return new Response('<h1>Something went wrong</h1>', {
      status: 500,
      headers: { 'Content-Type': 'text/html' },
    })
  }
})

console.log(`Server running on http://localhost:${PORT}`)
