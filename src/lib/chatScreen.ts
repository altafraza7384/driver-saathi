import type { CSSProperties } from "react";

// Bounded chat screen for the Assistant and Finance AI tabs (v7). The chat
// used to sit in a page whose height was not bounded, so a long history
// pushed the mic/text/send row below the screen and the whole page scrolled.
// The chat now fills exactly the space between the top safe area and the
// bottom nav: the message list scrolls inside (flex-1 + min-h-0) and the
// input row (shrink-0) stays pinned above the bottom nav. When the keyboard
// resizes the app window the box shrinks with it, so the input row stays
// above the keyboard too.
//
// Bottom nav = 68px buttons + 2px top border + safe-area padding
// (max(inset, 16px)). An AdMob banner, when one is showing, sits right below
// the lifted nav and publishes its height as --admob-banner-height (0 otherwise).
export const CHAT_SCREEN_CLASS = "fixed inset-x-0 mx-auto flex w-full max-w-md flex-col p-4 pt-6 sm:max-w-lg";

export const CHAT_SCREEN_STYLE: CSSProperties = {
  top: "env(safe-area-inset-top, 0px)",
  bottom: "calc(70px + max(env(safe-area-inset-bottom, 0px), 16px) + var(--admob-banner-height, 0px))",
};
