# syntax=docker/dockerfile:1

FROM denoland/deno:2.6.8 AS build

WORKDIR /app

COPY deno.json deno.lock ./
COPY packages ./packages

RUN deno install
RUN cd packages/app && deno task build

FROM denoland/deno:2.6.8 AS production

WORKDIR /app

# Copy workspace config and dependencies
COPY --from=build /app/deno.json /app/deno.lock ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages

EXPOSE 3000

ENV PORT=3000

WORKDIR /app/packages/app

CMD ["run", "-A", "server.ts"]
