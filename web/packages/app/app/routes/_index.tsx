import { Form, Link, redirect, useLoaderData } from 'react-router'
import type { Route } from './+types/_index.ts'
import { Button } from '@wuhu/shadcn/components/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@wuhu/shadcn/components/card'
import { Input } from '@wuhu/shadcn/components/input'
import { Textarea } from '@wuhu/shadcn/components/textarea'
import { Label } from '@wuhu/shadcn/components/label'
import { Badge } from '@wuhu/shadcn/components/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@wuhu/shadcn/components/select'

interface SandboxSummary {
  id: string
  name: string | null
  repoFullName: string | null
  status: string
  previewUrl: string
}

interface RepoSummary {
  id: number
  fullName: string
  private: boolean
}

export async function loader() {
  const apiUrl = Deno.env.get('API_URL')
  if (!apiUrl) {
    throw new Response('API_URL environment variable is not configured', {
      status: 500,
    })
  }

  let repos: RepoSummary[] = []
  let repoError: string | null = null
  try {
    const response = await fetch(`${apiUrl}/repos`)
    if (!response.ok) {
      throw new Error('repo_fetch_failed')
    }
    const data = await response.json()
    repos = (data?.repos ?? []) as RepoSummary[]
  } catch (_e) {
    repoError = 'Failed to load repos'
  }

  try {
    const response = await fetch(`${apiUrl}/sandboxes`)
    const data = await response.json()
    const sandboxes = (data?.sandboxes ?? []) as SandboxSummary[]
    return { sandboxes, repos, error: null, repoError }
  } catch (_e) {
    return {
      sandboxes: [],
      repos,
      error: 'Failed to connect to API',
      repoError,
    }
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
    const repo = String(formData.get('repo') ?? '').trim()
    const prompt = String(formData.get('prompt') ?? '').trim()
    if (!repo) {
      throw new Response('Repo is required', { status: 400 })
    }
    const body: { name: string | null; repo: string; prompt?: string } = {
      name: name || null,
      repo,
    }
    if (prompt) body.prompt = prompt
    const response = await fetch(`${apiUrl}/sandboxes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
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
  const { sandboxes, repos, error, repoError } = useLoaderData<typeof loader>()

  return (
    <div className='container mx-auto p-8 max-w-4xl'>
      <h1 className='text-3xl font-bold mb-6'>Wuhu Sandboxes</h1>
      {error && <p className='text-destructive mb-4'>{error}</p>}

      <Card className='mb-8'>
        <CardHeader>
          <CardTitle>Create Task</CardTitle>
        </CardHeader>
        <CardContent>
          {repoError && <p className='text-destructive mb-4'>{repoError}</p>}
          <Form method='post' className='grid gap-4'>
            <div className='space-y-2'>
              <Label htmlFor='prompt'>Prompt</Label>
              <Textarea
                id='prompt'
                name='prompt'
                placeholder='What should the agent do? (optional)'
                rows={3}
              />
            </div>
            <div className='grid grid-cols-2 gap-4'>
              <div className='space-y-2'>
                <Label htmlFor='name'>Sandbox Name</Label>
                <Input
                  id='name'
                  name='name'
                  placeholder='Optional name'
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='repo'>Repository</Label>
                <Select name='repo'>
                  <SelectTrigger className='w-full'>
                    <SelectValue placeholder='Select repo' />
                  </SelectTrigger>
                  <SelectContent>
                    {repos.map((repo) => (
                      <SelectItem key={repo.id} value={repo.fullName}>
                        {repo.fullName}
                        {repo.private ? ' (private)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Button
                type='submit'
                name='_action'
                value='create'
                disabled={repos.length === 0}
              >
                Create Sandbox
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>

      <section>
        <h2 className='text-2xl font-semibold mb-4'>Active Sandboxes</h2>
        {sandboxes.length === 0
          ? <p className='text-muted-foreground'>No sandboxes yet.</p>
          : (
            <div className='grid gap-4'>
              {sandboxes.map((sandbox) => (
                <Card key={sandbox.id}>
                  <CardContent className='pt-6'>
                    <div className='flex justify-between items-start'>
                      <div className='space-y-1'>
                        <h3 className='font-semibold text-lg'>
                          {sandbox.name || sandbox.id}
                        </h3>
                        <div className='flex items-center gap-2'>
                          <span className='text-sm text-muted-foreground'>
                            Status:
                          </span>
                          <Badge variant='outline'>{sandbox.status}</Badge>
                        </div>
                        <p className='text-sm text-muted-foreground'>
                          Repo:{' '}
                          <span className='font-medium text-foreground'>
                            {sandbox.repoFullName ?? 'None'}
                          </span>
                        </p>
                        <p className='text-sm text-muted-foreground'>
                          Preview:{' '}
                          <a
                            href={sandbox.previewUrl}
                            target='_blank'
                            rel='noreferrer'
                            className='text-primary hover:underline'
                          >
                            {sandbox.previewUrl}
                          </a>
                        </p>
                      </div>
                      <div className='flex gap-2'>
                        <Button variant='outline' size='sm' asChild>
                          <Link to={`/sandboxes/${sandbox.id}`}>Details</Link>
                        </Button>
                        <Form method='post'>
                          <input type='hidden' name='id' value={sandbox.id} />
                          <Button
                            type='submit'
                            name='_action'
                            value='kill'
                            variant='destructive'
                            size='sm'
                          >
                            Kill
                          </Button>
                        </Form>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
      </section>
    </div>
  )
}
