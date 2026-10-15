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

  const loadWorkspace = useCallback(async (authToken: string, orgId: string) => {
    if (!orgId) return;
    const [serviceResult, incidentResult] = await Promise.all([
      apiRequest<ServiceResponse>(`/api/organizations/${orgId}/services`, {}, authToken),
      apiRequest<IncidentResponse>(`/api/organizations/${orgId}/incidents`, {}, authToken),
    ]);
    setServices(serviceResult.services);
    setIncidents(incidentResult.incidents);
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
          <article><span>Active incidents</span><strong>{activeIncidents.length}</strong><small>{activeIncidents.filter((item) => item.severity === "CRITICAL").length} critical</small></article>
          <article><span>Monitored services</span><strong>{services.length}</strong><small>Across this workspace</small></article>
          <article><span>AI readiness</span><strong>{selectedIncident ? "Ready" : "Idle"}</strong><small>{artifact ? `Last: ${artifact.model}` : "Evidence-grounded analysis"}</small></article>
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
