package com.reactnativegooglesignin;

import android.app.Activity;
import android.content.Intent;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.module.annotations.ReactModule;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.auth.api.signin.GoogleSignInStatusCodes;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Task;
import java.util.ArrayList;
import java.util.List;

@ReactModule(name = RNGoogleSigninModule.NAME)
public class RNGoogleSigninModule extends ReactContextBaseJavaModule {
    public static final String NAME = "RNGoogleSignin";
    private static final int RC_SIGN_IN = 9001;
    private GoogleSignInClient apiClient;
    @Nullable
    private Promise pendingSignInPromise;

    private final ActivityEventListener activityEventListener = new BaseActivityEventListener() {
        @Override
        public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
            if (requestCode != RC_SIGN_IN || pendingSignInPromise == null) {
                return;
            }

            Promise promise = pendingSignInPromise;
            pendingSignInPromise = null;
            Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(data);
            handleSignInResult(task, promise);
        }
    };

    public RNGoogleSigninModule(ReactApplicationContext reactContext) {
        super(reactContext);
        reactContext.addActivityEventListener(activityEventListener);
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void configure(ReadableMap config, Promise promise) {
        ReadableArray scopes = config.hasKey("scopes") ? config.getArray("scopes") : null;
        String webClientId = config.hasKey("webClientId") ? config.getString("webClientId") : null;
        boolean offlineAccess = config.hasKey("offlineAccess") && config.getBoolean("offlineAccess");
        boolean forceCodeForRefreshToken =
                config.hasKey("forceCodeForRefreshToken") && config.getBoolean("forceCodeForRefreshToken");
        String accountName = config.hasKey("accountName") ? config.getString("accountName") : null;
        String hostedDomain = config.hasKey("hostedDomain") ? config.getString("hostedDomain") : null;

        GoogleSignInOptions.Builder builder =
                new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                        .requestEmail()
                        .requestProfile();

        if (webClientId != null && !webClientId.isEmpty()) {
            builder.requestIdToken(webClientId);
            if (offlineAccess) {
                builder.requestServerAuthCode(webClientId, forceCodeForRefreshToken);
            }
        }

        if (accountName != null && !accountName.isEmpty()) {
            builder.setAccountName(accountName);
        }

        if (hostedDomain != null && !hostedDomain.isEmpty()) {
            builder.setHostedDomain(hostedDomain);
        }

        for (Scope scope : createScopes(scopes)) {
            builder.requestScopes(scope);
        }

        apiClient = GoogleSignIn.getClient(getReactApplicationContext(), builder.build());
        promise.resolve(null);
    }

    @ReactMethod
    public void playServicesAvailable(boolean showPlayServicesUpdateDialog, Promise promise) {
        Activity activity = getCurrentActivity();
        if (activity == null) {
            promise.reject("NULL_ACTIVITY", "Current activity is null.");
            return;
        }

        GoogleApiAvailability availability = GoogleApiAvailability.getInstance();
        int status = availability.isGooglePlayServicesAvailable(activity);
        if (status == ConnectionResult.SUCCESS) {
            promise.resolve(true);
            return;
        }

        if (showPlayServicesUpdateDialog && availability.isUserResolvableError(status)) {
            availability.getErrorDialog(activity, status, 2404).show();
        }

        promise.reject("PLAY_SERVICES_NOT_AVAILABLE", "Play services not available");
    }

    @ReactMethod
    public void signIn(ReadableMap options, Promise promise) {
        if (apiClient == null) {
            promise.reject(NAME, "apiClient is null - call configure() first");
            return;
        }

        Activity activity = getCurrentActivity();
        if (activity == null) {
            promise.reject("NULL_ACTIVITY", "Current activity is null.");
            return;
        }

        pendingSignInPromise = promise;
        UiThreadUtil.runOnUiThread(() -> activity.startActivityForResult(apiClient.getSignInIntent(), RC_SIGN_IN));
    }

    @ReactMethod
    public void signInSilently(Promise promise) {
        if (apiClient == null) {
            promise.reject(NAME, "apiClient is null - call configure() first");
            return;
        }

        apiClient.silentSignIn().addOnCompleteListener(task -> handleSignInResult(task, promise));
    }

    @ReactMethod
    public void signOut(Promise promise) {
        if (apiClient == null) {
            promise.resolve(null);
            return;
        }

        apiClient.signOut().addOnCompleteListener(task -> promise.resolve(null));
    }

    @ReactMethod
    public void revokeAccess(Promise promise) {
        if (apiClient == null) {
            promise.resolve(null);
            return;
        }

        apiClient.revokeAccess().addOnCompleteListener(task -> promise.resolve(null));
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    public boolean hasPreviousSignIn() {
        return GoogleSignIn.getLastSignedInAccount(getReactApplicationContext()) != null;
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    public @Nullable WritableMap getCurrentUser() {
        GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(getReactApplicationContext());
        return account == null ? null : getUserProperties(account);
    }

    @ReactMethod
    public void clearCachedAccessToken(String tokenString, Promise promise) {
        promise.resolve(null);
    }

    @ReactMethod
    public void getTokens(Promise promise) {
        GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(getReactApplicationContext());
        if (account == null) {
            promise.reject("SIGN_IN_REQUIRED", "No Google user is signed in.");
            return;
        }

        WritableMap tokens = Arguments.createMap();
        tokens.putString("idToken", account.getIdToken());
        tokens.putString("accessToken", null);
        promise.resolve(tokens);
    }

    @ReactMethod
    public void addScopes(ReadableMap config, Promise promise) {
        promise.resolve(false);
    }

    private void handleSignInResult(Task<GoogleSignInAccount> task, Promise promise) {
        try {
            GoogleSignInAccount account = task.getResult(ApiException.class);
            if (account == null) {
                promise.reject("SIGN_IN_FAILED", "GoogleSignInAccount is null");
                return;
            }

            promise.resolve(getUserProperties(account));
        } catch (ApiException exception) {
            int statusCode = exception.getStatusCode();
            String code = String.valueOf(statusCode);
            if (statusCode == GoogleSignInStatusCodes.SIGN_IN_CANCELLED) {
                promise.reject(code, "Sign in cancelled");
                return;
            }
            if (statusCode == CommonStatusCodes.SIGN_IN_REQUIRED) {
                promise.reject(code, "Sign in required");
                return;
            }
            if (statusCode == CommonStatusCodes.DEVELOPER_ERROR) {
                promise.reject(code, "DEVELOPER_ERROR: verify OAuth client ids and SHA fingerprints.");
                return;
            }
            promise.reject(code, exception.getLocalizedMessage(), exception);
        } catch (Exception exception) {
            promise.reject("SIGN_IN_FAILED", exception);
        }
    }

    private WritableMap getUserProperties(GoogleSignInAccount account) {
        WritableMap params = Arguments.createMap();
        WritableMap user = Arguments.createMap();
        user.putString("id", account.getId());
        user.putString("name", account.getDisplayName());
        user.putString("email", account.getEmail());
        user.putString("photo", account.getPhotoUrl() != null ? account.getPhotoUrl().toString() : null);
        user.putString("familyName", account.getFamilyName());
        user.putString("givenName", account.getGivenName());

        params.putMap("user", user);
        params.putString("idToken", account.getIdToken());
        params.putString("serverAuthCode", account.getServerAuthCode());
        params.putArray("scopes", createWritableScopes(account.getGrantedScopes()));
        return params;
    }

    private WritableArray createWritableScopes(@Nullable java.util.Set<Scope> grantedScopes) {
        WritableArray result = Arguments.createArray();
        if (grantedScopes == null) {
            return result;
        }

        for (Scope scope : grantedScopes) {
            result.pushString(scope.toString());
        }
        return result;
    }

    private List<Scope> createScopes(@Nullable ReadableArray scopes) {
        List<Scope> result = new ArrayList<>();
        if (scopes == null) {
            return result;
        }

        for (int index = 0; index < scopes.size(); index += 1) {
            String nextScope = scopes.getString(index);
            if (nextScope != null && !nextScope.isEmpty()) {
                result.add(new Scope(nextScope));
            }
        }
        return result;
    }
}
