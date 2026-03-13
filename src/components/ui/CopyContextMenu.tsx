"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Provides copy-to-clipboard state with an automatic success reset.
 */
export function useCopyToClipboard(timeout = 1500): {
  copy: (text: string) => Promise<void>;
  copied: boolean;
} {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const markCopied = useCallback(() => {
    setCopied(true);
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => setCopied(false), timeout);
  }, [timeout]);

  const copy = useCallback(
    async (text: string) => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          markCopied();
          return;
        }

        throw new Error("Clipboard API unavailable");
      } catch {
        const el = document.createElement("textarea");
        el.value = text;
        el.style.cssText = "position:fixed;opacity:0;pointer-events:none;";
        document.body.appendChild(el);
        el.focus();
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
        markCopied();
      }
    },
    [markCopied]
  );

  return { copy, copied };
}

type CopyButtonProps = {
  value: string;
  className?: string;
  size?: "sm" | "md";
};

/**
 * Inline copy button with transient copied state.
 */
export function CopyButton({ value, className, size = "sm" }: CopyButtonProps): JSX.Element {
  const { copy, copied } = useCopyToClipboard();

  return (
    <button
      type="button"
      onClick={() => void copy(value)}
      className={cn(
        "inline-flex items-center justify-center rounded transition-all duration-150",
        size === "sm" ? "h-6 w-6" : "h-7 w-7",
        copied
          ? "bg-emerald-500/10 text-emerald-400"
          : "text-zinc-600 hover:bg-white/6 hover:text-zinc-300",
        className
      )}
      title={copied ? "Copied!" : "Copy"}
      aria-label={copied ? "Copied!" : "Copy"}
    >
      {copied ? <Check size={size === "sm" ? 11 : 13} strokeWidth={2.5} /> : <Copy size={size === "sm" ? 11 : 13} />}
    </button>
  );
}

type CopyCellProps = {
  value: string;
  children: ReactNode;
  className?: string;
};

/**
 * Wraps content and reveals a copy affordance on hover.
 */
export function CopyCell({ value, children, className }: CopyCellProps): JSX.Element {
  return (
    <span className={cn("group inline-flex items-center gap-1.5", className)}>
      {children}
      <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <CopyButton value={value} />
      </span>
    </span>
  );
}

export type ContextMenuItem = {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: "default" | "danger";
  divider?: boolean;
};

type ContextMenuState = {
  x: number;
  y: number;
  items: ContextMenuItem[];
} | null;

let setMenuSingleton: ((menu: ContextMenuState) => void) | null = null;

/**
 * Opens the shared context menu at the mouse position.
 */
export function showContextMenu(event: MouseEvent<HTMLElement>, items: ContextMenuItem[]): void {
  event.preventDefault();
  setMenuSingleton?.({ x: event.clientX, y: event.clientY, items });
}

/**
 * Singleton context menu host. Mount once near the root layout.
 */
export function ContextMenuRoot(): JSX.Element | null {
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMenuSingleton = setMenu;
    return () => {
      setMenuSingleton = null;
    };
  }, []);

  useEffect(() => {
    if (!menu) {
      return;
    }

    const close = () => setMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    document.addEventListener("mousedown", close);
    document.addEventListener("scroll", close, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menu]);

  useEffect(() => {
    if (!menu) {
      return;
    }

    setPosition({ x: menu.x, y: menu.y });

    const frame = window.requestAnimationFrame(() => {
      const el = menuRef.current;
      if (!el) {
        return;
      }

      const rect = el.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      setPosition({
        x: menu.x + rect.width > viewportWidth ? Math.max(8, menu.x - rect.width) : menu.x,
        y: menu.y + rect.height > viewportHeight ? Math.max(8, menu.y - rect.height) : menu.y
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [menu]);

  if (!menu) {
    return null;
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[99998] min-w-[180px] rounded-[0.625rem] border border-white/8 bg-zinc-900 p-1 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
      style={{
        top: position.y,
        left: position.x,
        animation: "context-in 0.12s cubic-bezier(0.34,1.56,0.64,1)"
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <style>{`
        @keyframes context-in {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
      {menu.items.map((item, index) => (
        <div key={`${item.label}-${index}`}>
          {item.divider && index > 0 ? <div className="my-1 h-px bg-white/6" /> : null}
          <button
            type="button"
            onClick={() => {
              item.onClick();
              setMenu(null);
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[0.8rem] transition-colors",
              item.variant === "danger"
                ? "text-red-400 hover:bg-red-500/10"
                : "text-zinc-300 hover:bg-white/6"
            )}
          >
            {item.icon ? <span className="flex opacity-60">{item.icon}</span> : null}
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}
