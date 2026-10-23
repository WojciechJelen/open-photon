# syntax=docker/dockerfile:1
FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
RUN npm install --global npm@11.6.2
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN test ! -e docs/priv && test ! -e .env \
  && COMFY_API_KEY=build-canary-not-a-real-key npm run build \
  && npm run check:client

FROM node:24.19.0-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl gosu && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/app/data/app.sqlite
COPY --from=build --chown=node:node /app/.output ./.output
# Every feature's workflows/ (runtime workflows and their models.lock) and samples/, at their
# source paths: the server reads them from the working directory.
COPY --from=build --chown=node:node --parents /app/./src/features/*/workflows /app/./src/features/*/samples ./
COPY --from=build --chown=node:node /app/src/shared/server/migrations ./src/shared/server/migrations
# Run in the container to mint an access code on its volume: node scripts/mint-code.mjs <label> <max>
COPY --from=build --chown=node:node /app/scripts/mint-code.mjs ./scripts/mint-code.mjs
# Run in the container, with the app up, to render and pre-render the sample matrix (💸):
# BASE_URL=http://127.0.0.1:3000 ACCESS_CODE=<code> node scripts/prerender-samples.mjs
COPY --from=build --chown=node:node /app/scripts/prerender-samples.mjs ./scripts/prerender-samples.mjs
COPY --chmod=755 scripts/container-entrypoint.sh /usr/local/bin/open-photon-entrypoint
RUN mkdir /app/data && chown node:node /app/data
LABEL org.opencontainers.image.source="https://github.com/WojciechJelen/open-photon"
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
  CMD curl --fail --silent --show-error --max-time 3 --output /dev/null http://127.0.0.1:3000/healthz
ENTRYPOINT ["open-photon-entrypoint"]
CMD ["node", ".output/server/index.mjs"]
