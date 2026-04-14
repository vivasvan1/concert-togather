import React, { useEffect, useMemo, useState } from "react";
import {
  BackHandler,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { SectionCard } from "../components/SectionCard";
import {
  confirmPhoneOtp,
  requestPhoneOtp,
  type PhoneConfirmationResult,
} from "../services/firebase/FirebasePhoneAuthService";
import { getPlatformCapabilities } from "../services/platform/capabilities";
import { useAppState } from "../state/AppContext";
import type { ChatMessage, DeliveryState, DeviceContact, FriendProfile } from "../types/domain";
import { formatTimeLabel, minutesAgo } from "../utils/date";
import {
  formatPhoneNumber,
  isLikelyPhoneNumber,
  normalizePhoneNumber,
  normalizePhoneNumberParts,
} from "../utils/phone";

type TabKey = "chats" | "discover";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "chats", label: "Chats" },
  { key: "discover", label: "People" },
];

const androidTopInset = Platform.OS === "android" ? NativeStatusBar.currentHeight ?? 0 : 0;

function getReceiptLabel(state: DeliveryState) {
  if (state === "read") {
    return "✓✓";
  }
  if (state === "delivered") {
    return "✓✓";
  }
  return "✓";
}

function getReceiptStyle(state: DeliveryState) {
  if (state === "read") {
    return styles.receiptRead;
  }
  if (state === "delivered") {
    return styles.receiptDelivered;
  }
  return styles.receiptSent;
}

function getChatStatusLabel(friend: FriendProfile) {
  if (friend.chatStatus === "accepted") {
    return "Available";
  }
  if (friend.chatStatus === "incoming-pending") {
    return "Request";
  }
  if (friend.chatStatus === "outgoing-pending") {
    return "Pending";
  }
  if (friend.chatStatus === "declined") {
    return "Declined";
  }
  return "Invite";
}

function getConversationPreview(
  friend: FriendProfile,
  latest?: ChatMessage,
  currentUserId?: string,
) {
  if (latest) {
    return `${latest.senderId === currentUserId ? "You: " : ""}${latest.plaintextPreview}`;
  }
  return getChatStatusLabel(friend);
}

function getConversationSortBucket(friend: FriendProfile, unreadCount: number) {
  if (unreadCount > 0) {
    return 0;
  }
  if (friend.chatStatus === "incoming-pending") {
    return 1;
  }
  if (friend.chatStatus === "accepted") {
    return 2;
  }
  if (friend.chatStatus === "outgoing-pending") {
    return 3;
  }
  return 4;
}

function getNearbyServiceLine(
  transportConnectionState: string,
  nearbyPermissionState: string,
  transportError?: string,
) {
  if (transportConnectionState === "error") {
    return transportError
      ? `Delivery issue: ${transportError}`
      : "Delivery issue";
  }

  if (transportConnectionState === "connected") {
    return "Nearby and internet assist are active";
  }

  if (transportConnectionState === "connecting") {
    return "Trying nearby and internet assist";
  }

  if (nearbyPermissionState !== "granted") {
    return transportError || "Nearby delivery is waiting for Android permissions";
  }

  return "Nearby is active. Internet relay connects when reachable";
}

function getComposerPlaceholder(friend: FriendProfile) {
  if (friend.chatStatus === "accepted") {
    return `Message ${friend.displayName}`;
  }

  if (friend.chatStatus === "incoming-pending") {
    return "Accept to chat";
  }

  if (friend.chatStatus === "outgoing-pending") {
    return "Waiting for approval";
  }

  return "Send a request first";
}

