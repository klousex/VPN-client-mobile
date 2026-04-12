package com.wobbmobile.wobb;

import androidx.annotation.Nullable;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

/**
 * Emits VPN lifecycle events from Android native code back to React Native.
 */
public final class WobbVpnEventEmitter {
    @Nullable
    private static ReactApplicationContext reactContext;

    private WobbVpnEventEmitter() {
    }

    public static void register(ReactApplicationContext context) {
        reactContext = context;
    }

    public static void emitVpnStatus(String status) {
        emit("WobbVpnStatus", "status", status);
    }

    public static void emitPermissionStatus(String status) {
        emit("WobbVpnPermission", "status", status);
    }

    public static void emitLog(String stream, String message) {
        if (reactContext == null || !reactContext.hasActiveReactInstance()) {
            return;
        }

        WritableMap payload = Arguments.createMap();
        payload.putString("stream", stream);
        payload.putString("message", message);
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
            .emit("WobbVpnLog", payload);
    }

    private static void emit(String eventName, String key, String value) {
        if (reactContext == null || !reactContext.hasActiveReactInstance()) {
            return;
        }

        WritableMap payload = Arguments.createMap();
        payload.putString(key, value);
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
            .emit(eventName, payload);
    }
}
