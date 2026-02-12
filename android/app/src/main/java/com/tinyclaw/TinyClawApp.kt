package com.tinyclaw

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class TinyClawApp : Application() {

    companion object {
        const val CHANNEL_ID = "tinyclaw_service"
    }

    override fun onCreate() {
        super.onCreate()

        val channel = NotificationChannel(
            CHANNEL_ID,
            "TinyClaw Service",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Keeps TinyClaw running in the background"
        }

        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }
}
