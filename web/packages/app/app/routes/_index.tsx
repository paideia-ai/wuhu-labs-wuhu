import type { Route } from './+types/_index'

export async function loader({ request }: Route.LoaderArgs) {
  const apiUrl = process.env.API_URL
  if (!apiUrl) {
    throw new Response('API_URL environment variable is not configured', { status: 500 })
  }

  try {
    const response = await fetch(apiUrl)
    const data = await response.json()
    return { api: data, error: null }
  } catch (e) {
    return { api: null, error: 'Failed to connect to API' }
  }
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Wuhu' },
    { name: 'description', content: 'Wuhu Web App' },
  ]
}

export default function Index({ loaderData }: Route.ComponentProps) {
  const { api, error } = loaderData

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Wuhu</h1>
      <h2>API Status</h2>
      {error ? (
        <p style={{ color: 'red' }}>{error}</p>
      ) : (
        <pre style={{ background: '#f4f4f4', padding: '1rem', borderRadius: '4px' }}>
          {JSON.stringify(api, null, 2)}
        </pre>
      )}
    </div>
  )
}
