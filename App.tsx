import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  NativeModules,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as storage from './storage';
import {
  bootstrapDraftToProfile,
  buildTunnelConfig,
  createEmptyBootstrapDraft,
  createEmptyProfile,
  createShareLink,
  generateUuid,
  normalizeProfile,
  profileEndpoint,
  type BootstrapDraft,
  type LocalProfile,
  type ProfileMode,
  type ValidationResult,
  validateProfile,
} from './profileUtils';

type ConnectionState = 'idle' | 'permission_required' | 'connecting' | 'connected' | 'disconnecting' | 'error';
type ViewMode = 'home' | 'form' | 'bootstrap';

type DiagnosticLogEntry = {
  id: string;
  level: 'info' | 'warn' | 'error';
  source: 'app' | 'native' | 'helper';
  message: string;
  timestamp: string;
};

type OnboardingSlide = {
  eyebrow: string;
  title: string;
  body: string;
};

type BootstrapPlan = {
  draftProfile?: Partial<BootstrapDraft>;
  profileReady?: boolean;
  profile?: Partial<LocalProfile>;
  missingFields?: string[];
  manualSteps?: string[];
  panelTemplate?: Record<string, unknown>;
  shareLink?: string | null;
};

const PROFILES_KEY = 'wobb.mobile.selfhosted.profiles.v1';
const ACTIVE_PROFILE_KEY = 'wobb.mobile.selfhosted.active-profile.v1';
const ONBOARDING_COMPLETE_KEY = 'wobb.mobile.selfhosted.onboarding.v1';
const HELPER_API_BASE_CANDIDATES = ['http://127.0.0.1:3000', 'http://10.0.2.2:3000'];

const ONBOARDING_SLIDES: OnboardingSlide[] = [
  {
    eyebrow: 'Self-hosted access',
    title: 'Bring your own server',
    body: 'Use Wobb with your own VLESS and REALITY profile instead of a public hosted plan.',
  },
  {
    eyebrow: 'Manual profile first',
    title: 'Save one clean config',
    body: 'Add your host, UUID, server name, public key, and short ID locally on the device.',
  },
  {
    eyebrow: 'Optional setup helper',
    title: 'Bootstrap your VPS',
    body: 'Generate a setup plan when you want help preparing a new server, then connect with the saved profile.',
  },
];

const COLORS = {
  background: '#08111f',
  panel: '#111c32',
  panelMuted: '#0d1728',
  border: '#1f2d46',
  text: '#e5e7eb',
  muted: '#94a3b8',
  accent: '#3b82f6',
  accentSoft: '#1d4ed8',
  success: '#bfdbfe',
  successSoft: '#172554',
  warning: '#fef08a',
  warningSoft: '#3f3b0b',
  danger: '#fca5a5',
  dangerSoft: '#3f1d2e'
};

const { WobbVpnModule } = NativeModules as {
  WobbVpnModule?: {
    prepareVpn?: () => Promise<{ granted?: boolean }>;
    startVpn?: (configJson: string) => Promise<void>;
    stopVpn?: () => Promise<void>;
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
    timestamp: new Date().toISOString(),
  };
}

function stateLabel(state: ConnectionState): string {
  switch (state) {
    case 'permission_required':
      return 'Permission required';
    case 'connecting':
      return 'Connecting';
    case 'connected':
      return 'Connected';
    case 'disconnecting':
      return 'Disconnecting';
    case 'error':
      return 'Connection error';
    default:
      return 'Disconnected';
  }
}

function stateTone(state: ConnectionState) {
  if (state === 'connected') {
    return { text: COLORS.success, background: COLORS.successSoft };
  }
  if (state === 'error') {
    return { text: COLORS.danger, background: COLORS.dangerSoft };
  }
  if (state === 'connecting' || state === 'disconnecting' || state === 'permission_required') {
    return { text: COLORS.warning, background: COLORS.warningSoft };
  }
  return { text: COLORS.text, background: COLORS.panelMuted };
}

