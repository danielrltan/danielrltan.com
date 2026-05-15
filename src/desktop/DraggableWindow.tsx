import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Minus, X } from "lucide-react";
import { useWindows } from "./WindowManager";

interface Props {
  id: string;
  title: string;
  children: ReactNode;
}

/**
 * A draggable, focusable window owned by the WindowManager.
 *
 * - Drag the title bar to move; pointer-capture keeps the drag clean even
 *   if the cursor leaves the title bar mid-drag.
 * - Anywhere on the window focuses it (raises its z-index).
 * - Minimize hides the body but keeps the entry in the window list so a
 *   taskbar can re-show it (taskbar is wired in DesktopOS).
 * - Close removes the window.
 *
 * Position / size live in `WindowManager` — drag handlers just push updates.
 */
export function DraggableWindow({ id, title, children }: Props) {
  const { windows, focus, close, move, toggleMinimize } = useWindows();
  const win = windows.find((w) => w.id === id);
  const dragRef = useRef<{ ox: number; oy: number; pid: number } | null>(null);
  const [hoverClose, setHoverClose] = useState(false);

  const onTitleDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (!win) return;
      // Don't start a drag if the user pressed the close / minimize button —
      // setPointerCapture on the title bar would otherwise eat the click.
      const target = e.target as HTMLElement | null;
      if (target && target.closest("button")) return;
      focus(id);
      const ox = e.clientX - win.x;
      const oy = e.clientY - win.y;
      dragRef.current = { ox, oy, pid: e.pointerId };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
    },
    [focus, id, win],
  );

  // Pointer move/up bound on the title element via the same handler; the
  // capture means we keep getting events even when the cursor leaves it.
  const onTitleMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d || d.pid !== e.pointerId) return;
      move(id, e.clientX - d.ox, e.clientY - d.oy);
    },
    [move, id],
  );

  const onTitleUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d || d.pid !== e.pointerId) return;
      dragRef.current = null;
      try {
        (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
      } catch {
        /* already released */
      }
    },
    [],
  );

  useEffect(() => {
    return () => {
      dragRef.current = null;
    };
  }, []);

  if (!win) return null;
  if (win.minimized) return null;

  return (
    <div
      role="dialog"
      aria-label={title}
      onPointerDown={() => focus(id)}
      style={{
        position: "absolute",
        left: win.x,
        top: win.y,
        width: win.width,
        height: win.height,
        background: "var(--surface)",
        color: "var(--text-lt)",
        borderRadius: 10,
        border: "1px solid var(--surface-alt)",
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 60px rgba(0,0,0,0.45)",
        zIndex: win.z,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        onPointerDown={onTitleDown}
        onPointerMove={onTitleMove}
        onPointerUp={onTitleUp}
        onPointerCancel={onTitleUp}
        style={{
          flex: "0 0 30px",
          background: "var(--surface-alt)",
          borderBottom: "1px solid #000",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 10px",
          cursor: dragRef.current ? "grabbing" : "grab",
          userSelect: "none",
          touchAction: "none",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-lt)",
            letterSpacing: 0.5,
          }}
        >
          <span style={{ color: "var(--muted)" }}>~/</span>
          {title}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleMinimize(id);
            }}
            aria-label="Minimize"
            style={tbBtn(false)}
          >
            <Minus size={12} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              close(id);
            }}
            onMouseEnter={() => setHoverClose(true)}
            onMouseLeave={() => setHoverClose(false)}
            aria-label="Close"
            style={tbBtn(hoverClose)}
          >
            <X size={12} />
          </button>
        </div>
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          background: "var(--surface)",
          minHeight: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function tbBtn(hot: boolean): React.CSSProperties {
  return {
    width: 22,
    height: 22,
    display: "grid",
    placeItems: "center",
    border: "none",
    background: "transparent",
    color: hot ? "#ff5f57" : "var(--muted)",
    cursor: "pointer",
    borderRadius: 4,
    transition: "color 0.12s ease",
  };
}
