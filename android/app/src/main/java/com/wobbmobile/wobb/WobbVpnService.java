package com.wobbmobile.wobb;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.VpnService;
import android.os.Build;
import android.os.IBinder;
import android.os.ParcelFileDescriptor;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import java.io.IOException;
import libXray.LibXray;

/**
 * Android VPN service shell for Wobb mobile.
 *
 * This service owns the foreground notification, prepares the TUN interface,
 * and forwards a runtime JSON config into an embedded libXray-style Android
 * library. Concrete libXray method signatures vary between wrappers, so the
 * integration entry points are intentionally isolated behind reflection-based
 * placeholder calls.
 */
public class WobbVpnService extends VpnService {
    public static final String ACTION_START = "com.wobbmobile.wobb.action.START";
    public static final String ACTION_STOP = "com.wobbmobile.wobb.action.STOP";
    public static final String EXTRA_CONFIG_JSON = "com.wobbmobile.wobb.extra.CONFIG_JSON";

    private static final String CHANNEL_ID = "wobb_vpn_channel";
    private static final int NOTIFICATION_ID = 1042;

    @Nullable
    private ParcelFileDescriptor tunInterface;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) {
            return START_NOT_STICKY;
        }

        if (ACTION_STOP.equals(intent.getAction())) {
            stopTunnel();
            stopForeground(STOP_FOREGROUND_REMOVE);
            WobbVpnEventEmitter.emitVpnStatus("idle");
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_START.equals(intent.getAction())) {
            String configJson = intent.getStringExtra(EXTRA_CONFIG_JSON);
            startForeground(NOTIFICATION_ID, buildNotification());
            startTunnel(configJson);
            return START_STICKY;
        }

        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return super.onBind(intent);
    }

    private Notification buildNotification() {
        createChannelIfNeeded();

        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launchIntent == null) {
            launchIntent = new Intent();
        }
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                : PendingIntent.FLAG_UPDATE_CURRENT
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle("WOBB VPN")
            .setContentText("VPN tunnel is active on this device.")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(contentIntent)
            .build();
    }

    private void createChannelIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager =
            (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        if (manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "WOBB VPN",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("WOBB mobile VPN status");
        manager.createNotificationChannel(channel);
    }

    /**
     * Prepares the TUN interface and starts the embedded core through the
     * project-specific Android library wrapper.
     */
    private synchronized void startTunnel(@Nullable String configJson) {
        stopTunnel();
        WobbVpnEventEmitter.emitVpnStatus("connecting");
        WobbVpnEventEmitter.emitLog("service", "Preparing Android TUN interface.");

        Builder builder = new Builder()
            .setSession("WOBB VPN")
            .addAddress("10.0.0.2", 32)
            .addDnsServer("1.1.1.1")
            .addRoute("0.0.0.0", 0);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            builder.setMetered(false);
        }

        tunInterface = builder.establish();

        if (tunInterface == null) {
            WobbVpnEventEmitter.emitLog("stderr", "Failed to establish Android VPN interface.");
            WobbVpnEventEmitter.emitVpnStatus("error");
            stopSelf();
            return;
        }

        WobbVpnEventEmitter.emitLog("service", "Android VPN interface established.");

        try {
            startEmbeddedCore(configJson == null ? "{}" : configJson, tunInterface.getFd());
            WobbVpnEventEmitter.emitLog("service", "Embedded Wobb Core started.");
            WobbVpnEventEmitter.emitVpnStatus("connected");
        } catch (Exception exception) {
            WobbVpnEventEmitter.emitLog("stderr", "Failed to start embedded core: " + exception.getMessage());
            stopTunnel();
            WobbVpnEventEmitter.emitVpnStatus("error");
            stopSelf();
        }
    }

    /**
     * Placeholder libXray invocation.
     *
     * Replace the reflective lookup with your concrete wrapper once the final
     * `.aar` API surface is fixed. The expected shape is similar to:
     * `libXray.Xray.startVpn(configString)`.
     */
    private void startEmbeddedCore(String configString, int tunFd) throws Exception {
        WobbVpnEventEmitter.emitLog("service", "Calling libXray.LibXray.runXrayFromJSON(...).");
        String result = LibXray.runXrayFromJSON(configString);
        WobbVpnEventEmitter.emitLog("service", "LibXray response: " + result);
    }

    /**
     * Placeholder libXray shutdown hook.
     */
    private void stopEmbeddedCore() {
        try {
            WobbVpnEventEmitter.emitLog("service", "Stopping embedded Wobb Core bridge.");
            String result = LibXray.stopXray();
            WobbVpnEventEmitter.emitLog("service", "Embedded Wobb Core stopped: " + result);
        } catch (Exception exception) {
            WobbVpnEventEmitter.emitLog("stderr", "Embedded core shutdown hook unavailable: " + exception.getMessage());
        }
    }

    /**
     * Stops the embedded core and closes the TUN descriptor.
     */
    private synchronized void stopTunnel() {
        stopEmbeddedCore();

        if (tunInterface == null) {
            return;
        }

        try {
            tunInterface.close();
            WobbVpnEventEmitter.emitLog("service", "Android VPN interface closed.");
        } catch (IOException exception) {
            WobbVpnEventEmitter.emitLog("stderr", "Failed to close Android VPN interface: " + exception.getMessage());
        } finally {
            tunInterface = null;
        }
    }

    @Override
    public void onDestroy() {
        stopTunnel();
        WobbVpnEventEmitter.emitVpnStatus("idle");
        super.onDestroy();
    }
}