async function readProfiles(): Promise<LocalProfile[]> {
  const raw = await storage.getItem(PROFILES_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as LocalProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeProfiles(profiles: LocalProfile[]): Promise<void> {
  await storage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

async function readActiveProfileId(): Promise<string | null> {
  return storage.getItem(ACTIVE_PROFILE_KEY);
}

async function writeActiveProfileId(profileId: string | null): Promise<void> {
  if (profileId) {
    await storage.setItem(ACTIVE_PROFILE_KEY, profileId);
    return;
  }

  await storage.removeItem(ACTIVE_PROFILE_KEY);
}

async function readOnboardingComplete(): Promise<boolean> {
  return (await storage.getItem(ONBOARDING_COMPLETE_KEY)) === '1';
}

async function writeOnboardingComplete(): Promise<void> {
  await storage.setItem(ONBOARDING_COMPLETE_KEY, '1');
}

async function helperRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let lastError: unknown;

  for (const baseUrl of HELPER_API_BASE_CANDIDATES) {
    try {
      const response = await fetch(`${baseUrl}${path}`, init);
      const rawBody = await response.text();
      const payload = rawBody ? (JSON.parse(rawBody) as T & { message?: string }) : ({} as T & { message?: string });

      if (!response.ok) {
        throw new Error(payload.message || `Helper request failed with status ${response.status}`);
      }

      return payload;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(lastError instanceof Error ? lastError.message : 'Helper service is unavailable.');
}

function validationText(validation: ValidationResult): string | null {
  return validation.valid ? null : validation.errors[0] || 'Profile is incomplete.';
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric';
  multiline?: boolean;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.muted}
        keyboardType={keyboardType}
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMultiline]}
      />
    </View>
  );
}

