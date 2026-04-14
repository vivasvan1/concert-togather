const fs = require("node:fs");

const config = {
  expo: {
    name: "Concert Togather",
    slug: "concert-togather",
    scheme: "concertmesh",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "light",
    assetBundlePatterns: ["**/*"],
    ios: {
      bundleIdentifier: "com.vivasvan.concertmesh",
      supportsTablet: true,
      infoPlist: {
        NSContactsUsageDescription:
          "Concert Togather uses your contacts so you can start chats by phone number and send request-based invites.",
        NSLocationWhenInUseUsageDescription:
          "Concert Togather uses your location to help friends find your meetup spot when service is weak.",
      },
    },
    plugins: [
      [
        "expo-contacts",
        {
          contactsPermission:
            "Concert Togather uses your contacts so you can start chats by phone number and send request-based invites.",
        },
      ],
      "@react-native-firebase/app",
      "@react-native-firebase/auth",
    ],
    android: {
      package: "com.vivasvan.concertmesh",
      versionCode: 1,
      adaptiveIcon: {
        backgroundColor: "#10141A",
      },
      permissions: [
        "ACCESS_COARSE_LOCATION",
        "ACCESS_FINE_LOCATION",
        "BLUETOOTH",
        "BLUETOOTH_ADMIN",
        "BLUETOOTH_ADVERTISE",
        "BLUETOOTH_CONNECT",
        "BLUETOOTH_SCAN",
        "ACCESS_WIFI_STATE",
        "CHANGE_WIFI_STATE",
        "NEARBY_WIFI_DEVICES",
        "READ_CONTACTS",
      ],
    },
    extra: {
      eas: {
        projectId: "98a2a40b-cc02-42bb-ad0e-bd54fbaa8b96",
      },
    },
  },
};

if (fs.existsSync("./GoogleService-Info.plist")) {
  config.expo.ios.googleServicesFile = "./GoogleService-Info.plist";
}

if (fs.existsSync("./google-services.json")) {
  config.expo.android.googleServicesFile = "./google-services.json";
} else if (fs.existsSync("./android/app/google-services.json")) {
  config.expo.android.googleServicesFile = "./android/app/google-services.json";
}

module.exports = config;
