# Local Research Engine

This service is the local model-backed Research System used by DamdAImin. It
implements the existing `/v1/analyze` contract and remains stateless: it
receives a WAV payload, performs ASR and emotion inference, applies the
preliminary symbolic layer, and returns the transcript, fused probabilities,
explanation, and technical trace.

The service vendors the small TSERA runtime slice it needs under
`vendor/tsera`. The full TSERA checkout is not required to run DamdAImin. The
vendored runtime includes:

- the fine-tuned neural checkpoint;
- the TSERA audio preprocessing/inference module; and
- the five symbolic rule tables and an English vocabulary table for
  code-switch detection.

Whisper `large-v3-turbo` is the default ASR model. Override `ASR_MODEL` when a
different locally supported Whisper checkpoint is required. The preliminary
rule weights default to `1.00`. Fusion starts with `0.60` neural and `0.40`
symbolic weighting, then adjusts per recording. Normalized neural entropy can
raise symbolic influence by up to `0.15`; disagreement from lexical or contrast
emotion evidence can raise it further, up to a maximum symbolic weight of
`0.90` when the evidence is strong. Supporting context can add up to `0.05`.
Prosodic energy and
code-switch detection do not count as strong contextual evidence, so loudness
alone cannot make the symbolic layer overrule the neural model.

When no emotion-bearing symbolic rules contribute evidence, the symbolic layer
uses a neutral-leaning prior: `0.70` neutral and `0.10` for each other emotion.
That prior may influence uncertain neural predictions but is not treated as
contextual evidence. The response explanation reports the effective weights
and reason for the adjustment. These are heuristic defaults, not calibrated
thesis settings. When positive symbolic evidence supports only neutral, neutral
receives at least `0.65` of the symbolic probability before fusion. Emotion
matching checks exact lexicon forms first, then allows a bounded shared-stem
match for single-word Filipino emotion entries.

Set `HF_TOKEN` in the repository `.env` file to authenticate Whisper downloads
against the Hugging Face Hub. The token is passed only to the local research
engine container and is not committed.

The default Compose setup mounts the repository-local `.cache/huggingface`
directory. To use a Docker-managed named volume instead, run Compose with the
named-cache override:

```bash
docker compose -f docker-compose.yml -f docker-compose.named-cache.yml up --build research-engine api worker
```

The named volume downloads the ASR model on its first startup and reuses it on
later container recreations. The research engine preloads ASR before serving
traffic, so its health check does not pass until the model is ready.

## Local startup

From the DamdAImin repository:

```bash
pnpm dev
```

`pnpm dev` starts the web app, API, worker, and this model-backed service. Start the shared local
dependencies first with `docker compose up -d redis fake-gcs otel-collector`. To run only this
service, use `docker compose up --build research-engine api worker` instead.

The first build installs Python dependencies and the first engine startup
downloads the ASR checkpoint when it is not already cached. The model-backed service is available at
`http://localhost:4100/healthz`. The deterministic contract fake remains
available at `http://localhost:4101` for contract-only testing.

## Neural inference windows

Neural inference covers the full recording in non-overlapping five-second
windows. Window probabilities are averaged by valid audio duration, with
additional weight for speech timed by ASR. Duration weighting still gives each
window a contribution when ASR misses speech or no ASR timings are available.

## Symbolic lexicon sources

The six keyword tables under `vendor/tsera/data/raw/keywords` combine the local
entries with [Symbolic-Rules](https://github.com/reilala/Symbolic-Rules/tree/023446c5f7c2e052f7943626efa7b881cad5e061)
at commit `023446c5f7c2e052f7943626efa7b881cad5e061`. Exact duplicate rows are
removed, and variants are combined for otherwise matching rows. Local emotion
labels, strengths, and additions such as `wow` and `hinayang` are preserved.

`THESIS-english_words.csv` provides 4,008 English vocabulary entries for
token language detection. It does not assign emotions or introduce a new
emotion-scoring rule. Shared English and Filipino tokens retain the existing
`mixed` language treatment. Custom `SYMBOLIC_KEYWORD_DIR` directories must
include all six tables.
