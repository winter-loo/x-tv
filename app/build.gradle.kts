plugins {
    id("com.android.application")
}

android {
    namespace = "cn.deeloo.tvxbrowser"
    compileSdk = 36

    defaultConfig {
        applicationId = "cn.deeloo.tvxbrowser"
        minSdk = 28
        targetSdk = 28
        versionCode = 2
        versionName = "0.2.0"

        ndk {
            abiFilters.addAll(listOf("armeabi-v7a"))
        }
    }

    buildFeatures {
        buildConfig = true
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

afterEvaluate {
    tasks.matching { it.name.contains("AarMetadata") }.configureEach {
        enabled = false
    }
}
