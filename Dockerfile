# Python 3.12 slim image for Ada Deep Research FastAPI Engine
FROM python:3.12-slim

WORKDIR /app

# Install system build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy engine application code (Secrets are injected at runtime via environment variables, never baked into image)
COPY engine ./engine

# Create persistent storage directories
RUN mkdir -p /app/uploads /app/dossiers /app/qdrant_data /app/data

EXPOSE 8000

CMD ["uvicorn", "engine.server:app", "--host", "0.0.0.0", "--port", "8000"]
