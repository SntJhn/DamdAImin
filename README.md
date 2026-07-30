# DamdAImin

DamdAImin is the application shell for the completed explainable speech-emotion Research System. It accepts a user's own speech and presents the Research System's classification, Transcript, Explanation, and Technical Trace. It does not train or evaluate the model and does not provide clinical, diagnostic, or mood claims.

## Status

The product requirements, local-first implementation route, and architecture are specified. The local foundation is now scaffolded; authenticated account and Analysis History behavior remains the next implementation slice.

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

TypeBox schemas and their generated OpenAPI and JSON Schema artifacts will own transport contracts once implementation starts. Drizzle schemas and committed migrations will own the application database structure. The README links those sources after they exist instead of copying their contents.

## Local development

The repository contains a pnpm monorepo foundation with web, API, worker, deterministic Research System, shared packages, environment templates, a reviewed initial application migration, and Docker Compose health checks.

To start locally:

1. Activate Node 24 (`nvm use`), then run `pnpm install`.
2. Copy `.env.example` to `.env` and add the local Neon development-branch connection string.
3. Run `pnpm db:migrate` to create only the application-owned `app` schema.
4. Run `docker compose up --build`.

The supplied Neon credential is intentionally not stored in this repository. Keep it in the ignored `.env` file and rotate it if it has been exposed outside the intended development team.

The normal local runtime will use Docker for application dependencies and a Neon development branch for PostgreSQL and Neon Auth. Tests must use generated synthetic WAV fixtures rather than research recordings or user submissions.

## Research integration boundary

Development will use a deterministic fake Research System that implements the same versioned contract as the completed neuro-symbolic service. The neural-only Baseline Model cannot serve as the DamdAImin analysis implementation.

## Reference inputs

- [Figma Thesis page](https://www.figma.com/design/WetBJTGHU9e7wkRR3ugGED/DamdAImin?node-id=0-1)

These inputs provide research and interface context. The PRD, glossary, ADRs, executable contracts, and linked issues own the resulting decisions.
