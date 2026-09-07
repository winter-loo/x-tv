package cn.deeloo.tvxbrowser;

import android.app.Application;
import android.util.Log;
import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoRuntimeSettings;

public class TvXApplication extends Application {
    private static final String TAG = "TvXApplication";
    private static GeckoRuntime sRuntime;

    @Override
    public void onCreate() {
        super.onCreate();

        String processName = getProcessName();
        Log.e(TAG, "===> TvXApplication.onCreate in process: " + processName + " <===");

        // Crucial: Only initialize GeckoRuntime in the main app process.
        // GeckoView's child processes (:gpu, :tab, :crashhelper) also invoke Application.onCreate()!
        if (!getPackageName().equals(processName)) {
            Log.e(TAG, "Child process [" + processName + "]: skipping GeckoRuntime initialization.");
            return;
        }

        try {
            GeckoRuntimeSettings.Builder builder = new GeckoRuntimeSettings.Builder()
                    .javaScriptEnabled(true)
                    .consoleOutput(true)
                    .debugLogging(true)
                    .remoteDebuggingEnabled(true);

            sRuntime = GeckoRuntime.create(this, builder.build());
            Log.e(TAG, "===> GeckoRuntime created successfully in main process <===");
        } catch (Throwable t) {
            Log.e(TAG, "===> Failed to create GeckoRuntime <===", t);
        }
    }

    public static synchronized GeckoRuntime getRuntime() {
        return sRuntime;
    }
}
