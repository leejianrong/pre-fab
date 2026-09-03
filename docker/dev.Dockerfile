# Shared dev image for docker-compose.yml's migrate/api/editor services.
# No COPY or install here: docker-compose.yml bind-mounts the whole repo
# over /repo at runtime, so anything baked in at build time would just be
# shadowed. Each service's command runs `pnpm install --frozen-lockfile`
# against the mounted repo before its dev command.
FROM node:22-slim
RUN corepack enable
WORKDIR /repo

# Run as the host's most common first Linux user (uid/gid 1000), not root —
# belt-and-suspenders alongside docker-compose.yml's per-package node_modules
# volumes: even though those volumes mean a container `pnpm install` can no
# longer reach anything host-owned, staying non-root also keeps the bind-
# mounted repo itself (source files, .git) writable by the host user for
# anything a dev command writes there directly (e.g. Vite's cache dirs).
#
# Every one of those named volumes needs its mountpoint pre-created with
# this ownership: Docker copies a fresh volume's initial content and
# permissions from whatever already exists at that exact path in the image,
# and otherwise creates it root-owned, which the non-root user below can't
# write into. Keep this list in sync with docker-compose.yml's
# x-dev-service.volumes.
RUN mkdir -p \
      /pnpm-store \
      /repo/node_modules \
      /repo/apps/api/node_modules \
      /repo/apps/cli/node_modules \
      /repo/apps/editor/node_modules \
      /repo/apps/mcp/node_modules \
      /repo/e2e/node_modules \
      /repo/packages/api-client/node_modules \
      /repo/packages/blocks/node_modules \
      /repo/packages/commands/node_modules \
      /repo/packages/db/node_modules \
      /repo/packages/publish/node_modules \
      /repo/packages/puck-adapter/node_modules \
      /repo/packages/runtime/node_modules \
      /repo/packages/schema/node_modules \
      /repo/packages/templates/node_modules \
      /repo/tools/checks/node_modules \
    && chown -R 1000:1000 /pnpm-store /repo
USER 1000:1000
ENV HOME=/tmp
