import { useEffect, useRef, useState } from "react";
import "./sections.css";
import "./other.css";
import { OtherDeskScene } from "../other/OtherDeskScene";
import { OtherPhotoTrains } from "../other/OtherPhotoTrains";

/**
 * "Other" — the extras section. Two layers stacked in the same
 * 100vh band:
 *   Upper half: HTML "photo trains" — multiple horizontal rows of
 *               achievement / behind-the-scenes images that slide
 *               left/right at different rates as the user scrolls.
 *   Lower half: 3D desk with a handful of hobby-symbol objects;
 *               click an object → tooltip describing the interest
 *               and any related accolades.
 *
 * The HTML/3D split is intentional — the photo trains have to
 * render crisp text and lots of images, which is faster + sharper
 * via DOM than as Three.js textures. The desk is a tactile beat
 * that ties this section back to the curiosity-cabinet aesthetic
 * without making it a third "every object is a tooltip" repeat.
 */

export interface HobbyObject {
  id: string;
  label: string;
  blurb: string;
  /** Hex color for the placeholder cube material. */
  color: string;
  /** Position on the desk surface in world units (x = left/right, z = depth). */
  position: [number, number, number];
  /** Crude shape selector — different per object so the desk reads as varied. */
  shape: "box" | "cylinder" | "sphere" | "cone";
  /** Optional size override; default is ~0.35 across. */
  size?: number;
}

const HOBBIES: HobbyObject[] = [
  {
    id: "trophy",
    label: "Awards & Wins",
    blurb:
      "Hack The 6ix Finalist · IBM Watsonx Top 50 · TRREB 2nd Place · WFN Odyssey Cup First Place.",
    color: "#e87040",
    position: [-1.2, 0.35, -0.3],
    shape: "cone",
    size: 0.45,
  },
  {
    id: "folder",
    label: "Leadership",
    blurb:
      "Director of Flagship at Western AI Club. VP of Design at Western Founders Network. Director of Outreach at Tech for Social Impact.",
    color: "#5a3a1f",
    position: [-0.4, 0.25, 0.1],
    shape: "box",
    size: 0.55,
  },
  {
    id: "envelope",
    label: "Grants",
    blurb:
      "$3,000 Ontario Summer Company Grant for a small business operated through 2023.",
    color: "#c5a37f",
    position: [0.5, 0.22, -0.2],
    shape: "cylinder",
    size: 0.36,
  },
  {
    id: "star",
    label: "Scholarships",
    blurb:
      "Western Scholarship of Distinction · National Merit · Chris Binns-Smith Memorial · GPA 3.9/4.0.",
    color: "#7a4f30",
    position: [1.4, 0.30, 0.05],
    shape: "sphere",
    size: 0.40,
  },
  {
    id: "book",
    label: "Builds",
    blurb:
      "TD Innovation Sprint finalist. Internal Slackbot, OAuth flow, ticket automation extension — across Windscribe + Nodes.",
    color: "#3a2418",
    position: [0.0, 0.20, 0.55],
    shape: "box",
    size: 0.50,
  },
];

const TRAIN_PHOTOS: { color: string; label: string }[] = [
  { color: "#e87040", label: "Hack The 6ix" },
  { color: "#5a3a1f", label: "WFN Odyssey" },
  { color: "#7a4f30", label: "TD Innovation Sprint" },
  { color: "#c5a37f", label: "TRREB" },
  { color: "#3a2418", label: "Ontario Grant" },
  { color: "#a8c4d0", label: "Western AI Club" },
  { color: "#ff7842", label: "WFN" },
  { color: "#4a2e1a", label: "TSI" },
  { color: "#d4a574", label: "WDS" },
  { color: "#262120", label: "Watsonx" },
  { color: "#ff5400", label: "Scholarships" },
  { color: "#c08c6c", label: "Demerzel" },
];

export function Other() {
  const sectionRef = useRef<HTMLElement>(null);
  // Lazy-mount the 3D canvas (same pattern as Photos / Keypad).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || mounted) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setMounted(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "75% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted]);

  return (
    <section ref={sectionRef} className="portfolio-section portfolio-other">
      <div className="other-trains-layer">
        <OtherPhotoTrains photos={TRAIN_PHOTOS} sectionRef={sectionRef} />
      </div>
      <div className="other-desk-layer">
        {mounted && <OtherDeskScene hobbies={HOBBIES} />}
      </div>
      <div className="portfolio-col other-col">
        <span className="section-marker">06</span>
        <span className="section-index">06 / 07 &middot; Other</span>
        <h2>Bits and pieces.</h2>
        <p className="other-blurb">
          Extras. Tap an object on the desk; the photos above are
          flashes from the cutting-room floor.
        </p>
      </div>
    </section>
  );
}
