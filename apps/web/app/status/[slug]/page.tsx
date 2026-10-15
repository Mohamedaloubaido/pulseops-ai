import { notFound } from "next/navigation";
import { LiveStatusRefresh } from "./live-refresh";
import styles from "./status.module.css";

type ServiceStatus =
  | "OPERATIONAL"
  | "DEGRADED"
  | "PARTIAL_OUTAGE"
  | "MAJOR_OUTAGE"
  | "MAINTENANCE";

type IncidentStatus = "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED";

type StatusData = {
  organization: {
    name: string;
    slug: string;
    title: string;
    description: string | null;
  };
  overallStatus: "OPERATIONAL" | "ISSUES_DETECTED";
  services: Array<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    status: ServiceStatus;
    updatedAt: string;
  }>;
  activeIncidents: Incident[];
  incidentHistory: Incident[];
  generatedAt: string;
};

type Incident = {
  id: string;
  title: string;
  summary: string | null;
  severity: "MINOR" | "MAJOR" | "CRITICAL";
  status: IncidentStatus;
  startedAt: string;
  resolvedAt: string | null;
  updatedAt: string;
  services: Array<{ id: string; name: string; slug: string }>;
  updates: Array<{
    id: string;
    message: string;
    status: IncidentStatus | null;
    createdAt: string;
  }>;
};

const serviceLabels: Record<ServiceStatus, string> = {
  OPERATIONAL: "Operational",
  DEGRADED: "Degraded performance",
  PARTIAL_OUTAGE: "Partial outage",
  MAJOR_OUTAGE: "Major outage",
  MAINTENANCE: "Maintenance",
};

const incidentLabels: Record<IncidentStatus, string> = {
  INVESTIGATING: "Investigating",
  IDENTIFIED: "Identified",
  MONITORING: "Monitoring",
  RESOLVED: "Resolved",
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

async function loadStatus(slug: string, apiOrigin: string): Promise<StatusData | null> {
  const response = await fetch(`${apiOrigin}/api/status/${encodeURIComponent(slug)}`, {
    cache: "no-store",
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Status API returned ${response.status}`);
  return (await response.json()) as StatusData;
}

function IncidentCard({ incident }: { incident: Incident }) {
  return (
    <article className={styles.incidentCard}>
      <div className={styles.incidentHeading}>
        <div>
          <span className={styles.severity}>{incident.severity.toLowerCase()}</span>
          <h3>{incident.title}</h3>
        </div>
        <span className={styles.incidentState}>{incidentLabels[incident.status]}</span>
      </div>

      {incident.summary ? <p className={styles.summary}>{incident.summary}</p> : null}

      {incident.services.length > 0 ? (
        <p className={styles.affected}>
          Affected: {incident.services.map((service) => service.name).join(", ")}
        </p>
      ) : null}

      {incident.updates.length > 0 ? (
        <ol className={styles.timeline}>
          {incident.updates.map((update) => (
            <li key={update.id}>
              <div className={styles.timelineMeta}>
                <span>{update.status ? incidentLabels[update.status] : "Update"}</span>
                <time dateTime={update.createdAt}>{formatTime(update.createdAt)} UTC</time>
              </div>
              <p>{update.message}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </article>
  );
}

export default async function PublicStatusPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const apiOrigin = process.env.NEXT_PUBLIC_PULSEOPS_API_URL ?? process.env.PULSEOPS_API_URL ?? "http://localhost:4000";
  const data = await loadStatus(slug, apiOrigin);
  if (!data) notFound();

  const healthy = data.overallStatus === "OPERATIONAL";

  return (
    <main className={styles.page}>
      <LiveStatusRefresh apiOrigin={apiOrigin} slug={slug} />
      <div className={styles.container}>
        <header className={styles.header}>
          <span className={styles.brand}>PULSEOPS AI</span>
          <h1>{data.organization.title}</h1>
          {data.organization.description ? <p>{data.organization.description}</p> : null}
        </header>

        <section className={`${styles.banner} ${healthy ? styles.healthy : styles.issue}`}>
          <span className={styles.bannerDot} aria-hidden="true" />
          <div>
            <strong>{healthy ? "All systems operational" : "Some systems are experiencing issues"}</strong>
            <span>Live service health for {data.organization.name}</span>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <h2>Services</h2>
            <span>{data.services.length} monitored</span>
          </div>
          <div className={styles.serviceList}>
            {data.services.map((service) => (
              <article className={styles.service} key={service.id}>
                <div>
                  <h3>{service.name}</h3>
                  {service.description ? <p>{service.description}</p> : null}
                </div>
                <span className={styles.serviceStatus} data-status={service.status}>
                  {serviceLabels[service.status]}
                </span>
              </article>
            ))}
            {data.services.length === 0 ? <p className={styles.empty}>No services published yet.</p> : null}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <h2>Active incidents</h2>
            <span>{data.activeIncidents.length}</span>
          </div>
          <div className={styles.incidentList}>
            {data.activeIncidents.length === 0 ? (
              <div className={styles.emptyPanel}>No active incidents.</div>
            ) : (
              data.activeIncidents.map((incident) => <IncidentCard incident={incident} key={incident.id} />)
            )}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <h2>Recent history</h2>
            <span>Last 30 days</span>
          </div>
          <div className={styles.incidentList}>
            {data.incidentHistory.length === 0 ? (
              <div className={styles.emptyPanel}>No recently resolved incidents.</div>
            ) : (
              data.incidentHistory.map((incident) => <IncidentCard incident={incident} key={incident.id} />)
            )}
          </div>
        </section>

        <footer className={styles.footer}>
          <span>Powered by PulseOps AI</span>
          <time dateTime={data.generatedAt}>Updated {formatTime(data.generatedAt)} UTC</time>
        </footer>
      </div>
    </main>
  );
}
