import React, { useEffect, useMemo, useState } from "react";
import {
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
import { getPlatformCapabilities } from "../services/platform/capabilities";
import { useAppState } from "../state/AppContext";
import type { ChatMessage, DeliveryState, DeviceContact, FriendProfile } from "../types/domain";
import { formatTimeLabel, minutesAgo } from "../utils/date";
import { formatPhoneNumber, isLikelyPhoneNumber, normalizePhoneNumber } from "../utils/phone";

type TabKey = "chats" | "discover" | "status";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "chats", label: "Chats" },
  { key: "discover", label: "Discover" },
  { key: "status", label: "Status" },
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
    return "Needs your approval";
  }
  if (friend.chatStatus === "outgoing-pending") {
    return "Waiting for acceptance";
  }
  if (friend.chatStatus === "declined") {
    return "Declined";
  }
  return "Invite to app";
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
  transportMode: string,
  transportConnectionState: string,
  transportError?: string,
) {
  const isNearbyContext =
    transportMode === "nearby-android" || transportConnectionState === "error";

  if (!isNearbyContext) {
    return undefined;
  }

  if (transportConnectionState === "error") {
    return transportError
      ? `Nearby delivery error: ${transportError}`
      : "Nearby delivery error";
  }

  if (transportConnectionState === "connected") {
    return "Nearby delivery is active";
  }

  if (transportConnectionState === "connecting") {
    return "Nearby delivery is connecting";
  }

  if (transportConnectionState === "permission-required") {
    return transportError || "Nearby delivery is waiting for permissions";
  }

  return "Nearby delivery is offline";
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
    setTransportMode,
    setRelayServerUrl,
    startNearbyTransport,
    stopNearbyTransport,
  } = useAppState();
  const [activeTab, setActiveTab] = useState<TabKey>("chats");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [profileName, setProfileName] = useState("");
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

  const acceptedFriends = useMemo(
    () => state.friends.filter((friend) => friend.chatStatus === "accepted"),
    [state.friends],
  );
  const incomingRequests = useMemo(
    () => state.friends.filter((friend) => friend.chatStatus === "incoming-pending"),
    [state.friends],
  );
  const pendingThreads = useMemo(
    () =>
      state.friends.filter(
        (friend) =>
          friend.chatStatus === "outgoing-pending" ||
          friend.chatStatus === "incoming-pending" ||
          friend.chatStatus === "invitable-unregistered",
      ),
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
    state.transportMode,
    state.transportConnectionState,
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
    const normalizedPhone = normalizePhoneNumber(phoneNumber);

    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.hero}>
          <Text style={styles.kicker}>Concert mesh</Text>
          <Text style={styles.headline}>Start with your phone number</Text>
          <Text style={styles.copy}>
            Chats stay request-based. People can find you by number, but they still
            need your approval before messaging opens.
          </Text>
          <TextInput
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            style={styles.input}
            placeholder="+1 415 555 0100"
            placeholderTextColor="#6F7E90"
            keyboardType="phone-pad"
          />
          <TextInput
            value={profileName}
            onChangeText={setProfileName}
            style={styles.input}
            placeholder="Your name"
            placeholderTextColor="#6F7E90"
          />
          <Pressable
            onPress={() => bootstrapIdentity(normalizedPhone, profileName)}
            style={({ pressed }) => [
              styles.primaryButton,
              !isLikelyPhoneNumber(normalizedPhone) && styles.disabledButton,
              pressed && styles.buttonPressed,
            ]}
            disabled={!isLikelyPhoneNumber(normalizedPhone)}
          >
            <Text style={styles.primaryButtonLabel}>Enter Headliner Night</Text>
          </Pressable>
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
                    styles.secondaryButton,
                    styles.backButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.secondaryLabel}>Back</Text>
                </Pressable>
                <View style={styles.friendMeta}>
                  <Text style={styles.rowTitle}>{selectedFriend.displayName}</Text>
                  <Text style={styles.rowMeta}>
                    {selectedFriend.phoneNumberDisplay} · {getChatStatusLabel(selectedFriend)}
                  </Text>
                </View>
              </View>

              {selectedFriend.chatStatus !== "accepted" ? (
                <View style={styles.requestBanner}>
                  <Text style={styles.rowTitle}>{getChatStatusLabel(selectedFriend)}</Text>
                  <Text style={styles.rowMeta}>
                    {selectedFriend.chatStatus === "incoming-pending"
                      ? "Approve this request before either side can message."
                      : selectedFriend.chatStatus === "outgoing-pending"
                        ? "Your request was sent. Chat unlocks after they accept."
                        : "This number is saved, but messaging works only after the other device is discoverable and accepts the request."}
                  </Text>
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
                  <Text style={styles.rowMeta}>
                    No messages yet. Once the request is accepted, this thread behaves
                    like a regular direct chat.
                  </Text>
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
                  placeholder={
                    selectedFriend.chatStatus === "accepted"
                      ? `Message ${selectedFriend.displayName}`
                      : "Chat unlocks after acceptance"
                  }
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
              <View>
                <Text style={styles.kicker}>Live event</Text>
                <Text style={styles.headline}>{state.event?.name}</Text>
                <Text style={styles.copy}>
                  {state.user.displayName} · {state.user.phoneNumberDisplay}
                </Text>
              </View>
              <View style={styles.bannerStats}>
                <Text style={styles.bannerStat}>{acceptedFriends.length} active</Text>
                <Text style={styles.bannerStat}>{incomingRequests.length} requests</Text>
              </View>
            </View>

            {nearbyServiceLine ? (
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
                  <SectionCard
                    title="Chats"
                    subtitle="Request-first conversations sorted like a chat inbox."
                  >
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
                        <View style={styles.row}>
                          <View style={styles.friendMeta}>
                            <Text style={styles.rowTitle}>Device contacts</Text>
                            <Text style={styles.rowMeta}>
                              {state.contactsPermissionState === "granted"
                                ? `${state.contacts.length} contacts loaded`
                                : "Import contacts to start chats by phone number."}
                            </Text>
                          </View>
                          <Pressable
                            onPress={syncContacts}
                            style={({ pressed }) => [
                              styles.secondaryButton,
                              pressed && styles.buttonPressed,
                            ]}
                          >
                            <Text style={styles.secondaryLabel}>
                              {state.contactsPermissionState === "granted"
                                ? "Refresh"
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
                              <Text style={styles.rowTitle}>
                                {formatPhoneNumber(newChatMatches.manualPhoneNumber)}
                              </Text>
                              <Text style={styles.rowMeta}>
                                Start a request by phone number
                              </Text>
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
                              <Text style={styles.rowMeta}>
                                {contact.phoneNumberDisplay} ·{" "}
                                {matchedPeerIds.has(contact.phoneNumber)
                                  ? "Nearby now"
                                  : "Invite only until they appear nearby"}
                              </Text>
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
                              <Text style={styles.rowMeta}>
                                Nearby over {peer.via}
                              </Text>
                            </View>
                            <Text style={[styles.badge, styles.goodBadge]}>Request</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}

                    {conversationSummaries.length === 0 ? (
                      <Text style={styles.rowMeta}>
                        No chats yet. Sync contacts or type a phone number to send a
                        request.
                      </Text>
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
              <SectionCard
                title="Nearby delivery"
                subtitle="Nearby peers are transport endpoints. Requests and approval still control who can chat."
              >
                <View style={styles.row}>
                  <View style={styles.friendMeta}>
                    <Text style={styles.rowTitle}>Nearby scan</Text>
                    <Text style={styles.rowMeta}>
                      {state.transportConnectionState}
                      {state.transportError ? ` · ${state.transportError}` : ""}
                    </Text>
                  </View>
                  <Pressable
                    onPress={
                      state.nearbyEnabled ? stopNearbyTransport : startNearbyTransport
                    }
                    style={({ pressed }) => [
                      styles.primaryButton,
                      styles.inlinePrimary,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={styles.primaryButtonLabel}>
                      {state.nearbyEnabled ? "Stop" : "Start"}
                    </Text>
                  </Pressable>
                </View>
              </SectionCard>

              <SectionCard
                title="Incoming requests"
                subtitle="These requests also appear in the chat inbox."
              >
                {incomingRequests.length === 0 ? (
                  <Text style={styles.rowMeta}>
                    No pending approvals right now.
                  </Text>
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

              <SectionCard
                title="Nearby phones"
                subtitle="Use phone numbers from contacts or the chat composer. Nearby discovery is only the delivery path."
              >
                {state.transportPeers.length === 0 ? (
                  <Text style={styles.rowMeta}>
                    No nearby phones yet. Start scanning on both devices and keep the
                    app in the foreground.
                  </Text>
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
            </>
          ) : null}

          {activeTab === "status" ? (
            <>
              <SectionCard
                title="Connection status"
                subtitle="Operational details for transport, sync, and receipts."
              >
                <View style={styles.row}>
                  <View style={styles.friendMeta}>
                    <Text style={styles.rowTitle}>Transport</Text>
                    <Text style={styles.rowMeta}>
                      {state.transportMode} · {state.transportConnectionState}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.badge,
                      state.transportConnectionState === "connected"
                        ? styles.goodBadge
                        : styles.mutedBadge,
                    ]}
                  >
                    {state.transportPeers.length} peers
                  </Text>
                </View>
                <Text style={styles.rowMeta}>
                  Contacts: {state.contactsPermissionState} · {state.contacts.length} loaded
                </Text>
                <Text style={styles.rowMeta}>
                  Pending request threads: {pendingThreads.length}
                </Text>
                <Text style={styles.rowMeta}>
                  Relay queue: {state.queue.length} · Seen envelopes:{" "}
                  {state.seenEnvelopeIds.length}
                </Text>
                <Text style={styles.rowMeta}>
                  Helped forward: {state.relayStats.forwardedEnvelopeCount} envelopes
                </Text>
              </SectionCard>

              <SectionCard
                title="Transport mode"
                subtitle="Nearby Android should be primary. Relay and demo remain as test tools."
              >
                <View style={styles.chipWrap}>
                  {Platform.OS === "android" ? (
                    <Pressable
                      onPress={() => setTransportMode("nearby-android")}
                      style={({ pressed }) => [
                        styles.chip,
                        state.transportMode === "nearby-android" && styles.chipActive,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <Text style={styles.chipLabel}>Nearby Android</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => setTransportMode("relay-server")}
                    style={({ pressed }) => [
                      styles.chip,
                      state.transportMode === "relay-server" && styles.chipActive,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={styles.chipLabel}>Relay server</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setTransportMode("demo")}
                    style={({ pressed }) => [
                      styles.chip,
                      state.transportMode === "demo" && styles.chipActive,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <Text style={styles.chipLabel}>Demo transport</Text>
                  </Pressable>
                </View>

                {state.transportMode === "relay-server" ? (
                  <>
                    <TextInput
                      value={relayUrlDraft}
                      onChangeText={setRelayUrlDraft}
                      style={styles.input}
                      placeholder="ws://192.168.x.x:8787"
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
                  </>
                ) : null}
              </SectionCard>

              <SectionCard
                title="Device capability"
                subtitle="Capability notes stay here so the chat flow stays clean."
              >
                {capabilities.map((capability) => (
                  <View key={capability.kind} style={styles.row}>
                    <View style={styles.friendMeta}>
                      <Text style={styles.rowTitle}>{capability.label}</Text>
                      <Text style={styles.rowMeta}>{capability.note}</Text>
                    </View>
                    <Text
                      style={[
                        styles.badge,
                        capability.available ? styles.goodBadge : styles.mutedBadge,
                      ]}
                    >
                      {capability.available ? "ready" : "limited"}
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
    padding: 16,
    gap: 16,
    paddingBottom: 124,
  },
  hero: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    gap: 14,
    backgroundColor: "#0B141A",
  },
  banner: {
    paddingHorizontal: 4,
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "flex-start",
  },
  bannerStats: {
    alignItems: "flex-end",
    gap: 6,
  },
  serviceLine: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
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
    padding: 16,
    paddingBottom: 124,
  },
  chatCard: {
    flex: 1,
    backgroundColor: "#171B22",
    borderRadius: 24,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: "#2A3340",
  },
  bannerStat: {
    color: "#8EE6C9",
    fontSize: 12,
    fontWeight: "800",
    backgroundColor: "#11332D",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: "hidden",
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
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "800",
  },
  copy: {
    color: "#9AA8B7",
    fontSize: 15,
    lineHeight: 22,
  },
  input: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#22303A",
    backgroundColor: "#111B21",
    color: "#F3F7FB",
    paddingHorizontal: 16,
    fontSize: 15,
  },
  primaryButton: {
    minHeight: 52,
    paddingHorizontal: 18,
    borderRadius: 18,
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
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2A3A44",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#101A20",
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
    borderRadius: 16,
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
    marginTop: 8,
    paddingTop: 4,
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
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#111B21",
    borderWidth: 1,
    borderColor: "#22303A",
  },
  chipActive: {
    backgroundColor: "#123428",
    borderColor: "#25D366",
  },
  chipLabel: {
    color: "#E1EAF1",
    fontSize: 13,
    fontWeight: "700",
  },
  friendCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderRadius: 18,
    backgroundColor: "#111B21",
    borderWidth: 1,
    borderColor: "#20303A",
    padding: 14,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    backgroundColor: "#111B21",
    borderWidth: 1,
    borderColor: "#20303A",
    padding: 14,
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
    width: 48,
    height: 48,
    borderRadius: 24,
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
    minWidth: 82,
  },
  requestBanner: {
    gap: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#2A3A44",
    backgroundColor: "#101A20",
    padding: 14,
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
    paddingHorizontal: 12,
    paddingVertical: 7,
    overflow: "hidden",
  },
  messageBubble: {
    maxWidth: "84%",
    gap: 8,
    borderRadius: 18,
    backgroundColor: "#182229",
    paddingHorizontal: 14,
    paddingVertical: 10,
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
    gap: 10,
    paddingTop: 4,
  },
  composeInput: {
    flex: 1,
  },
  composeButton: {
    minWidth: 92,
  },
  tabBar: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 18,
    flexDirection: "row",
    gap: 10,
    padding: 10,
    borderRadius: 26,
    backgroundColor: "#101A20",
    borderWidth: 1,
    borderColor: "#22303A",
  },
  tabButton: {
    flex: 1,
    minHeight: 54,
    borderRadius: 16,
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
