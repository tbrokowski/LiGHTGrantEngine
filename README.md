# LiGHT Grant System

**Dynamic Grant Intelligence, Tracking, and Proposal Automation Hub**

An internal web platform for the LiGHT research group (EPFL) that manages the full grant lifecycle — from automated discovery and scoring through proposal development, archiving, and AI-assisted writing.

All AI workflows are powered by **Qwen**, running on your cluster.

---

## Architecture

```
light-grant-system/
├── config.yaml            ← Master config (Qwen endpoint, scoring weights, schedule)
├── .env.example           ← Copy to .env and fill in secrets
├── docker-compose.yml     ← Full stack: DB, Redis, backend, workers, frontend
├── backend/               ← FastAPI (Python)
│   ├── app/
│   │   ├── ai/            ← Qwen client + all 10 agents + RAG retriever
│   │   ├── models/        ← SQLAlchemy ORM (17 tables)
│   │   ├── routers/       ← REST API endpoints
│   │   ├── scrapers/      ← Source connectors (RSS, HTML, API)
│   │   ├── services/      ← Business logic
│   │   └── workers/       ← Celery tasks (discovery, notifications, embeddings)
│   └── alembic/           ← Database migrations
├── frontend/              ← Next.js 14 (TypeScript + Tailwind)
└── scripts/               ← Seed data, admin creation
```

---

## Quick Start

### 1. Configure Qwen

Edit `config.yaml` to point at your Qwen deployment:

```yaml
ai:
  base_url: "http://your-cluster-host:8000/v1"  # vLLM / Ollama / TGI
  model: "Qwen/Qwen2.5-72B-Instruct"
  api_key: "EMPTY"  # or your auth key
```

### 2. Set environment variables

```bash
cp .env.example .env
# Edit .env — at minimum set SECRET_KEY
```

### 3. Start with Docker Compose

```bash
docker-compose up -d
```

This starts:
- PostgreSQL 16 with pgvector
- Redis
- FastAPI backend (port 8000)
- Celery worker + beat scheduler
- Next.js frontend (port 3000)

### 4. Run database migrations

```bash
docker-compose exec backend alembic upgrade head
```

### 5. Create admin user

```bash
docker-compose exec backend python scripts/create_admin.py admin@your-org.ch "Admin Name" yourpassword
```

### 6. Seed the 133 LiGHT opportunities

```bash
docker-compose exec backend python scripts/seed_opportunities.py /path/to/Opportunities.xlsx
```

### 7. Open the app

Visit **http://localhost:3000** → log in with your admin credentials.

---

## AI Workflows

All AI runs go through `backend/app/ai/client.py`, which calls the Qwen endpoint configured in `config.yaml`. Every run is logged in the `ai_runs` table with sources, outputs, and warnings.

| Agent | Endpoint | Description |
|-------|----------|-------------|
| Call Analyzer | `POST /api/v1/ai/analyze-call` | Extracts structure from a grant call |
| Fit Scorer | `POST /api/v1/ai/score-opportunity` | Scores 0–100 against team priorities |
| Go/No-Go | `POST /api/v1/ai/go-no-go` | Strategic decision memo |
| Proposal Architect | `POST /api/v1/ai/proposal-outline` | Outline + timeline + assignments |
| Section Drafter | `POST /api/v1/ai/draft-section` | RAG-assisted section drafting |
| Compliance Checker | `POST /api/v1/ai/compliance-check` | Checks draft against funder requirements |
| Similar Grants | `POST /api/v1/ai/find-similar-grants` | Semantic search over archive |
| Feedback Analyzer | `POST /api/v1/ai/analyze-feedback` | Lessons from reviewer comments |
| Memory Agent | `POST /api/v1/ai/process-for-memory` | Archives completed grants |

### RAG / Vector Search

Proposal sections and documents are embedded using the Qwen embeddings endpoint (configured in `config.yaml:ai.embeddings`). Embeddings are stored in PostgreSQL via pgvector. The retriever uses **hybrid search**: vector similarity + keyword + metadata filters, with permission enforcement.

---

## Configuration Reference (`config.yaml`)

| Section | Key | Description |
|---------|-----|-------------|
| `ai.base_url` | Qwen server URL | vLLM/Ollama/TGI endpoint |
| `ai.model` | Model name | As registered on your server |
| `ai.api_key` | API key | `"EMPTY"` for local deployments |
| `ai.embeddings` | Embeddings config | Separate endpoint if needed |
| `fit_scoring.team_themes` | Theme list | Used by Qwen scorer |
| `fit_scoring.tiers` | Score thresholds | Customize tier boundaries |
| `discovery.default_schedule` | weekly/daily | How often to scan sources |
| `rag.top_k` | int | Results per retrieval query |
| `notifications.email.enabled` | bool | Enable email reminders |

---

## Development Setup (without Docker)

```bash
# Backend
cd backend
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload

# Celery worker (separate terminal)
celery -A app.workers.celery_app worker --loglevel=info

# Frontend
cd frontend
npm install
npm run dev
```

---

## Grant Source Categories

Pre-configured source categories (add/edit via Admin UI or `/api/v1/sources`):
- Global health, AI & data science, Digital health
- Swiss funding (SNSF, Innosuisse, Swiss AI Initiative)
- EU funding (Horizon Europe, IHI, ERC, MSCA)
- US federal (NIH, USAID, FCDO)
- Private foundations (Gates, Wellcome, Grand Challenges)
- EPFL internal calls, Yale/Harvard institutional

---

## API Documentation

Interactive docs available at:
- Swagger UI: http://localhost:8000/api/docs
- ReDoc: http://localhost:8000/api/redoc
