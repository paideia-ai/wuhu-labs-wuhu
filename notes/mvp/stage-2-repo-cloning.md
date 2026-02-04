# Stage 2: Repo Cloning + File Server

## Setup

- GitHub PAT stored as K8s secret in cluster
- Note: The coding agent (Claude/Codex) should ask human for a PAT during setup

## Repo Listing API

- Simple list repos endpoint
- Cache with 5min TTL (Redis in cluster)
- Use latest node-redis with strong types

## Web UI - Create Task

- Now requires selecting a repo (from cached list)
- Still just name + repo, no prompt yet

## Sandbox Cloning

- Clones selected repo to `/root/repo`
- Uses PAT from cluster secret

## Preview Server

- Previous dummy static server → HTTP file server on `/root/repo`
- Browse cloned repo via preview URL

## Validates

- PAT/secret handling works
- Repo listing + caching works
- Clone into sandbox works
- File server proves repo is there
