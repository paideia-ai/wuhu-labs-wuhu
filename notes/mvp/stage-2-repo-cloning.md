# Stage 2: Repo Cloning + File Server

## Setup

- GitHub PAT stored as K8s secret (`github-pat`)
- Scopes: `repo` + `workflow`
- `GITHUB_ALLOWED_ORGS` env var filters which orgs' repos are returned (comma-separated)
  - e.g., `GITHUB_ALLOWED_ORGS=paideia-ai,wuhu-labs`
  - Only repos from these orgs appear in the listing
  - Personal repos excluded for now (MVP simplicity)

## Repo Listing API

- Simple list repos endpoint
- Filters to `GITHUB_ALLOWED_ORGS` only
- Cache with 5min TTL (Redis in cluster)

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
