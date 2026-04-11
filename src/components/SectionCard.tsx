import React from "react";
import { StyleSheet, Text, View } from "react-native";

export function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#171B22",
    borderRadius: 24,
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: "#2A3340",
  },
  title: {
    color: "#F4F7FB",
    fontSize: 20,
    fontWeight: "700",
  },
  subtitle: {
    color: "#98A4B3",
    fontSize: 13,
    lineHeight: 18,
  },
  content: {
    gap: 12,
  },
});

