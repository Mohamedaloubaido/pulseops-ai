const pillars = [
  {
    title: "Realtime operations",
    body: "Track services, incidents and recovery progress without refreshing the dashboard.",
  },
  {
    title: "AI incident copilot",
    body: "Summarize incidents, suggest likely causes and draft customer-facing updates.",
  },
  {
    title: "Public status pages",
    body: "Publish clear service health, incident history and scheduled maintenance.",
  },
];

export default function Home() {
  return (
    <main className="shell">
      <section className="hero">
        <span className="eyebrow">PULSEOPS AI</span>
        <h1>Incident operations, with AI built into the workflow.</h1>
        <p>
          A production-minded SaaS for service monitoring, incident response,
          status communication and postmortems.
        </p>
        <div className="statusRow">
          <span className="statusDot" />
          Foundation environment ready
        </div>
      </section>

      <section className="grid" aria-label="Platform pillars">
        {pillars.map((pillar) => (
          <article className="card" key={pillar.title}>
            <h2>{pillar.title}</h2>
            <p>{pillar.body}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
