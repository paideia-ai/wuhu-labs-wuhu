import { Form, Link, redirect, useLoaderData } from 'react-router'
import type { Route } from './+types/sandboxes.$id.ts'

export async function loader({ params }: Route.LoaderArgs) {
  const apiUrl = Deno.env.get('API_URL')
  if (!apiUrl) {
    throw new Response('API_URL environment variable is not configured', {
      status: 500,
    })
  }
  const response = await fetch(`${apiUrl}/sandboxes/${params.id}`)
  if (!response.ok) {
    throw new Response('Sandbox not found', { status: 404 })
  }
  const data = await response.json()
  return { sandbox: data.sandbox }
}

export async function action({ params, request }: Route.ActionArgs) {
  const apiUrl = Deno.env.get('API_URL')
  if (!apiUrl) {
    throw new Response('API_URL environment variable is not configured', {
      status: 500,
    })
  }

  const formData = await request.formData()
  const actionType = String(formData.get('_action') ?? '')

  if (actionType === 'kill') {
    await fetch(`${apiUrl}/sandboxes/${params.id}/kill`, { method: 'POST' })
    return redirect('/')
  }

  return null
}

export default function SandboxDetail() {
  const { sandbox } = useLoaderData<typeof loader>()

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <Link to='/'>← Back</Link>
      <h1>{sandbox.name || sandbox.id}</h1>
      <p>
        Status: <strong>{sandbox.status}</strong>
      </p>
      <p>
        Repo: <strong>{sandbox.repoFullName ?? 'None'}</strong>
      </p>
      <p>
        Preview:{' '}
        <a href={sandbox.previewUrl} target='_blank' rel='noreferrer'>
          {sandbox.previewUrl}
        </a>
      </p>
      <p>Namespace: {sandbox.namespace}</p>
      <p>Job: {sandbox.jobName}</p>
      <p>Pod: {sandbox.podName ?? 'Pending'}</p>
      <p>Pod IP: {sandbox.podIp ?? 'Pending'}</p>
      <Form method='post'>
        <button type='submit' name='_action' value='kill'>
          Kill Sandbox
        </button>
      </Form>
    </div>
  )
}
