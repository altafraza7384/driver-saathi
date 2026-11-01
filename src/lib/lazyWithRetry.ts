import { lazy, type ComponentType, type LazyExoticComponent } from "react";

// Lazy page import with retries: on a flaky mobile connection a page
// chunk can fail to download once. Retry twice (1s apart) before giving
// up; a final failure still reaches the ErrorBoundary, whose Reload
// button fetches a fresh index.html.
export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  const load = async (attempt: number): Promise<{ default: T }> => {
    try {
      return await factory();
    } catch (err) {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return load(attempt + 1);
      }
      throw err;
    }
  };
  return lazy(() => load(0));
}
