import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { liveLinkLabel, type MacProject } from "../macintosh/projects";
import { track } from "../analytics";
import { lockScroll, unlockScroll } from "../scroll";
import "./theater.css";

/**
 * Project theater: a project's demo video, full size with sound, over a dark
 * scrim, with the record (meta, title, blurb, tags, links) under it. Opened
 * from the CRT's WATCH panel (desktop), the accordion poster (narrow) and the
 * phone cards. Portaled to <body> so no section's stacking context clips it.
 * Esc, the close button or a click on the scrim closes it; focus returns to
 * whatever opened it, and page scroll is locked while it is up.
 */
export function ProjectTheater({
  project,
  onClose,
}: {
  project: MacProject | null;
  onClose: () => void;
}) {
  // Keep the last project mounted through the exit fade.
  const [shown, setShown] = useState<MacProject | null>(project);
  const [open, setOpen] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (project) {
      openerRef.current = document.activeElement as HTMLElement | null;
      setShown(project);
      // Next frame so the entrance transition runs from the closed state.
      const id = requestAnimationFrame(() => setOpen(true));
      track("project_video", { project: project.title });
      return () => cancelAnimationFrame(id);
    }
    setOpen(false);
    videoRef.current?.pause();
    const t = window.setTimeout(() => setShown(null), 260);
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener && typeof opener.focus === "function") opener.focus({ preventScroll: true });
    return () => window.clearTimeout(t);
  }, [project]);

  useEffect(() => {
    if (!project) return;
    lockScroll("theater");
    const id = requestAnimationFrame(() => closeBtnRef.current?.focus({ preventScroll: true }));
    // Capture phase + stopImmediatePropagation: Esc closes ONLY the theater,
    // never the CRT project detail sitting under it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("keydown", onKey, true);
      unlockScroll("theater");
    };
  }, [project]);

  if (!shown?.video || typeof document === "undefined") return null;
  const p = shown;
  const [date, stack] = p.meta.split(" · ");
  const titleId = `theater-title-${p.id}`;

  return createPortal(
    <div
      className={`theater${open ? " is-open" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      // Wheel/touch inside the panel must not reach Lenis.
      data-lenis-prevent=""
    >
      <div className="theater-panel">
        <button
          ref={closeBtnRef}
          type="button"
          className="theater-close"
          aria-label="Close video"
          onClick={onClose}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />
          </svg>
        </button>
        <div className="theater-frame">
          <video
            ref={videoRef}
            key={p.id}
            className="theater-video"
            src={p.video!.src}
            poster={p.video!.poster}
            controls
            autoPlay
            playsInline
            preload="metadata"
          />
          <span className="theater-tick tl" aria-hidden="true" />
          <span className="theater-tick tr" aria-hidden="true" />
          <span className="theater-tick bl" aria-hidden="true" />
          <span className="theater-tick br" aria-hidden="true" />
        </div>
        <div className="theater-info">
          <div className="theater-main">
            <p className="theater-meta">
              {date}
              {stack && <span className="theater-stack">{stack}</span>}
            </p>
            <h2 id={titleId} className="theater-title">
              {p.title}
            </h2>
            <p className="theater-blurb">{p.blurb}</p>
          </div>
          <div className="theater-side">
            {p.tags.length > 0 && (
              <ul className="theater-tags">
                {p.tags.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
            <div className="theater-links">
              {p.liveHref && (
                <a
                  className="theater-link"
                  href={p.liveHref}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => track("project_link", { project: p.title, type: "live" })}
                >
                  {liveLinkLabel(p.liveHref)} <span aria-hidden="true">→</span>
                </a>
              )}
              {p.repoHref && (
                <a
                  className="theater-link theater-link-o"
                  href={p.repoHref}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => track("project_link", { project: p.title, type: "repo" })}
                >
                  Source <span aria-hidden="true">→</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