export function ConcertMeshApp() {
  const {
    state,
    bootstrapIdentity,
    syncContacts,
    sendChatRequest,
    approveFriendRequest,
    declineFriendRequest,
    sendChatMessage,
    setSelectedChatFriend,
    setRelayServerUrl,
    requestNearbyAccess,
  } = useAppState();
  const [activeTab, setActiveTab] = useState<TabKey>("chats");
  const [countryCode, setCountryCode] = useState("+91");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [profileName, setProfileName] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [phoneConfirmation, setPhoneConfirmation] = useState<PhoneConfirmationResult | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [draft, setDraft] = useState("");
  const [relayUrlDraft, setRelayUrlDraft] = useState(state.relayServerUrl);
  const [showNewChat, setShowNewChat] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [openedUnreadMarker, setOpenedUnreadMarker] = useState<{
    friendId: string;
    firstMessageId: string;
    count: number;
  }>();
  const capabilities = getPlatformCapabilities();

  useEffect(() => {
    setRelayUrlDraft(state.relayServerUrl);
  }, [state.relayServerUrl]);

  const incomingRequests = useMemo(
    () => state.friends.filter((friend) => friend.chatStatus === "incoming-pending"),
    [state.friends],
  );
  const conversationSummaries = useMemo(() => {
    if (!state.user) {
      return [];
    }

    const currentUserId = state.user.id;

    return state.friends
      .filter((friend) => friend.chatStatus !== "declined")
      .map((friend) => {
        const messages = state.messages.filter(
          (message) =>
            message.kind === "chat" &&
            ((message.senderId === currentUserId &&
              message.recipientIds.includes(friend.id)) ||
              (message.senderId === friend.id &&
                message.recipientIds.includes(currentUserId))),
        );
        const sorted = [...messages].sort(
          (left, right) =>
            new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime() ||
            right.messageId.localeCompare(left.messageId),
        );
        const latest = sorted[0];
        const unreadCount = messages.filter(
          (message) => message.senderId === friend.id && message.unread,
        ).length;

        return {
          friend,
          latest,
          unreadCount,
          sortBucket: getConversationSortBucket(friend, unreadCount),
          sortTime: latest ? new Date(latest.createdAt).getTime() : 0,
        };
      })
      .sort((left, right) => {
        if (left.sortBucket !== right.sortBucket) {
          return left.sortBucket - right.sortBucket;
        }
        return right.sortTime - left.sortTime;
      });
  }, [state.friends, state.messages, state.user]);

  const selectedFriend =
    state.friends.find((friend) => friend.id === state.selectedChatFriendId) ??
    conversationSummaries.find((item) => item.friend.id === state.selectedChatFriendId)?.friend;

  useEffect(() => {
    if (Platform.OS !== "android" || !selectedFriend) {
      return;
    }

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setOpenedUnreadMarker(undefined);
      setSelectedChatFriend(undefined);
      return true;
    });

    return () => {
      subscription.remove();
    };
  }, [selectedFriend, setSelectedChatFriend]);

  const selectedChatMessages = useMemo(() => {
    if (!state.user || !selectedFriend) {
      return [];
    }

    const currentUserId = state.user.id;
    return [...state.messages]
      .filter(
        (message) =>
          message.kind === "chat" &&
          ((message.senderId === currentUserId &&
            message.recipientIds.includes(selectedFriend.id)) ||
            (message.senderId === selectedFriend.id &&
              message.recipientIds.includes(currentUserId))),
      )
      .sort(
        (left, right) =>
          new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() ||
          left.messageId.localeCompare(right.messageId),
      );
  }, [selectedFriend, state.messages, state.user]);

  const matchedPeerIds = useMemo(
    () => new Set(state.transportPeers.map((peer) => peer.phoneNumber).filter(Boolean)),
    [state.transportPeers],
  );

  const newChatMatches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const friendMatches = state.friends.filter((friend) => {
      if (!query) {
        return true;
      }
      return (
        friend.displayName.toLowerCase().includes(query) ||
        friend.phoneNumberDisplay.toLowerCase().includes(query) ||
        friend.phoneNumber.includes(query)
      );
    });

    const friendPhoneNumbers = new Set(friendMatches.map((friend) => friend.phoneNumber));
    const contactMatches = state.contacts.filter((contact) => {
      if (friendPhoneNumbers.has(contact.phoneNumber)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        contact.displayName.toLowerCase().includes(query) ||
        contact.phoneNumberDisplay.toLowerCase().includes(query) ||
        contact.phoneNumber.includes(query)
      );
    });

    const peerMatches = state.transportPeers.filter((peer) => {
      if (!peer.phoneNumber || friendPhoneNumbers.has(peer.phoneNumber)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        peer.alias.toLowerCase().includes(query) ||
        peer.phoneNumberDisplay?.toLowerCase().includes(query) ||
        peer.phoneNumber.includes(query)
      );
    });

    return {
      friendMatches,
      contactMatches,
      peerMatches,
      manualPhoneNumber: isLikelyPhoneNumber(normalizePhoneNumber(searchQuery))
        ? normalizePhoneNumber(searchQuery)
        : "",
    };
  }, [searchQuery, state.contacts, state.friends, state.transportPeers]);

  const nearbyServiceLine = getNearbyServiceLine(
    state.transportConnectionState,
    state.nearbyPermissionState,
    state.transportError,
  );

  async function openChat(friendId: string) {
    const currentUserId = state.user?.id;

    if (!currentUserId) {
      await setSelectedChatFriend(friendId);
      return;
    }

    const unreadMessages = [...state.messages]
      .filter(
        (message) =>
          message.kind === "chat" &&
          message.senderId === friendId &&
          message.unread &&
          ((message.senderId === currentUserId && message.recipientIds.includes(friendId)) ||
            (message.senderId === friendId &&
              message.recipientIds.includes(currentUserId))),
      )
      .sort(
        (left, right) =>
          new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() ||
          left.messageId.localeCompare(right.messageId),
      );

    setOpenedUnreadMarker(
      unreadMessages.length > 0
        ? {
            friendId,
            firstMessageId: unreadMessages[0].messageId,
            count: unreadMessages.length,
          }
        : undefined,
    );

    await setSelectedChatFriend(friendId);
  }

  if (!state.user) {
    const normalizedPhone = normalizePhoneNumberParts(countryCode, phoneNumber);

    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.hero}>
          <Text style={styles.kicker}>Concert mesh</Text>
          <Text style={styles.headline}>Get started</Text>
          <View style={styles.phoneRow}>
            <TextInput
              value={countryCode}
              onChangeText={setCountryCode}
              style={[styles.input, styles.countryCodeInput]}
              placeholder="+91"
              placeholderTextColor="#6F7E90"
              keyboardType="phone-pad"
            />
            <TextInput
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              style={[styles.input, styles.phoneInput]}
              placeholder="98765 43210"
              placeholderTextColor="#6F7E90"
              keyboardType="phone-pad"
            />
          </View>
          <TextInput
            value={profileName}
            onChangeText={setProfileName}
            style={styles.input}
            placeholder="Your name"
            placeholderTextColor="#6F7E90"
          />
          {phoneConfirmation ? (
            <TextInput
              value={otpCode}
              onChangeText={setOtpCode}
              style={styles.input}
              placeholder="OTP code"
              placeholderTextColor="#6F7E90"
              keyboardType="number-pad"
            />
          ) : null}
          {authError ? <Text style={styles.authError}>{authError}</Text> : null}
          <Pressable
            onPress={async () => {
              if (!isLikelyPhoneNumber(normalizedPhone) || authBusy) {
                return;
              }

              setAuthBusy(true);
              setAuthError("");

              try {
                if (!phoneConfirmation) {
                  const confirmation = await requestPhoneOtp(normalizedPhone);
                  setPhoneConfirmation(confirmation);
                  setOtpCode("");
                } else {
                  await confirmPhoneOtp(phoneConfirmation, otpCode.trim());
                  bootstrapIdentity(normalizedPhone, profileName);
                }
              } catch (error) {
                setAuthError(
                  error instanceof Error
                    ? error.message
                    : "Unable to verify phone number.",
                );
              } finally {
                setAuthBusy(false);
              }
            }}
            style={({ pressed }) => [
              styles.primaryButton,
              ((!isLikelyPhoneNumber(normalizedPhone) ||
                (phoneConfirmation ? otpCode.trim().length < 4 : false) ||
                authBusy) &&
                styles.disabledButton),
              pressed && styles.buttonPressed,
            ]}
            disabled={
              !isLikelyPhoneNumber(normalizedPhone) ||
              (phoneConfirmation ? otpCode.trim().length < 4 : false) ||
              authBusy
            }
          >
            <Text style={styles.primaryButtonLabel}>
              {phoneConfirmation ? "Verify and enter" : "Send code"}
            </Text>
          </Pressable>
          {phoneConfirmation ? (
            <Pressable
              onPress={() => {
                if (authBusy) {
                  return;
                }
                setPhoneConfirmation(null);
                setOtpCode("");
                setAuthError("");
              }}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.secondaryLabel}>Change number</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.shell}>
        {activeTab === "chats" && selectedFriend ? (
          <View style={styles.chatScreen}>
            <View style={styles.chatCard}>
              <View style={styles.chatHeader}>
                <Pressable
                  onPress={() => {
                    setOpenedUnreadMarker(undefined);
                    setSelectedChatFriend(undefined);
                  }}
                  style={({ pressed }) => [
                    styles.backButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.backButtonLabel}>‹</Text>
                </Pressable>
                <View style={styles.friendMeta}>
                  <Text style={styles.rowTitle}>{selectedFriend.displayName}</Text>
                  <Text style={styles.rowMeta}>{selectedFriend.phoneNumberDisplay}</Text>
                </View>
                <Text style={[styles.badge, styles.mutedBadge]}>
                  {getChatStatusLabel(selectedFriend)}
                </Text>
              </View>

              {selectedFriend.chatStatus !== "accepted" ? (
                <View style={styles.requestBanner}>
                  <Text style={styles.rowTitle}>{getChatStatusLabel(selectedFriend)}</Text>
                  {selectedFriend.chatStatus === "incoming-pending" ? (
                    <View style={styles.inlineActions}>
                      <Pressable
                        onPress={() => approveFriendRequest(selectedFriend.id)}
                        style={({ pressed }) => [
                          styles.primaryButton,
                          styles.inlinePrimary,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text style={styles.primaryButtonLabel}>Accept</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => declineFriendRequest(selectedFriend.id)}
                        style={({ pressed }) => [
                          styles.secondaryButton,
                          styles.inlineSecondary,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text style={styles.secondaryLabel}>Decline</Text>
                      </Pressable>
                    </View>
                  ) : selectedFriend.chatStatus === "invitable-unregistered" ? (
                    <Pressable
                      onPress={() =>
                        sendChatRequest(
                          selectedFriend.phoneNumber,
                          selectedFriend.displayName,
                        )
                      }
                      style={({ pressed }) => [
                        styles.secondaryButton,
                        styles.inlineSecondary,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <Text style={styles.secondaryLabel}>Retry request</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              <ScrollView
                style={styles.chatThread}
                contentContainerStyle={styles.chatThreadContent}
                keyboardShouldPersistTaps="handled"
              >
                {selectedChatMessages.length === 0 ? (
                  <Text style={styles.emptyStateLabel}>No messages yet</Text>
                ) : (
                  selectedChatMessages.map((message) => {
                    const isMine = message.senderId === state.user?.id;
                    return (
                      <View key={message.messageId}>
                        {openedUnreadMarker?.friendId === selectedFriend.id &&
                        openedUnreadMarker.firstMessageId === message.messageId ? (
                          <View style={styles.unreadMarkerRow}>
                            <Text style={styles.unreadMarkerText}>
                              {openedUnreadMarker.count} unread{" "}
                              {openedUnreadMarker.count === 1 ? "message" : "messages"}
                            </Text>
                          </View>
                        ) : null}
                        <View
                          style={[styles.messageRow, isMine && styles.messageRowMine]}
                        >
                          <View
                            style={[
                              styles.messageBubble,
                              isMine && styles.messageBubbleMine,
                            ]}
                          >
                            <Text style={styles.messageText}>{message.plaintextPreview}</Text>
                            <View style={styles.messageFooter}>
                              <Text style={styles.messageMeta}>
                                {formatTimeLabel(message.createdAt)}
                              </Text>
                              {isMine ? (
                                <Text
                                  style={[
                                    styles.messageMeta,
                                    getReceiptStyle(message.deliveryState),
                                  ]}
                                >
                                  {getReceiptLabel(message.deliveryState)}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                        </View>
                      </View>
                    );
                  })
                )}
              </ScrollView>

              <View style={styles.composeRow}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  style={[styles.input, styles.composeInput]}
                  placeholder={getComposerPlaceholder(selectedFriend)}
                  placeholderTextColor="#6F7E90"
                  editable={selectedFriend.chatStatus === "accepted"}
                />
                <Pressable
                  onPress={async () => {
                    await sendChatMessage(selectedFriend.id, draft);
                    setDraft("");
                  }}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    styles.composeButton,
                    (selectedFriend.chatStatus !== "accepted" || !draft.trim()) &&
                      styles.disabledButton,
                    pressed && styles.buttonPressed,
                  ]}
                  disabled={selectedFriend.chatStatus !== "accepted" || !draft.trim()}
                >
                  <Text style={styles.primaryButtonLabel}>Send</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={styles.banner}>
              <Text style={styles.topBrand}>Concert Mesh</Text>
            </View>

            {activeTab === "chats" && nearbyServiceLine ? (
              <View
                style={[
                  styles.serviceLine,
                  state.transportConnectionState === "error"
                    ? styles.serviceLineError
                    : styles.serviceLineNeutral,
                ]}
              >
                <Text
                  style={[
                    styles.serviceLineText,
                    state.transportConnectionState === "error"
                      ? styles.serviceLineTextError
                      : styles.serviceLineTextNeutral,
                  ]}
                >
                  {nearbyServiceLine}
                </Text>
              </View>
            ) : null}

            {activeTab === "chats" ? (
              <>
                {!selectedFriend ? (
                <>
                  <SectionCard title="Chats">
                    <View style={styles.chatToolbar}>
                      <View style={styles.searchShell}>
                        <TextInput
                          value={searchQuery}
                          onChangeText={setSearchQuery}
                          style={styles.searchInput}
                          placeholder="Search chats or numbers"
                          placeholderTextColor="#7A8797"
                        />
                      </View>
                      <Pressable
                        onPress={() => setShowNewChat((value) => !value)}
                        style={({ pressed }) => [
                          styles.secondaryButton,
                          styles.toolbarButton,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text style={styles.secondaryLabel}>
                        {showNewChat ? "Close" : "New chat"}
                        </Text>
                      </Pressable>
                    </View>

                    {showNewChat ? (
                      <View style={styles.newChatPanel}>
                        <View style={styles.newChatHeader}>
                          <Text style={styles.sectionEyebrow}>Contacts</Text>
                          <Pressable
                            onPress={syncContacts}
                            style={({ pressed }) => [
                              styles.secondaryButton,
                              styles.compactButton,
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <Text style={styles.secondaryLabel}>
                              {state.contactsPermissionState === "granted"
                                ? "Refresh"
                                : state.contactsPermissionState === "denied"
                                  ? "Retry permission"
                                  : "Sync contacts"}
                            </Text>
                          </Pressable>
                        </View>

                        {newChatMatches.manualPhoneNumber &&
                        !newChatMatches.friendMatches.some(
                          (friend) => friend.phoneNumber === newChatMatches.manualPhoneNumber,
                        ) ? (
                          <Pressable
                            onPress={async () => {
                              await sendChatRequest(newChatMatches.manualPhoneNumber);
                              setShowNewChat(false);
                              setSearchQuery("");
                            }}
                            style={({ pressed }) => [
                              styles.contactRow,
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <View style={styles.avatar}>
                              <Text style={styles.avatarLabel}>#</Text>
                            </View>
                            <View style={styles.friendMeta}>
                              <Text style={styles.rowTitle}>{formatPhoneNumber(newChatMatches.manualPhoneNumber)}</Text>
                            </View>
                            <Text style={[styles.badge, styles.mutedBadge]}>Request</Text>
                          </Pressable>
                        ) : null}

                        {newChatMatches.friendMatches.map((friend) => (
                          <Pressable
                            key={friend.id}
                            onPress={async () => {
                              await openChat(friend.id);
                              setShowNewChat(false);
                              setSearchQuery("");
                            }}
                            style={({ pressed }) => [
                              styles.contactRow,
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <View style={styles.avatar}>
                              <Text style={styles.avatarLabel}>
                                {friend.displayName.slice(0, 1).toUpperCase()}
                              </Text>
                            </View>
                            <View style={styles.friendMeta}>
                              <Text style={styles.rowTitle}>{friend.displayName}</Text>
                              <Text style={styles.rowMeta}>
                                {friend.phoneNumberDisplay} · {getChatStatusLabel(friend)}
                              </Text>
                            </View>
                            <Text
                              style={[
                                styles.badge,
                                friend.chatStatus === "accepted"
                                  ? styles.goodBadge
                                  : styles.mutedBadge,
                              ]}
                            >
                              {friend.chatStatus === "accepted" ? "Open" : "View"}
                            </Text>
                          </Pressable>
                        ))}

                        {newChatMatches.contactMatches.map((contact: DeviceContact) => (
                          <Pressable
                            key={contact.id}
                            onPress={async () => {
                              await sendChatRequest(contact.phoneNumber, contact.displayName);
                              setShowNewChat(false);
                              setSearchQuery("");
                            }}
                            style={({ pressed }) => [
                              styles.contactRow,
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <View style={styles.avatar}>
                              <Text style={styles.avatarLabel}>
                                {contact.displayName.slice(0, 1).toUpperCase()}
                              </Text>
                            </View>
                            <View style={styles.friendMeta}>
                              <Text style={styles.rowTitle}>{contact.displayName}</Text>
                              <Text style={styles.rowMeta}>{contact.phoneNumberDisplay}</Text>
                            </View>
                            <Text
                              style={[
                                styles.badge,
                                matchedPeerIds.has(contact.phoneNumber)
                                  ? styles.goodBadge
                                  : styles.mutedBadge,
                              ]}
                            >
                              {matchedPeerIds.has(contact.phoneNumber) ? "Request" : "Invite"}
                            </Text>
                          </Pressable>
                        ))}

                        {newChatMatches.peerMatches.map((peer) => (
                          <Pressable
                            key={peer.id}
                            onPress={async () => {
                              await sendChatRequest(peer.phoneNumber ?? peer.alias, peer.alias);
                              setShowNewChat(false);
                              setSearchQuery("");
                            }}
                            style={({ pressed }) => [
                              styles.contactRow,
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <View style={styles.avatar}>
                              <Text style={styles.avatarLabel}>+</Text>
                            </View>
                            <View style={styles.friendMeta}>
                              <Text style={styles.rowTitle}>
                                {peer.phoneNumberDisplay || peer.alias}
                              </Text>
                            </View>
                            <Text style={[styles.badge, styles.goodBadge]}>Request</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}

                    {conversationSummaries.length === 0 ? (
                      <Text style={styles.emptyStateLabel}>No chats yet</Text>
                    ) : (
                      conversationSummaries.map(({ friend, latest, unreadCount }) => (
                        <Pressable
                          key={friend.id}
                          onPress={() => openChat(friend.id)}
                          style={({ pressed }) => [
                            styles.inboxRow,
                            pressed && styles.buttonPressed,
                          ]}
                        >
                          <View style={styles.avatar}>
                            <Text style={styles.avatarLabel}>
                              {friend.displayName.slice(0, 1).toUpperCase()}
                            </Text>
                          </View>
                          <View style={styles.inboxBody}>
                            <View style={styles.inboxHeadline}>
                              <Text style={styles.rowTitle}>{friend.displayName}</Text>
                              <Text style={styles.rowMeta}>
                                {latest
                                  ? formatTimeLabel(latest.createdAt)
                                  : formatTimeLabel(friend.lastSeenAt)}
                              </Text>
                            </View>
                            <View style={styles.inboxHeadline}>
                              <Text
                                style={[
                                  styles.rowMeta,
                                  unreadCount > 0 && styles.unreadPreview,
                                ]}
                                numberOfLines={1}
                              >
                                {getConversationPreview(friend, latest, state.user?.id)}
                              </Text>
                              {unreadCount > 0 ? (
                                <Text style={[styles.badge, styles.goodBadge]}>
                                  {unreadCount}
                                </Text>
                              ) : friend.chatStatus !== "accepted" ? (
                                <Text style={[styles.badge, styles.mutedBadge]}>
                                  {friend.chatStatus === "incoming-pending"
                                    ? "Request"
                                    : friend.chatStatus === "outgoing-pending"
                                      ? "Pending"
                                      : "Invite"}
                                </Text>
                              ) : null}
                            </View>
                          </View>
                        </Pressable>
                      ))
                    )}
                  </SectionCard>
                </>
              ) : null}
            </>
          ) : null}

          {activeTab === "discover" ? (
            <>
              <SectionCard title="Nearby">
                <View style={styles.row}>
                  <View style={styles.friendMeta}>
                    <Text style={styles.rowTitle}>Nearby</Text>
                  </View>
                  {state.nearbyPermissionState !== "granted" ? (
                    <Pressable
                      onPress={requestNearbyAccess}
                      style={({ pressed }) => [
                        styles.secondaryButton,
                        styles.inlineSecondary,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <Text style={styles.secondaryLabel}>Grant access</Text>
                    </Pressable>
                  ) : (
                    <Text style={[styles.badge, styles.goodBadge]}>Always on</Text>
                  )}
                </View>
              </SectionCard>

              <SectionCard title="Requests">
                {incomingRequests.length === 0 ? (
                  <Text style={styles.emptyStateLabel}>No requests</Text>
                ) : (
                  incomingRequests.map((friend) => (
                    <View key={friend.id} style={styles.friendCard}>
                      <View style={styles.friendMeta}>
                        <Text style={styles.rowTitle}>{friend.displayName}</Text>
                        <Text style={styles.rowMeta}>
                          {friend.phoneNumberDisplay} · seen{" "}
                          {minutesAgo(friend.lastSeenAt)}m ago
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => approveFriendRequest(friend.id)}
                        style={({ pressed }) => [
                          styles.secondaryButton,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text style={styles.secondaryLabel}>Accept</Text>
                      </Pressable>
                    </View>
                  ))
                )}
              </SectionCard>

              <SectionCard title="Nearby phones">
                {state.transportPeers.length === 0 ? (
                  <Text style={styles.emptyStateLabel}>No nearby phones</Text>
                ) : (
                  state.transportPeers.map((peer) => {
                    const friend = state.friends.find((item) => item.id === peer.id);
                    return (
                      <View key={peer.id} style={styles.friendCard}>
                        <View style={styles.friendMeta}>
                          <Text style={styles.rowTitle}>
                            {peer.phoneNumberDisplay || peer.alias}
                          </Text>
                          <Text style={styles.rowMeta}>
                            In range over {peer.via} · seen{" "}
                            {minutesAgo(peer.lastSeenAt)}m ago
                          </Text>
                        </View>
                        {friend ? (
                          <Text
                            style={[
                              styles.badge,
                              friend.chatStatus === "accepted"
                                ? styles.goodBadge
                                : styles.mutedBadge,
                            ]}
                          >
                            {getChatStatusLabel(friend)}
                          </Text>
                        ) : (
                          <Pressable
                            onPress={() => sendChatRequest(peer.phoneNumber ?? peer.alias)}
                            style={({ pressed }) => [
                              styles.secondaryButton,
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <Text style={styles.secondaryLabel}>Send request</Text>
                          </Pressable>
                        )}
                      </View>
                    );
                  })
                )}
              </SectionCard>

              <SectionCard title="Internet assist">
                <TextInput
                  value={relayUrlDraft}
                  onChangeText={setRelayUrlDraft}
                  style={styles.input}
                  placeholder="ws://192.168.x.x:8787/ws"
                  placeholderTextColor="#6F7E90"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Pressable
                  onPress={() => setRelayServerUrl(relayUrlDraft.trim())}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                    <Text style={styles.secondaryLabel}>Apply relay URL</Text>
                  </Pressable>
              </SectionCard>

              <SectionCard title="Device">
                {capabilities.map((capability) => (
                  <View key={capability.kind} style={styles.row}>
                    <View style={styles.friendMeta}>
                      <Text style={styles.rowTitle}>{capability.label}</Text>
                    </View>
                    <Text
                      style={[
                        styles.badge,
                        capability.available ? styles.goodBadge : styles.mutedBadge,
                      ]}
                    >
                      {capability.available ? "Ready" : "Limited"}
                    </Text>
                  </View>
                ))}
              </SectionCard>
            </>
          ) : null}
          </ScrollView>
        )}

        <View style={styles.tabBar}>
          {TABS.map((tab) => (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={({ pressed }) => [
                styles.tabButton,
                activeTab === tab.key && styles.tabButtonActive,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text
                style={[
                  styles.tabLabel,
                  activeTab === tab.key && styles.tabLabelActive,
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0B141A",
    paddingTop: androidTopInset,
  },
  shell: {
    flex: 1,
    backgroundColor: "#0B141A",
  },
  scrollContent: {
    padding: 14,
    gap: 12,
    paddingBottom: 108,
  },
  hero: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#0B141A",
  },
  banner: {
    paddingHorizontal: 4,
    paddingTop: 6,
    gap: 4,
  },
  topBrand: {
    color: "#25D366",
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  serviceLine: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
  },
  serviceLineNeutral: {
    backgroundColor: "#102027",
    borderColor: "#23404D",
  },
  serviceLineError: {
    backgroundColor: "#31171B",
    borderColor: "#6B3139",
  },
  serviceLineText: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  serviceLineTextNeutral: {
    color: "#A7D7EA",
  },
  serviceLineTextError: {
    color: "#FFB8C0",
  },
  chatScreen: {
    flex: 1,
    padding: 14,
    paddingBottom: 108,
  },
  chatCard: {
    flex: 1,
    backgroundColor: "#171B22",
    borderRadius: 16,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: "#22303A",
  },
  kicker: {
    color: "#25D366",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.6,
  },
  headline: {
    color: "#F3F7FB",
    fontSize: 28,
    lineHeight: 32,
    fontWeight: "800",
  },
  copy: {
    color: "#9AA8B7",
    fontSize: 15,
    lineHeight: 22,
  },
  authError: {
    color: "#FFB8C0",
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#22303A",
    backgroundColor: "#111B21",
    color: "#F3F7FB",
    paddingHorizontal: 16,
    fontSize: 15,
  },
  phoneRow: {
    flexDirection: "row",
    gap: 10,
  },
  countryCodeInput: {
    flex: 0.36,
  },
  phoneInput: {
    flex: 1,
  },
  primaryButton: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: "#25D366",
    justifyContent: "center",
    alignItems: "center",
  },
  primaryButtonLabel: {
    color: "#04110B",
    fontSize: 15,
    fontWeight: "800",
  },
  secondaryButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#22303A",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#121C22",
  },
  secondaryLabel: {
    color: "#D7E3EC",
    fontSize: 14,
    fontWeight: "700",
  },
  disabledButton: {
    opacity: 0.45,
  },
  inlinePrimary: {
    minWidth: 96,
  },
  inlineSecondary: {
    minWidth: 112,
  },
  toolbarButton: {
    minWidth: 96,
  },
  compactButton: {
    minHeight: 38,
    paddingHorizontal: 14,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  chatToolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchShell: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: "#111B21",
    borderWidth: 1,
    borderColor: "#22303A",
  },
  searchInput: {
    minHeight: 48,
    paddingHorizontal: 14,
    color: "#F3F7FB",
    fontSize: 14,
  },
  newChatPanel: {
    gap: 10,
    marginTop: 6,
    paddingTop: 2,
  },
  newChatHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  sectionEyebrow: {
    color: "#7FA1B6",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  inlineActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  rowTitle: {
    color: "#F3F7FB",
    fontSize: 16,
    fontWeight: "700",
  },
  rowMeta: {
    color: "#97A6B5",
    fontSize: 13,
    lineHeight: 18,
  },
  emptyStateLabel: {
    color: "#97A6B5",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    paddingVertical: 12,
  },
  unreadPreview: {
    color: "#DCE6EE",
    fontWeight: "700",
  },
  friendMeta: {
    flex: 1,
    gap: 2,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#1D2A33",
    color: "#D3DFE8",
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
  },
  goodBadge: {
    backgroundColor: "#103D30",
    color: "#A6F4D4",
  },
  mutedBadge: {
    backgroundColor: "#1A252D",
    color: "#A1AFBC",
  },
  friendCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderRadius: 12,
    backgroundColor: "#111B21",
    borderWidth: 1,
    borderColor: "#1F2B33",
    padding: 12,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    backgroundColor: "#111B21",
    borderWidth: 1,
    borderColor: "#1F2B33",
    padding: 12,
  },
  inboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1A2831",
    paddingVertical: 12,
  },
  inboxBody: {
    flex: 1,
    gap: 6,
  },
  inboxHeadline: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#1F2C34",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLabel: {
    color: "#DCE6EE",
    fontSize: 17,
    fontWeight: "800",
  },
  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  backButtonLabel: {
    color: "#D7E3EC",
    fontSize: 28,
    lineHeight: 28,
    fontWeight: "400",
  },
  requestBanner: {
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#22303A",
    backgroundColor: "#101A20",
    padding: 12,
  },
  chatThread: {
    flex: 1,
    minHeight: 0,
  },
  chatThreadContent: {
    gap: 10,
    paddingBottom: 8,
  },
  messageRow: {
    alignItems: "flex-start",
  },
  messageRowMine: {
    alignItems: "flex-end",
  },
  unreadMarkerRow: {
    alignItems: "center",
    paddingVertical: 6,
  },
  unreadMarkerText: {
    color: "#A6F4D4",
    fontSize: 12,
    fontWeight: "800",
    backgroundColor: "#103D30",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    overflow: "hidden",
  },
  messageBubble: {
    maxWidth: "84%",
    gap: 8,
    borderRadius: 14,
    backgroundColor: "#182229",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  messageBubbleMine: {
    backgroundColor: "#134D37",
    borderBottomRightRadius: 6,
  },
  messageText: {
    color: "#F3F7FB",
    fontSize: 15,
    lineHeight: 21,
  },
  messageFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  messageMeta: {
    color: "#9AA8B7",
    fontSize: 12,
    fontWeight: "600",
  },
  receiptSent: {
    color: "#8C98A7",
  },
  receiptDelivered: {
    color: "#C1D3E4",
  },
  receiptRead: {
    color: "#7DD8FF",
  },
  composeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 2,
  },
  composeInput: {
    flex: 1,
  },
  composeButton: {
    minWidth: 84,
  },
  tabBar: {
    position: "absolute",
    left: 14,
    right: 14,
    bottom: 14,
    flexDirection: "row",
    gap: 8,
    padding: 8,
    borderRadius: 16,
    backgroundColor: "#101A20",
    borderWidth: 1,
    borderColor: "#22303A",
  },
  tabButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  tabButtonActive: {
    backgroundColor: "#25D366",
  },
  tabLabel: {
    color: "#A7B5C2",
    fontSize: 14,
    fontWeight: "800",
  },
  tabLabelActive: {
    color: "#04110B",
  },
});
