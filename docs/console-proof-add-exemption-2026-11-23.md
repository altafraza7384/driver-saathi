# Console proof — Add Exemption route observed (read-only) — 2026-11-23

**Project:** `driver-saathi-app`, database `(default)`.
**Path:** Firebase console → Firestore → Indexes → **Automatic** (single-field) tab.
**What ran:** the read-only console check briefed in C10 of
`docs/cloud-settings-review-2026-11-22.md`. Nothing was applied: the
dialog was closed with Cancel and no entry was created. This file records
what was observed; it changes no live setting and no repo code — docs only.

**NO SCREENSHOT EXISTS.** No screenshot file exists for this check: the
browser task that ran the check returns no file paths, so no screenshot
could be attached. Do not look for a screenshot file for this proof — there
is none, and no screenshot filename is claimed anywhere in this repo. The
proof below rests on **TWO agreeing independent console text reads**
(2026-11-23, read-only, no Save/Publish, Cancel only).

## Automatic tab settings observed

Three rows — Ascending, Descending, Arrays — each with Collection scope
**Enabled** and Collection group scope **Disabled** for all three.

## Baseline exemptions before the check

4 entries, list showing "1–4 of 4":

- `car_documents / notify_at`
- `chat_messages / created_at`
- `reminders / notify_at`
- `transactions / transaction_date`

Each Collection Group Scope "✓ Ascending" + "+ 2 unchanged". No `aiUsage`
entry. This matches the report's earlier live inventory (§4
reconciliation table: 8 manual composite indexes + 4 single-field
exemptions).

## Step 1 — "Add exemption" dialog (verbatim labels)

- Title: "Add exemption"
- Steps: "1 Choose a field to exempt from automatic settings" and
  "2 Select index settings for this field"
- Fields: "Collection ID" (required, placeholder "Example: Artists") and
  "Field path" (required, placeholder "Example: Playcount")
- "Query scope" checkboxes: "Collection" / "Collection group"
- Footer: "Cancel" + "Next" (Next's accessible name is "Save"; disabled
  until Collection ID + Field path + a scope are given)
- NO Ascending/Descending options on step 1.

## Step 2 — "Select index settings for this field"

- Summary: "Collection ID aiUsage | Field path bucket_start | Query scope
  Collection group"
- Table headers: "Indexes" / "Collection group scope"
- Rows are SWITCHES — Ascending / Descending / Arrays, ALL Disabled by
  default for a collection-group exemption; a warning text about disabling
  indexes/storage; footer "Cancel" + "Save".
- Turning Ascending on (in-dialog only) showed "Enabled" while Descending
  and Arrays stayed Disabled — matching the existing exemptions' pattern
  (CG Ascending, others unchanged).

## Outcome

Dialog closed with Cancel. After closing, the list still showed "1–4 of
4", and a page search for "aiUsage" returned nothing — NO `aiUsage` entry
was created. The route is therefore console-observed (labels + defaults +
preview), NOT applied.

## Status

The `aiUsage` index remains **HOLD** — not applied, needs the user's
approval. The 8 manual composite indexes and 4 exemptions observed match
the report's earlier live inventory. C10's "until that proof exists"
condition is now met for labels/defaults/preview — the route's console
wording is observed — but the route itself is still unapplied, and §4's
"NOT done here" stands.
