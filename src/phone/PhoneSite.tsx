import { Fragment, useEffect, useRef } from "react";
import { MAC_PROJECTS, liveLinkLabel } from "../macintosh/projects";
import { STINTS } from "../portfolio/workData";
import {
  ENTRIES,
  TOTAL_GRANTS_USD,
  TOTAL_LEADERSHIP,
  TOTAL_WINS,
  formatMoney,
} from "../portfolio/honoursData";
import { HOBBIES } from "../other/hobbies";
import { SOCIALS } from "../socials";
import { ensureLenis } from "../scroll";
import { track } from "../analytics";
import "./phone.css";

/**
 * The phone site (<=600px wide, decided once at mount in App.tsx). The live
 * signature hero stays on top in App's fixed hero layer (heroWipe's scrubbed
 * fade); everything after it is this page: one fixed WebGL stage behind the
 * whole scroll (stage.ts) whose camera flies between Daniel's objects, sharp
 * white sheets over it that leave windows open where an object is the
 * subject, and a bottom dock of section keys (dock.ts).
 *
 * Every stage window (.ph-win[data-shot]) names its camera shot; a section
 * that changes station opens with a full-bleed transit gap (.ph-transit)
 * where that flight plays, BEFORE its header. Lab: .scratch/mobile-redesign
 * (m05). Classes are ph-* so the desktop CSS can't reach them.
 */

const RESUME = "/resume/Daniel_Tan_Resume.pdf";
const EMAIL = "hello@danielrltan.com";
const SECTIONS = ["Hero", "About", "Projects", "Experience", "Some interests", "The trophy wall", "Recents", "Contact"];
const pad2 = (n: number) => String(n).padStart(2, "0");

const outbound = (url: string, context: string) => () => track("outbound_link", { url, context });

function Head({ n, title }: { n: number; title: string }) {
  return (
    <header className="ph-head ph-opaque">
      <span className="ph-num">{pad2(n)}</span>
      <h2>{title}</h2>
    </header>
  );
}

/** Giant item counter + the ticks that mark where this item sits. */
function Counter({ i, n }: { i: number; n: number }) {
  return (
    <div className="ph-ctr-row">
      <p className="ph-ctr">
        <b>{pad2(i + 1)}</b>
        <span>/ {pad2(n)}</span>
      </p>
      <div className="ph-ticks" aria-hidden>
        {Array.from({ length: n }, (_, k) => (
          <i key={k} className={k === i ? "ph-on" : undefined} />
        ))}
      </div>
    </div>
  );
}

function Arrow() {
  return <i aria-hidden>↗</i>;
}

const FEATURED = ENTRIES.filter((e) => e.featured);
const OTHERS = ENTRIES.filter((e) => !e.featured);
/** The small grey line under an "other" honour: its money/context, else the org or kind. */
const otherNote = (e: (typeof ENTRIES)[number]) =>
  e.context ??
  (e.category === "Grant" ? "grant" : e.category === "Leadership" ? (e.blurb ?? "").replace(/\.$/, "") : "");

