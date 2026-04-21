package com.klouse.vpnclient;

import android.app.Application;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import com.facebook.react.ReactApplication;
import com.facebook.react.ReactHost;
import com.facebook.react.ReactPackage;
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint;
import com.facebook.react.defaults.DefaultReactHost;
import com.facebook.react.defaults.DefaultReactNativeHost;
import com.facebook.react.runtime.hermes.HermesInstance;
import com.facebook.react.soloader.OpenSourceMergedSoMapping;
import com.facebook.react.shell.MainReactPackage;
import com.facebook.soloader.SoLoader;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;

public class MainApplication extends Application implements ReactApplication {
    private static final String JS_MAIN_MODULE_NAME = "index";
    private final List<ReactPackage> reactPackages =
            Arrays.<ReactPackage>asList(
                    new MainReactPackage(),
                    new VpnClientPackage());

    private final DefaultReactNativeHost reactNativeHost =
            new DefaultReactNativeHost(this) {
                @Override
                public boolean getUseDeveloperSupport() {
                    return false;
                }

                @NonNull
                @Override
                protected List<ReactPackage> getPackages() {
                    return reactPackages;
                }

                @Override
                protected String getJSMainModuleName() {
                    return JS_MAIN_MODULE_NAME;
                }

                @Nullable
                @Override
                protected String getBundleAssetName() {
                    return "index.android.bundle";
                }
            };

    @Override
    public DefaultReactNativeHost getReactNativeHost() {
        return reactNativeHost;
    }

    @Override
    @Nullable
    public ReactHost getReactHost() {
        return DefaultReactHost.getDefaultReactHost(this, reactNativeHost, new HermesInstance());
    }

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            SoLoader.init(this, OpenSourceMergedSoMapping.INSTANCE);
        } catch (IOException exception) {
            throw new RuntimeException("Failed to initialize SoLoader", exception);
        }
        DefaultNewArchitectureEntryPoint.load();
    }
}
