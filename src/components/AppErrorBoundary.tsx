import { Component, type ErrorInfo, type ReactNode } from "react";
import { DEBUG_BUILD } from "@/lib/debugOverlay";

type Props = { children: ReactNode };
type State = { error: Error | null; componentStack: string | null };

// A lazy page whose code file failed to download (flaky network, or an
// old cached index after a new release) throws one of these. One automatic
// reload fixes it; the sessionStorage stamp stops a reload loop.
const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk [^ ]+ failed|Unable to preload CSS/i;
const RELOAD_KEY = "ds-chunk-reload-at";

export function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
  return CHUNK_ERROR.test(msg);
}

/** Reload once (per 30 s) to recover from a failed code-chunk download. */
export function reloadOnceForChunkError(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/**
 * Top-level error boundary: a render error anywhere in the app shows a
 * "something went wrong" card with a Reload button instead of leaving the
 * WebView on a blank white screen. Deliberately dependency-free (no i18n,
 * no UI kit) so it still renders when those are what failed; text is
 * bilingual instead.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App crashed during render", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
    if (isChunkLoadError(error)) reloadOnceForChunkError();
  }

  render() {
    if (!this.state.error) return this.props.children;
    const err = this.state.error;
    const message = (err && (err.message || String(err))) || "Unknown error";
    const details = DEBUG_BUILD
      ? [
          ...(err?.stack ?? "").split("\n").slice(0, 6),
          ...(this.state.componentStack ?? "").trim().split("\n").slice(0, 4),
        ].join("\n")
      : "";
    return (
      <div
        role="alert"
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          padding: 24,
          textAlign: "center",
          background: "#0b2a5b",
          color: "#fff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <img src="/icon-192.png" alt="" width={72} height={72} style={{ borderRadius: 16 }} />
        <div style={{ fontSize: 18, fontWeight: 700 }}>Something went wrong</div>
        <div style={{ fontSize: 15, opacity: 0.85 }}>Kuch gadbad ho gayi. Dobara kholein.</div>
        {/* The error text, so a screenshot tells us what broke. */}
        <div
          style={{
            maxWidth: 360,
            fontSize: 11,
            opacity: 0.7,
            fontFamily: "monospace",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            textAlign: "left",
          }}
        >
          {message}
          {details ? `\n\n${details}` : ""}
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 6,
            padding: "10px 20px",
            border: 0,
            borderRadius: 8,
            background: "#f5c518",
            color: "#0b2a5b",
            fontWeight: 700,
            fontSize: 15,
          }}
        >
          Reload / दोबारा खोलें
        </button>
      </div>
    );
  }
}
