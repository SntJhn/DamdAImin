# Local Research Engine

This service is the local model-backed Research System used by DamdAImin. It
implements the existing `/v1/analyze` contract and remains stateless: it
receives a WAV payload, performs ASR and emotion inference, applies the
preliminary symbolic layer, and returns the transcript, fused probabilities,
explanation, and technical trace.

The service imports the TSERA inference implementation and reads the model and
keyword resources through a read-only bind mount. The default local paths are:

- `/tsera/src/models/best_finetuned_baseline.pt`
- `/tsera/data/raw/keywords`

Whisper `large-v3-turbo` is the default ASR model. Override `ASR_MODEL` when a
different locally supported Whisper checkpoint is required. The preliminary
rule weights default to `1.00` and the neural/symbolic fusion coefficients
default to `0.80` and `0.20`; these are demonstration values and not final
validated thesis settings.

Set `HF_TOKEN` in the repository `.env` file to authenticate Whisper downloads
against the Hugging Face Hub. The token is passed only to the local research
engine container and is not committed.

## Local startup

From the DamdAImin repository:

```bash
pnpm dev
```

`pnpm dev` starts the web app, API, worker, and this model-backed service. Start the shared local
dependencies first with `docker compose up -d redis fake-gcs otel-collector`. To run only this
service, use `docker compose up --build research-engine api worker` instead.

The first build downloads Python dependencies and the first analysis downloads
the ASR checkpoint. The model-backed service is available at
`http://localhost:4100/healthz`. The deterministic contract fake remains
available at `http://localhost:4101` for contract-only testing.
