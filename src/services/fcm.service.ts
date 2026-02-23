import { FirebaseMessaging, NotificationActionPerformedEvent } from '@capacitor-firebase/messaging';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export class FCMService {
    /**
     * Initialize Firebase Cloud Messaging
     * Call this when the app starts
     */
    static async initialize() {
        if (!Capacitor.isNativePlatform()) {
            console.log('FCM is only available on native platforms');
            return;
        }

        try {
            // Request permission for notifications
            const permission = await FirebaseMessaging.requestPermissions();

            if (permission.receive === 'granted') {
                console.log('✅ Push notification permission granted');

                // Get FCM token
                const { token } = await FirebaseMessaging.getToken();
                console.log('📱 FCM Token:', token);

                // Save token to backend
                await this.saveTokenToBackend(token);

                // Listen for token refresh
                await FirebaseMessaging.addListener('tokenReceived', (event) => {
                    console.log('🔄 Token refreshed:', event.token);
                    this.saveTokenToBackend(event.token);
                });

                // Listen for notifications when app is in foreground
                await FirebaseMessaging.addListener('notificationReceived', (notification) => {
                    console.log('🔔 Notification received:', notification);
                    // You can show a custom in-app notification here
                });

                // Listen for notification actions (when user taps notification)
                await FirebaseMessaging.addListener('notificationActionPerformed', (action: NotificationActionPerformedEvent) => {
                    console.log('👆 Notification action:', action);
                    this.handleNotificationAction(action);
                });

                console.log('✅ FCM initialized successfully');
            } else {
                console.log('❌ Push notification permission denied');
            }
        } catch (error) {
            console.error('❌ Error initializing FCM:', error);
        }
    }

    /**
     * Save FCM token to Supabase
     */
    static async saveTokenToBackend(token: string) {
        try {
            const { data: { user } } = await supabase.auth.getUser();

            if (!user) {
                console.log('⚠️ No user logged in, token not saved');
                return;
            }

            const { error } = await db
                .from('fcm_tokens')
                .upsert({
                    user_id: user.id,
                    token: token,
                    device_info: {
                        platform: Capacitor.getPlatform(),
                        timestamp: new Date().toISOString(),
                        app_version: '1.0.0'
                    },
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'token'
                });

            if (error) {
                console.error('❌ Error saving token to Supabase:', error);
            } else {
                console.log('✅ FCM token saved to Supabase');
            }
        } catch (error) {
            console.error('❌ Error in saveTokenToBackend:', error);
        }
    }

    /**
     * Handle notification actions (when user taps notification)
     */
    static handleNotificationAction(action: NotificationActionPerformedEvent) {
        const data = action.notification?.data as Record<string, string> | undefined;

        if (!data) {
            console.log('No data in notification');
            return;
        }

        // Handle different notification types
        if (data.route) {
            // Navigate to specific route
            console.log('Navigating to:', data.route);
            window.location.href = data.route;
        }

        if (data.type === 'reminder') {
            // Handle reminder notification
            window.location.href = '/reminders';
        }

        if (data.type === 'transaction') {
            // Handle transaction notification
            window.location.href = '/transactions';
        }

        if (data.type === 'debt') {
            // Handle debt notification
            window.location.href = '/debts';
        }

        if (data.type === 'goal') {
            // Handle goal notification
            window.location.href = '/goals';
        }

        if (data.type === 'sos') {
            // Handle SOS notification
            window.location.href = '/sos';
        }
    }

    /**
     * Get current FCM token
     */
    static async getToken(): Promise<string | null> {
        try {
            if (!Capacitor.isNativePlatform()) {
                return null;
            }

            const { token } = await FirebaseMessaging.getToken();
            return token;
        } catch (error) {
            console.error('Error getting FCM token:', error);
            return null;
        }
    }

    /**
     * Delete FCM token (call on logout)
     */
    static async deleteToken() {
        try {
            if (!Capacitor.isNativePlatform()) {
                return;
            }

            await FirebaseMessaging.deleteToken();
            console.log('✅ FCM token deleted');

            // Also remove from Supabase
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                await db
                    .from('fcm_tokens')
                    .delete()
                    .eq('user_id', user.id);
            }
        } catch (error) {
            console.error('❌ Error deleting token:', error);
        }
    }

    /**
     * Subscribe to a topic
     */
    static async subscribeToTopic(topic: string) {
        try {
            if (!Capacitor.isNativePlatform()) {
                return;
            }

            await FirebaseMessaging.subscribeToTopic({ topic });
            console.log(`✅ Subscribed to topic: ${topic}`);
        } catch (error) {
            console.error(`❌ Error subscribing to topic ${topic}:`, error);
        }
    }

    /**
     * Unsubscribe from a topic
     */
    static async unsubscribeFromTopic(topic: string) {
        try {
            if (!Capacitor.isNativePlatform()) {
                return;
            }

            await FirebaseMessaging.unsubscribeFromTopic({ topic });
            console.log(`✅ Unsubscribed from topic: ${topic}`);
        } catch (error) {
            console.error(`❌ Error unsubscribing from topic ${topic}:`, error);
        }
    }
}
