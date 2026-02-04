import { index, route, type RouteConfig } from '@react-router/dev/routes'

export default [
  index('routes/_index.tsx'),
  route('sandboxes/:id', 'routes/sandboxes.$id.tsx'),
  route('sandboxes/:id/stream', 'routes/sandboxes.$id.stream.ts'),
] satisfies RouteConfig
