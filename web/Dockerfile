# syntax=docker/dockerfile:1

FROM denoland/deno:latest AS build

WORKDIR /app

COPY deno.json deno.lock ./
COPY packages ./packages

RUN deno install
RUN cd packages/app && deno task build

FROM denoland/deno:latest AS production

WORKDIR /app

# Copy workspace config and dependencies
COPY --from=build /app/deno.json /app/deno.lock ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/app/deno.json ./packages/app/deno.json
COPY --from=build /app/packages/react-router-deno/deno.json ./packages/react-router-deno/deno.json

# Copy app files
COPY --from=build /app/packages/app/server.ts ./packages/app/server.ts
COPY --from=build /app/packages/app/build ./packages/app/build

EXPOSE 3000

ENV PORT=3000

WORKDIR /app/packages/app

CMD ["run", "-A", "server.ts"]
