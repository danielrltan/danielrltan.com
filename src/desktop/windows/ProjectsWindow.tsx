export function ProjectsWindow() {
  return (
    <div
      style={{
        padding: 22,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        textAlign: "center",
        gap: 8,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        projects
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: 22,
          color: "var(--text-lt)",
          letterSpacing: -0.3,
        }}
      >
        under construction
      </div>
    </div>
  );
}
