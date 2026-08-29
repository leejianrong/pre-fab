# Build from the repository root:
#   docker build -f apps/self-host/Dockerfile -t prefab-self-host .
#
# This needs the whole monorepo as build context (pnpm workspace deploy
# resolves apps/self-host's dependency closure — @prefab/runtime and
# @prefab/schema — from the sibling packages), but the final image ships
# only the deployed, self-contained result of that resolution: no other
# package's source, no devDependencies, no pnpm workspace machinery.

FROM node:22-slim AS deploy
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter=@prefab/self-host deploy --prod --legacy /prod/self-host

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=deploy /prod/self-host .

ENV NODE_ENV=production
ENV PORT=8080
ENV BUNDLE_DIR=/app/site
ENV DATA_DIR=/app/data

# Populate /app/site with an exported bundle (`prefab export-bundle`) —
# either baked into your own image on top of this one, or bind-mounted at
# `docker run` time. /app/data is where prefab.db lives; mount it as a
# volume so submissions survive a container restart or upgrade.
VOLUME ["/app/data"]
EXPOSE 8080

CMD ["node", "--import", "tsx", "src/server.ts"]
