import { useEffect, useState } from "react";
import { useWindows } from "../WindowManager";

/**
 * Bottom status strip. Shows:
 *   - left:  open-app activity dots + their labels
 *   - center: ambient session info ("idle for Xm" or "active")
 *   - right: live clock (seconds resolution) + version tag
 *
 * Inert / informational only — no controls. The fullscreen toggle
 * has moved to the top-right corner of the desktop.
 */
export function StatusBar() {
  const { windows } = useWindows();
  const [now, setNow] = useState(() => new Date());
  const [sessionStart] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const sessionSec = Math.floor((now.getTime() - sessionStart) / 1000);
  const sessionLabel =
    sessionSec < 60
      ? `${sessionSec}s`
      : sessionSec < 3600
      ? `${Math.floor(sessionSec / 60)}m`
      : `${Math.floor(sessionSec / 3600)}h ${Math.floor((sessionSec % 3600) / 60)}m`;

  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  return (
    <div
      style={{
        gridColumn: "1 / -1",
        height: 28,
        background: "var(--surface)",
        color: "var(--text-lt)",
        borderRadius: 6,
        padding: "0 12px",
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: 0.4,
        border: "1px solid var(--surface-alt)",
      }}
    >
      {/* Open apps */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {windows.length === 0 ? (
          <span style={{ color: "var(--muted)", letterSpacing: 1.5 }}>
            no apps open
          </span>
        ) : (
          windows.map((w) => (
            <span
              key={w.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: "var(--text-lt)",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  display: "inline-block",
                  boxShadow: "0 0 6px var(--accent)",
                }}
              />
              {w.id}
            </span>
          ))
        )}
      </div>

      {/* Session uptime */}
      <div
        style={{
          color: "var(--muted)",
          letterSpacing: 2,
          textTransform: "uppercase",
          fontSize: 10,
        }}
      >
        session · {sessionLabel}
      </div>

      {/* Clock + version */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 12,
        }}
      >
        <span style={{ color: "var(--text-lt)" }}>{hhmm}</span>
        <span style={{ color: "var(--muted)", letterSpacing: 0.6 }}>
          roomos v1.0
        </span>
      </div>
    </div>
  );
}