function ModeToggle({
  value,
  onChange,
}: {
  value: ProfileMode;
  onChange: (next: ProfileMode) => void;
}) {
  return (
    <View style={styles.modeToggle}>
      {(['vpn', 'proxy'] as ProfileMode[]).map((option) => {
        const selected = value === option;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            style={[styles.modeButton, selected && styles.modeButtonActive]}
          >
            <Text style={[styles.modeButtonText, selected && styles.modeButtonTextActive]}>
              {option === 'vpn' ? 'VPN' : 'Proxy'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('home');
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [profiles, setProfiles] = useState<LocalProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [formDraft, setFormDraft] = useState<LocalProfile>(createEmptyProfile());
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [bootstrapDraft, setBootstrapDraft] = useState<BootstrapDraft>(createEmptyBootstrapDraft());
  const [bootstrapPlan, setBootstrapPlan] = useState<BootstrapPlan | null>(null);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [logs, setLogs] = useState<DiagnosticLogEntry[]>([]);
  const logViewportRef = useRef<ScrollView | null>(null);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) || null,
    [profiles, activeProfileId]
  );
  const activeValidation = useMemo(
    () => (activeProfile ? validateProfile(activeProfile) : { valid: false, errors: ['Add a profile to connect.'] }),
    [activeProfile]
  );
  const tone = stateTone(connectionState);

  function appendLog(source: DiagnosticLogEntry['source'], message: string, level: DiagnosticLogEntry['level'] = 'info') {
    setLogs((current) => [...current, createLogEntry(source, message, level)].slice(-150));
  }

  useEffect(() => {
    let cancelled = false;

    const statusListener = DeviceEventEmitter.addListener('WobbVpnStatus', (payload) => {
      const status = String(payload?.status || '').toLowerCase();
      if (status === 'connecting') {
        setConnectionState('connecting');
        appendLog('native', 'VPN service is starting.');
      } else if (status === 'connected') {
        setConnectionState('connected');
        appendLog('native', 'VPN tunnel connected.');
      } else if (status === 'disconnecting') {
        setConnectionState('disconnecting');
        appendLog('native', 'VPN service is stopping.');
      } else if (status === 'error') {
        setConnectionState('error');
        appendLog('native', 'VPN service reported an error.', 'error');
      } else if (status === 'stopped' || status === 'idle') {
        setConnectionState('idle');
      }
    });

    const logListener = DeviceEventEmitter.addListener('WobbVpnLog', (payload) => {
      const stream = String(payload?.stream || 'native');
      const message = String(payload?.message || '').trim();
      if (message) {
        appendLog('native', `${stream}: ${message}`);
      }
    });

    const permissionListener = DeviceEventEmitter.addListener('WobbVpnPermission', (payload) => {
      const status = String(payload?.status || '').toLowerCase();
      if (status === 'requested') {
        setConnectionState('permission_required');
      }
      if (status === 'denied') {
        setConnectionState('error');
        setErrorText('VPN permission was denied.');
        appendLog('native', 'VPN permission was denied.', 'error');
      }
    });

    async function boot() {
      try {
        const [storedProfiles, storedActiveProfileId, storedOnboarding] = await Promise.all([
          readProfiles(),
          readActiveProfileId(),
          readOnboardingComplete(),
        ]);

        if (cancelled) {
          return;
        }

        setProfiles(storedProfiles);
        setActiveProfileId(storedActiveProfileId || storedProfiles[0]?.id || null);
        setOnboardingComplete(storedOnboarding);
      } finally {
        if (!cancelled) {
          setBooting(false);
        }
      }
    }

    boot();

    return () => {
      cancelled = true;
      statusListener.remove();
      logListener.remove();
      permissionListener.remove();
    };
  }, []);

  useEffect(() => {
    logViewportRef.current?.scrollToEnd({ animated: true });
  }, [logs]);

  async function persistProfiles(nextProfiles: LocalProfile[], nextActiveProfileId: string | null) {
    setProfiles(nextProfiles);
    setActiveProfileId(nextActiveProfileId);
    await writeProfiles(nextProfiles);
    await writeActiveProfileId(nextActiveProfileId);
  }

  function handleCompleteOnboarding() {
    writeOnboardingComplete().catch(() => undefined);
    setOnboardingComplete(true);
  }

  function handleOpenCreateProfile() {
    setEditingProfileId(null);
    setFormDraft(createEmptyProfile());
    setErrorText(null);
    setViewMode('form');
  }

  function handleOpenEditProfile(profile: LocalProfile) {
    setEditingProfileId(profile.id);
    setFormDraft(profile);
    setErrorText(null);
    setViewMode('form');
  }

  async function handleSaveProfile() {
    try {
      const savedProfile = normalizeProfile(formDraft);
      const nextProfiles = editingProfileId
        ? profiles.map((profile) => (profile.id === editingProfileId ? savedProfile : profile))
        : [savedProfile, ...profiles];
      const nextActiveId = activeProfileId || savedProfile.id;

      await persistProfiles(nextProfiles, nextActiveId === editingProfileId ? savedProfile.id : nextActiveId);
      setViewMode('home');
      setEditingProfileId(null);
      setErrorText(null);
      appendLog('app', `Saved profile ${savedProfile.name}.`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to save profile.');
    }
  }

  function handleDeleteProfile(profile: LocalProfile) {
    Alert.alert('Delete profile', `Remove ${profile.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const nextProfiles = profiles.filter((entry) => entry.id !== profile.id);
          const nextActiveId = activeProfileId === profile.id ? nextProfiles[0]?.id || null : activeProfileId;
          persistProfiles(nextProfiles, nextActiveId).catch(() => undefined);
          appendLog('app', `Deleted profile ${profile.name}.`, 'warn');
          if (editingProfileId === profile.id) {
            setViewMode('home');
            setEditingProfileId(null);
          }
        },
      },
    ]);
  }

  async function handleSelectProfile(profile: LocalProfile) {
    setActiveProfileId(profile.id);
    await writeActiveProfileId(profile.id);
    appendLog('app', `Selected profile ${profile.name}.`);
  }

  async function handleShareProfile() {
    if (!activeProfile) {
      setErrorText('Select a profile first.');
      return;
    }

    try {
      const shareLink = createShareLink(activeProfile);
      await Share.share({ message: shareLink });
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to share profile.');
    }
  }

  async function handleToggleConnection() {
    setErrorText(null);

    try {
      if (connectionState === 'connected' || connectionState === 'connecting') {
        setConnectionState('disconnecting');
        appendLog('app', 'Stopping VPN tunnel.');
        await VpnInterface.stop();
        setConnectionState('idle');
        return;
      }

      if (!activeProfile) {
        throw new Error('Add and select a profile before connecting.');
      }

      const validation = validateProfile(activeProfile);
      if (!validation.valid) {
        throw new Error(validation.errors[0]);
      }

      const config = buildTunnelConfig(activeProfile, activeProfile.mode === 'proxy');
      setConnectionState('connecting');
      appendLog('app', `Starting tunnel to ${profileEndpoint(activeProfile)}.`);
      await VpnInterface.prepare();
      await VpnInterface.start(config);
    } catch (error) {
      setConnectionState('error');
      setErrorText(error instanceof Error ? error.message : 'Connection failed.');
      appendLog('app', error instanceof Error ? error.message : 'Connection failed.', 'error');
    }
  }

  async function handleRequestBootstrapPlan() {
    setBootstrapBusy(true);
    setErrorText(null);
    setBootstrapPlan(null);

    try {
      const response = await helperRequest<{ success: boolean; data: BootstrapPlan }>('/api/v1/bootstrap/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileName: bootstrapDraft.profileName,
          publicHost: bootstrapDraft.publicHost,
          publicPort: bootstrapDraft.publicPort,
          serverName: bootstrapDraft.serverName,
          realityDest: bootstrapDraft.realityDest,
          fingerprint: bootstrapDraft.fingerprint,
          spiderX: bootstrapDraft.spiderX,
          flow: bootstrapDraft.flow,
          mode: bootstrapDraft.mode,
          sshHost: bootstrapDraft.sshHost,
          sshPort: bootstrapDraft.sshPort,
          sshUser: bootstrapDraft.sshUser,
          uuid: bootstrapDraft.uuid || undefined,
          publicKey: bootstrapDraft.publicKey || undefined,
          shortId: bootstrapDraft.shortId || undefined,
          remarks: bootstrapDraft.remarks || undefined,
        }),
      });

      setBootstrapPlan(response.data);
      appendLog('helper', 'Generated VPS bootstrap plan.');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Failed to generate setup plan.');
      appendLog('helper', error instanceof Error ? error.message : 'Failed to generate setup plan.', 'error');
    } finally {
      setBootstrapBusy(false);
    }
  }

  function handleUseBootstrapDraft() {
    if (!bootstrapPlan) {
      return;
    }

    const source = bootstrapPlan.profileReady && bootstrapPlan.profile ? bootstrapPlan.profile : bootstrapPlan.draftProfile;
    const nextProfile = bootstrapDraftToProfile({
      ...bootstrapDraft,
      ...(source || {}),
      profileName: String((source as Partial<LocalProfile> | undefined)?.name || bootstrapDraft.profileName),
      publicHost: String((source as Partial<LocalProfile> | undefined)?.host || bootstrapDraft.publicHost),
      publicPort: String((source as Partial<LocalProfile> | undefined)?.port || bootstrapDraft.publicPort),
    });

    setEditingProfileId(null);
    setFormDraft(nextProfile);
    setViewMode('form');
  }

  const connectLabel =
    connectionState === 'connected'
      ? 'Disconnect'
      : connectionState === 'connecting'
        ? 'Connecting'
        : connectionState === 'disconnecting'
          ? 'Disconnecting'
          : 'Connect';

  if (booting) {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <View style={styles.center}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoBadgeText}>W</Text>
          </View>
          <ActivityIndicator color={COLORS.accent} />
          <Text style={styles.screenTitle}>Wobb</Text>
          <Text style={styles.mutedText}>Loading local profiles.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!onboardingComplete) {
    const currentSlide = ONBOARDING_SLIDES[Math.min(onboardingStep, ONBOARDING_SLIDES.length - 1)];
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <View style={styles.onboardingRoot}>
          <View style={styles.onboardingHero}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoBadgeText}>W</Text>
            </View>
            <Text style={styles.onboardingEyebrow}>{currentSlide.eyebrow}</Text>
            <Text style={styles.onboardingTitle}>{currentSlide.title}</Text>
            <Text style={styles.onboardingBody}>{currentSlide.body}</Text>
          </View>
          <View style={styles.panel}>
            <View style={styles.onboardingDots}>
              {ONBOARDING_SLIDES.map((_, index) => (
                <View key={index} style={[styles.onboardingDot, index === onboardingStep && styles.onboardingDotActive]} />
              ))}
            </View>
            <View style={styles.onboardingActions}>
              <Pressable style={styles.secondaryButton} onPress={handleCompleteOnboarding}>
                <Text style={styles.secondaryButtonText}>Skip</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryButton, styles.flexButton]}
                onPress={() => {
                  if (onboardingStep === ONBOARDING_SLIDES.length - 1) {
                    handleCompleteOnboarding();
                    return;
                  }
                  setOnboardingStep((current) => current + 1);
                }}
              >
                <Text style={styles.primaryButtonText}>
                  {onboardingStep === ONBOARDING_SLIDES.length - 1 ? 'Continue' : 'Next'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (viewMode === 'form') {
    const draftValidation = validateProfile(formDraft);
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.headerRow}>
            <Text style={styles.screenTitle}>{editingProfileId ? 'Edit profile' : 'New profile'}</Text>
            <Pressable style={styles.secondaryButtonCompact} onPress={() => setViewMode('home')}>
              <Text style={styles.secondaryButtonText}>Back</Text>
            </Pressable>
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Connection profile</Text>
            <FormField label="Profile name" value={formDraft.name} onChangeText={(value) => setFormDraft((current) => ({ ...current, name: value }))} />
            <FormField label="Host" value={formDraft.host} onChangeText={(value) => setFormDraft((current) => ({ ...current, host: value }))} placeholder="157.90.116.123" />
            <FormField label="Port" value={formDraft.port} onChangeText={(value) => setFormDraft((current) => ({ ...current, port: value }))} keyboardType="numeric" />
            <FormField label="UUID" value={formDraft.uuid} onChangeText={(value) => setFormDraft((current) => ({ ...current, uuid: value }))} />
            <Pressable style={styles.inlineAction} onPress={() => setFormDraft((current) => ({ ...current, uuid: generateUuid() }))}>
              <Text style={styles.inlineActionText}>Generate UUID</Text>
            </Pressable>
            <FormField label="Server name / SNI" value={formDraft.serverName} onChangeText={(value) => setFormDraft((current) => ({ ...current, serverName: value }))} />
            <FormField label="REALITY public key" value={formDraft.publicKey} onChangeText={(value) => setFormDraft((current) => ({ ...current, publicKey: value }))} />
            <FormField label="REALITY short ID" value={formDraft.shortId} onChangeText={(value) => setFormDraft((current) => ({ ...current, shortId: value }))} />
            <FormField label="Fingerprint" value={formDraft.fingerprint} onChangeText={(value) => setFormDraft((current) => ({ ...current, fingerprint: value }))} />
            <FormField label="Spider X" value={formDraft.spiderX} onChangeText={(value) => setFormDraft((current) => ({ ...current, spiderX: value }))} />
            <FormField label="Flow" value={formDraft.flow} onChangeText={(value) => setFormDraft((current) => ({ ...current, flow: value }))} />
            <FormField label="Remarks" value={formDraft.remarks} onChangeText={(value) => setFormDraft((current) => ({ ...current, remarks: value }))} multiline />
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Mode</Text>
              <ModeToggle value={formDraft.mode} onChange={(mode) => setFormDraft((current) => ({ ...current, mode }))} />
            </View>
            {draftValidation.valid ? null : <Text style={styles.warningText}>{validationText(draftValidation)}</Text>}
            <Pressable style={styles.primaryButton} onPress={handleSaveProfile}>
              <Text style={styles.primaryButtonText}>Save profile</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (viewMode === 'bootstrap') {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.headerRow}>
            <Text style={styles.screenTitle}>Bootstrap VPS</Text>
            <Pressable style={styles.secondaryButtonCompact} onPress={() => setViewMode('home')}>
              <Text style={styles.secondaryButtonText}>Back</Text>
            </Pressable>
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Setup plan</Text>
            <Text style={styles.panelText}>Generate a manual setup plan. If UUID, public key, and short ID are already known, Wobb can turn the result into a ready profile.</Text>
            <FormField label="Profile name" value={bootstrapDraft.profileName} onChangeText={(value) => setBootstrapDraft((current) => ({ ...current, profileName: value }))} />
            <FormField label="Public host" value={bootstrapDraft.publicHost} onChangeText={(value) => setBootstrapDraft((current) => ({ ...current, publicHost: value }))} placeholder="157.90.116.123" />
            <FormField label="Public port" value={bootstrapDraft.publicPort} onChangeText={(value) => setBootstrapDraft((current) => ({ ...current, publicPort: value }))} keyboardType="numeric" />
            <FormField label="Server name" value={bootstrapDraft.serverName} onChangeText={(value) => setBootstrapDraft((current) => ({ ...current, serverName: value }))} />
            <FormField label="REALITY destination" value={bootstrapDraft.realityDest} onChangeText={(value) => setBootstrapDraft((current) => ({ ...current, realityDest: value }))} />
            <FormField label="SSH host" value={bootstrapDraft.sshHost} onChangeText={(value) => setBootstrapDraft((current) => ({ ...current, sshHost: value }))} />
            <FormField label="SSH port" value={bootstrapDraft.sshPort} onChangeText={(value) => setBootstrapDraft((current) => ({ ...current, sshPort: value }))} keyboardType="numeric" />
            <FormField label="SSH user" value={bootstrapDraft.sshUser} onChangeText={(value) => setBootstrapDraft((current) => ({ ...current, sshUser: value }))} />
            <FormField label="UUID (optional)" value={bootstrapDraft.uuid} onChangeText={(value) => setBootstrapDraft((current) => ({ ...current, uuid: value }))} />
            <FormField label="Public key (optional)" value={bootstrapDraft.publicKey} onChangeText={(value) => setBootstrapDraft((current) => ({ ...current, publicKey: value }))} />
            <FormField label="Short ID (optional)" value={bootstrapDraft.shortId} onChangeText={(value) => setBootstrapDraft((current) => ({ ...current, shortId: value }))} />
            <Pressable style={styles.primaryButton} onPress={handleRequestBootstrapPlan}>
              <Text style={styles.primaryButtonText}>{bootstrapBusy ? 'Working' : 'Generate setup plan'}</Text>
            </Pressable>
          </View>

          {bootstrapPlan ? (
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Plan result</Text>
              <Text style={styles.detailValue}>Profile ready: {bootstrapPlan.profileReady ? 'Yes' : 'Not yet'}</Text>
              {bootstrapPlan.missingFields && bootstrapPlan.missingFields.length > 0 ? (
                <Text style={styles.warningText}>Missing fields: {bootstrapPlan.missingFields.join(', ')}</Text>
              ) : null}
              {bootstrapPlan.manualSteps?.map((step, index) => (
                <Text key={`${step}-${index}`} style={styles.stepText}>{index + 1}. {step}</Text>
              ))}
              <Pressable style={styles.secondaryButton} onPress={handleUseBootstrapDraft}>
                <Text style={styles.secondaryButtonText}>
                  {bootstrapPlan.profileReady ? 'Import ready profile' : 'Open draft profile'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <ScrollView contentContainerStyle={styles.scrollContent} ref={logViewportRef}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.screenTitle}>Wobb</Text>
            <Text style={styles.screenSubtitle}>Self-hosted VLESS and REALITY client</Text>
          </View>
          <View style={[styles.stateBadge, { backgroundColor: tone.background }]}>
            <Text style={[styles.stateBadgeText, { color: tone.text }]}>{stateLabel(connectionState)}</Text>
          </View>
        </View>

        <View style={styles.connectionCard}>
          <View style={styles.connectionCopy}>
            <Text style={styles.sectionLabel}>Active profile</Text>
            <Text style={styles.connectionTitle}>{activeProfile ? activeProfile.name : 'No profile selected'}</Text>
            <Text style={styles.connectionSubtitle}>
              {activeProfile ? `${profileEndpoint(activeProfile)} - ${activeProfile.serverName}` : 'Add a local server profile to start.'}
            </Text>
          </View>

          <Pressable
            disabled={!activeProfile || (connectionState !== 'connected' && !activeValidation.valid)}
            onPress={handleToggleConnection}
            style={[
              styles.connectButton,
              (!activeProfile || (connectionState !== 'connected' && !activeValidation.valid)) && styles.connectButtonDisabled,
            ]}
          >
            <Text style={styles.connectButtonLabel}>{connectLabel}</Text>
          </Pressable>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryChip}>
            <Text style={styles.summaryLabel}>Mode</Text>
            <Text style={styles.summaryValue}>{activeProfile ? (activeProfile.mode === 'vpn' ? 'VPN' : 'Proxy') : '--'}</Text>
          </View>
          <View style={styles.summaryChip}>
            <Text style={styles.summaryLabel}>Endpoint</Text>
            <Text style={styles.summaryValue}>{activeProfile ? profileEndpoint(activeProfile) : '--'}</Text>
          </View>
        </View>

        {!activeValidation.valid && activeProfile ? <Text style={styles.warningText}>{validationText(activeValidation)}</Text> : null}

        <View style={styles.quickActions}>
          <Pressable style={styles.quickActionButton} onPress={handleOpenCreateProfile}>
            <Text style={styles.quickActionLabel}>Add Profile</Text>
          </Pressable>
          <Pressable style={styles.quickActionButton} onPress={() => setViewMode('bootstrap')}>
            <Text style={styles.quickActionLabel}>Bootstrap</Text>
          </Pressable>
          <Pressable style={styles.quickActionButton} onPress={handleShareProfile}>
            <Text style={styles.quickActionLabel}>Share</Text>
          </Pressable>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Profiles</Text>
          {profiles.length === 0 ? (
            <Text style={styles.logEmpty}>No local profiles yet.</Text>
          ) : (
            profiles.map((profile, index) => {
              const selected = profile.id === activeProfileId;
              return (
                <View key={profile.id}>
                  {index > 0 ? <View style={styles.locationSeparator} /> : null}
                  <View style={[styles.locationRow, selected && styles.locationRowSelected]}>
                    <View style={styles.locationPrimary}>
                      <View>
                        <Text style={styles.locationTitle}>{profile.name}</Text>
                        <Text style={styles.locationSubtitle}>{profile.host}:{profile.port} - {profile.serverName}</Text>
                      </View>
                    </View>
                    <View style={styles.rowActions}>
                      <Pressable style={styles.rowAction} onPress={() => handleSelectProfile(profile)}>
                        <Text style={styles.rowActionText}>{selected ? 'Active' : 'Use'}</Text>
                      </Pressable>
                      <Pressable style={styles.rowAction} onPress={() => handleOpenEditProfile(profile)}>
                        <Text style={styles.rowActionText}>Edit</Text>
                      </Pressable>
                      <Pressable style={styles.rowActionDanger} onPress={() => handleDeleteProfile(profile)}>
                        <Text style={styles.rowActionDangerText}>Delete</Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Logs</Text>
          <View style={styles.logContainer}>
            {logs.length === 0 ? (
              <Text style={styles.logEmpty}>No logs yet.</Text>
            ) : (
              logs.map((entry) => (
                <View key={entry.id} style={styles.logRow}>
                  <Text style={styles.logMeta}>{entry.timestamp.slice(11, 19)} {entry.source.toUpperCase()}</Text>
                  <Text style={[styles.logMessage, entry.level === 'error' ? styles.logError : entry.level === 'warn' ? styles.logWarn : null]}>{entry.message}</Text>
                </View>
              ))
            )}
          </View>
        </View>

        {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  logoBadge: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  logoBadgeText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  mutedText: {
    color: COLORS.muted,
    fontSize: 13,
  },
  onboardingRoot: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 20,
  },
  onboardingHero: {
    paddingTop: 40,
  },
  onboardingEyebrow: {
    color: COLORS.accent,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 14,
  },
  onboardingTitle: {
    color: COLORS.text,
    fontSize: 34,
    fontWeight: '700',
    lineHeight: 40,
    maxWidth: 280,
  },
  onboardingBody: {
    color: COLORS.muted,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 16,
    maxWidth: 320,
  },
  onboardingDots: {
    flexDirection: 'row',
    gap: 8,
  },
  onboardingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.border,
  },
  onboardingDotActive: {
    width: 22,
    backgroundColor: COLORS.accent,
  },
  onboardingActions: {
    flexDirection: 'row',
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
  },
  screenTitle: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '700',
  },
  screenSubtitle: {
    color: COLORS.muted,
    fontSize: 14,
    marginTop: 4,
  },
  panel: {
    backgroundColor: COLORS.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    gap: 12,
  },
  panelTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '700',
  },
  panelText: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  stateBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  stateBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  connectionCard: {
    backgroundColor: COLORS.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    gap: 16,
  },
  connectionCopy: {
    gap: 6,
  },
  sectionLabel: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  connectionTitle: {
    color: COLORS.text,
    fontSize: 22,
    fontWeight: '700',
  },
  connectionSubtitle: {
    color: COLORS.muted,
    fontSize: 13,
  },
  connectButton: {
    width: '100%',
    borderRadius: 8,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  connectButtonDisabled: {
    opacity: 0.45,
  },
  connectButtonLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryChip: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.panelMuted,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  summaryLabel: {
    color: COLORS.muted,
    fontSize: 12,
  },
  summaryValue: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  quickActions: {
    flexDirection: 'row',
    gap: 10,
  },
  quickActionButton: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.panelMuted,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
  },
  quickActionLabel: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  secondaryButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.panelMuted,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonCompact: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.panelMuted,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: COLORS.text,
    fontWeight: '600',
  },
  flexButton: {
    flex: 1,
  },
  fieldGroup: {
    gap: 8,
  },
  fieldLabel: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.panelMuted,
    color: COLORS.text,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  modeToggle: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.panelMuted,
    overflow: 'hidden',
  },
  modeButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeButtonActive: {
    backgroundColor: COLORS.accent,
  },
  modeButtonText: {
    color: COLORS.muted,
    fontWeight: '600',
  },
  modeButtonTextActive: {
    color: '#FFFFFF',
  },
  locationSeparator: {
    height: 10,
  },
  locationRow: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 12,
    gap: 12,
    backgroundColor: COLORS.panelMuted,
  },
  locationRowSelected: {
    borderColor: COLORS.accent,
    backgroundColor: '#11213f',
  },
  locationPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  locationTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  locationSubtitle: {
    color: COLORS.muted,
    fontSize: 12,
    marginTop: 4,
  },
  rowActions: {
    flexDirection: 'row',
    gap: 8,
  },
  rowAction: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.panel,
  },
  rowActionText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '600',
  },
  rowActionDanger: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#5f2438',
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.dangerSoft,
  },
  rowActionDangerText: {
    color: COLORS.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  logContainer: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.panelMuted,
    padding: 12,
    gap: 10,
    maxHeight: 320,
  },
  logRow: {
    gap: 4,
  },
  logMeta: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  logMessage: {
    color: COLORS.text,
    fontSize: 13,
  },
  logWarn: {
    color: COLORS.warning,
  },
  logError: {
    color: COLORS.danger,
  },
  logEmpty: {
    color: COLORS.muted,
    fontSize: 13,
  },
  warningText: {
    color: COLORS.warning,
    fontSize: 13,
  },
  errorText: {
    color: COLORS.danger,
    textAlign: 'center',
    fontSize: 13,
  },
  detailValue: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  stepText: {
    color: COLORS.text,
    fontSize: 13,
    lineHeight: 20,
  },
  inlineAction: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.panelMuted,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inlineActionText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
  },
});
