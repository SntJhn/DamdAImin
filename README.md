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

## Local development

The repository contains a pnpm monorepo foundation with web, API, worker, deterministic Research System, shared packages, environment templates, a reviewed initial application migration, and Docker Compose health checks.

To start locally:

1. Activate Node 24 (`nvm use`), then run `pnpm install`.
2. Copy `.env.example` to `.env` and add the local Neon development-branch connection string.
3. Run `pnpm db:migrate` to create only the application-owned `app` schema.
4. Start the local dependencies with `docker compose up -d redis fake-gcs otel-collector`.
5. Run `pnpm dev`. This starts the web app, API, worker, and model-backed Research System; the
   research engine is run in Docker because its Python dependencies and mounted TSERA checkout
   are containerized.

For an all-in-Docker runtime, `docker compose up --build` remains supported.

The supplied Neon credential is intentionally not stored in this repository. Keep it in the ignored `.env` file and rotate it if it has been exposed outside the intended development team.

The normal local runtime will use Docker for application dependencies and a Neon development branch for PostgreSQL and Neon Auth. Tests must use generated synthetic WAV fixtures rather than research recordings or user submissions.

The issue #3 tracer bullet is available at `/analyze` after sign-in. It validates one WAV utterance against the provisional 20-second envelope, uploads it to the private local source-audio bucket, queues the durable Analysis, and polls `/analyses/{id}` until a terminal stage. The fake returns a deterministic definitive classification; full confidence, Transcript, Explanation, and Technical Trace presentation remains assigned to the result slice.

`pnpm test:integration` starts a disposable PostgreSQL 18 container for the database/API ownership test. It does not read the configured `DATABASE_URL`; Docker must be available locally.

Run `pnpm quality` for the complete local gate, including formatting, linting, type checking, OpenAPI drift, unit tests, and the disposable database/API integration test.

## Research integration boundary

Development uses a model-backed Research System that implements the same
versioned contract as the completed neuro-symbolic service. The service reads
the mounted TSERA fine-tuned checkpoint, transcribes with Whisper, applies the
preliminary symbolic layer, and returns the transcript, classification,
explanation, and technical trace. The deterministic fake remains available at
port 4101 for contract-only testing.

## Reference inputs

- [Figma Thesis page](https://www.figma.com/design/WetBJTGHU9e7wkRR3ugGED/DamdAImin?node-id=0-1)

These inputs provide research and interface context. The PRD, glossary, ADRs, executable contracts, and linked issues own the resulting decisions.
