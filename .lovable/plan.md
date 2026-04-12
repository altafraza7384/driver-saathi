

# Plan: Fix All Critical Android App Issues

## Issues to Fix

### 1. Move Privacy Policy Outside Protected Routes
**Problem**: `/privacy-policy` is inside `ProtectedRoutes`, requiring login. App stores mandate public access.
**Fix**: Move the `<Route path="/privacy-policy">` outside the protected route group in `src/App.tsx`, placing it alongside `/auth`.

### 2. Add Missing App Icons
**Problem**: `manifest.json` references `/icon-192.png` and `/icon-512.png` but neither file exists.
**Fix**: Generate proper 192x192 and 512x512 PNG app icons programmatically (a steering wheel / car-themed icon with "DS" branding matching the app's black/white theme) and place them in `/public`.

### 3. Fix UI Overlap Bugs
**Problem**: Content hidden behind bottom tab bar; top/bottom overlap; modals overlap with keyboard on Android; nav buttons too low on Android.
**Fix** (in `src/index.css`, `src/components/layout/AppLayout.tsx`, `src/components/layout/BottomNav.tsx`):
- Increase `pb-24` to `pb-28` on main content to clear bottom nav
- Add `mb-safe` spacing to bottom nav with extra padding for Android nav buttons
- Update `.safe-bottom` CSS to use `max(env(safe-area-inset-bottom), 16px)` so Android devices without notches still get clearance
- Add `interactive-widget=resizes-content` meta tag (already present in viewport) to handle keyboard overlap for modals/forms

### 4. Add Account Deletion Feature
**Problem**: Google Play requires a "Delete Account" option. Currently missing.
**Fix**:
- Add a "Delete My Account" button in `src/pages/SettingsPage.tsx` with a confirmation dialog (type "DELETE" to confirm)
- Create a new edge function `supabase/functions/delete-account/index.ts` that:
  - Validates the user's JWT
  - Deletes all user data from every table (transactions, profiles, debts, goals, notes, etc.)
  - Deletes the user from `auth.users` using the service role key
- Sign the user out after successful deletion

### 5. Update Support Email
**Problem**: Contact dialog shows `support@driversaathi.app` instead of the actual support email.
**Fix**: Update `src/pages/MorePage.tsx` to use `razakhan.chino@gmail.com` as the email address in both the mailto link and display text.

## Files to Create/Edit
- `src/App.tsx` — move privacy-policy route
- `src/pages/SettingsPage.tsx` — add delete account button + confirmation
- `src/pages/MorePage.tsx` — update support email
- `src/components/layout/AppLayout.tsx` — adjust content padding
- `src/components/layout/BottomNav.tsx` — adjust bottom nav safe area
- `src/index.css` — improve safe-area CSS for Android
- `supabase/functions/delete-account/index.ts` — new edge function
- `public/icon-192.png`, `public/icon-512.png` — generated app icons
- Database migration: none needed (delete function uses service role)

