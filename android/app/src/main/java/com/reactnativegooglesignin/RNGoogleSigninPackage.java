package com.reactnativegooglesignin;

import androidx.annotation.NonNull;
import com.facebook.react.BaseReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.module.model.ReactModuleInfo;
import com.facebook.react.module.model.ReactModuleInfoProvider;
import com.facebook.react.uimanager.ViewManager;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.HashMap;

public class RNGoogleSigninPackage extends BaseReactPackage {
    @NonNull
    @Override
    public NativeModule getModule(@NonNull String name, @NonNull ReactApplicationContext reactContext) {
        if (RNGoogleSigninModule.NAME.equals(name)) {
            return new RNGoogleSigninModule(reactContext);
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
                        RNGoogleSigninModule.NAME,
                        new ReactModuleInfo(
                                RNGoogleSigninModule.NAME,
                                RNGoogleSigninModule.class.getName(),
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
    public List<ViewManager> createViewManagers(@NonNull ReactApplicationContext reactContext) {
        return Collections.emptyList();
    }
}
