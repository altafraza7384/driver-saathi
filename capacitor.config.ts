import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.driversaathi.app',
  appName: 'Driver Saathi',
  webDir: 'dist',
  server: {
    // Live published app: Google sign-in only works on the published domain.
    // Moved 2026-10-24 from driver-saathi.lovable.app to Firebase Hosting
    // (badge-free). Native-only change: needs a new APK/AAB to take effect
    // in the installed app; web changes still reach it via this URL.
    url: 'https://driver-saathi-app.web.app',
  },
  plugins: {
    SplashScreen: {
      // Keep the native splash up until the WebView has painted index.html's
      // built-in loader (same colours + logo), instead of auto-hiding onto a
      // blank white WebView. index.html hides it on first paint (3 s safety
      // net) and src/main.tsx again after React mounts.
      launchAutoHide: false,
      backgroundColor: '#0b2a5b',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: false,
      splashImmersive: false,
    },
        SystemBars: {
      // Edge-to-edge: the @capawesome/capacitor-android-edge-to-edge-support
      // plugin applies native insets to the WebView (fixes Razorpay checkout
      // logo/button sitting under the system bars). The built-in SystemBars
      // insets handling must be OFF or the two fight and double-count.
      insetsHandling: 'disable',
        },          
    FirebaseAuthentication: {
      // The native plugin only brokers the Google account pick and returns
      // the credential; the Firebase JS SDK performs the actual sign-in, so
      // it stays the single source of truth for auth state (the Firestore
      // adapter listens to the JS SDK's onAuthStateChanged).
      skipNativeAuth: true,
      providers: ['google.com'],
    },
  },
};

export default config;
