package com.driversaathi.app.speechsilence;

import android.content.Context;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Mutes the SpeechRecognizer start/stop beep: the beep plays on
// STREAM_MUSIC, so mute that stream for a short window around each
// start/stop. SAFETY: the plugin auto-unmutes itself on the main thread
// after `ms`, and it never unmutes a stream the user had already muted
// before we touched it — so the phone can never be left muted by us, and
// the user's own mute state is never changed.
@CapacitorPlugin(name = "SpeechSilence")
public class SpeechSilencePlugin extends Plugin {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable pendingUnmute;
    private boolean mutedByUs;

    @PluginMethod
    public void muteFor(PluginCall call) {
        int ms = call.getInt("ms", 1000);
        ms = Math.max(200, Math.min(ms, 2000));
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am != null && !am.isStreamMute(AudioManager.STREAM_MUSIC)) {
            am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, 0);
            mutedByUs = true;
        }
        if (pendingUnmute != null) handler.removeCallbacks(pendingUnmute);
        final int delayMs = ms;
        pendingUnmute = () -> {
            if (mutedByUs) {
                AudioManager am2 = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
                if (am2 != null) {
                    am2.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0);
                }
                mutedByUs = false;
            }
            pendingUnmute = null;
        };
        handler.postDelayed(pendingUnmute, delayMs);
        call.resolve(new JSObject().put("mutedMs", ms));
    }
}
