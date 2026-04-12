import "react-native-get-random-values";

import { StatusBar } from "expo-status-bar";
import React from "react";

import { ConcertMeshApp } from "./src/app/ConcertMeshApp";
import { AppProvider } from "./src/state/AppContext";

export default function App() {
  return (
    <AppProvider>
      <StatusBar style="light" />
      <ConcertMeshApp />
    </AppProvider>
  );
}
