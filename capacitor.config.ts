import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.driversaathi.app',
  appName: 'Driver Saathi',
  webDir: 'dist',
  server: {
    // Live published app: Google sign-in (/~oauth) only works on the published domain.
    url: 'https://driver-saathi.lovable.app',
  },
};

export default config;
