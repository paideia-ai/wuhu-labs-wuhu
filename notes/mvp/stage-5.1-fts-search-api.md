# Stage 5.1: FTS Schema + Core Search API

## FTS Indexing (Postgres)

- Add FTS index on `messages` table
- Index human input (role = 'user')
- Index AI message to human (role = 'assistant', final turn messages)
- Do NOT index: tool calls, tool results, reasoning/reasoning summary

## HTTP API Endpoints

1. `POST /sessions/search` - FTS query across sessions
   - Request body: `{ query: string, limit?: number, offset?: number }`
   - Returns matching sessions with relevance score

2. `GET /sessions/:id` - Get session log
   - Returns DB version (not raw logs)
   - Excludes unused metadata
   - Returns messages in chronological order

## Validates

- Unit tests for FTS indexing logic
- Unit tests for search endpoint (query parsing, result formatting)
- Unit tests for session retrieval endpoint
