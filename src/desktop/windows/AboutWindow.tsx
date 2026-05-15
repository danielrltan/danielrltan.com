export function AboutWindow() {
  return (
    <div style={{ padding: 28, maxWidth: 560 }}>
      <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            background: "var(--accent)",
            color: "var(--text-dk)",
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            fontSize: 28,
            letterSpacing: -1,
          }}
        >
          D
        </div>
        <div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 22,
              color: "var(--text-lt)",
              letterSpacing: -0.4,
            }}
          >
            Daniel Tan
          </div>
          <div
            style={{
              marginTop: 4,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--accent)",
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            creative developer · toronto
          </div>
        </div>
      </div>
      <p
        style={{
          marginTop: 22,
          fontSize: 13,
          lineHeight: 1.7,
          color: "var(--text-lt)",
          opacity: 0.86,
        }}
      >
        Builds interactive 3D experiences, generative tools, and the
        occasional weird OS-in-a-room. Currently obsessed with how physics,
        sound, and small UI flourishes compound into things that feel
        alive — which is also what this whole site is.
      </p>
      <p
        style={{
          marginTop: 16,
          fontSize: 13,
          lineHeight: 1.7,
          color: "var(--text-lt)",
          opacity: 0.86,
        }}
      >
        Open the icons on the desktop to dig deeper.
      </p>
    </div>
  );
}
