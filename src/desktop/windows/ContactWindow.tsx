/**
 * Contact window. ASCII art scene — sky at top with socials laid
 * into it, cat sitting in the centre, grass at the bottom. Email
 * + LinkedIn are real `<a>` tags inside the `<pre>` so monospace
 * alignment is preserved while keeping the links clickable.
 *
 * Email is reassembled at runtime in `buildEmail` so the literal
 * `hello@...` string isn't part of the static HTML payload — keeps
 * naive scrapers off the address.
 */

const EMAIL_USER = "hello";
const EMAIL_DOMAIN = "danielrltan.com";
const LINKEDIN = "https://www.linkedin.com/in/danielrltan/";

const buildEmail = () => `${EMAIL_USER}@${EMAIL_DOMAIN}`;

const linkStyle: React.CSSProperties = {
  color: "var(--accent)",
  textDecoration: "underline",
  textUnderlineOffset: 2,
};

export function ContactWindow() {
  const email = buildEmail();
  return (
    <div
      style={{
        height: "100%",
        padding: 22,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        background: "var(--surface)",
      }}
    >
      <pre
        aria-label="contact"
        style={{
          margin: 0,
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          lineHeight: 1.4,
          color: "var(--text-lt)",
          letterSpacing: 0,
          whiteSpace: "pre",
          textAlign: "left",
        }}
      >
{`     .       *     .              *        .   .
   *      .            .       *       .         *

           ╭──────────────────────────────────────╮
           │ ✉  `}<a href={`mailto:${email}`} style={linkStyle}>{email}</a>{`             │
           │ in `}<a href={LINKEDIN} target="_blank" rel="noreferrer" style={linkStyle}>linkedin.com/in/danielrltan</a>{`       │
           ╰──────────────────────────────────────╯

   *           .         *          .          *
                                    .

                       /\\___/\\
                      ( ='   '= )
                       )  ___  (
                      (___( )___)
                          " "
   ───────────────────────────────────────────────
   ~ '~~  ~~ '' ~~  '~ ~~ '' ~~  ~' ~~ '' ~~  ~~ '~`}
      </pre>
    </div>
  );
}
