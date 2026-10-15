# PulseOps AI

**AI-assisted incident operations platform** for realtime monitoring, service health, status communication, incident response and postmortems.

PulseOps AI is designed as a production-minded full-stack SaaS project rather than a chatbot demo. The AI layer sits inside the incident workflow: it will summarize events, suggest likely causes, propose next actions, draft public updates and generate postmortems from the incident timeline.

## Current foundation

This first milestone establishes the platform skeleton:

- npm workspaces monorepo
- Next.js + React web application
- Fastify + TypeScript API
- strict TypeScript configuration
- Zod-based environment validation
- PostgreSQL and Redis local infrastructure via Docker Compose
- ESLint flat config
- GitHub Actions CI for lint, typecheck and build
- API health endpoint

## Architecture

```text
                         ┌──────────────────────┐
                         │      Next.js Web     │
                         │   Operations UI      │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │     Fastify API      │
                         │ Auth / Incidents /   │
                         │ Services / AI        │
                         └───────┬───────┬──────┘
                                 │       │
                    ┌────────────┘       └────────────┐
                    ▼                                 ▼
          ┌──────────────────┐              ┌──────────────────┐
          │    PostgreSQL    │              │      Redis       │
          │ App data + later │              │ queues + realtime│
          │ pgvector search  │              │ coordination     │
          └──────────────────┘              └──────────────────┘
```

## Planned product capabilities

- Organizations, users and RBAC
- Service registry and health states
- Incident lifecycle and timeline
- Public status pages
- Scheduled maintenance
- Background uptime checks with Redis/BullMQ
- Realtime dashboard updates
- AI incident summaries
- Probable root-cause suggestions with confidence indicators
- Suggested next actions
- Customer-facing status update generation
- Similar-incident retrieval with embeddings + pgvector
- AI-assisted postmortems
- Reliability analytics including MTTR and incident frequency

## Repository structure

```text
pulseops-ai/
├── apps/
│   ├── api/        # Fastify API
│   └── web/        # Next.js operations UI
├── .github/
│   └── workflows/  # CI
├── docker-compose.yml
├── eslint.config.mjs
├── package.json
└── tsconfig.base.json
```

## Local development

Requirements:

- Node.js 20+
- npm
- Docker + Docker Compose

Create your local environment file:

```bash
cp .env.example .env
```

Start PostgreSQL and Redis:

```bash
docker compose up -d
```

Install dependencies:

```bash
npm install
```

Run both workspaces in development mode:

```bash
npm run dev
```

The web app runs on `http://localhost:3000` and the API defaults to `http://localhost:4000`.

Health check:

```text
GET http://localhost:4000/api/health
```

## Quality checks

```bash
npm run lint
npm run typecheck
npm run build
```

## Engineering roadmap

The project is intentionally being developed through focused pull requests so each architectural capability is reviewable in isolation.

1. Project foundation
2. Authentication, organizations and RBAC
3. Service registry
4. Incident lifecycle
5. Public status pages
6. Monitoring workers
7. Realtime operations
8. AI Incident Copilot
9. Similar-incident retrieval / RAG
10. Postmortems and reliability analytics

## AI safety direction

AI output will be presented as **assistance, not authoritative diagnosis**. Root-cause suggestions will carry confidence/context, customer-facing drafts will require deliberate publication, and the system will preserve the underlying incident evidence and human-authored timeline.

---

Built by Mohammed Al-Obaido as a production-minded full-stack and applied-AI engineering project.
