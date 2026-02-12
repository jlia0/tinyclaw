package com.tinyclaw

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat

class TinyClawService : Service() {

    companion object {
        const val ACTION_STOP = "com.tinyclaw.ACTION_STOP"

        init {
            System.loadLibrary("tinyclaw_android")
        }
    }

    private external fun nativeStart(dataDir: String): Int
    private external fun nativeStop(): Int

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            nativeStop()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(1, buildNotification())
        nativeStart(filesDir.absolutePath)

        return START_STICKY
    }

    override fun onDestroy() {
        nativeStop()
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        val stopIntent = Intent(this, TinyClawService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPending = PendingIntent.getService(
            this, 0, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val openIntent = Intent(this, MainActivity::class.java)
        val openPending = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, TinyClawApp.CHANNEL_ID)
            .setContentTitle("TinyClaw")
            .setContentText("Running on localhost:8787")
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(openPending)
            .addAction(0, "Stop", stopPending)
            .setOngoing(true)
            .build()
    }
}
