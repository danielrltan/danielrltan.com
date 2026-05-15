import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

interface Line {
  kind: "in" | "out";
  text: string;
}

const NEOFETCH = [
  "      _____      ",
  "     /     \\     ",
  "    /_______\\    ",
  "    |  ▢  ▢ |    ",
  "    |    █   |   ",
  "    |________|   ",
  "",
  "  os      RoomOS 1.0",
  "  shell   zsh 5.9",
  "  wm      three.js r170",
  "  theme   warm-amber",
  "  pkgs    42",
];

function exec(input: string): string[] | "clear" {
  const cmd = input.trim();
  if (!cmd) return [];
  switch (cmd.toLowerCase()) {
    case "help":
      return [
        "available commands:",
        "  about      bio + what i do",
        "  projects   list of recent work",
        "  contact    socials + email",
        "  neofetch   system info",
        "  clear      wipe the screen",
        "  help       you're looking at it",
      ];
    case "about":
      return [
        "daniel tan",
        "creative developer · toronto",
        "",
        "i build interactive 3d sites, generative tools,",
        "and the occasional weird os-in-a-room.",
      ];
    case "projects":
      return [
        "1. room os                (interactive portfolio)",
        "2. generative posters     (glsl, web)",
        "3. audio sketches         (web audio)",
        "4. tiling wm rice         (hyprland dotfiles)",
        "5. field notes            (mdx blog)",
        "6. synth studies          (rust, wasm)",
      ];
    case "contact":
      return [
        "email     hello@danieltan.dev",
        "github    /danielrltan",
        "linkedin  /in/danielrltan",
        "x         /danielrltan",
      ];
    case "neofetch":
      return NEOFETCH;
    case "clear":
      return "clear";
    default:
      return [`${cmd}: command not found. try \`help\`.`];
  }
}

export function TerminalWindow() {
  const [lines, setLines] = useState<Line[]>([
    { kind: "out", text: "welcome to roomos terminal. type `help`." },
  ]);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const submit = () => {
    const result = exec(input);
    const next: Line[] = [...lines, { kind: "in", text: input }];
    if (result === "clear") {
      setLines([]);
    } else {
      for (const text of result) next.push({ kind: "out", text });
      setLines(next);
    }
    setInput("");
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      ref={scrollerRef}
      onClick={() => inputRef.current?.focus()}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 13,
        lineHeight: 1.6,
        color: "var(--text-lt)",
        padding: 22,
        height: "100%",
        overflow: "auto",
        cursor: "text",
      }}
    >
        {lines.map((l, i) => (
          <div key={i} style={{ whiteSpace: "pre" }}>
            {l.kind === "in" ? (
              <>
                <span style={{ color: "var(--muted)" }}>daniel@room</span>
                <span style={{ color: "var(--text-lt)" }}> ~ </span>
                <span style={{ color: "var(--accent)" }}>$ </span>
                <span>{l.text}</span>
              </>
            ) : (
              <span style={{ color: "var(--text-lt)", opacity: 0.85 }}>
                {l.text}
              </span>
            )}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ color: "var(--muted)" }}>daniel@room</span>
          <span style={{ color: "var(--text-lt)" }}> ~ </span>
          <span style={{ color: "var(--accent)", marginRight: 4 }}>$</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text-lt)",
              fontFamily: "inherit",
              fontSize: "inherit",
              padding: 0,
              caretColor: "var(--accent)",
            }}
          />
      </div>
    </div>
  );
}
