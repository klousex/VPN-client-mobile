# WOBB Mobile

React Native Android client for self-hosted VLESS / REALITY access.

## Current flow

- onboarding
- create or edit local server profiles
- optional VPS bootstrap plan via the helper backend
- connect or disconnect with the selected local profile

## Requirements

- Node.js 20+
- Java 17
- Android SDK / platform tools
- `adb`
- Local `android/app/libs/wobb-core.aar` built outside this repo

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Put the Android core archive here:

   ```text
   android/app/libs/wobb-core.aar
   ```

3. Start Metro:

   ```bash
   npm run start
   ```

4. If you want the optional VPS bootstrap helper over USB, reverse port 3000:

   ```bash
   npm run reverse
   ```

5. Run the app on a connected Android device:

   ```bash
   npm run android
   ```
