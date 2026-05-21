import { useEffect, useRef, useState } from "react";
import "./sections.css";
import "./other.css";
import { OtherDeskScene } from "../other/OtherDeskScene";
import { OtherPhotoTrains } from "../other/OtherPhotoTrains";

/**
 * "Off the clock" / hobbies section. Two interlocked layers in one
 * 100vh band:
 *
 *   Upper half: HTML "photo trains" — 3 horizontal rows of
 *               hobby-related images that slide opposite directions
 *               as the user scrolls.
 *   Lower half: 3D desk with one primitive-shape object per hobby.
 *               Click an object → tooltip describing the hobby +
 *               the meta line.
 *
 * Previously this section was for "accomplishments" / extras —
 * those moved to BitsAndPieces.tsx so this section can BE the hobby
 * showcase as requested.
 */

export interface HobbyObject {
  id: string;
  label: string;
  blurb: string;
  /** Hex color for the placeholder cube material. */
  color: string;
  /** Position on the desk surface in world units. */
  position: [number, number, number];
  shape: "box" | "cylinder" | "sphere" | "cone";
  /** Size override; default is ~0.35 across. */
  size?: number;
}

const HOBBIES: HobbyObject[] = [
  {
    id: "taekwondo",
    label: "Taekwondo",
    blurb: "Black Belt 2nd Dan. Years of forms, sparring, breaking — long-haul discipline practice.",
    color: "#1a1714",
    position: [-1.4, 0.30, -0.2],
    shape: "cone",
    size: 0.45,
  },
  {
    id: "piano",
    label: "Piano",
    blurb: "12+ years. RCM Level 9. Plays through Rachmaninoff badly and Ludovico Einaudi well.",
    color: "#3a2418",
    position: [-0.55, 0.20, 0.15],
    shape: "box",
    size: 0.60,
  },
  {
    id: "keyboards",
    label: "Mechanical Keyboards",
    blurb: "Custom builds + speed typing. ~150wpm sustained on the daily driver.",
    color: "#5a3a1f",
    position: [0.35, 0.22, -0.25],
    shape: "box",
    size: 0.50,
  },
  {
    id: "cars",
    label: "Cars & Driving",
    blurb: "Manual nerd. Track-curious. Spends too much time reading car YouTubers' shop talk.",
    color: "#7a4f30",
    position: [1.35, 0.30, 0.05],
    shape: "cylinder",
    size: 0.42,
  },
  {
    id: "skiing",
    label: "Skiing",
    blurb: "Cold-weather kid. Black runs and the occasional bail.",
    color: "#a8c4d0",
    position: [-0.05, 0.20, 0.6],
    shape: "sphere",
    size: 0.42,
  },
  {
    id: "design",
    label: "Graphic Design",
    blurb: "VP of Design at Western Founders Network. Figma muscle memory; aesthetic > engagement.",
    color: "#e87040",
    position: [0.85, 0.22, 0.45],
    shape: "cone",
    size: 0.42,
  },
];

/**
 * Per-row photo set for the train layer above the desk. Each item is
 * a label that doubles as a placeholder caption until real hobby
 * photos are dropped in /public/images/hobbies/. The trains visually
 * shuffle through these as the user scrolls.
 */
const TRAIN_PHOTOS: { color: string; label: string }[] = [
  { color: "#1a1714", label: "Taekwondo" },
  { color: "#3a2418", label: "Piano" },
  { color: "#5a3a1f", label: "Keys" },
  { color: "#7a4f30", label: "Cars" },
  { color: "#a8c4d0", label: "Skiing" },
  { color: "#e87040", label: "Design" },
  { color: "#262120", label: "Travel" },
  { color: "#c08c6c", label: "Crocheting" },
  { color: "#4a2e1a", label: "Fashion" },
  { color: "#d4a574", label: "Coffee" },
  { color: "#ff5400", label: "Photography" },
  { color: "#9c7c5e", label: "Books" },
];

export function Other() {
  const sectionRef = useRef<HTMLElement>(null);
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
        <span className="section-marker">05</span>
        <span className="section-index">05 / 06 &middot; Off the clock</span>
        <h2>Things I love.</h2>
        <p className="other-blurb">
          Tap an object on the desk. The photos above are flashes from
          the time I&apos;m not at the keyboard.
        </p>
      </div>
    </section>
  );
}
