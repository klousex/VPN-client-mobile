# WOBB Mobile

Public React Native Android client for WOBB.

## Contents

- React Native UI
- Android native VPN bridge
- Android project files

## Requirements

- Node.js 20+
- Java 17
- Android SDK / platform tools
- A local `adb`
- A local `android/app/libs/wobb-core.aar` built outside this repo

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Put the local Android core archive here:

   ```text
   android/app/libs/wobb-core.aar
   ```

3. Start Metro:

   ```bash
   npm run start
   ```

4. Reverse the backend port over USB:

   ```bash
   npm run reverse
   ```

5. Run the app on a connected Android device:

   ```bash
   npm run android
   ```

The app expects the backend API on `http://127.0.0.1:3000` or the Android emulator bridge `http://10.0.2.2:3000`.
