import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  DeviceEventEmitter,
  Linking,
  NativeModules,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { GoogleSignin } from './googleSignIn';
import * as storage from './storage';

type ConnectionState =
  | 'idle'
  | 'verifying'
  | 'permission_required'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'blocked'
  | 'error';

type ConnectionMode = 'vpn' | 'proxy' | 'own_server';

type ApiError = Error & {
  code?: string;
  prompt?: string;
};

type SessionData = {
  mode: ConnectionMode;
  state: 'idle' | 'blocked';
  user: {
    id: number;
    googleEmail: string;
    googleSub: string;
    uuid: string;
    xrayUuid: string | null;
    vpnKey: string | null;
    installationId: string | null;
    telegramUsername: string | null;
  };
  subscription: {
    tier: string;
    title: string;
    status: string;
    isLifetime: boolean;
    isActive: boolean;
    expiryDate: string | null;
    daysRemaining: number | null;
    devicesLimit: number;
    blockedReason: string | null;
  };
  traffic: {
    usedBytes: number;
    limitBytes: number;
    remainingBytes: number;
  };
  location: {
    selectedId: string | null;
  };
  provisioning: {
    assignedEndpoint: string | null;
    maintenanceMode: boolean;
    maintenanceReason: string | null;
    vpnConfig: Record<string, unknown> | null;
  };
  diagnostics: {
    serverTime: string;
    messages: Array<{
      level?: string;
      message: string;
    }>;
  };
};

type SessionApiResponse = {
  success: boolean;
  message?: string;
  data?: SessionData;
};

type LocationItem = {
  id: string;
  country: string;
  flag: string;
  city: string;
  loadPercent: number;
};

type DiagnosticLogEntry = {
  id: string;
  level: 'info' | 'warn' | 'error';
  source: 'app' | 'native' | 'api';
  message: string;
  timestamp: string;
};

const API_BASE_CANDIDATES = ['http://127.0.0.1:3000', 'http://10.0.2.2:3000'];
const SESSION_CACHE_KEY = 'wobb.mobile.session.v7';
const SESSION_TOKEN_KEY = 'wobb.mobile.session-token.v4';
const INSTALLATION_ID_KEY = 'wobb.mobile.installation-id.v1';
const SELECTED_LOCATION_KEY = 'wobb.mobile.location.v1';
const GOOGLE_WEB_CLIENT_ID =
  '157778125537-th8lu3rlhkm1gieqisv0e73lvdh0g5re.apps.googleusercontent.com';

const COLORS = {
  background: '#F3F4F6',
  panel: '#FFFFFF',
  border: '#D1D5DB',
  text: '#111827',
  muted: '#6B7280',
  accent: '#111827',
  accentSoft: '#E5E7EB',
  success: '#166534',
  successSoft: '#DCFCE7',
  warning: '#92400E',
  warningSoft: '#FEF3C7',
  danger: '#991B1B',
  dangerSoft: '#FEE2E2'
};

const { WobbVpnModule } = NativeModules as {
  WobbVpnModule?: {
    prepareVpn?: () => Promise<{ granted?: boolean }>;
    startVpn?: (configJson: string) => Promise<void>;
    stopVpn?: () => Promise<void>;
    getOrCreateInstallationId?: () => Promise<string>;
  };
};

const VpnInterface = {
  async prepare(): Promise<void> {
    if (!WobbVpnModule?.prepareVpn) {
      throw new Error('VPN bridge is unavailable in this Android build.');
    }

    const result = await WobbVpnModule.prepareVpn();
    if (result?.granted === false) {
      throw new Error('VPN permission was not granted.');
    }
  },
  start(config: Record<string, unknown>) {
    if (!WobbVpnModule?.startVpn) {
      return Promise.reject(new Error('VpnInterface.start is unavailable in this build.'));
    }

    return WobbVpnModule.startVpn(JSON.stringify(config));
  },
  stop() {
    if (!WobbVpnModule?.stopVpn) {
      return Promise.reject(new Error('VpnInterface.stop is unavailable in this build.'));
    }

    return WobbVpnModule.stopVpn();
  }
};

function createPseudoUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const next = character === 'x' ? random : (random & 0x3) | 0x8;
    return next.toString(16);
  });
}

async function getInstallationId(): Promise<string> {
  if (WobbVpnModule?.getOrCreateInstallationId) {
    return WobbVpnModule.getOrCreateInstallationId();
  }

  const existing = await storage.getItem(INSTALLATION_ID_KEY);
  if (existing) {
    return existing;
  }

  const created = createPseudoUuid();
  await storage.setItem(INSTALLATION_ID_KEY, created);
  return created;
}

async function readCachedSession(): Promise<SessionData | null> {
  const raw = await storage.getItem(SESSION_CACHE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

async function writeCachedSession(session: SessionData): Promise<void> {
  await storage.setItem(SESSION_CACHE_KEY, JSON.stringify(session));
}

async function readCachedToken(): Promise<string | null> {
  return storage.getItem(SESSION_TOKEN_KEY);
}

async function writeCachedToken(idToken: string): Promise<void> {
  await storage.setItem(SESSION_TOKEN_KEY, idToken);
}

async function readSelectedLocation(): Promise<string | null> {
  return storage.getItem(SELECTED_LOCATION_KEY);
}

async function writeSelectedLocation(locationId: string): Promise<void> {
  await storage.setItem(SELECTED_LOCATION_KEY, locationId);
}

function formatBytes(bytes: number): string {
  const safeBytes = Math.max(0, Number(bytes || 0));
  const gb = safeBytes / (1024 * 1024 * 1024);
  const rounded = gb < 10 ? Math.round(gb * 10) / 10 : Math.round(gb);
  return `${rounded} GB`;
}

function formatExpiry(subscription: SessionData['subscription']): string {
  if (subscription.isLifetime) {
    return 'Lifetime';
  }

  if (subscription.daysRemaining == null) {
    return 'Unknown';
  }

  return `${subscription.daysRemaining} day${subscription.daysRemaining === 1 ? '' : 's'}`;
}

function formatBlockedReason(reason: string | null): string {
  switch (reason) {
    case 'quota_exhausted':
      return 'Traffic limit reached';
    case 'expired':
      return 'Subscription expired';
    case 'inactive':
      return 'Subscription inactive';
    default:
      return reason || 'Blocked';
  }
}

function createLogEntry(
  source: DiagnosticLogEntry['source'],
  message: string,
  level: DiagnosticLogEntry['level'] = 'info'
): DiagnosticLogEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    source,
    message,
    level,
    timestamp: new Date().toISOString()
  };
}

