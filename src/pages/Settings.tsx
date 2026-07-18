import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, useGcalStatus, useProjects } from "../api";
import { getThemePref, setThemePref, type ThemePref } from "../theme";

export default function Settings() {
  const gcal = useGcalStatus();
  const archived = useProjects(true);
  const qc = useQueryClient();
  const [pref, setPref] = useState<ThemePref>(getThemePref());
  const [calId, setCalId] = useState("");
  const [tz, setTz] = useState("");
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (gcal.data) {
      setCalId(gcal.data.calendar_id ?? "");
      setTz(gcal.data.timezone);
    }
  }, [gcal.data]);

  function theme(p: ThemePref) {
    setThemePref(p);
    setPref(p);
  }

  async function saveConfig() {
    await api("/api/gcal/config", { method: "PUT", body: JSON.stringify({ calendar_id: calId, timezone: tz }) });
    void qc.invalidateQueries({ queryKey: ["gcal"] });
  }

  async function syncNow() {
    setSyncing(true);
    try {
      await api("/api/gcal/sync", { method: "POST" });
    } finally {
      setSyncing(false);
      void qc.invalidateQueries({ queryKey: ["gcal"] });
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login";
  }

  const err = gcal.data?.error;

  return (
    <div>
      <h1>Settings</h1>

      <section className="card settings-section">
        <h2>Theme</h2>
        <div className="settings-row">
          {(["system", "light", "dark"] as const).map((p) => (
            <button key={p} className={`chip ${pref === p ? "on" : ""}`} onClick={() => theme(p)}>{p}</button>
          ))}
        </div>
      </section>

      <section className="card settings-section">
        <h2>Google Calendar</h2>
        <p style={{ fontSize: 13, color: "var(--tx3)" }}>
          Share a dedicated calendar with the service account below ("make changes to events"),
          then paste its calendar ID here.
        </p>
        <div className="settings-row">
          <span style={{ fontSize: 13 }}>Service account:</span>
          <code style={{ fontSize: 12 }}>{gcal.data?.client_email ?? "secrets not configured"}</code>
        </div>
        <div className="settings-row">
          <input className="input" style={{ maxWidth: 340 }} placeholder="Calendar ID (…@group.calendar.google.com)"
            value={calId} onChange={(e) => setCalId(e.target.value)} />
          <input className="input" style={{ maxWidth: 160 }} placeholder="Timezone"
            value={tz} onChange={(e) => setTz(e.target.value)} />
          <button className="btn" onClick={saveConfig}>Save</button>
        </div>
        <div className="settings-row">
          <button className="btn" onClick={syncNow} disabled={syncing}>{syncing ? "Syncing…" : "Sync now"}</button>
          {gcal.data && (gcal.data.dirty_count > 0 || gcal.data.orphan_count > 0) && (
            <span style={{ fontSize: 13, color: "var(--tx3)" }}>
              {gcal.data.dirty_count} pending · {gcal.data.orphan_count} orphaned
            </span>
          )}
        </div>
        {err && (
          <p className={err.class === "auth" ? "gcal-error-auth" : "gcal-error-transient"}>
            {err.class === "auth"
              ? `Authentication broken — needs action: ${err.message}`
              : `Sync failing (will retry): ${err.message}`}
          </p>
        )}
      </section>

      {(archived.data?.length ?? 0) > 0 && (
        <section className="card settings-section">
          <h2>Archived projects</h2>
          {archived.data!.map((p) => (
            <div key={p.id} className="settings-row">
              <span>{p.icon ? `${p.icon} ` : ""}{p.name}</span>
              <button className="btn" onClick={() =>
                api(`/api/projects/${p.id}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) })
                  .then(() => { void qc.invalidateQueries({ queryKey: ["projects"] }); })}>
                Unarchive
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="card settings-section">
        <h2>Session</h2>
        <button className="btn" onClick={logout}>Log out</button>
      </section>
    </div>
  );
}
