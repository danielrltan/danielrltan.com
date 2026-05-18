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
          fontFamily: "var(--font-display)",
          fontSize: 18,
          fontWeight: 600,
          color: "var(--text-lt)",
          letterSpacing: -0.2,
          lineHeight: 1.4,
        }}
      >
        Welcome to my website!
      </p>
      <p
        style={{
          marginTop: 12,
          fontSize: 13,
          lineHeight: 1.7,
          color: "var(--text-lt)",
          opacity: 0.85,
        }}
      >
        Thanks for stopping by. This whole site is a an exact replica of my real bedroom.
        Everything is fully interactive, so feel free to poke around.  
        <br />
        <br />
        I just started the devleopment of this website; so do expect some work-in-progress segments and 
        occasional performance issues here and there.
      </p>
      <p
        style={{
          marginTop: 12,
          fontSize: 13,
          lineHeight: 1.7,
          color: "var(--text-lt)",
          opacity: 0.85,
        }}
      >
        Open the icons on the desktop to dig deeper.
      </p>
      <p
        style={{
          marginTop: 20,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        more under construction
      </p>
    </div>
  );
}
