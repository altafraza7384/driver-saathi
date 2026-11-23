import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog";

afterEach(cleanup);

describe("DialogContent constrained height", () => {
  it("constrains tall content to the viewport with internal scroll", () => {
    // REGRESSION (fix 6): the Add Loan modal grew beyond a 1280x720
    // viewport (top -58.7, bottom 778.7) with the Add Loan / Cancel
    // buttons cut off and unreachable by normal scroll — the shared
    // DialogContent had no max-height and no overflow, so tall content
    // overflowed the viewport instead of scrolling inside the modal.
    // jsdom has no layout engine, so this pins the classes; the real
    // pixel proof (1280x720, mobile, keyboard-open height) is measured
    // with headless Chromium against the built CSS — see the fix-6
    // note in the PR #29 report.
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Loan</DialogTitle>
          </DialogHeader>
          <div style={{ height: 1200 }}>tall content</div>
        </DialogContent>
      </Dialog>,
    );
    const content = screen.getByRole("dialog");
    // Constrained to the (dynamic) viewport height, with usable
    // internal scroll: the footer buttons stay reachable by scrolling
    // the modal, never by scrolling the page behind it.
    expect(content.className).toContain("max-h-[90dvh]");
    expect(content.className).toContain("overflow-y-auto");
  });
});
