import type { CSSProperties } from "react";

// Bounded chat screen for the Assistant and Finance AI tabs (v7). The chat
// used to sit in a page whose height was not bounded, so a long history
// pushed the mic/text/send row below the screen and the whole page scrolled.
// The chat now fills exactly the space between the top safe area and the
// bottom nav: the message list scrolls inside (flex-1 + min-h-0) and the
// input row (shrink-0) stays pinned above the bottom nav. The keyboard does
// NOT resize the window (the app runs edge-to-edge, so adjustResize has no
// effect) — instead src/lib/keyboardHeight.ts writes the keyboard height to
// --kb and the box's bottom grows by it, so the input row moves above the
// keyboard exactly like a native chat app.
//
// Bottom nav = 68px buttons + 2px top border + safe-area padding
// (max(inset, 16px)).
export const CHAT_SCREEN_CLASS = "fixed inset-x-0 mx-auto flex w-full max-w-md flex-col p-4 pt-6 sm:max-w-lg";

export const CHAT_SCREEN_STYLE: CSSProperties = {
  top: "env(safe-area-inset-top, 0px)",
  bottom: "calc(70px + max(env(safe-area-inset-bottom, 0px), 16px) + var(--kb, 0px))",
};
