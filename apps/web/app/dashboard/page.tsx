"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../lib/api";
import styles from "./dashboard.module.css";

type Organization = { id: string; name: string; slug: string; role: "OWNER" | "ADMIN" | "RESPONDER" | "VIEWER" };
type ServiceStatus = "OPERATIONAL" | "DEGRADED" | "PARTIAL_OUTAGE" | "MAJOR_OUTAGE" | "MAINTENANCE";
type Service = { id: string; name: string; slug: string; description: string | null; status: ServiceStatus; updatedAt: string };
type IncidentStatus = "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED";
type Incident = {
  id: string;
  title: string;
  summary: string | null;
  severity: "MINOR" | "MAJOR" | "CRITICAL";
  status: IncidentStatus;
  startedAt: string;
  services: Array<{ service: Service }>;
};
type AiArtifact = { id: string; type: "INCIDENT_ANALYSIS" | "POSTMORTEM"; payload: Record<string, unknown>; model: string; createdAt: string };
type ReliabilityResponse = {
  window: { days: number; from: string; to: string };
  incidents: {
    total: number;
    active: number;
    resolved: number;
    severity: { MINOR: number; MAJOR: number; CRITICAL: number };
    meanTimeToResolveMinutes: number | null;
  };
  monitoring: {
    checks: number;
    upChecks: number;
    downChecks: number;
    checkSuccessRate: number | null;
    averageResponseTimeMs: number | null;
  };
  services: Array<{
    id: string;
    name: string;
    status: ServiceStatus;
    incidentCount: number;
    activeIncidentCount: number;
    checks: number;
    failedChecks: number;
    checkSuccessRate: number | null;
  }>;
};

type OrganizationResponse = { organizations: Organization[] };
type ServiceResponse = { services: Service[] };
type IncidentResponse = { incidents: Incident[] };
type AiArtifactResponse = { artifacts: AiArtifact[] };
type AiGenerateResponse = { artifact: AiArtifact; disclaimer: string };

const statusLabel: Record<ServiceStatus, string> = {
  OPERATIONAL: "Operational",
  DEGRADED: "Degraded",
  PARTIAL_OUTAGE: "Partial outage",
  MAJOR_OUTAGE: "Major outage",
  MAINTENANCE: "Maintenance",
};

const incidentLabel: Record<IncidentStatus, string> = {
  INVESTIGATING: "Investigating",
  IDENTIFIED: "Identified",
  MONITORING: "Monitoring",
  RESOLVED: "Resolved",
};

function relativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.round(diff / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatMinutes(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  if (value < 60) return `${value}m`;
  const hours = value / 60;
  return `${hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10}h`;
}

function compactArtifact(artifact: AiArtifact | null) {
  if (!artifact) return null;
  const payload = artifact.payload as {
    summary?: string;
    probableCause?: string;
    confidence?: number;
    suggestedActions?: string[];
    customerUpdate?: string;
  };
  return payload;
}

export default function DashboardPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [services, setServices] = useState<Service[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [reliability, setReliability] = useState<ReliabilityResponse | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<AiArtifact | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const selectedOrganization = organizations.find((item) => item.id === organizationId) ?? null;
  const selectedIncident = incidents.find((item) => item.id === selectedIncidentId) ?? null;
  const latestAnalysis = compactArtifact(artifact);

  const activeIncidents = useMemo(() => incidents.filter((incident) => incident.status !== "RESOLVED"), [incidents]);
  const unhealthyServices = useMemo(() => services.filter((service) => service.status !== "OPERATIONAL"), [services]);
  const riskiestService = reliability?.services[0] ?? null;

  const loadWorkspace = useCallback(async (authToken: string, orgId: string) => {
    if (!orgId) return;
    const [serviceResult, incidentResult, reliabilityResult] = await Promise.all([
      apiRequest<ServiceResponse>(`/api/organizations/${orgId}/services`, {}, authToken),
      apiRequest<IncidentResponse>(`/api/organizations/${orgId}/incidents`, {}, authToken),
      apiRequest<ReliabilityResponse>(`/api/organizations/${orgId}/analytics/reliability?days=30`, {}, authToken),
    ]);
    setServices(serviceResult.services);
    setIncidents(incidentResult.incidents);
    setReliability(reliabilityResult);
    setSelectedIncidentId((current) => {
      if (current && incidentResult.incidents.some((incident) => incident.id === current)) return current;
      return incidentResult.incidents.find((incident) => incident.status !== "RESOLVED")?.id ?? incidentResult.incidents[0]?.id ?? null;
    });
    setLastRefresh(new Date());
  }, []);

  useEffect(() => {
    const authToken = localStorage.getItem("pulseops_token");
    if (!authToken) {
      router.replace("/login");
      return;
    }
    setToken(authToken);

    void (async () => {
      try {
        const result = await apiRequest<OrganizationResponse>("/api/organizations", {}, authToken);
        setOrganizations(result.organizations);
        const first = result.organizations[0]?.id ?? "";
        setOrganizationId(first);
        if (first) await loadWorkspace(authToken, first);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Unable to load workspace";
        setError(message);
        if (message.toLowerCase().includes("authentication") || message.toLowerCase().includes("session")) {
          localStorage.removeItem("pulseops_token");
          router.replace("/login");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [loadWorkspace, router]);

  useEffect(() => {
    if (!token || !organizationId || loading) return;
    const timer = window.setInterval(() => {
      void loadWorkspace(token, organizationId).catch(() => undefined);
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [token, organizationId, loading, loadWorkspace]);

  useEffect(() => {
    if (!token || !organizationId || !selectedIncidentId) {
      setArtifact(null);
      return;
    }
    void apiRequest<AiArtifactResponse>(
      `/api/organizations/${organizationId}/incidents/${selectedIncidentId}/ai`,
      {},
      token,
    )
      .then((result) => setArtifact(result.artifacts.find((item) => item.type === "INCIDENT_ANALYSIS") ?? null))
      .catch(() => setArtifact(null));
  }, [token, organizationId, selectedIncidentId]);

  async function changeOrganization(nextId: string) {
    setOrganizationId(nextId);
    setArtifact(null);
    setReliability(null);
    setError(null);
    if (!token) return;
    setLoading(true);
    try {
      await loadWorkspace(token, nextId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to switch workspace");
    } finally {
      setLoading(false);
    }
  }

  async function runAiAnalysis() {
    if (!token || !organizationId || !selectedIncidentId) return;
    setAiLoading(true);
    setError(null);
    try {
      const result = await apiRequest<AiGenerateResponse>(
        `/api/organizations/${organizationId}/incidents/${selectedIncidentId}/ai/analyze`,
        { method: "POST" },
        token,
      );
      setArtifact(result.artifact);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI analysis failed");
    } finally {
      setAiLoading(false);
    }
  }

  async function refresh() {
    if (!token || !organizationId) return;
    setLoading(true);
    setError(null);
    try {
      await loadWorkspace(token, organizationId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Refresh failed");
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    if (token) {
      await apiRequest<void>("/api/auth/logout", { method: "POST" }, token).catch(() => undefined);
    }
    localStorage.removeItem("pulseops_token");
    localStorage.removeItem("pulseops_session_expires");
    router.replace("/login");
  }

  return (
    <main className={styles.page}>
      <aside className={styles.sidebar}>
        <div>
          <div className={styles.brand}>PULSEOPS AI</div>
          <div className={styles.workspaceLabel}>Workspace</div>
          <select value={organizationId} onChange={(event) => void changeOrganization(event.target.value)} className={styles.orgSelect}>
            {organizations.map((organization) => <option value={organization.id} key={organization.id}>{organization.name}</option>)}
          </select>
          {selectedOrganization ? <span className={styles.role}>{selectedOrganization.role.toLowerCase()}</span> : null}
        </div>
        <nav className={styles.nav}>
          <span className={styles.navActive}>Overview</span>
          <span>Incidents <b>{activeIncidents.length}</b></span>
          <span>Services <b>{services.length}</b></span>
          <span>Reliability</span>
          <span>AI Copilot</span>
        </nav>
        <button className={styles.logout} onClick={() => void logout()}>Sign out</button>
      </aside>

      <section className={styles.content}>
        <header className={styles.topbar}>
          <div>
            <span className={styles.kicker}>OPERATIONS OVERVIEW</span>
            <h1>{selectedOrganization?.name ?? "PulseOps workspace"}</h1>
          </div>
          <div className={styles.topActions}>
            <span>{lastRefresh ? `Synced ${relativeTime(lastRefresh.toISOString())}` : "Connecting…"}</span>
            <button onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
          </div>
        </header>

        {error ? <div className={styles.error}>{error}</div> : null}

        <section className={styles.metrics}>
          <article><span>Service health</span><strong>{services.length ? Math.round(((services.length - unhealthyServices.length) / services.length) * 100) : 100}%</strong><small>{unhealthyServices.length ? `${unhealthyServices.length} need attention` : "All systems nominal"}</small></article>
          <article><span>Active incidents</span><strong>{activeIncidents.length}</strong><small>{reliability ? `${reliability.incidents.total} in last ${reliability.window.days}d` : "30-day window"}</small></article>
          <article><span>Mean time to resolve</span><strong>{formatMinutes(reliability?.incidents.meanTimeToResolveMinutes)}</strong><small>{reliability ? `${reliability.incidents.resolved} resolved incidents` : "Waiting for analytics"}</small></article>
          <article><span>Check success</span><strong>{reliability?.monitoring.checkSuccessRate === null || reliability?.monitoring.checkSuccessRate === undefined ? "—" : `${reliability.monitoring.checkSuccessRate}%`}</strong><small>{reliability ? `${reliability.monitoring.checks} checks · ${reliability.monitoring.downChecks} failed` : "30-day monitoring window"}</small></article>
        </section>

        <section className={styles.twoColumn}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}><div><span>SERVICE REGISTRY</span><h2>Current health</h2></div><b>{services.length}</b></div>
            <div className={styles.serviceList}>
              {services.map((service) => (
                <article key={service.id} className={styles.serviceRow}>
                  <div className={styles.serviceIdentity}><span className={styles.statusDot} data-status={service.status} /><div><strong>{service.name}</strong><small>{service.description ?? service.slug}</small></div></div>
                  <div className={styles.serviceMeta}><span data-status={service.status}>{statusLabel[service.status]}</span><small>{relativeTime(service.updatedAt)}</small></div>
                </article>
              ))}
              {!services.length && !loading ? <div className={styles.empty}>No services yet. Add your first service through the API.</div> : null}
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}><div><span>INCIDENT QUEUE</span><h2>Response timeline</h2></div><b>{incidents.length}</b></div>
            <div className={styles.incidentList}>
              {incidents.map((incident) => (
                <button key={incident.id} className={`${styles.incidentRow} ${selectedIncidentId === incident.id ? styles.selectedIncident : ""}`} onClick={() => setSelectedIncidentId(incident.id)}>
                  <div><span className={styles.severity} data-severity={incident.severity}>{incident.severity}</span><strong>{incident.title}</strong><small>{incident.services.map(({ service }) => service.name).join(", ") || "No service linked"}</small></div>
                  <div className={styles.incidentMeta}><span>{incidentLabel[incident.status]}</span><small>{relativeTime(incident.startedAt)}</small></div>
                </button>
              ))}
              {!incidents.length && !loading ? <div className={styles.empty}>No incidents recorded. Your queue is clear.</div> : null}
            </div>
          </div>
        </section>

        {reliability ? (
          <section className={styles.copilot}>
            <div className={styles.copilotHeader}>
              <div><span>30-DAY RELIABILITY SNAPSHOT</span><h2>{riskiestService ? `${riskiestService.name} has the highest incident load` : "Reliability signals are healthy"}</h2></div>
            </div>
            <div className={styles.copilotGrid}>
              <article><span>Incident mix</span><p>{reliability.incidents.severity.CRITICAL} critical · {reliability.incidents.severity.MAJOR} major · {reliability.incidents.severity.MINOR} minor</p></article>
              <article><span>Monitoring latency</span><p>{reliability.monitoring.averageResponseTimeMs === null ? "No check latency yet." : `${reliability.monitoring.averageResponseTimeMs} ms average response time across recorded checks.`}</p></article>
              <article><span>Highest incident load</span><p>{riskiestService ? `${riskiestService.name}: ${riskiestService.incidentCount} incidents, ${riskiestService.failedChecks} failed checks.` : "No incident history in this window."}</p></article>
              <article><span>Resolved workload</span><p>{reliability.incidents.resolved} of {reliability.incidents.total} incidents resolved in the selected 30-day window.</p></article>
            </div>
          </section>
        ) : null}

        <section className={styles.copilot}>
          <div className={styles.copilotHeader}>
            <div><span>AI INCIDENT COPILOT</span><h2>{selectedIncident ? selectedIncident.title : "Select an incident to analyze"}</h2></div>
            <button disabled={!selectedIncident || aiLoading} onClick={() => void runAiAnalysis()}>{aiLoading ? "Analyzing evidence…" : artifact ? "Run fresh analysis" : "Analyze incident"}</button>
          </div>

          {selectedIncident ? (
            <div className={styles.copilotGrid}>
              <article><span>Summary</span><p>{latestAnalysis?.summary ?? selectedIncident.summary ?? "Run the copilot to generate a grounded incident summary."}</p></article>
              <article><span>Probable cause</span><p>{latestAnalysis?.probableCause ?? "No AI hypothesis generated yet."}</p>{typeof latestAnalysis?.confidence === "number" ? <strong>{latestAnalysis.confidence}% confidence</strong> : null}</article>
              <article><span>Suggested actions</span>{latestAnalysis?.suggestedActions?.length ? <ol>{latestAnalysis.suggestedActions.map((action) => <li key={action}>{action}</li>)}</ol> : <p>Actions appear here after analysis.</p>}</article>
              <article><span>Customer update draft</span><p>{latestAnalysis?.customerUpdate ?? "A publish-ready draft will appear here, but publication always remains a human decision."}</p></article>
            </div>
          ) : (
            <div className={styles.emptyLarge}>Create or select an incident to activate the copilot.</div>
          )}
          <p className={styles.disclaimer}>AI output is advisory and must be verified against operational evidence before action or publication.</p>
        </section>
      </section>
    </main>
  );
}
