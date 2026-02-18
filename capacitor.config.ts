import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.driversaathi.app',
  appName: 'Driver Saathi',
  webDir: 'dist',
  server: {
    url: 'https://87f2ba68-ef69-4fc7-b0be-20f77e06132f.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
};

export default config;
