import { scrollToY } from "../scroll";
import { track } from "../analytics";

/*
 * The phone site's bottom dock: one pixel key per section, an orange cursor
 * that steps to the section under the screen's upper third, and that
 * section's progress along the dock's top edge in 6 px pixels. A key glides
 * the page (and so the stage camera) to the section's header.
 */
export function installDock(root: HTMLElement): () => void {
  const secs = [...root.querySelectorAll<HTMLElement>(".ph-site > .ph-sec")];
  const keys = [...root.querySelectorAll<HTMLAnchorElement>(".ph-dock-keys a")];
  const cur = root.querySelector<HTMLElement>(".ph-dock-cur")!;
  const prog = root.querySelector<HTMLElement>(".ph-dock-prog")!;
  const docTop = (el: Element) => el.getBoundingClientRect().top + window.scrollY;
  let active = -1;

  function setActive(i: number) {
    if (i === active) return;
    active = i;
    keys.forEach((k, j) => {
      k.classList.toggle("ph-on", j === i);
      if (j === i) k.setAttribute("aria-current", "true");
      else k.removeAttribute("aria-current");
    });
    cur.style.setProperty("--i", String(i));
    // Never for the hero: it is the opening screen, not a section someone reached.
    if (i > 0) track("section_view", { section: keys[i].getAttribute("aria-label") });
  }
  function onScroll() {
    const probe = window.innerHeight * 0.38;
    let idx = 0;
    for (let i = 0; i < secs.length; i++) if (secs[i].getBoundingClientRect().top <= probe) idx = i;
    setActive(idx);
    const r = secs[idx].getBoundingClientRect();
    const span = idx === secs.length - 1 ? r.height - (window.innerHeight - probe) : r.height;
    const p = Math.min(1, Math.max(0, (probe - r.top) / Math.max(1, span)));
    const px = prog.parentElement!.clientWidth;
    prog.style.setProperty("--p", String((Math.floor((p * px) / 6) * 6) / px));
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  const clicks = keys.map((k, i) => {
    const f = (e: MouseEvent) => {
      e.preventDefault();
      // Land on the section's header (a section may open with a camera transit above it).
      const head = secs[i].querySelector(":scope > .ph-head");
      void scrollToY(i === 0 || !head ? 0 : docTop(head));
      track("nav_jump", { section: k.getAttribute("aria-label"), source: "dock" });
    };
    k.addEventListener("click", f);
    return () => k.removeEventListener("click", f);
  });

  return () => {
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);
    clicks.forEach((f) => f());
  };
}