function deriveConnectionState(session: SessionData | null, localState: ConnectionState): ConnectionState {
  if (session?.subscription?.blockedReason) {
    return 'blocked';
  }

  return localState;
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let lastError: unknown;

  for (const baseUrl of API_BASE_CANDIDATES) {
    try {
      const response = await fetch(`${baseUrl}${path}`, init);
      const payload = (await response.json()) as T & { message?: string; code?: string; prompt?: string };

      if (!response.ok) {
        const error = new Error(payload.message || `Request failed with status ${response.status}`) as ApiError;
        error.code = payload.code;
        error.prompt = payload.prompt;
        throw error;
      }

      return payload;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('API request failed');
}

async function openMobileSession(params: {
  installationId: string;
  googleIdToken: string;
  transferSession?: boolean;
  locationId?: string;
}): Promise<SessionApiResponse> {
  return apiRequest<SessionApiResponse>('/api/v1/mobile/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params)
  });
}

async function fetchMobileState(
  installationId: string,
  locationId?: string
): Promise<SessionApiResponse> {
  const query = locationId ? `?locationId=${encodeURIComponent(locationId)}` : '';
  return apiRequest<SessionApiResponse>(`/api/v1/mobile/state/${installationId}${query}`);
}

async function fetchLocations(): Promise<LocationItem[]> {
  const response = await apiRequest<{ success: boolean; data?: LocationItem[] }>('/api/locations');
  return response.data || [];
}

function stateLabel(state: ConnectionState, session: SessionData | null): string {
  switch (state) {
    case 'verifying':
      return 'Verifying access';
    case 'permission_required':
      return 'VPN permission required';
    case 'connecting':
      return 'Connecting';
    case 'connected':
      return 'Connected';
    case 'disconnecting':
      return 'Disconnecting';
    case 'blocked':
      return formatBlockedReason(session?.subscription?.blockedReason || null);
    case 'error':
      return 'Connection error';
    default:
      return 'Idle';
  }
}

function stateTone(state: ConnectionState) {
  if (state === 'connected') {
    return {
      text: COLORS.success,
      background: COLORS.successSoft
    };
  }

  if (state === 'blocked' || state === 'error') {
    return {
      text: COLORS.danger,
      background: COLORS.dangerSoft
    };
  }

  if (state === 'verifying' || state === 'connecting' || state === 'disconnecting' || state === 'permission_required') {
    return {
      text: COLORS.warning,
      background: COLORS.warningSoft
    };
  }

  return {
    text: COLORS.text,
    background: COLORS.accentSoft
  };
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [localConnectionState, setLocalConnectionState] = useState<ConnectionState>('idle');
  const [session, setSession] = useState<SessionData | null>(null);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [logs, setLogs] = useState<DiagnosticLogEntry[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionRef = useRef<SessionData | null>(null);

  const effectiveConnectionState = deriveConnectionState(session, localConnectionState);
  const tone = stateTone(effectiveConnectionState);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  function appendLog(
    source: DiagnosticLogEntry['source'],
    message: string,
    level: DiagnosticLogEntry['level'] = 'info'
  ) {
    setLogs((current) => [...current, createLogEntry(source, message, level)].slice(-120));
  }

  async function applySession(response: SessionApiResponse) {
    if (!response.data) {
      return;
    }

    await writeCachedSession(response.data);
    setSession(response.data);
    setSelectedLocationId(response.data.location.selectedId);

    if (response.data.diagnostics.messages.length > 0) {
      for (const message of response.data.diagnostics.messages) {
        appendLog('api', message.message, (message.level as DiagnosticLogEntry['level']) || 'info');
      }
    }

    if (response.data.provisioning.maintenanceMode && response.data.provisioning.maintenanceReason) {
      appendLog('api', response.data.provisioning.maintenanceReason, 'warn');
    }

    if (response.message === 'Limit Exceeded' || response.data.subscription.blockedReason) {
      setLocalConnectionState('blocked');
    } else if (localConnectionState === 'verifying') {
      setLocalConnectionState('idle');
    }
  }

  useEffect(() => {
    let cancelled = false;

    const statusListener = DeviceEventEmitter.addListener('WobbVpnStatus', (payload) => {
      const status = String(payload?.status || '').toLowerCase();

      if (status === 'connecting') {
        setLocalConnectionState('connecting');
        appendLog('native', 'VPN service is starting.');
      } else if (status === 'connected') {
        setLocalConnectionState('connected');
        appendLog('native', 'VPN tunnel connected.');
      } else if (status === 'disconnecting') {
        setLocalConnectionState('disconnecting');
        appendLog('native', 'VPN tunnel is stopping.');
      } else if (status === 'idle' || status === 'disconnected') {
        setLocalConnectionState(sessionRef.current?.subscription.blockedReason ? 'blocked' : 'idle');
        appendLog('native', 'VPN tunnel is idle.');
      } else if (status === 'error') {
        setLocalConnectionState('error');
        appendLog('native', 'VPN service reported an error.', 'error');
      }
    });

    const permissionListener = DeviceEventEmitter.addListener('WobbVpnPermission', (payload) => {
      const status = String(payload?.status || '').toLowerCase();
      if (status === 'requested') {
        setLocalConnectionState('permission_required');
        appendLog('native', 'VPN permission requested on device.', 'warn');
      } else if (status === 'denied') {
        setLocalConnectionState('permission_required');
        appendLog('native', 'VPN permission denied.', 'error');
      } else if (status === 'granted') {
        appendLog('native', 'VPN permission granted.');
      }
    });

    const logListener = DeviceEventEmitter.addListener('WobbVpnLog', (payload) => {
      const stream = String(payload?.stream || 'native').toLowerCase();
      const level = stream === 'stderr' ? 'error' : stream === 'service' ? 'info' : 'warn';
      appendLog('native', String(payload?.message || ''), level);
    });

    async function bootstrap() {
      try {
        await GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID, offlineAccess: false });

        const [nextInstallationId, savedLocationId, cached, fetchedLocations] = await Promise.all([
          getInstallationId(),
          readSelectedLocation(),
          readCachedSession(),
          fetchLocations()
        ]);

        if (cancelled) {
          return;
        }

        setInstallationId(nextInstallationId);
        setLocations(fetchedLocations);
        appendLog('app', 'Application initialized.');

        const defaultLocationId =
          savedLocationId && fetchedLocations.some((entry) => entry.id === savedLocationId)
            ? savedLocationId
            : cached?.location.selectedId || fetchedLocations[0]?.id || null;

        setSelectedLocationId(defaultLocationId);

        if (cached) {
          setSession(cached);
          appendLog('app', 'Loaded cached session.');
        }

        const cachedToken = await readCachedToken();
        if (cachedToken) {
          setLocalConnectionState('verifying');
          const response = await openMobileSession({
            installationId: nextInstallationId,
            googleIdToken: cachedToken,
            locationId: defaultLocationId || undefined
          });
          await applySession(response);
          if (defaultLocationId) {
            await writeSelectedLocation(defaultLocationId);
          }
          appendLog('api', 'Session refreshed from backend.');
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to initialize app.';
          setErrorText(message);
          setLocalConnectionState('error');
          appendLog('app', message, 'error');
        }
      } finally {
        if (!cancelled) {
          setBooting(false);
        }
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
      statusListener.remove();
      permissionListener.remove();
      logListener.remove();
    };
  }, []);

  useEffect(() => {
    if (!installationId || !session) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    const refresh = async () => {
      try {
        const response = await fetchMobileState(
          installationId,
          selectedLocationId || session.location.selectedId || undefined
        );
        await applySession(response);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to refresh state.';
        setErrorText(message);
        appendLog('api', message, 'error');
      }
    };

    refresh();
    pollingRef.current = setInterval(refresh, 60 * 1000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [installationId, selectedLocationId, session?.user.id, session?.location.selectedId]);

  async function handleSignIn() {
    setErrorText(null);
    setLocalConnectionState('verifying');

    try {
      const nextInstallationId = installationId || (await getInstallationId());
      const user = await GoogleSignin.signIn();
      if (!user.idToken) {
        throw new Error('Google sign-in did not return an idToken.');
      }

      await writeCachedToken(user.idToken);
      const response = await openMobileSession({
        installationId: nextInstallationId,
        googleIdToken: user.idToken,
        locationId: selectedLocationId || undefined
      });

      await applySession(response);
      setInstallationId(nextInstallationId);
      appendLog('api', 'Signed in and session created.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sign-in failed.';
      setErrorText(message);
      setLocalConnectionState('error');
      appendLog('api', message, 'error');
    }
  }

  async function handleLocationSelect(location: LocationItem) {
    if (!installationId) {
      return;
    }

    setSelectedLocationId(location.id);
    await writeSelectedLocation(location.id);
    appendLog('app', `Selected location ${location.country}.`);

    try {
      setLocalConnectionState('verifying');
      const response = await fetchMobileState(installationId, location.id);
      await applySession(response);
      setErrorText(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to switch location.';
      setErrorText(message);
      setLocalConnectionState('error');
      appendLog('api', message, 'error');
    }
  }

  async function handleToggleVpn() {
    if (!session) {
      return;
    }

    if (session.subscription.blockedReason) {
      setLocalConnectionState('blocked');
      setErrorText(formatBlockedReason(session.subscription.blockedReason));
      return;
    }

    try {
      setErrorText(null);

      if (effectiveConnectionState === 'connected' || effectiveConnectionState === 'connecting') {
        setLocalConnectionState('disconnecting');
        await VpnInterface.stop();
        return;
      }

      const vpnConfig = session.provisioning.vpnConfig;
      if (!vpnConfig) {
        throw new Error('VPN config is unavailable for this account.');
      }

      setLocalConnectionState('connecting');
      await VpnInterface.prepare();
      await VpnInterface.start(vpnConfig);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'VPN error.';
      setLocalConnectionState('error');
      setErrorText(message);
      appendLog('native', message, 'error');
    }
  }

  async function handleOpenTelegramPurchase() {
    try {
      await Linking.openURL('https://t.me/wobbvpnbot');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open Telegram.';
      setErrorText(message);
      appendLog('app', message, 'error');
    }
  }

  const connectLabel = useMemo(() => {
    if (effectiveConnectionState === 'connected') {
      return 'Disconnect';
    }
    if (effectiveConnectionState === 'connecting' || effectiveConnectionState === 'verifying') {
      return 'Working';
    }
    if (effectiveConnectionState === 'disconnecting') {
      return 'Stopping';
    }
    if (effectiveConnectionState === 'blocked') {
      return 'Blocked';
    }
    return 'Connect';
  }, [effectiveConnectionState]);

  const connectDisabled =
    !session ||
    !session.provisioning.vpnConfig ||
    effectiveConnectionState === 'verifying' ||
    effectiveConnectionState === 'disconnecting' ||
    effectiveConnectionState === 'blocked';

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {booting ? (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.text} />
          <Text style={styles.mutedText}>Starting WOBB</Text>
        </View>
      ) : !session ? (
        <View style={styles.center}>
          <Text style={styles.screenTitle}>WOBB</Text>
          <Text style={styles.screenSubtitle}>Sign in to load your subscription and connect.</Text>
          <Pressable style={styles.primaryButton} onPress={handleSignIn}>
            <Text style={styles.primaryButtonText}>Sign in with Google</Text>
          </Pressable>
          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <View>
              <Text style={styles.screenTitle}>WOBB</Text>
              <Text style={styles.screenSubtitle}>{session.user.googleEmail}</Text>
            </View>
            <View style={[styles.stateBadge, { backgroundColor: tone.background }]}>
              <Text style={[styles.stateBadgeText, { color: tone.text }]}>
                {stateLabel(effectiveConnectionState, session)}
              </Text>
            </View>
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Connection</Text>
            <Pressable
              disabled={connectDisabled}
              onPress={handleToggleVpn}
              style={[styles.connectButton, connectDisabled && styles.connectButtonDisabled]}
            >
              <Text style={styles.connectButtonLabel}>{connectLabel}</Text>
            </Pressable>
            <Text style={styles.panelHint}>
              Mode: {session.mode} {session.provisioning.assignedEndpoint ? `| ${session.provisioning.assignedEndpoint}` : ''}
            </Text>
            {session.subscription.blockedReason ? (
              <Pressable style={styles.secondaryButton} onPress={handleOpenTelegramPurchase}>
                <Text style={styles.secondaryButtonText}>Open Telegram to renew</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Plan</Text>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Tier</Text>
              <Text style={styles.detailValue}>{session.subscription.title}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Traffic</Text>
              <Text style={styles.detailValue}>
                {formatBytes(session.traffic.usedBytes)} / {formatBytes(session.traffic.limitBytes)}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Expiry</Text>
              <Text style={styles.detailValue}>{formatExpiry(session.subscription)}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>State</Text>
              <Text style={styles.detailValue}>
                {session.subscription.blockedReason
                  ? formatBlockedReason(session.subscription.blockedReason)
                  : session.subscription.status}
              </Text>
            </View>
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Locations</Text>
            {locations.map((item, index) => {
              const selected = item.id === (selectedLocationId || session.location.selectedId);
              return (
                <React.Fragment key={item.id}>
                  {index > 0 ? <View style={styles.separator} /> : null}
                  <Pressable
                    onPress={() => handleLocationSelect(item)}
                    style={[styles.locationRow, selected && styles.locationRowSelected]}
                  >
                    <View style={styles.locationPrimary}>
                      <Text style={styles.locationFlag}>{item.flag}</Text>
                      <View>
                        <Text style={styles.locationTitle}>{item.country}</Text>
                        <Text style={styles.locationSubtitle}>{item.city || 'Default edge'}</Text>
                      </View>
                    </View>
                    <Text style={styles.locationMeta}>{selected ? 'Selected' : `${item.loadPercent}% load`}</Text>
                  </Pressable>
                </React.Fragment>
              );
            })}
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Diagnostics</Text>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Backend state</Text>
              <Text style={styles.detailValue}>{session.state}</Text>
            </View>
            {session.provisioning.maintenanceReason ? (
              <Text style={styles.warningText}>{session.provisioning.maintenanceReason}</Text>
            ) : null}
            <View style={styles.logContainer}>
              {logs.length === 0 ? (
                <Text style={styles.logEmpty}>No diagnostics yet.</Text>
              ) : (
                logs.map((entry) => (
                  <View key={entry.id} style={styles.logRow}>
                    <Text style={styles.logMeta}>
                      {entry.timestamp.slice(11, 19)} {entry.source.toUpperCase()}
                    </Text>
                    <Text
                      style={[
                        styles.logMessage,
                        entry.level === 'error'
                          ? styles.logError
                          : entry.level === 'warn'
                            ? styles.logWarn
                            : null
                      ]}
                    >
                      {entry.message}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </View>

          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12
  },
  scrollContent: {
    padding: 16,
    gap: 14
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12
  },
  screenTitle: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '700'
  },
  screenSubtitle: {
    color: COLORS.muted,
    fontSize: 14,
    marginTop: 4
  },
  panel: {
    backgroundColor: COLORS.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    gap: 12
  },
  panelTitle: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '700'
  },
  stateBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  stateBadgeText: {
    fontSize: 12,
    fontWeight: '700'
  },
  connectButton: {
    alignSelf: 'center',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center'
  },
  connectButtonDisabled: {
    opacity: 0.45
  },
  connectButtonLabel: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700'
  },
  panelHint: {
    color: COLORS.muted,
    fontSize: 13,
    textAlign: 'center'
  },
  primaryButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 18
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700'
  },
  secondaryButton: {
    alignSelf: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: COLORS.accentSoft
  },
  secondaryButtonText: {
    color: COLORS.text,
    fontWeight: '600'
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12
  },
  detailLabel: {
    color: COLORS.muted,
    fontSize: 14
  },
  detailValue: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right'
  },
  separator: {
    height: 8
  },
  locationRow: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  locationRowSelected: {
    backgroundColor: COLORS.accentSoft,
    borderColor: COLORS.text
  },
  locationPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1
  },
  locationFlag: {
    width: 28,
    textAlign: 'center',
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700'
  },
  locationTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600'
  },
  locationSubtitle: {
    color: COLORS.muted,
    fontSize: 12
  },
  locationMeta: {
    color: COLORS.muted,
    fontSize: 12
  },
  logContainer: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: '#F9FAFB',
    padding: 12,
    gap: 10,
    maxHeight: 260
  },
  logRow: {
    gap: 4
  },
  logMeta: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600'
  },
  logMessage: {
    color: COLORS.text,
    fontSize: 13
  },
  logWarn: {
    color: COLORS.warning
  },
  logError: {
    color: COLORS.danger
  },
  logEmpty: {
    color: COLORS.muted,
    fontSize: 13
  },
  warningText: {
    color: COLORS.warning,
    fontSize: 13
  },
  mutedText: {
    color: COLORS.muted,
    fontSize: 13
  },
  errorText: {
    color: COLORS.danger,
    textAlign: 'center',
    fontSize: 13
  }
});
