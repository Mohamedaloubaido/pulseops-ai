# PulseOps AI

**AI-assisted incident operations platform** for service monitoring, incident response, realtime coordination, public status communication and postmortems.

PulseOps AI is a production-minded full-stack SaaS project rather than a chatbot demo. AI sits inside the incident workflow and works from operational evidence: incident timelines, affected services and recent monitor checks.

## What is implemented

- Multi-tenant users, organizations and RBAC
- Secure scrypt password hashing and opaque bearer sessions
- Service registry and operational health states
- Incident lifecycle, affected services and authored timeline updates
- Public status pages with recent incident history
- Redis/BullMQ uptime monitoring worker
- Monitor history, retry/backoff and outage confirmation
- Redis-backed realtime organization/status events
- Authenticated operations dashboard
- Evidence-grounded AI incident analysis
- Probable root-cause hypotheses with confidence indicators
- Suggested next actions and customer-update drafts
- AI-assisted postmortem generation for resolved incidents
- Persisted AI artifacts for traceability
- Docker-based PostgreSQL + Redis local infrastructure

## Architecture

```text
                          ┌─────────────────────────┐
                          │       Next.js Web       │
                          │ Landing / Dashboard /   │
                          │ Public Status Pages     │
                          └────────────┬────────────┘
                                       │
                                       ▼
                          ┌─────────────────────────┐
                          │       Fastify API       │
                          │ Auth / RBAC / Services  │
                          │ Incidents / AI / SSE    │
                          └──────┬─────────┬────────┘
                                 │         │
                 ┌───────────────┘         └───────────────┐
                 ▼                                         ▼
       ┌──────────────────┐                     ┌──────────────────┐
       │    PostgreSQL    │                     │      Redis       │
       │ tenants, health, │                     │ BullMQ + Pub/Sub │
       │ incidents, AI    │                     └────────┬─────────┘
       └──────────────────┘                              │
                                                       ▼
                                            ┌──────────────────────┐
                                            │ Monitoring Worker    │
                                            │ HTTP checks + state  │
                                            └──────────────────────┘
```

## Run the demo locally

Requirements:

- Node.js 20.19+
- npm
- Docker + Docker Compose

Create your environment file and start infrastructure:

```bash
cp .env.example .env
docker compose up -d
```

Install dependencies and apply the committed database migrations:

```bash
npm install
npm run db:deploy
```

Seed a realistic local workspace:

```bash
npm run demo:seed
```

Start the API, web app and monitoring worker together:

```bash
npm run dev
```

Open:

- Operations login: `http://localhost:3000/login`
- Public status page: `http://localhost:3000/status/northstar-cloud`
- API health: `http://localhost:4000/api/health`

Local demo credentials:

```text
Email: demo@pulseops.local
Password: PulseOpsDemo123!
```

The seed is idempotent and is intended for local development. It refuses to run in `NODE_ENV=production` unless `ALLOW_DEMO_SEED=true` is explicitly set. You can override the local credentials with `DEMO_EMAIL` and `DEMO_PASSWORD`.

### AI copilot

The rest of the demo works without an AI key. To run incident analysis or postmortem generation, set:

```bash
OPENAI_API_KEY=...
```

The API uses the OpenAI Responses API with `store: false`. AI output is advisory only and never triggers automatic remediation or publication.

## Repository structure

```text
pulseops-ai/
├── apps/
│   ├── api/          # Fastify API + Prisma schema/migrations
│   ├── web/          # Next.js landing, dashboard and status pages
│   └── worker/       # BullMQ uptime monitoring worker
├── .github/
│   └── workflows/    # CI configuration
├── docker-compose.yml
├── eslint.config.mjs
├── package.json
└── tsconfig.base.json
```

## Core API workflow

```text
Monitor check
   ↓
Service health
   ↓
Incident opened
   ↓
Timeline updates
   ↓
AI evidence analysis
   ↓
Suggested actions / customer update
   ↓
Monitoring / resolution
   ↓
AI-assisted postmortem
```

## Quality checks

```bash
npm run lint
npm run typecheck
npm run build
```

## Engineering roadmap

Completed milestones:

1. Project foundation
2. Authentication, organizations and RBAC
3. Service registry
4. Incident lifecycle
5. Public status pages
6. Monitoring workers
7. Realtime operations
8. AI Incident Copilot + postmortems
9. Authenticated operations dashboard
10. Local demo environment

Next engineering targets include similar-incident retrieval with embeddings/pgvector, reliability analytics, scheduled maintenance, notifications/webhooks and broader automated tests.

## AI safety model

PulseOps treats generated output as **assistance, not authoritative diagnosis**. Probable causes are labeled as hypotheses, confidence is explicit, prompts are grounded in stored incident evidence, customer-facing drafts require human publication, and postmortems preserve known unknowns rather than inventing missing facts.

---

Built by **Mohammed Al-Obaido** as a full-stack and applied-AI engineering project.
