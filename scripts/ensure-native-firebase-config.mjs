import fs from "node:fs";
import path from "node:path";

const platform = process.argv[2];
const projectRoot = process.cwd();

const platformConfig = {
  ios: {
    filenames: ["GoogleService-Info.plist"],
    setupHint:
      "Create the iOS app in Firebase, download GoogleService-Info.plist, and place it in the repo root.",
  },
  android: {
    filenames: ["google-services.json", "android/app/google-services.json"],
    setupHint:
      "Create the Android app in Firebase, download google-services.json, and place it in the repo root or under android/app/.",
  },
};

if (!platform || !(platform in platformConfig)) {
  console.error("Usage: node scripts/ensure-native-firebase-config.mjs <ios|android>");
  process.exit(1);
}

const { filenames, setupHint } = platformConfig[platform];
const matchingPath = filenames.find((filename) =>
  fs.existsSync(path.join(projectRoot, filename)),
);

if (matchingPath) {
  process.exit(0);
}

console.error(`Missing required Firebase native config: ${filenames[0]}`);
console.error(setupHint);
process.exit(1);
