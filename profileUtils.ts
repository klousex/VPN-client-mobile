export type ProfileMode = 'vpn' | 'proxy';

export type LocalProfile = {
  id: string;
  name: string;
  host: string;
  port: string;
  uuid: string;
  security: 'reality';
  serverName: string;
  publicKey: string;
  shortId: string;
  fingerprint: string;
  spiderX: string;
  flow: string;
  remarks: string;
  mode: ProfileMode;
  createdAt: string;
  updatedAt: string;
};

export type BootstrapDraft = {
  profileName: string;
  publicHost: string;
  publicPort: string;
  serverName: string;
  realityDest: string;
  fingerprint: string;
  spiderX: string;
  flow: string;
  mode: ProfileMode;
  sshHost: string;
  sshPort: string;
  sshUser: string;
  uuid: string;
  publicKey: string;
  shortId: string;
  remarks: string;
};

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

function nowIso(): string {
  return new Date().toISOString();
}

export function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const next = character === 'x' ? random : (random & 0x3) | 0x8;
    return next.toString(16);
  });
}

export function isPlaceholderValue(value: unknown): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('example.com') ||
    normalized.includes('replace-with-') ||
    normalized.includes('your-') ||
    normalized === 'change-me'
  );
}

export function createEmptyProfile(overrides: Partial<LocalProfile> = {}): LocalProfile {
  const timestamp = nowIso();
  return {
    id: overrides.id || generateUuid(),
    name: overrides.name || '',
    host: overrides.host || '',
    port: overrides.port || '8443',
    uuid: overrides.uuid || generateUuid(),
    security: 'reality',
    serverName: overrides.serverName || 'www.google.com',
    publicKey: overrides.publicKey || '',
    shortId: overrides.shortId || '',
    fingerprint: overrides.fingerprint || 'chrome',
    spiderX: overrides.spiderX || '/',
    flow: overrides.flow || 'xtls-rprx-vision',
    remarks: overrides.remarks || '',
    mode: overrides.mode || 'vpn',
    createdAt: overrides.createdAt || timestamp,
    updatedAt: overrides.updatedAt || timestamp,
  };
}

export function createEmptyBootstrapDraft(): BootstrapDraft {
  return {
    profileName: 'My VPS',
    publicHost: '',
    publicPort: '8443',
    serverName: 'www.google.com',
    realityDest: 'www.google.com:443',
    fingerprint: 'chrome',
    spiderX: '/',
    flow: 'xtls-rprx-vision',
    mode: 'vpn',
    sshHost: '',
    sshPort: '22',
    sshUser: 'root',
    uuid: '',
    publicKey: '',
    shortId: '',
    remarks: '',
  };
}

