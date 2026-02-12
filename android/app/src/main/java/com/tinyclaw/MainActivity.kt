package com.tinyclaw

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.Spinner
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private var serviceRunning = false

    private lateinit var statusText: TextView
    private lateinit var toggleButton: Button
    private lateinit var modelSpinner: Spinner
    private lateinit var portText: TextView

    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* proceed regardless */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusText = findViewById(R.id.status_text)
        toggleButton = findViewById(R.id.toggle_button)
        modelSpinner = findViewById(R.id.model_spinner)
        portText = findViewById(R.id.port_text)

        val models = arrayOf(
            "gemma3-1b",
            "gemma-3n-e2b",
            "gemma-3n-e4b",
            "phi-4-mini",
            "qwen2.5-1.5b"
        )
        modelSpinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, models)

        portText.text = getString(R.string.port_label, 8787)

        toggleButton.setOnClickListener {
            if (serviceRunning) {
                stopTinyClaw()
            } else {
                startTinyClaw()
            }
        }

        requestNotificationPermissionIfNeeded()
        updateUi()
    }

    private fun startTinyClaw() {
        val intent = Intent(this, TinyClawService::class.java)
        ContextCompat.startForegroundService(this, intent)
        serviceRunning = true
        updateUi()
    }

    private fun stopTinyClaw() {
        val intent = Intent(this, TinyClawService::class.java).apply {
            action = TinyClawService.ACTION_STOP
        }
        startService(intent)
        serviceRunning = false
        updateUi()
    }

    private fun updateUi() {
        if (serviceRunning) {
            statusText.text = getString(R.string.status_running)
            toggleButton.text = getString(R.string.stop)
        } else {
            statusText.text = getString(R.string.status_stopped)
            toggleButton.text = getString(R.string.start)
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }
}
