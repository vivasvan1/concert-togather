import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export function SectionCard({
  title,
  subtitle,
  children,
  onTitlePress,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onTitlePress?: () => void;
}) {
  return (
    <View style={styles.card}>
      <Pressable style={styles.header} onPress={onTitlePress} disabled={!onTitlePress}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </Pressable>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#171B22",
    borderRadius: 16,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: "#22303A",
  },
  header: {
    gap: 4,
  },
  title: {
    color: "#F4F7FB",
    fontSize: 18,
    fontWeight: "700",
  },
  subtitle: {
    color: "#98A4B3",
    fontSize: 12,
    lineHeight: 16,
  },
  content: {
    gap: 10,
  },
});
