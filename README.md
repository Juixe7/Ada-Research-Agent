# Ada Research Agent

Multi-agent research engine that decomposes complex queries into sub-questions, retrieves evidence in parallel across the live web and private documents, checks for contradictions across sources, and generates long-form reports. Citation IDs are validated against retrieved evidence, and report claims can be checked against their cited passages by the entailment judge.

## Architecture

- **Backend (`engine/`)**: Python, FastAPI, SQLAlchemy (PostgreSQL / SQLite), JWT authentication
- **Task Queue (`engine/celery_app.py`, `engine/tasks.py`)**: Celery workers backed by Redis for async pipeline execution and live job progress
- **Vector Store (`engine/storage/vector_store.py`)**: Qdrant + FastEmbed (`BAAI/bge-small-en-v1.5`, 384d ONNX) with per-user payload filtering
- **Retrieval & Scraping (`engine/ingest/`)**: Google Serper search, bounded public-URL fetch with redirect and response-size checks, search-snippet fallback, and `PyMuPDF` PDF chunking
- **Agents & Guards (`engine/agents/`, `engine/guards/`)**:
  - `planner.py`: Breaks a topic into 3-5 sub-questions (`qwen/qwen3.8-27b` via Groq)
  - `critic.py`: Audits gathered evidence for contradictions and missing coverage (`openai/gpt-oss-120b`)
  - `synthesizer.py`: Writes structured Markdown reports from XML-fenced sources (`gemini-3.8-flash` / `gemini-3.1-pro-preview`)
  - `citation_guard.py`: Validates `[S#]` and `[D#]` references against the retrieved source manifest and removes lines backed only by unknown citation IDs
- **Frontend (`frontend/`)**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS

## Local Setup

### 1. Environment Variables

Copy `.env.example` to `.env` and fill in your API keys:

```bash
cp .env.example .env
```

Required keys in `.env`:
```env
GROQ_API_KEY=gsk_...
GEMINI_API_KEY=...
SERPER_API_KEY=...
DATABASE_URL=sqlite:///./ada.db
JWT_SECRET=<random secret generated with python -c "import secrets; print(secrets.token_urlsafe(48))">
PUBLIC_APP_URL=http://localhost:3000
SMTP_HOST=your-smtp-host
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=research@example.com
```

`JWT_SECRET` must be set for Docker deployments. Local development generates an ephemeral secret when it is omitted, which invalidates local sessions when the backend restarts. Password reset requests always return a generic response; reset links are sent only when SMTP and `PUBLIC_APP_URL` are configured.

### 2. Backend

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

uvicorn engine.server:app --host 127.0.0.1 --port 8000 --reload
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

App runs at `http://localhost:3000` (API at `http://127.0.0.1:8000`).

## Docker Deployment

To run the full stack (`caddy`, `frontend`, `backend`, `celery_worker`, `redis`, `qdrant`):

```bash
docker compose up -d --build
```

### Local Langfuse Demo (Optional)

Ada can send LiteLLM traces to a local Langfuse instance. Tracing is off by default. Langfuse receives the LLM request and response content, so keep it local for private documents and research prompts.

1. Start Docker Desktop, then follow Langfuse's [official local Docker Compose guide](https://langfuse.com/self-hosting/deployment/docker-compose): clone `https://github.com/langfuse/langfuse` into `.local-run/langfuse`, replace the secrets marked `CHANGEME` in its `docker-compose.yml`, and run `docker compose up -d` there. Open `http://localhost:3000`, create the first user, organization, and project, then copy that project's public and secret keys.
2. Put the keys in the ignored root `.env` file (never commit or paste them into chat):

   ```env
   LANGFUSE_ENABLED=true
   LANGFUSE_PUBLIC_KEY=pk-lf-...
   LANGFUSE_SECRET_KEY=sk-lf-...
   LANGFUSE_OTEL_HOST=http://host.docker.internal:3000
   ```

   If Ada runs directly on the host rather than in Docker, use `LANGFUSE_OTEL_HOST=http://localhost:3000`.
3. Rebuild/restart Ada's backend and worker with `docker compose up -d --build backend celery_worker`. Start a research run and inspect Langfuse's **Traces** view. LLM calls for the same Ada run share a trace/session ID and are tagged with the agent and model group. Cache hits do not create LLM generations.

Langfuse runs in a separate project and does not change the production stack. To stop its local containers, run `docker compose down` from `.local-run/langfuse`; omit `-v` to preserve local trace data. Langfuse's Compose setup is for local evaluation and does not provide production high availability or backups.

## Running Tests

```bash
python tests/test_e2e_audit.py
python tests/test_phase0.py
```

## Interview Demo: Report Evidence and Evaluation

Report follow-ups first retrieve relevant passages from that report's saved evidence. Ada cites the source IDs, checks those IDs against the evidence manifest, and runs the claim entailment judge. If no saved passage is relevant or the judge rejects the answer, the UI says evidence was insufficient; it does not silently launch a separate web search. Use the research form to start a new run when broader research is needed.

Run the deterministic citation-reference evaluation against a saved report:

```bash
python scripts/evaluate_dossier.py path/to/dossier.json --json-out .local-run/evaluation.json
```

The evaluation reports valid citation-reference precision and phantom citation counts. It does not claim to measure semantic support for an entire report; claim entailment is a separate judge step.
