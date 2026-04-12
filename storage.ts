import { NativeModules } from 'react-native';

type StorageBridge = {
  getItem?: (key: string) => Promise<string | null>;
  setItem?: (key: string, value: string) => Promise<void>;
  removeItem?: (key: string) => Promise<void>;
};

const { WobbVpnModule } = NativeModules as {
  WobbVpnModule?: StorageBridge;
};

const memoryStore = new Map<string, string>();

export async function getItem(key: string): Promise<string | null> {
  if (WobbVpnModule?.getItem) {
    const value = await WobbVpnModule.getItem(key);
    return value ?? null;
  }

  return memoryStore.get(key) ?? null;
}

export async function setItem(key: string, value: string): Promise<void> {
  if (WobbVpnModule?.setItem) {
    await WobbVpnModule.setItem(key, value);
    return;
  }

  memoryStore.set(key, value);
}

export async function removeItem(key: string): Promise<void> {
  if (WobbVpnModule?.removeItem) {
    await WobbVpnModule.removeItem(key);
    return;
  }

  memoryStore.delete(key);
}
