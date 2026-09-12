import java.util.Properties

plugins {
    id("com.android.application")
}

val releaseVersion = Properties().apply {
    rootProject.file("version.properties").inputStream().use { load(it) }
}
val signingValues = listOf("TVX_KEYSTORE_PATH", "TVX_KEYSTORE_PASSWORD", "TVX_KEY_ALIAS", "TVX_KEY_PASSWORD")
    .associateWith { providers.environmentVariable(it).orNull }
val hasReleaseSigning = signingValues.values.all { !it.isNullOrBlank() }
require(signingValues.values.all { it.isNullOrBlank() } || hasReleaseSigning) {
    "Release signing requires all four TVX_KEYSTORE_PATH/PASSWORD, TVX_KEY_ALIAS and TVX_KEY_PASSWORD variables."
}

android {
    namespace = "cn.deeloo.tvxbrowser"
    compileSdk {
        version = release(37) { minorApiLevel = 1 }
    }

    defaultConfig {
        applicationId = "cn.deeloo.tvxbrowser"
        minSdk = 28
        targetSdk = 28
        versionCode = releaseVersion.getProperty("versionCode").toInt()
        versionName = releaseVersion.getProperty("versionName")

        ndk {
            abiFilters.addAll(listOf("armeabi-v7a"))
        }
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("distribution") {
                storeFile = file(signingValues.getValue("TVX_KEYSTORE_PATH")!!)
                storePassword = signingValues.getValue("TVX_KEYSTORE_PASSWORD")
                keyAlias = signingValues.getValue("TVX_KEY_ALIAS")
                keyPassword = signingValues.getValue("TVX_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            versionNameSuffix = "-debug"
        }
        getByName("release") {
            isDebuggable = false
            // Keep the validated GeckoView / JavaScript bridge behavior; shrinking needs separate acceptance.
            isMinifyEnabled = false
            if (hasReleaseSigning) signingConfig = signingConfigs.getByName("distribution")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        disable += "ExpiredTargetSdkVersion"
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core:1.13.1")
    implementation("org.mozilla.geckoview:geckoview-omni-armeabi-v7a:155.0.20260903215306")
}
