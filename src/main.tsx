import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Mark <html> as loading-active BEFORE React mounts. Without this,
// there's a one-frame window between (a) the inline `#boot-screen`
// being removed by AssemblyController on mount, and (b) the cover
// dome inside the canvas painting orange — during which the App
// wrapper's wrapper-bg (cool grey) shows through, reading as a
// white flash. With the class set synchronously, the CSS keeps the
// wrapper orange until climaxDone fires.
document.documentElement.classList.add("loading-active");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
