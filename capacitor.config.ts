import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.driversaathi.app',
  appName: 'Driver Saathi',
  webDir: 'dist',
  server: {
    // Live published app: Google sign-in (/~oauth) only works on the published domain.
    url: 'https://driver-saathi.lovable.app',
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
