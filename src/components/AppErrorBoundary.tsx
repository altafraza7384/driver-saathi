import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Top-level error boundary: a render error anywhere in the app shows a
 * "something went wrong" card with a Reload button instead of leaving the
 * WebView on a blank white screen. Deliberately dependency-free (no i18n,
 * no UI kit) so it still renders when those are what failed; text is
 * bilingual instead.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App crashed during render", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
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
