import { NativeModules } from 'react-native';

export type GoogleUser = {
  user: {
    id: string | null;
    name: string | null;
    email: string | null;
    photo: string | null;
    familyName: string | null;
    givenName: string | null;
  };
  idToken: string | null;
  serverAuthCode: string | null;
  scopes: string[];
};

type GoogleSignInNativeModule = {
  configure?: (config: {
    webClientId?: string;
    offlineAccess?: boolean;
    forceCodeForRefreshToken?: boolean;
    scopes?: string[];
    accountName?: string;
    hostedDomain?: string;
  }) => Promise<void>;
  playServicesAvailable?: (showPlayServicesUpdateDialog: boolean) => Promise<boolean>;
  signIn?: (options?: Record<string, never>) => Promise<GoogleUser>;
  signInSilently?: () => Promise<GoogleUser>;
  signOut?: () => Promise<void>;
  revokeAccess?: () => Promise<void>;
  hasPreviousSignIn?: () => boolean;
  getCurrentUser?: () => GoogleUser | null;
  getTokens?: () => Promise<{ idToken: string | null; accessToken: string | null }>;
  clearCachedAccessToken?: (token: string) => Promise<void>;
};

const nativeModule = NativeModules.RNGoogleSignin as GoogleSignInNativeModule | undefined;

function requireNativeModule(): GoogleSignInNativeModule {
  if (!nativeModule) {
    throw new Error('RNGoogleSignin native module is unavailable in this Android build.');
  }
  return nativeModule;
}

export const statusCodes = {
  SIGN_IN_CANCELLED: '12501',
  IN_PROGRESS: 'IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  SIGN_IN_REQUIRED: '4',
};

export const GoogleSignin = {
  configure(config: {
    webClientId?: string;
    offlineAccess?: boolean;
    forceCodeForRefreshToken?: boolean;
    scopes?: string[];
    accountName?: string;
    hostedDomain?: string;
  }): Promise<void> {
    return requireNativeModule().configure?.(config) ?? Promise.resolve();
  },

  hasPlayServices(options?: { showPlayServicesUpdateDialog?: boolean }): Promise<boolean> {
    return (
      requireNativeModule().playServicesAvailable?.(
        options?.showPlayServicesUpdateDialog ?? true
      ) ?? Promise.resolve(true)
    );
  },

  signIn(): Promise<GoogleUser> {
    return requireNativeModule().signIn?.({}) ?? Promise.reject(new Error('signIn is unavailable.'));
  },

  signInSilently(): Promise<GoogleUser> {
    return (
      requireNativeModule().signInSilently?.() ??
      Promise.reject(new Error('signInSilently is unavailable.'))
    );
  },

  signOut(): Promise<void> {
    return requireNativeModule().signOut?.() ?? Promise.resolve();
  },

  revokeAccess(): Promise<void> {
    return requireNativeModule().revokeAccess?.() ?? Promise.resolve();
  },

  getCurrentUser(): GoogleUser | null {
    return requireNativeModule().getCurrentUser?.() ?? null;
  },

  getTokens(): Promise<{ idToken: string | null; accessToken: string | null }> {
    return requireNativeModule().getTokens?.() ?? Promise.resolve({ idToken: null, accessToken: null });
  },

  hasPreviousSignIn(): boolean {
    return requireNativeModule().hasPreviousSignIn?.() ?? false;
  },

  clearCachedAccessToken(token: string): Promise<void> {
    return requireNativeModule().clearCachedAccessToken?.(token) ?? Promise.resolve();
  },
};
