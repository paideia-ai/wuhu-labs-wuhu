# syntax=docker/dockerfile:1

# Stage 1: Generate Prisma client with Node
FROM node:24-alpine AS prisma-generate

WORKDIR /app

COPY prisma ./prisma
COPY packages/prisma/deno.json ./packages/prisma/deno.json

RUN npm install -g prisma@latest
RUN cd prisma && prisma generate

# Stage 2: Build with Deno
FROM denoland/deno:2.3.3 AS build

WORKDIR /app

COPY deno.json deno.lock* ./
COPY packages ./packages
COPY --from=prisma-generate /app/packages/prisma/generated ./packages/prisma/generated

RUN deno install
RUN deno check packages/server/main.ts

# Stage 3: Production
FROM denoland/deno:2.3.3 AS production

WORKDIR /app

COPY --from=build /app/deno.json ./deno.json
COPY --from=build /app/deno.lock ./deno.lock
COPY --from=build /app/packages ./packages

RUN deno install

EXPOSE 3000

ENV PORT=3000

CMD ["deno", "run", "-A", "packages/server/main.ts"]
