/**
 * CSP regression tests (PR #30 correction 3).
 *
 * Firebase Google web-auth loads https://apis.google.com/js/api.js at
 * runtime (signInWithPopup injects it); the CSP shipped in this bundle
 * had no apis.google.com in script-src, so a real-browser isolated probe
 * blocked it and Google login could not complete. The fix adds
 * https://apis.google.com to script-src in every place the CSP lives.
 *
 * The CSP lives in THREE places that must stay identical (the workflow
 * heredoc is what actually deploys; the root firebase.json is not read
 * by the deploy; public/_headers is the Lovable-era copy): root
 * firebase.json, public/_headers, .github/workflows/firebase-hosting.yml.
 * All three are checked here. NOTE: the workflow file cannot be pushed
 * via the GitHub App (no `workflows` permission) — its update travels
 * as a separate patch applied via the web UI, so until that lands the
 * workflow assertions below fail on a checkout that has the other two
 * copies updated but not the workflow copy. That is the intended tripwire.
 *
 * What this does NOT prove: a live Google login or Razorpay checkout.
 * There is no live browser here. Enforcement stays STAGED until a live
 * login probe on the deployed URL passes with the CSP enforced (see the
 * staged-enforcement note in firebase.json / the workflow comments).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readCspFromFirebaseJson(): string {
  const json = JSON.parse(
    readFileSync(join(process.cwd(), "firebase.json"), "utf8"),
  ) as {
    hosting: {
      headers: { source: string; headers: { key: string; value: string }[] }[];
    };
  };
  const all = json.hosting.headers.find((h) => h.source === "**");
  const csp = all?.headers.find((h) => h.key === "Content-Security-Policy");
  if (!csp) throw new Error("no CSP in firebase.json ** rule");
  return csp.value;
}

function readCspFromPublicHeaders(): string {
  const text = readFileSync(join(process.cwd(), "public", "_headers"), "utf8");
  const match = text.match(/Content-Security-Policy:\s*(\S(?:.*\S)?)\s*$/m);
  if (!match) throw new Error("no CSP in public/_headers");
  return match[1].trim();
}

/**
 * The CSP inside the deploy workflow's heredoc — the copy that actually
 * reaches the live site. The workflow file cannot be pushed via the
 * GitHub App (no `workflows` permission), so this copy is updated via
 * the web UI; this assertion is what catches it drifting from the other
 * two copies.
 */
function readCspFromDeployWorkflow(): string {
  const text = readFileSync(
    join(process.cwd(), ".github", "workflows", "firebase-hosting.yml"),
    "utf8",
  );
  const match = text.match(
    /"Content-Security-Policy",\s*"value":\s*"([^"]+)"/,
  );
  if (!match) throw new Error("no CSP in firebase-hosting.yml heredoc");
  return match[1];
}

function scriptSrc(csp: string): string {
  const match = csp.match(/script-src ([^;]+)/);
  if (!match) throw new Error("no script-src in CSP");
  return match[1];
}

describe("CSP allows Firebase Google web-auth", () => {
  it("script-src includes https://apis.google.com (firebase.json)", () => {
    expect(scriptSrc(readCspFromFirebaseJson())).toContain(
      "https://apis.google.com",
    );
  });

  it("script-src includes https://apis.google.com (public/_headers)", () => {
    expect(scriptSrc(readCspFromPublicHeaders())).toContain(
      "https://apis.google.com",
    );
  });

  it("script-src includes https://apis.google.com (deploy workflow heredoc)", () => {
    expect(scriptSrc(readCspFromDeployWorkflow())).toContain(
      "https://apis.google.com",
    );
  });

  it("the two App-pushable CSP copies are identical", () => {
    expect(readCspFromPublicHeaders()).toBe(readCspFromFirebaseJson());
  });

  it("the deploy workflow CSP is identical to firebase.json", () => {
    expect(readCspFromDeployWorkflow()).toBe(readCspFromFirebaseJson());
  });

  it("keeps the previously verified allowances (no regression)", () => {
    for (const csp of [
      readCspFromFirebaseJson(),
      readCspFromPublicHeaders(),
    ]) {
      // Razorpay checkout script (SubscriptionPlansCard).
      expect(scriptSrc(csp)).toContain("https://checkout.razorpay.com");
      // Firebase Auth hidden iframe (signInWithPopup / redirect).
      expect(csp).toMatch(/frame-src [^;]*https:\/\/\*\.firebaseapp\.com/);
    }
  });
});