export function validateProfile(profile: LocalProfile): ValidationResult {
  const errors: string[] = [];
  const host = String(profile.host || '').trim();
  const name = String(profile.name || '').trim();
  const serverName = String(profile.serverName || '').trim();
  const publicKey = String(profile.publicKey || '').trim();
  const shortId = String(profile.shortId || '').trim();
  const uuid = String(profile.uuid || '').trim();
  const fingerprint = String(profile.fingerprint || '').trim();
  const port = Number(profile.port);

  if (!name) {
    errors.push('Profile name is required.');
  }
  if (!host || isPlaceholderValue(host)) {
    errors.push('Server host is required.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('Server port must be between 1 and 65535.');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) {
    errors.push('UUID must be a valid v4 UUID.');
  }
  if (!serverName || isPlaceholderValue(serverName)) {
    errors.push('Server name is required.');
  }
  if (!publicKey || isPlaceholderValue(publicKey)) {
    errors.push('REALITY public key is required.');
  }
  if (!shortId || isPlaceholderValue(shortId)) {
    errors.push('REALITY short ID is required.');
  }
  if (!fingerprint) {
    errors.push('Fingerprint is required.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function normalizeProfile(input: LocalProfile): LocalProfile {
  const next = createEmptyProfile({
    ...input,
    id: input.id || generateUuid(),
    name: String(input.name || '').trim(),
    host: String(input.host || '').trim(),
    port: String(input.port || '').trim(),
    uuid: String(input.uuid || '').trim(),
    serverName: String(input.serverName || '').trim(),
    publicKey: String(input.publicKey || '').trim(),
    shortId: String(input.shortId || '').trim(),
    fingerprint: String(input.fingerprint || '').trim() || 'chrome',
    spiderX: String(input.spiderX || '').trim() || '/',
    flow: String(input.flow || '').trim() || 'xtls-rprx-vision',
    remarks: String(input.remarks || '').trim(),
    mode: input.mode === 'proxy' ? 'proxy' : 'vpn',
    updatedAt: nowIso(),
  });

  const validation = validateProfile(next);
  if (!validation.valid) {
    throw new Error(validation.errors[0]);
  }

  return next;
}

export function createShareLink(profile: LocalProfile): string {
  const normalized = normalizeProfile(profile);
  const pairs = [
    ['type', 'tcp'],
    ['security', 'reality'],
    ['pbk', normalized.publicKey],
    ['sid', normalized.shortId],
    ['fp', normalized.fingerprint],
    ['sni', normalized.serverName],
    ['spx', normalized.spiderX],
    ['flow', normalized.flow],
  ];
  const query = pairs
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  return `vless://${normalized.uuid}@${normalized.host}:${normalized.port}?${query}#${encodeURIComponent(normalized.name)}`;
}

export function buildTunnelConfig(profile: LocalProfile, stealthMode = false): Record<string, unknown> {
  const normalized = normalizeProfile(profile);

  return {
    log: {
      loglevel: 'warning',
    },
    dns: {
      servers: ['1.1.1.1', '8.8.8.8', 'localhost'],
    },
    inbounds: [
      {
        tag: 'socks-in',
        listen: '127.0.0.1',
        port: 10808,
        protocol: 'socks',
        settings: {
          auth: 'noauth',
          udp: true,
        },
        sniffing: {
          enabled: true,
          destOverride: ['http', 'tls', 'quic'],
        },
      },
    ],
    outbounds: [
      {
        tag: 'proxy',
        protocol: 'vless',
        settings: {
          vnext: [
            {
              address: normalized.host,
              port: Number(normalized.port),
              users: [
                {
                  id: normalized.uuid,
                  encryption: 'none',
                  flow: normalized.flow,
                },
              ],
            },
          ],
        },
        streamSettings: {
          network: 'tcp',
          security: 'reality',
          sockopt: stealthMode
            ? {
                tcpNoDelay: true,
              }
            : undefined,
          realitySettings: {
            show: false,
            serverName: normalized.serverName,
            fingerprint: normalized.fingerprint,
            publicKey: normalized.publicKey,
            shortId: normalized.shortId,
            spiderX: normalized.spiderX,
          },
        },
        mux: {
          enabled: false,
          concurrency: -1,
        },
      },
      {
        tag: 'direct',
        protocol: 'freedom',
      },
      {
        tag: 'block',
        protocol: 'blackhole',
      },
    ],
    routing: {
      domainStrategy: stealthMode ? 'IPOnDemand' : 'IPIfNonMatch',
      rules: [
        {
          type: 'field',
          inboundTag: ['socks-in'],
          outboundTag: 'proxy',
        },
      ],
    },
    policy: stealthMode
      ? {
          levels: {
            0: {
              handshake: 4,
              connIdle: 300,
              uplinkOnly: 1,
              downlinkOnly: 1,
            },
          },
        }
      : undefined,
  };
}

export function profileEndpoint(profile: LocalProfile): string {
  return `${profile.host}:${profile.port}`;
}

export function bootstrapDraftToProfile(draft: Partial<BootstrapDraft>): LocalProfile {
  return createEmptyProfile({
    name: String(draft.profileName || '').trim() || 'My VPS',
    host: String(draft.publicHost || '').trim(),
    port: String(draft.publicPort || '8443').trim(),
    uuid: String(draft.uuid || generateUuid()).trim(),
    serverName: String(draft.serverName || '').trim() || 'www.google.com',
    publicKey: String(draft.publicKey || '').trim(),
    shortId: String(draft.shortId || '').trim(),
    fingerprint: String(draft.fingerprint || 'chrome').trim() || 'chrome',
    spiderX: String(draft.spiderX || '/').trim() || '/',
    flow: String(draft.flow || 'xtls-rprx-vision').trim() || 'xtls-rprx-vision',
    remarks: String(draft.remarks || '').trim(),
    mode: draft.mode === 'proxy' ? 'proxy' : 'vpn',
  });
}
