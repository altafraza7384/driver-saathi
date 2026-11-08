package com.driversaathi.app.nativeads;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.TextView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.ads.AdListener;
import com.google.android.gms.ads.AdLoader;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.LoadAdError;
import com.google.android.gms.ads.VideoOptions;
import com.google.android.gms.ads.nativead.MediaView;
import com.google.android.gms.ads.nativead.NativeAd;
import com.google.android.gms.ads.nativead.NativeAdOptions;
import com.google.android.gms.ads.nativead.NativeAdView;

/**
 * Native bridge for inline AdMob native ads (video-capable).
 * The web page reserves a slot div and reports its rect in CSS pixels
 * relative to the WebView; this plugin loads a native ad and overlays a
 * NativeAdView at exactly that rect (video plays muted inside the
 * MediaView when the served ad has video content).
 * Methods: showNativeAd ({ adUnitId }), setAdRect ({ x, y, width, height }),
 * hideNativeAd ().
 */
@CapacitorPlugin(name = "NativeAds")
public class NativeAdsPlugin extends Plugin {

    // Serialize slot state, load callbacks and view cleanup on the UI thread.
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private long loadGeneration = 0;
    private NativeAd nativeAd;
    private NativeAdView adView;
    private float density = 1.0f;
    private double lastX, lastY, lastW, lastH;
    private boolean hasRect = false;

    @PluginMethod
    public void showNativeAd(PluginCall call) {
        String adUnitId = call.getString("adUnitId");
        if (adUnitId == null || adUnitId.isEmpty()) {
            call.reject("adUnitId is required");
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        mainHandler.post(() -> {
            final long generation = ++loadGeneration;
            density = activity.getResources().getDisplayMetrics().density;
            VideoOptions videoOptions = new VideoOptions.Builder().setStartMuted(true).build();
            NativeAdOptions options = new NativeAdOptions.Builder().setVideoOptions(videoOptions).build();
            AdLoader loader = new AdLoader.Builder(getContext(), adUnitId)
                .forNativeAd(ad -> mainHandler.post(() -> {
                    // Hide or a newer show invalidates this load, even after a remount.
                    if (generation != loadGeneration) {
                        ad.destroy();
                        return;
                    }
                    releaseAd();
                    nativeAd = ad;
                    attachAdView();
                    JSObject ret = new JSObject();
                    ret.put("loaded", true);
                    notifyListeners("nativeAdLoaded", ret);
                }))
                .withAdListener(new AdListener() {
                    @Override
                    public void onAdFailedToLoad(LoadAdError error) {
                        mainHandler.post(() -> {
                            if (generation != loadGeneration) return;
                            JSObject ret = new JSObject();
                            ret.put("code", error.getCode());
                            ret.put("message", error.getMessage());
                            notifyListeners("nativeAdFailedToLoad", ret);
                        });
                    }
                })
                .withNativeAdOptions(options)
                .build();
            loader.loadAd(new AdRequest.Builder().build());
            call.resolve();
        });
    }

    @PluginMethod
    public void setAdRect(PluginCall call) {
        Double x = call.getDouble("x");
        Double y = call.getDouble("y");
        Double w = call.getDouble("width");
        Double h = call.getDouble("height");
        if (x == null || y == null || w == null || h == null || w <= 0 || h <= 0) {
            call.reject("x, y, width and height are required and width/height must be positive");
            return;
        }
        mainHandler.post(() -> {
            lastX = x;
            lastY = y;
            lastW = w;
            lastH = h;
            hasRect = true;
            // The ad may have loaded before the first rect arrived (cached
            // or instant load): attachAdView() only runs from onAdLoaded and
            // returns early without a rect, so attach it here when needed.
            if (nativeAd != null && adView == null) attachAdView();
            repositionAdView();
            call.resolve();
        });
    }

    @PluginMethod
    public void hideNativeAd(PluginCall call) {
        mainHandler.post(() -> {
            destroyAd();
            call.resolve();
        });
    }

    private void attachAdView() {
        Activity activity = getActivity();
        if (activity == null || nativeAd == null || !hasRect) return;
        ViewGroup decor = (ViewGroup) activity.getWindow().getDecorView();
        int layoutId;
        if (lastH <= 60) {
            layoutId = R.layout.native_ad_banner_layout;
        } else if (lastH < 180) {
            layoutId = R.layout.native_ad_compact_layout;
        } else {
            layoutId = R.layout.native_ad_layout;
        }
        NativeAdView view = (NativeAdView) activity.getLayoutInflater().inflate(layoutId, decor, false);
        MediaView mediaView = view.findViewById(R.id.ad_media);
        TextView headline = view.findViewById(R.id.ad_headline);
        TextView body = view.findViewById(R.id.ad_body);
        TextView advertiser = view.findViewById(R.id.ad_advertiser);
        Button cta = view.findViewById(R.id.ad_cta);
        ImageView icon = view.findViewById(R.id.ad_icon);
        if (mediaView != null) view.setMediaView(mediaView);
        view.setHeadlineView(headline);
        view.setBodyView(body);
        view.setAdvertiserView(advertiser);
        view.setCallToActionView(cta);
        view.setIconView(icon);
        headline.setText(nativeAd.getHeadline());
        if (nativeAd.getBody() != null) body.setText(nativeAd.getBody()); else body.setVisibility(View.GONE);
        if (nativeAd.getAdvertiser() != null) advertiser.setText(nativeAd.getAdvertiser()); else advertiser.setVisibility(View.GONE);
        if (nativeAd.getCallToAction() != null) cta.setText(nativeAd.getCallToAction()); else cta.setVisibility(View.GONE);
        if (nativeAd.getIcon() != null) icon.setImageDrawable(nativeAd.getIcon().getDrawable()); else icon.setVisibility(View.GONE);
        if (mediaView != null && nativeAd.getMediaContent() != null) mediaView.setMediaContent(nativeAd.getMediaContent());
        view.setNativeAd(nativeAd);
        decor.addView(view, layoutParams());
        adView = view;
    }

    private void repositionAdView() {
        if (adView == null) return;
        adView.setLayoutParams(layoutParams());
    }

    private FrameLayout.LayoutParams layoutParams() {
        int[] webLoc = new int[2];
        WebView webView = getBridge().getWebView();
        if (webView != null) webView.getLocationOnScreen(webLoc);
        int left = webLoc[0] + (int) Math.round(lastX * density);
        int top = webLoc[1] + (int) Math.round(lastY * density);
        int width = (int) Math.round(lastW * density);
        int height = (int) Math.round(lastH * density);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(width, height);
        params.leftMargin = left;
        params.topMargin = top;
        return params;
    }

    private void destroyAd() {
        ++loadGeneration;
        hasRect = false;
        lastX = lastY = lastW = lastH = 0;
        releaseAd();
    }

    // Replacing an accepted ad must preserve the current slot's rect and generation.
    private void releaseAd() {
        if (adView != null) {
            ViewGroup parent = (ViewGroup) adView.getParent();
            if (parent != null) parent.removeView(adView);
            adView = null;
        }
        if (nativeAd != null) {
            nativeAd.destroy();
            nativeAd = null;
        }
    }
}
