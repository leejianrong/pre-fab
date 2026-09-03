# Shared dev image for docker-compose.yml's migrate/api/editor services.
# No COPY or install here: docker-compose.yml bind-mounts the whole repo
# over /repo at runtime, so anything baked in at build time would just be
# shadowed. Each service's command runs `pnpm install --frozen-lockfile`
# against the mounted repo before its dev command.
FROM node:22-slim
RUN corepack enable
WORKDIR /repo

# Run as the host's most common first Linux user (uid/gid 1000), not root.
# `pnpm install` writes node_modules back onto the bind-mounted host repo
# (see docker-compose.yml's comment) — running it as root leaves those
# files root-owned on the host, breaking native `pnpm`/git/editor access
# until someone manually chowns tens of thousands of files back. Pre-create
# the pnpm store's mountpoint with the right ownership so the named volume
# inherits it on first use (Docker copies a volume's initial content, ACLs
# included, from whatever already exists at that path in the image).
RUN mkdir -p /pnpm-store && chown 1000:1000 /pnpm-store
USER 1000:1000
ENV HOME=/tmp
