package expo.modules.concertnearbymesh

import android.util.Log
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.tasks.Task
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

// Android bridge around Google Nearby Connections. It exposes a small set of JS
// events so the rest of the app can stay transport-agnostic.
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
      Log.i(MODULE_NAME, "startSession eventId=$eventId userId=$userId alias=$alias")
      // Rebuilding the session from scratch keeps endpoint caches aligned with
      // the currently selected event and user identity.
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

      val advertisingTask: Task<Void> = connectionsClient.startAdvertising(
        buildEndpointName(eventId, userId, alias),
        SERVICE_ID,
        connectionLifecycleCallback,
        advertisingOptions
      )
      advertisingTask.addOnFailureListener { error ->
        Log.e(MODULE_NAME, "Failed to start advertising", error)
        emitConnectionState(
          "error",
          describeError("Failed to start Android nearby advertising", error),
          getStatusCode(error)
        )
      }
      advertisingTask.addOnSuccessListener {
        Log.i(MODULE_NAME, "Advertising started for serviceId=$SERVICE_ID")
      }

      val discoveryTask: Task<Void> = connectionsClient.startDiscovery(
        SERVICE_ID,
        endpointDiscoveryCallback,
        discoveryOptions
      )
      discoveryTask.addOnFailureListener { error ->
        Log.e(MODULE_NAME, "Failed to start discovery", error)
        emitConnectionState(
          "error",
          describeError("Failed to start Android nearby discovery", error),
          getStatusCode(error)
        )
      }
      discoveryTask.addOnSuccessListener {
        Log.i(MODULE_NAME, "Discovery started for serviceId=$SERVICE_ID")
      }

      return@AsyncFunction Unit
    }

    AsyncFunction("stopSession") {
      Log.i(MODULE_NAME, "stopSession")
      stopActiveSession()
      emitConnectionState("disconnected", null)
    }

    AsyncFunction("sendEnvelope") { envelopeJson: String ->
      if (connectedPeers.isEmpty()) {
        throw IllegalStateException("No nearby peers are connected.")
      }

      Log.i(MODULE_NAME, "sendEnvelope peers=${connectedPeers.size} bytes=${envelopeJson.length}")
      val payload = Payload.fromBytes(envelopeJson.toByteArray(StandardCharsets.UTF_8))
      val endpointIds = connectedPeers.keys.toList()
      val sendTask: Task<Void> = connectionsClient.sendPayload(endpointIds, payload)
      sendTask.addOnFailureListener { error ->
        Log.e(MODULE_NAME, "Failed to send nearby payload", error)
        emitConnectionState(
          "error",
          describeError("Failed to send to nearby peers", error),
          getStatusCode(error)
        )
      }
      sendTask.addOnSuccessListener {
        Log.i(MODULE_NAME, "sendEnvelope success endpoints=${endpointIds.joinToString(",")}")
      }

      return@AsyncFunction Unit
    }

    OnDestroy {
      stopActiveSession()
    }
  }

  private val endpointDiscoveryCallback = object : EndpointDiscoveryCallback() {
    override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
      Log.i(MODULE_NAME, "onEndpointFound endpointId=$endpointId name=${info.endpointName}")
      val endpoint = parseEndpointName(info.endpointName) ?: return
      if (endpoint.eventId != activeEventId || endpoint.userId == activeUserId) {
        Log.i(MODULE_NAME, "Ignoring endpointId=$endpointId eventId=${endpoint.eventId} userId=${endpoint.userId}")
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
        emitConnectionState(
          "error",
          describeError("Nearby request connection failed", error),
          getStatusCode(error)
        )
      }
      Log.i(MODULE_NAME, "requestConnection started endpointId=$endpointId alias=${endpoint.alias}")
    }

    override fun onEndpointLost(endpointId: String) {
      Log.i(MODULE_NAME, "onEndpointLost endpointId=$endpointId")
      discoveredPeers.remove(endpointId)
      connectedPeers.remove(endpointId)
      emitPeersChanged()
    }
  }

  private val connectionLifecycleCallback = object : ConnectionLifecycleCallback() {
    override fun onConnectionInitiated(endpointId: String, connectionInfo: ConnectionInfo) {
      Log.i(MODULE_NAME, "onConnectionInitiated endpointId=$endpointId name=${connectionInfo.endpointName}")
      val discoveredPeer = discoveredPeers[endpointId]
      val parsedEndpoint = parseEndpointName(connectionInfo.endpointName)

      // Nearby may surface only the remote alias here, not the full endpoint name
      // we advertised/discovered earlier. Prefer the cached discovered peer when present.
      if (discoveredPeer == null && (parsedEndpoint == null || parsedEndpoint.userId == activeUserId)) {
        Log.i(MODULE_NAME, "Rejecting unknown connection endpointId=$endpointId")
        connectionsClient.rejectConnection(endpointId)
        return
      }

      if (discoveredPeer == null && parsedEndpoint != null) {
        if (parsedEndpoint.eventId != activeEventId || parsedEndpoint.userId == activeUserId) {
          Log.i(MODULE_NAME, "Rejecting parsed connection endpointId=$endpointId")
          connectionsClient.rejectConnection(endpointId)
          return
        }

        discoveredPeers[endpointId] = NearbyPeer(
          endpointId = endpointId,
          userId = parsedEndpoint.userId,
          alias = parsedEndpoint.alias,
          lastSeenAt = nowIso()
        )
      } else if (discoveredPeer != null) {
        discoveredPeer.lastSeenAt = nowIso()
      }

      connectionsClient.acceptConnection(endpointId, payloadCallback)
      Log.i(
        MODULE_NAME,
        "acceptConnection endpointId=$endpointId alias=${discoveredPeers[endpointId]?.alias ?: connectionInfo.endpointName}"
      )
    }

    override fun onConnectionResult(endpointId: String, result: ConnectionResolution) {
      Log.i(
        MODULE_NAME,
        "onConnectionResult endpointId=$endpointId status=${result.status.statusCode} message=${result.status.statusMessage}"
      )
      if (result.status.statusCode == ConnectionsStatusCodes.STATUS_OK) {
        // Only surface peers to JS after Nearby fully accepts the connection.
        val peer = discoveredPeers[endpointId]
        if (peer != null) {
          peer.lastSeenAt = nowIso()
          connectedPeers[endpointId] = peer
        }
        emitPeersChanged()
        emitConnectionState("connected", null)
      } else {
        Log.w(
          MODULE_NAME,
          "Nearby connection failed with status ${result.status.statusCode}: ${result.status.statusMessage}"
        )
        connectedPeers.remove(endpointId)
        emitPeersChanged()
        emitConnectionState(
          "error",
          "Nearby connection failed: ${result.status.statusMessage ?: "unknown"}",
          result.status.statusCode
        )
      }
    }

    override fun onDisconnected(endpointId: String) {
      Log.i(MODULE_NAME, "onDisconnected endpointId=$endpointId")
      connectedPeers.remove(endpointId)
      emitPeersChanged()
      if (connectedPeers.isEmpty()) {
        emitConnectionState("connecting", null)
      }
    }
  }

  private val payloadCallback = object : PayloadCallback() {
    override fun onPayloadReceived(endpointId: String, payload: Payload) {
      Log.i(MODULE_NAME, "onPayloadReceived endpointId=$endpointId type=${payload.type}")
      val peer = connectedPeers[endpointId]
      if (peer != null) {
        peer.lastSeenAt = nowIso()
        emitPeersChanged()
      }

      if (payload.type != Payload.Type.BYTES) {
        return
      }

      // JS owns envelope verification/decryption; native just forwards the raw bytes.
      val bytes = payload.asBytes() ?: return
      val envelopeJson = String(bytes, StandardCharsets.UTF_8)
      Log.i(MODULE_NAME, "onPayloadReceived bytes=${bytes.size}")
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
    Log.i(MODULE_NAME, "stopActiveSession")
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

    Log.i(MODULE_NAME, "emitPeersChanged peers=${peers.size}")
    sendEvent(
      "onPeersChanged",
      mapOf("peers" to peers)
    )
  }

  private fun emitConnectionState(state: String, error: String?, statusCode: Int? = null) {
    Log.i(MODULE_NAME, "emitConnectionState state=$state statusCode=$statusCode error=$error")
    sendEvent(
      "onConnectionStateChanged",
      mapOf(
        "state" to state,
        "error" to error,
        "statusCode" to statusCode
      )
    )
  }

  private fun getStatusCode(error: Throwable): Int? {
    return (error as? ApiException)?.statusCode
  }

  private fun describeError(prefix: String, error: Throwable): String {
    val suffix = error.message?.takeIf { it.isNotBlank() } ?: error.javaClass.simpleName
    return "$prefix: $suffix"
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