export default function PhoneSite() {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Native scroll on touch; installs the loader lock (html.loading-active).
    ensureLenis();
    const root = rootRef.current;
    if (!root) return;
    let disposed = false;
    let dispose: (() => void) | null = null;
    void Promise.all([import("./stage"), import("./dock")]).then(([stage, dock]) => {
      if (disposed) return;
      const a = stage.installStage(root);
      const b = dock.installDock(root);
      dispose = () => {
        a();
        b();
      };
    });
    return () => {
      disposed = true;
      dispose?.();
    };
  }, []);

  return (
    <div className="ph-root" ref={rootRef}>
      <canvas className="ph-stage" aria-hidden />
      <main className="ph-site">
        {/* 00: the hero itself is App's fixed layer; this is its first screen. */}
        <section id="s00" className="ph-sec" data-sec="0" data-ground="orange">
          <div className="ph-win ph-hero" aria-hidden />
        </section>

        <section id="s01" className="ph-sec" data-sec="1" data-ground="light">
          <div className="ph-win ph-transit" style={{ ["--h" as string]: "70svh" }} aria-hidden />
          <Head n={1} title="About" />
          <div className="ph-win ph-room" data-shot="room">
            <p className="ph-callout ph-label">
              my room in real life!
              <svg viewBox="0 0 10 10" aria-hidden>
                <path fill="currentColor" d="M8 0h2v2H8zM6 2h2v2H6zM4 4h2v2H4zM2 6h2v2H2zM0 4h2v6H0zM0 8h6v2H0z" />
              </svg>
            </p>
          </div>
          <div className="ph-sheet ph-intro ph-dz">
            <figure className="ph-portrait">
              <img src="/images/Me.jpg" width={800} height={800} alt="Portrait of Daniel Tan" loading="lazy" decoding="async" />
              <figcaption>
                <b>
                  Daniel <span>Tan</span>
                </b>
                <span className="ph-label-sm ph-muted">Software developer / Toronto</span>
                <span className="ph-meta ph-muted">Software Engineer / Designer</span>
              </figcaption>
            </figure>
            <p className="ph-lede">
              I&rsquo;m Daniel, a <em>software developer</em> in Toronto who likes building the parts of products that{" "}
              <em>feel alive</em>. Right now that&rsquo;s <em>AI tooling</em>, agentic systems, and interactive 3D on the web.
            </p>
          </div>
          <div className="ph-sheet ph-facts ph-dzb">
            <dl className="ph-spec">
              <div className="ph-spec-row">
                <dt className="ph-label-sm">currently</dt>
                <dd>
                  <b>HBA Candidate</b>
                  <a
                    className="ph-meta ph-lnk"
                    href="https://www.ivey.uwo.ca/hba/"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={outbound("https://www.ivey.uwo.ca/hba/", "about")}
                  >
                    @ Ivey Business School
                  </a>
                </dd>
              </div>
              <div className="ph-spec-row">
                <dt className="ph-label-sm">exploring</dt>
                <dd>
                  <b>Gaussian splatting</b>
                  <span className="ph-tags">
                    <span>Splatting</span>
                    <span>Semantic segmentation</span>
                  </span>
                </dd>
              </div>
              <div className="ph-spec-row">
                <dt className="ph-label-sm">studying</dt>
                <dd>
                  <b>Computer Science + Ivey Business School</b>
                  <span className="ph-meta ph-muted">Western University / dual degree</span>
                </dd>
              </div>
              <div className="ph-spec-row">
                <dt className="ph-label-sm">location</dt>
                <dd>
                  <b>Toronto, Canada</b>
                  <span className="ph-meta ph-muted">EST · London, ON · 43.01 N / 81.27 W</span>
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section id="s02" className="ph-sec" data-sec="2" data-ground="grey">
          <div className="ph-win ph-transit" style={{ ["--h" as string]: "50svh" }} aria-hidden />
          <Head n={2} title="Projects" />
          {MAC_PROJECTS.map((p, i) => {
            const [date, stack] = p.meta.split(" · ");
            const last = i === MAC_PROJECTS.length - 1;
            return (
              <Fragment key={p.id}>
                <div className="ph-win ph-mac" data-shot={`mac${i}`} data-ch={i} />
                <article className={`ph-sheet ph-proj ph-dz${last ? "" : " ph-dzb"}`}>
                  <Counter i={i} n={MAC_PROJECTS.length} />
                  <p className="ph-meta ph-muted ph-date">{date}</p>
                  <h3>{p.title}</h3>
                  <p className="ph-stack">{stack}</p>
                  <p className="ph-body">{p.short}</p>
                  <p className="ph-links">
                    {p.liveHref && (
                      <a
                        className="ph-btn ph-btn-o"
                        href={p.liveHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => track("project_link", { project: p.title, type: "live" })}
                      >
                        {liveLinkLabel(p.liveHref)} <Arrow />
                      </a>
                    )}
                    {p.repoHref && (
                      <a
                        className="ph-btn"
                        href={p.repoHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => track("project_link", { project: p.title, type: "repo" })}
                      >
                        Source <Arrow />
                      </a>
                    )}
                  </p>
                </article>
              </Fragment>
            );
          })}
          <div className="ph-sheet ph-skills">
            <p className="ph-label-sm ph-acc">skills</p>
            <ul className="ph-chips">
              {["React", "TypeScript", "Three.js", "R3F", "Python", "FastAPI", "GSAP", "Blender", "Figma", "MongoDB", "Docker", "GLSL"].map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </section>

        <section id="s03" className="ph-sec" data-sec="3" data-ground="grey">
          <Head n={3} title="Experience" />
          {STINTS.map((s, i) => {
            const [from, to] = s.pull.metric.split(/\s*→\s*/);
            return (
              <article key={s.where} className={`ph-sheet ph-role${i === 0 ? " ph-dz" : ""}`}>
                <Counter i={i} n={STINTS.length} />
                <p className="ph-wc-top">
                  <span className="ph-wc-y">{s.year}</span>
                  <span className="ph-label-sm ph-muted">{s.brand}</span>
                </p>
                <h3>{s.where}</h3>
                <p className="ph-metric">
                  <span>{from}</span>
                  <span>→ {to}</span>
                </p>
                <p className="ph-body">{s.pull.caption}</p>
                <p className="ph-wc-meta ph-meta">
                  {s.role && <span>{s.role}</span>}
                  {s.location && <span>{s.location}</span>}
                  <span>{s.when}</span>
                </p>
              </article>
            );
          })}
          <div className="ph-sheet ph-after ph-dzb">
            <a
              className="ph-btn ph-btn-ink"
              href={RESUME}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track("resume_download", { context: "work" })}
            >
              Full résumé <Arrow />
            </a>
          </div>
        </section>

        <section id="s04" className="ph-sec" data-sec="4" data-ground="light">
          <div className="ph-win ph-transit" style={{ ["--h" as string]: "55svh" }} aria-hidden />
          <Head n={4} title="Some interests" />
          <div className="ph-win ph-play" data-shot="props">
            <div className="ph-play-pin">
              <p className="ph-play-name" aria-live="polite">
                {HOBBIES[0].label}
              </p>
            </div>
          </div>
          <div className="ph-sheet ph-interests ph-dz ph-dzb">
            <ol className="ph-ilist">
              {HOBBIES.map((h, i) => (
                <li key={h.id}>
                  <button type="button" data-k={i}>
                    <span className="ph-k-n">{pad2(i + 1)}</span>
                    <span className="ph-k-t">{h.label}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="s05" className="ph-sec" data-sec="5" data-ground="light">
          <div className="ph-win ph-transit" style={{ ["--h" as string]: "50svh" }} aria-hidden />
          <Head n={5} title="The trophy wall" />
          <div className="ph-win ph-podium" data-shot="podium" />
          <div className="ph-sheet ph-totals ph-dz">
            <dl className="ph-tots">
              <div>
                <dt>{formatMoney(TOTAL_GRANTS_USD)}</dt>
                <dd className="ph-meta">in awards &amp; funding</dd>
              </div>
              <div>
                <dt>{TOTAL_WINS}</dt>
                <dd className="ph-meta">competition placements</dd>
              </div>
              <div>
                <dt>{TOTAL_LEADERSHIP}</dt>
                <dd className="ph-meta">leadership roles</dd>
              </div>
            </dl>
          </div>
          {FEATURED.map((e) => (
            <article key={e.title} className="ph-sheet ph-hcard">
              <p className="ph-hc-m">
                <span className="ph-label-sm">{e.category}</span>
                <span className="ph-meta">{e.context}</span>
              </p>
              <p className="ph-hc-r">{e.metric}</p>
              <h3 className="ph-hc-t">{e.title}</h3>
            </article>
          ))}
          <div className="ph-sheet ph-others">
            <ol className="ph-hlist">
              {OTHERS.map((e, i) => (
                <li key={e.title}>
                  <span className="ph-hl-n">{pad2(FEATURED.length + i + 1)}</span>
                  <span className="ph-hl-t">{e.title}</span>
                  <span className="ph-hl-r">{e.metric}</span>
                  <span className="ph-hl-a ph-meta">{otherNote(e)}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="s06" className="ph-sec" data-sec="6" data-ground="light">
          <Head n={6} title="Recents" />
          <div className="ph-photos ph-opaque" />
        </section>

        <section id="s07" className="ph-sec" data-sec="7" data-ground="orange">
          <div className="ph-win ph-transit" style={{ ["--h" as string]: "50svh" }} aria-hidden />
          <Head n={7} title="Contact" />
          <div className="ph-win ph-keypad" data-shot="keypad" />
          <div className="ph-sheet ph-contact ph-dz ph-dzb">
            <a className="ph-mail" href={`mailto:${EMAIL}`} onClick={() => track("contact_email", { context: "contact" })}>
              {EMAIL}
            </a>
            <ul className="ph-clist">
              {[...SOCIALS]
                .sort((a, b) => ORDER.indexOf(a.node) - ORDER.indexOf(b.node))
                .map((s) => (
                  <li key={s.node}>
                    <a href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.aria} onClick={outbound(s.href, "contact")}>
                      <span>{s.label}</span>
                      <Arrow />
                    </a>
                  </li>
                ))}
              <li>
                <a href={RESUME} target="_blank" rel="noopener noreferrer" onClick={() => track("resume_download", { context: "contact" })}>
                  <span>Résumé</span>
                  <Arrow />
                </a>
              </li>
            </ul>
          </div>
          <div className="ph-marquee" aria-hidden>
            <div className="ph-mq-track">
              {[0, 1].map((k) => (
                <Fragment key={k}>
                  <span>let&rsquo;s connect</span>
                  <b />
                  <span>say hi</span>
                  <b />
                  <span>drop a line</span>
                  <b />
                </Fragment>
              ))}
            </div>
          </div>
          <footer className="ph-foot">
            <span>© Daniel Tan 2026</span>
          </footer>
        </section>
      </main>

      <nav className="ph-dock" aria-label="Sections">
        <div className="ph-dock-keys">
          {SECTIONS.map((label, i) => (
            <a key={label} href={`#s${pad2(i)}`} aria-label={label}>
              {pad2(i)}
            </a>
          ))}
          <span className="ph-dock-cur" aria-hidden />
          <span className="ph-dock-prog" aria-hidden>
            <i />
          </span>
        </div>
      </nav>
    </div>
  );
}

/** Contact rows in the draft's order (the keypad's key order). */
const ORDER = ["github", "linkedin", "x", "pinterest"];
