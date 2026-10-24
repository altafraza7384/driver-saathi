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
