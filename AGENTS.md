# Project rules

- Use shared date/time picker dialogs for vehicle and reminder forms, keeping date-only values as local `yyyy-MM-dd` strings; nested portal layers prevent native WebView picker and modal clipping failures.- New releases are detected by comparing the build id baked into the bundle with /version.json (emitted per build); Android Play updates use the in-app update plugin. Why: users get an Update prompt without manual checks.
