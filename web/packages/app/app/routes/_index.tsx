import { Form, Link, redirect, useLoaderData } from 'react-router'
import type { Route } from './+types/_index.ts'

interface SandboxSummary {
  id: string
  name: string | null
  status: string
  previewUrl: string
}

export async function loader() {
  const apiUrl = Deno.env.get('API_URL')
  if (!apiUrl) {
    throw new Response('API_URL environment variable is not configured', {
      status: 500,
    })
  }

  try {
    const response = await fetch(`${apiUrl}/sandboxes`)
    const data = await response.json()
    const sandboxes = (data?.sandboxes ?? []) as SandboxSummary[]
    return { sandboxes, error: null }
  } catch (_e) {
    return { sandboxes: [], error: 'Failed to connect to API' }
  }
}

export async function action({ request }: Route.ActionArgs) {
  const apiUrl = Deno.env.get('API_URL')
  if (!apiUrl) {
    throw new Response('API_URL environment variable is not configured', {
      status: 500,
    })
  }

  const formData = await request.formData()
  const actionType = String(formData.get('_action') ?? '')

  if (actionType === 'create') {
    const name = String(formData.get('name') ?? '').trim()
    const response = await fetch(`${apiUrl}/sandboxes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name || null }),
    })
    const payload = await response.json()
    if (!response.ok) {
      throw new Response('Failed to create sandbox', { status: 500 })
    }
    const id = payload?.sandbox?.id
    if (id) {
      return redirect(`/sandboxes/${id}`)
    }
    return null
  }

  if (actionType === 'kill') {
    const id = String(formData.get('id') ?? '')
    if (id) {
      await fetch(`${apiUrl}/sandboxes/${id}/kill`, { method: 'POST' })
    }
    return null
  }

  return null
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Wuhu' },
    { name: 'description', content: 'Wuhu Web App' },
  ]
}

export default function Index() {
  const { sandboxes, error } = useLoaderData<typeof loader>()

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Wuhu Sandboxes</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}

      <section style={{ marginBottom: '2rem' }}>
        <h2>Create Sandbox</h2>
        <Form method='post' style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type='text'
            name='name'
            placeholder='Sandbox name (optional)'
            style={{ flex: 1, padding: '0.5rem' }}
          />
          <button type='submit' name='_action' value='create'>
            Create
          </button>
        </Form>
      </section>

      <section>
        <h2>Active Sandboxes</h2>
        {sandboxes.length === 0
          ? <p>No sandboxes yet.</p>
          : (
            <div style={{ display: 'grid', gap: '1rem' }}>
              {sandboxes.map((sandbox) => (
                <div
                  key={sandbox.id}
                  style={{
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    padding: '1rem',
                  }}
                >
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    <div>
                      <h3 style={{ margin: 0 }}>
                        {sandbox.name || sandbox.id}
                      </h3>
                      <p style={{ margin: '0.25rem 0' }}>
                        Status: <strong>{sandbox.status}</strong>
                      </p>
                      <p style={{ margin: '0.25rem 0' }}>
                        Preview:{' '}
                        <a
                          href={sandbox.previewUrl}
                          target='_blank'
                          rel='noreferrer'
                        >
                          {sandbox.previewUrl}
                        </a>
                      </p>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: '0.5rem',
                        height: 'fit-content',
                      }}
                    >
                      <Link to={`/sandboxes/${sandbox.id}`}>Details</Link>
                      <Form method='post'>
                        <input type='hidden' name='id' value={sandbox.id} />
                        <button type='submit' name='_action' value='kill'>
                          Kill
                        </button>
                      </Form>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </section>
    </div>
  )
}
