"""Loads environment configuration for providers, model groups, persistence, queueing, and authentication.

"""

import os
import secrets
from pathlib import Path
from dotenv import load_dotenv

# Locate and load the root .env
ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

# --- API Keys ---
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
SERPER_API_KEY = os.getenv("SERPER_API_KEY", "")

# --- Verified Model Identifiers ---
GROQ_PLANNER_MODEL = "qwen/qwen3.8-27b"
GROQ_FALLBACK_MODEL = "openai/gpt-oss-120b"
GEMINI_SYNTHESIS_MODEL = "gemini-3.8-flash"
GEMINI_PRO_MODEL = "gemini-3.1-pro-preview"

# --- LiteLLM Model Groups (Blueprint Section 9) ---
MODEL_GROUP_SMALL = {
    "primary": os.getenv("LLM_SMALL_PRIMARY", "groq/qwen/qwen3.8-27b"),
    "fallback": os.getenv("LLM_SMALL_FALLBACK", "gemini/gemini-flash-latest"),
}
MODEL_GROUP_LARGE = {
    "primary": os.getenv("LLM_LARGE_PRIMARY", "groq/openai/gpt-oss-120b"),
    "fallback": os.getenv("LLM_LARGE_FALLBACK", "gemini/gemini-flash-latest"),
}
MODEL_GROUP_WRITE = {
    "primary": os.getenv("LLM_WRITE_PRIMARY", "gemini/gemini-flash-latest"),
    "fallback": os.getenv("LLM_WRITE_FALLBACK", "groq/openai/gpt-oss-120b"),
}
MODEL_GROUP_JUDGE = {
    "primary": os.getenv("LLM_JUDGE_PRIMARY", "groq/qwen/qwen3.8-27b"),
    "fallback": os.getenv("LLM_JUDGE_FALLBACK", "gemini/gemini-flash-latest"),
}

LLM_GROUPS = {
    "small": MODEL_GROUP_SMALL,
    "large": MODEL_GROUP_LARGE,
    "write": MODEL_GROUP_WRITE,
    "judge": MODEL_GROUP_JUDGE,
}

LLM_DEFAULT_RPM = int(os.getenv("LLM_DEFAULT_RPM", "60"))
LLM_DEFAULT_TPM = int(os.getenv("LLM_DEFAULT_TPM", "100000"))
RUN_COST_BUDGET_USD = float(os.getenv("RUN_COST_BUDGET_USD", "5.0"))
RUN_TOKEN_BUDGET = int(os.getenv("RUN_TOKEN_BUDGET", "250000"))

# --- Embeddings & Vector DB ---
EMBEDDING_MODEL_NAME = "BAAI/bge-small-en-v1.5"
QDRANT_COLLECTION = "ada_research_corpus"
QDRANT_STORAGE_PATH = str(ROOT_DIR / "qdrant_data")
QDRANT_URL = os.getenv("QDRANT_URL", "")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "")

# --- Redis & Celery Broker ---
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
USE_CELERY = os.getenv("USE_CELERY", "false").lower() in ("true", "1", "yes")

# --- Database & Auth ---
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{ROOT_DIR / 'ada.db'}")
JWT_SECRET = os.getenv("JWT_SECRET", "").strip()
if not JWT_SECRET:
    if os.getenv("APP_ENV", "development").lower() == "production":
        raise RuntimeError("JWT_SECRET must be configured in production.")
    # Local development remains usable without checked-in credentials. This
    # intentionally invalidates local sessions when the process restarts.
    JWT_SECRET = secrets.token_urlsafe(48)
    print("[config] JWT_SECRET is unset; using an ephemeral development secret.")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_DAYS = 7

# --- Jina Reader API ---
JINA_READER_PREFIX = "https://r.jina.ai/"

