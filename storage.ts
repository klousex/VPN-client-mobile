import { NativeModules } from 'react-native';

type StorageBridge = {
  getItem?: (key: string) => Promise<string | null>;
  setItem?: (key: string, value: string) => Promise<void>;
  removeItem?: (key: string) => Promise<void>;
};

const { VpnClientModule } = NativeModules as {
  VpnClientModule?: StorageBridge;
};

const memoryStore = new Map<string, string>();

export async function getItem(key: string): Promise<string | null> {
  if (VpnClientModule?.getItem) {
    const value = await VpnClientModule.getItem(key);
    return value ?? null;
  }

  return memoryStore.get(key) ?? null;
}

export async function setItem(key: string, value: string): Promise<void> {
  if (VpnClientModule?.setItem) {
    await VpnClientModule.setItem(key, value);
    return;
  }

  memoryStore.set(key, value);
}

export async function removeItem(key: string): Promise<void> {
  if (VpnClientModule?.removeItem) {
    await VpnClientModule.removeItem(key);
    return;
  }

  memoryStore.delete(key);
}
