package com.driversaathi.app.nativeads;

import android.app.Activity;
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
        density = activity.getResources().getDisplayMetrics().density;
        VideoOptions videoOptions = new VideoOptions.Builder().setStartMuted(true).build();
        NativeAdOptions options = new NativeAdOptions.Builder().setVideoOptions(videoOptions).build();
        AdLoader loader = new AdLoader.Builder(getContext(), adUnitId)
            .forNativeAd(ad -> {
                destroyAd();
                nativeAd = ad;
                activity.runOnUiThread(() -> {
                    attachAdView();
                    JSObject ret = new JSObject();
                    ret.put("loaded", true);
                    notifyListeners("nativeAdLoaded", ret);
                });
            })
            .withAdListener(new AdListener() {
                @Override
                public void onAdFailedToLoad(LoadAdError error) {
                    JSObject ret = new JSObject();
                    ret.put("code", error.getCode());
                    ret.put("message", error.getMessage());
                    notifyListeners("nativeAdFailedToLoad", ret);
                }
            })
            .withNativeAdOptions(options)
            .build();
        loader.loadAd(new AdRequest.Builder().build());
        call.resolve();
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
        lastX = x;
        lastY = y;
        lastW = w;
        lastH = h;
        hasRect = true;
        Activity activity = getActivity();
        if (activity != null && adView != null) {
            activity.runOnUiThread(this::repositionAdView);
        }
        call.resolve();
    }

    @PluginMethod
    public void hideNativeAd(PluginCall call) {
        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(this::destroyAd);
        } else {
            destroyAd();
        }
        call.resolve();
    }

    private void attachAdView() {
        Activity activity = getActivity();
        if (activity == null || nativeAd == null || !hasRect) return;
        ViewGroup decor = (ViewGroup) activity.getWindow().getDecorView();
        NativeAdView view = (NativeAdView) activity.getLayoutInflater().inflate(R.layout.native_ad_layout, decor, false);
        MediaView mediaView = view.findViewById(R.id.ad_media);
        TextView headline = view.findViewById(R.id.ad_headline);
        TextView body = view.findViewById(R.id.ad_body);
        TextView advertiser = view.findViewById(R.id.ad_advertiser);
        Button cta = view.findViewById(R.id.ad_cta);
        ImageView icon = view.findViewById(R.id.ad_icon);
        view.setMediaView(mediaView);
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
        if (nativeAd.getMediaContent() != null) mediaView.setMediaContent(nativeAd.getMediaContent());
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
