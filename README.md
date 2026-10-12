# Ada Research Agent

Multi-agent research engine that decomposes complex queries into sub-questions, retrieves evidence in parallel across the live web and uploaded PDF documents, checks for contradictions across sources, and generates long-form reports with verified inline citations.

## Architecture

- **Backend (`engine/`)**: Python, FastAPI, SQLAlchemy (PostgreSQL / SQLite), JWT authentication
- **Task Queue (`engine/celery_app.py`, `engine/tasks.py`)**: Celery workers backed by Redis for async pipeline execution and live job progress
- **Vector Store (`engine/storage/vector_store.py`)**: Qdrant + FastEmbed (`BAAI/bge-small-en-v1.5`, 384d ONNX) with per-user payload filtering
- **Retrieval & Scraping (`engine/retrieval/`)**: Google Serper search, 3-tier scraper (`Trafilatura` -> `Jina Reader` -> search snippets), and `PyMuPDF` PDF chunking
- **Agents & Guards (`engine/agents/`, `engine/guards/`)**:
  - `planner.py`: Breaks a topic into 3-5 sub-questions (`qwen/qwen3.8-27b` via Groq)
  - `critic.py`: Audits gathered evidence for contradictions and missing coverage (`openai/gpt-oss-120b`)
  - `synthesizer.py`: Writes structured Markdown reports from XML-fenced sources (`gemini-3.8-flash` / `gemini-3.1-pro-preview`)
  - `citation_guard.py`: Validates `[S#]` and `[D#]` tags against the retrieved source manifest and strips unsupported claims
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
JWT_SECRET=your-secret-key
```

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

## Running Tests

```bash
python tests/test_e2e_audit.py
python tests/test_phase0.py
```
