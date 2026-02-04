# syntax=docker/dockerfile:1

# Stage 1: Build with Deno
FROM denoland/deno:2.3.3 AS build

WORKDIR /app

COPY deno.json deno.lock* ./
COPY packages ./packages

RUN deno install
RUN deno check packages/server/main.ts

# Stage 2: Production
FROM denoland/deno:2.3.3 AS production

WORKDIR /app

COPY --from=build /app/deno.json ./deno.json
COPY --from=build /app/deno.lock ./deno.lock
COPY --from=build /app/packages ./packages

RUN deno install

EXPOSE 3000

ENV PORT=3000

CMD ["deno", "run", "-A", "packages/server/main.ts"]
