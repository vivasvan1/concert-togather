package expo.modules.concertnearbymesh

import android.util.Log
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.nio.charset.StandardCharsets
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ConcurrentHashMap

private const val MODULE_NAME = "ConcertNearbyMesh"
private const val SERVICE_ID = "concert.mesh.v1"
private val STRATEGY = Strategy.P2P_CLUSTER

data class NearbyPeer(
  val endpointId: String,
  val userId: String,
  val alias: String,
  var lastSeenAt: String
)

class ConcertNearbyMeshModule : Module() {
  private val discoveredPeers = ConcurrentHashMap<String, NearbyPeer>()
  private val connectedPeers = ConcurrentHashMap<String, NearbyPeer>()

  private var activeEventId: String? = null
  private var activeUserId: String? = null
  private var activeAlias: String? = null

  private val connectionsClient: ConnectionsClient
    get() = Nearby.getConnectionsClient(
      appContext.reactContext
        ?: throw IllegalStateException("React context unavailable for Nearby transport")
    )

  override fun definition() = ModuleDefinition {
    Name(MODULE_NAME)

    Events("onConnectionStateChanged", "onPeersChanged", "onEnvelope")

    Function("isAvailable") {
      appContext.reactContext != null
    }

    AsyncFunction("startSession") { eventId: String, userId: String, alias: String ->
      stopActiveSession()

      activeEventId = eventId
      activeUserId = userId
      activeAlias = alias

      emitConnectionState("connecting", null)

      val advertisingOptions = AdvertisingOptions.Builder()
        .setStrategy(STRATEGY)
        .build()

      val discoveryOptions = DiscoveryOptions.Builder()
        .setStrategy(STRATEGY)
        .build()

      connectionsClient.startAdvertising(
        buildEndpointName(eventId, userId, alias),
        SERVICE_ID,
        connectionLifecycleCallback,
        advertisingOptions
      ).addOnFailureListener { error ->
        Log.e(MODULE_NAME, "Failed to start advertising", error)
        emitConnectionState("error", "Failed to start Android nearby advertising.")
      }

      connectionsClient.startDiscovery(
        SERVICE_ID,
        endpointDiscoveryCallback,
        discoveryOptions
      ).addOnFailureListener { error ->
        Log.e(MODULE_NAME, "Failed to start discovery", error)
        emitConnectionState("error", "Failed to start Android nearby discovery.")
      }
    }

    AsyncFunction("stopSession") {
      stopActiveSession()
      emitConnectionState("disconnected", null)
    }

    AsyncFunction("sendEnvelope") { envelopeJson: String ->
      if (connectedPeers.isEmpty()) {
        throw IllegalStateException("No nearby peers are connected.")
      }

      val payload = Payload.fromBytes(envelopeJson.toByteArray(StandardCharsets.UTF_8))
      val endpointIds = connectedPeers.keys.toList()
      connectionsClient.sendPayload(endpointIds, payload)
        .addOnFailureListener { error ->
          Log.e(MODULE_NAME, "Failed to send nearby payload", error)
          emitConnectionState("error", "Failed to send to nearby peers.")
        }
    }

    OnDestroy {
      stopActiveSession()
    }
  }

  private val endpointDiscoveryCallback = object : EndpointDiscoveryCallback() {
    override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
      val endpoint = parseEndpointName(info.endpointName) ?: return
      if (endpoint.eventId != activeEventId || endpoint.userId == activeUserId) {
        return
      }

      discoveredPeers[endpointId] = NearbyPeer(
        endpointId = endpointId,
        userId = endpoint.userId,
        alias = endpoint.alias,
        lastSeenAt = nowIso()
      )

      connectionsClient.requestConnection(
        activeAlias ?: "concert-user",
        endpointId,
        connectionLifecycleCallback
      ).addOnFailureListener { error ->
        Log.w(MODULE_NAME, "Request connection failed for $endpointId", error)
      }
    }

