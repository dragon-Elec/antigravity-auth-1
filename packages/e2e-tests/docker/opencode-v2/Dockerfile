# syntax=docker/dockerfile:1.7
ARG BUN_VERSION=1.3.14

FROM node:24-bookworm-slim
ARG BUN_VERSION
ARG SOURCE_REVISION=unknown

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git unzip \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"

ENV PATH="/root/.bun/bin:${PATH}"
WORKDIR /workspace

COPY . .
RUN bun install --frozen-lockfile

LABEL org.opencontainers.image.revision="${SOURCE_REVISION}"
CMD ["bun", "run", "test:e2e:opencode-v2:local"]
