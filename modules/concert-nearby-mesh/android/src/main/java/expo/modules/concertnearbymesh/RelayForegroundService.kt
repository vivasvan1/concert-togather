package expo.modules.concertnearbymesh

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper

private const val NOTIFICATION_ID = 1001
private const val CHANNEL_ID = "concert_relay"
private const val RELAY_INTERVAL_MS = 30_000L

class RelayForegroundService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private val tickRunnable = object : Runnable {
    override fun run() {
      ConcertNearbyMeshModule.emitRelayTick()
      handler.postDelayed(this, RELAY_INTERVAL_MS)
    }
  }

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(NOTIFICATION_ID, buildNotification())
    handler.postDelayed(tickRunnable, RELAY_INTERVAL_MS)
    return START_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(tickRunnable)
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Concert Relay",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Keeps messages relaying while in the background"
        setShowBadge(false)
      }
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.createNotificationChannel(channel)
    }
  }

  private fun buildNotification(): Notification {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
        .setContentTitle("Concert Togather")
        .setContentText("Relaying messages nearby")
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setOngoing(true)
        .build()
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
        .setContentTitle("Concert Togather")
        .setContentText("Relaying messages nearby")
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setOngoing(true)
        .build()
    }
  }
}
