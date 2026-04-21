package com.klouse.vpnclient;

import androidx.annotation.NonNull;
import com.facebook.react.BaseReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.module.model.ReactModuleInfo;
import com.facebook.react.module.model.ReactModuleInfoProvider;
import com.facebook.react.uimanager.ViewManager;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Registers the VPN Client Android VPN native module with React Native.
 */
public class VpnClientPackage extends BaseReactPackage {
    @Override
    public NativeModule getModule(@NonNull String name, @NonNull ReactApplicationContext reactContext) {
        if (VpnClientModule.NAME.equals(name)) {
            return new VpnClientModule(reactContext);
        }
        return null;
    }

    @NonNull
    @Override
    public ReactModuleInfoProvider getReactModuleInfoProvider() {
        return new ReactModuleInfoProvider() {
            @Override
            public Map<String, ReactModuleInfo> getReactModuleInfos() {
                Map<String, ReactModuleInfo> infos = new HashMap<>();
                infos.put(
                        VpnClientModule.NAME,
                        new ReactModuleInfo(
                                VpnClientModule.NAME,
                                VpnClientModule.class.getName(),
                                false,
                                false,
                                false,
                                false));
                return infos;
            }
        };
    }

    @NonNull
    @Override
    public List<ViewManager> createViewManagers(ReactApplicationContext reactContext) {
        return Collections.emptyList();
    }
}
