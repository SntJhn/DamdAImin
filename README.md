# DamdAImin

DamdAImin is the application shell for the completed explainable speech-emotion Research System. It accepts a user's own speech and presents the Research System's classification, Transcript, Explanation, and Technical Trace. It does not train or evaluate the model and does not provide clinical, diagnostic, or mood claims.

## Status

The product requirements, local-first implementation route, and architecture are specified. The authenticated foundation and first complete Analysis tracer bullet are implemented locally: a verified user can upload one Taglish WAV, observe durable processing, and receive a model-backed completed classification through the API, queue, worker, storage, and Research System boundaries.

- Product scope: [PRD: DamdAImin MVP](https://github.com/SntJhn/DamdAImin/issues/1)
- Implementation plan: [MVP implementation plan](docs/plans/mvp-implementation-plan.md)
- Delivery status: [GitHub Issues](https://github.com/SntJhn/DamdAImin/issues)

## Sources of truth

| Concern                                  | Canonical source                                                   |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Product scope and requirements           | [PRD: DamdAImin MVP](https://github.com/SntJhn/DamdAImin/issues/1) |
| Phase order, gates, and research handoff | [MVP implementation plan](docs/plans/mvp-implementation-plan.md)   |
| Domain vocabulary                        | [CONTEXT.md](CONTEXT.md)                                           |
| Architecture decisions                   | [docs/adr](docs/adr)                                               |
| Required quality evidence                | [Behavior-and-risk matrix](docs/quality/behavior-risk-matrix.md)   |
| Delivery state and dependencies          | [GitHub Issues](https://github.com/SntJhn/DamdAImin/issues)        |
| Agent conventions                        | [AGENTS.md](AGENTS.md) and [docs/agents](docs/agents)              |

TypeBox schemas and their generated OpenAPI and JSON Schema artifacts own transport contracts. The current generated API document is [packages/contracts/generated/openapi.json](packages/contracts/generated/openapi.json). Drizzle schemas and committed migrations own the application database structure. The README links those sources instead of copying their contents.

## Setup and local development

DamdAImin uses a pnpm monorepo for the web app, API, worker, shared packages,
and contracts. Docker Compose supplies Redis, local object storage,
observability, and the model-backed Research System. PostgreSQL and Neon Auth
come from a Neon development branch.

### Prerequisites

- Node.js 24.x
- pnpm 11.x
- Docker Desktop with Compose
- A Neon development branch with PostgreSQL and Neon Auth enabled

The DamdAImin repository now includes the small TSERA runtime slice required by
the Research System. A separate TSERA checkout is not required for setup.

### Configure the environment

From the repository root:

```bash
cp .env.example .env
```

Fill in the values for `DATABASE_URL`, `NEON_AUTH_BASE_URL`,
`NEON_AUTH_JWKS_URL`, `NEON_AUTH_ISSUER`, `NEON_AUTH_AUDIENCE`, and
`NEON_AUTH_COOKIE_SECRET`. Keep `.env` local and never commit it. Set `HF_TOKEN`
if the machine needs authenticated Hugging Face downloads or higher Hub rate
limits.

### Install

```bash
nvm use 24                 # or activate another Node 24 installation
corepack enable
pnpm install
```

the application-owned schema. It does not alter Neon Auth's tables.

### Start the local application

Start the shared local services first:

```bash
docker compose up -d redis fake-gcs otel-collector research-engine api worker
```

Then start the web app:

```bash
pnpm --filter @damdai/web dev
```

Open <http://localhost:3000>. Useful health checks are:

- Web: <http://localhost:3000>
- API: <http://localhost:4000/healthz>
- Research System: <http://localhost:4100/healthz>
- Contract fake: <http://localhost:4101/healthz>

The first Research System startup loads the vendored neural checkpoint and the
cached Whisper ASR model. The engine is not reported healthy until ASR is ready,
so the first startup may take longer than later starts.

### Run everything in Docker

For an all-in-Docker runtime:

```bash
docker compose up --build
```

The default Compose file uses the repository-local ASR cache at
`.cache/huggingface`.

### Use a Docker-managed ASR cache

To give each machine a persistent named Docker volume instead of using the
repository-local cache:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.named-cache.yml \
  up --build
```

The first startup downloads Whisper into the `whisper-cache` volume. Later
container recreations reuse that volume. Do not run `docker compose down -v`
unless you intentionally want to delete the named cache and download Whisper
again.

The local bind-mounted cache and named-volume cache are alternative modes; use
only one for a given Compose invocation.

### Tests and quality checks

```bash
pnpm test              # unit and contract tests
pnpm test:integration  # disposable PostgreSQL integration test
pnpm test:e2e          # Playwright browser tests
pnpm quality           # complete local quality gate
```

`pnpm test:integration` starts a disposable PostgreSQL 18 container and does
not read the configured `DATABASE_URL`.

The supplied Neon credential is intentionally not stored in this repository.
Keep it in the ignored `.env` file and rotate it if it has been exposed outside
the intended development team.

## Research integration boundary

Development uses a model-backed Research System that implements the same
versioned contract as the completed neuro-symbolic service. The service reads
the vendored TSERA fine-tuned checkpoint and keyword tables, transcribes with
Whisper, applies the preliminary symbolic layer, and returns the transcript,
classification, explanation, and technical trace. The deterministic fake
remains available at port 4101 for contract-only testing.

## Reference inputs

- [Figma Thesis page](https://www.figma.com/design/WetBJTGHU9e7wkRR3ugGED/DamdAImin?node-id=0-1)

These inputs provide research and interface context. The PRD, glossary, ADRs, executable contracts, and linked issues own the resulting decisions.
