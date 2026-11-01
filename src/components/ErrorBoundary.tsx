import { Component, type ErrorInfo, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";

interface ErrorBoundaryInnerProps {
  message: string;
  reloadLabel: string;
  children: ReactNode;
}

interface ErrorBoundaryInnerState {
  hasError: boolean;
}

// Class boundary: catches render errors (including a page chunk that
// failed to download on a flaky connection) that would otherwise leave
// the app blank. It only ever renders when an error actually happened,
// so normal pages are untouched.
class ErrorBoundaryInner extends Component<
  ErrorBoundaryInnerProps,
  ErrorBoundaryInnerState
> {
  state: ErrorBoundaryInnerState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryInnerState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ErrorBoundary caught a render error:", error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-lg">{this.props.message}</p>
          <button
            type="button"
            className="rounded-md bg-primary px-6 py-3 font-medium text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            {this.props.reloadLabel}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ErrorBoundary({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <ErrorBoundaryInner
      message={t("home.loadError")}
      reloadLabel={t("common.reload")}
    >
      {children}
    </ErrorBoundaryInner>
  );
}