    override fun onEndpointLost(endpointId: String) {
      discoveredPeers.remove(endpointId)
      connectedPeers.remove(endpointId)
      emitPeersChanged()
    }
  }

  private val connectionLifecycleCallback = object : ConnectionLifecycleCallback() {
    override fun onConnectionInitiated(endpointId: String, connectionInfo: ConnectionInfo) {
      val endpoint = parseEndpointName(connectionInfo.endpointName)
      if (endpoint == null || endpoint.eventId != activeEventId || endpoint.userId == activeUserId) {
        connectionsClient.rejectConnection(endpointId)
        return
      }

      discoveredPeers[endpointId] = NearbyPeer(
        endpointId = endpointId,
        userId = endpoint.userId,
        alias = endpoint.alias,
        lastSeenAt = nowIso()
      )

      connectionsClient.acceptConnection(endpointId, payloadCallback)
    }

    override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
      if (result.status.statusCode == ConnectionsStatusCodes.STATUS_OK) {
        val peer = discoveredPeers[endpointId]
        if (peer != null) {
          peer.lastSeenAt = nowIso()
          connectedPeers[endpointId] = peer
        }
        emitPeersChanged()
        emitConnectionState("connected", null)
      } else {
        connectedPeers.remove(endpointId)
        emitPeersChanged()
        emitConnectionState("error", "Nearby connection failed.")
      }
    }

    override fun onDisconnected(endpointId: String) {
      connectedPeers.remove(endpointId)
      emitPeersChanged()
      if (connectedPeers.isEmpty()) {
        emitConnectionState("connecting", null)
      }
    }
  }

  private val payloadCallback = object : PayloadCallback() {
    override fun onPayloadReceived(endpointId: String, payload: Payload) {
      val peer = connectedPeers[endpointId]
      if (peer != null) {
        peer.lastSeenAt = nowIso()
        emitPeersChanged()
      }

      if (payload.type != Payload.Type.BYTES) {
        return
      }

      val bytes = payload.asBytes() ?: return
      val envelopeJson = String(bytes, StandardCharsets.UTF_8)
      sendEvent(
        "onEnvelope",
        mapOf("envelopeJson" to envelopeJson)
      )
    }

    override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {
      return
    }
  }

  private fun stopActiveSession() {
    discoveredPeers.clear()
    connectedPeers.clear()

    try {
      connectionsClient.stopAllEndpoints()
      connectionsClient.stopAdvertising()
      connectionsClient.stopDiscovery()
    } catch (error: Throwable) {
      Log.w(MODULE_NAME, "Failed to fully stop nearby session", error)
    }

    emitPeersChanged()
  }

  private fun emitPeersChanged() {
    val peers = connectedPeers.values
      .sortedBy { it.alias.lowercase() }
      .map {
        mapOf(
          "id" to it.userId,
          "alias" to it.alias,
          "lastSeenAt" to it.lastSeenAt,
          "via" to "nearby"
        )
      }

    sendEvent(
      "onPeersChanged",
      mapOf("peers" to peers)
    )
  }

  private fun emitConnectionState(state: String, error: String?) {
    sendEvent(
      "onConnectionStateChanged",
      mapOf(
        "state" to state,
        "error" to error
      )
    )
  }

  private fun buildEndpointName(eventId: String, userId: String, alias: String): String {
    val safeAlias = alias.replace("|", "").take(24)
    return "$eventId|$userId|$safeAlias"
  }

  private fun parseEndpointName(endpointName: String): ParsedEndpoint? {
    val parts = endpointName.split("|", limit = 3)
    if (parts.size != 3) {
      return null
    }

    return ParsedEndpoint(
      eventId = parts[0],
      userId = parts[1],
      alias = parts[2]
    )
  }

  private fun nowIso(): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    formatter.timeZone = TimeZone.getTimeZone("UTC")
    return formatter.format(Date())
  }
}

data class ParsedEndpoint(
  val eventId: String,
  val userId: String,
  val alias: String
)
