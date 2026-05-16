import type { ComponentType } from "react";
import type { IconShape } from "./DesktopIcon";
import { AboutWindow } from "./windows/AboutWindow";
import { ProjectsWindow } from "./windows/ProjectsWindow";
import { ResumeWindow } from "./windows/ResumeWindow";
import { ContactWindow } from "./windows/ContactWindow";
import { GithubWindow } from "./windows/GithubWindow";
import { PaintWindow } from "./windows/PaintWindow";

export interface AppDef {
  id: string;
  label: string;
  shape: IconShape;
  /** Default size of the window when first opened. */
  size: [number, number];
  Body: ComponentType;
}

/**
 * Single source of truth for the desktop's apps. Each entry:
 *   - icon (3D shape) appears on the desktop
 *   - clicking the icon opens its window
 *   - window content is the registered Body component
 */
export const APPS: AppDef[] = [
  { id: "about", label: "about", shape: "torus", size: [520, 480], Body: AboutWindow },
  { id: "projects", label: "projects", shape: "folder", size: [720, 520], Body: ProjectsWindow },
  { id: "resume", label: "resume", shape: "book", size: [640, 560], Body: ResumeWindow },
  { id: "contact", label: "contact", shape: "envelope", size: [480, 440], Body: ContactWindow },
  // Bigger default so the contributions grid + top 6 repos fit
  // without scrolling.
  { id: "github", label: "github", shape: "icosahedron", size: [820, 720], Body: GithubWindow },
  { id: "paint", label: "paint", shape: "cube", size: [620, 480], Body: PaintWindow },
];
