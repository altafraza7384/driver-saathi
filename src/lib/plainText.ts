// Plain text for the AI pages (v8). Both pages render replies as plain text,
// but the old strip removed only CLOSED **...** pairs, so a cut-off Finance AI
// reply ending "3. **Bajat" showed raw ** on screen. This strips every
// markdown marker, closed or not, and normalises odd spaces some models emit
// (a narrow no-break space before the rupee sign showed as "an\u20b9100").
// Same function as firebase/functions/src/aiLogic.ts (the server cleans too;
// this covers stored history and the server version not yet deployed).
// User messages are never passed through this.

export function stripMarkdown(text: string): string {
  return text
    .replace(/[\u00A0\u2007\u2009\u200A\u202F]/g, " ")
    .replace(/[\u2010\u2011]/g, "-")
    .replace(/[\u200B\uFEFF]/g, "")
    .replace(/^\s*```[^\n]*$/gm, "")
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*([-*_])(\s*\1){2,}\s*$/gm, "")
    .replace(/^(\s*)[*+\-\u2022]\s+/gm, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/(^|[\s(])\*(?=\S)/gm, "$1")
    .replace(/(\S)\*(?=[\s.,!?:;)]|$)/gm, "$1")
    .replace(/(^|[\s(])_(?=\S)([^_\n]*\S)_(?=[\s.,!?:;)]|$)/gm, "$1$2")
    .replace(/`/g, "")
    .replace(/\|/g, " ")
    .replace(/^[ \t:-]+$/gm, "")
    .replace(/([\p{L}\p{M}])\u20B9/gu, "$1 \u20B9")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
