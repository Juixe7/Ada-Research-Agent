import os
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
JWT_SECRET = os.getenv("JWT_SECRET", "ada-deep-research-secure-jwt-key-2026-auth")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_DAYS = 7

# --- Jina Reader API ---
JINA_READER_PREFIX = "https://r.jina.ai/"

