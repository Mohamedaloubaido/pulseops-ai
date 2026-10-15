"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { apiRequest } from "../../lib/api";
import styles from "./login.module.css";

type AuthResponse = {
  token: string;
  expiresAt: string;
  user: { id: string; name: string; email: string };
  organization?: { id: string; name: string; slug: string };
};

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const payload =
        mode === "login"
          ? { email, password }
          : { name, organizationName, email, password };
      const result = await apiRequest<AuthResponse>(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      localStorage.setItem("pulseops_token", result.token);
      localStorage.setItem("pulseops_session_expires", result.expiresAt);
      router.push("/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to continue");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.brandPanel}>
        <Link href="/" className={styles.brand}>PULSEOPS AI</Link>
        <div className={styles.pitch}>
          <span className={styles.eyebrow}>INCIDENT OPERATIONS</span>
          <h1>Move from signal to resolution with one operational view.</h1>
          <p>
            Monitor service health, coordinate incidents, communicate status, and use an evidence-grounded AI copilot without leaving the workflow.
          </p>
        </div>
        <div className={styles.signalGrid}>
          <div><strong>Realtime</strong><span>Redis-backed event streams</span></div>
          <div><strong>AI-assisted</strong><span>Analysis and postmortems</span></div>
          <div><strong>Production-minded</strong><span>RBAC, monitoring and auditability</span></div>
        </div>
      </section>

      <section className={styles.formPanel}>
        <div className={styles.formWrap}>
          <div className={styles.tabs}>
            <button className={mode === "login" ? styles.activeTab : ""} onClick={() => setMode("login")} type="button">Sign in</button>
            <button className={mode === "register" ? styles.activeTab : ""} onClick={() => setMode("register")} type="button">Create workspace</button>
          </div>

          <div className={styles.heading}>
            <span>{mode === "login" ? "WELCOME BACK" : "START OPERATING"}</span>
            <h2>{mode === "login" ? "Open your incident workspace" : "Create your PulseOps workspace"}</h2>
          </div>

          <form className={styles.form} onSubmit={submit}>
            {mode === "register" ? (
              <>
                <label>
                  Your name
                  <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} required placeholder="Mohammed Al-Obaido" />
                </label>
                <label>
                  Organization
                  <input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} minLength={2} required placeholder="Acme Engineering" />
                </label>
              </>
            ) : null}
            <label>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="you@company.com" />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={mode === "register" ? 10 : 1} required placeholder="••••••••••" />
            </label>
            {error ? <div className={styles.error}>{error}</div> : null}
            <button className={styles.submit} disabled={loading} type="submit">
              {loading ? "Connecting…" : mode === "login" ? "Sign in to PulseOps" : "Create workspace"}
            </button>
          </form>

          <p className={styles.note}>Sessions use opaque bearer tokens; passwords are never stored in plaintext.</p>
        </div>
      </section>
    </main>
  );
}
