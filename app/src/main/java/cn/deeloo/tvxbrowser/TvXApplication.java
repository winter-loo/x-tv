package cn.deeloo.tvxbrowser;

import android.app.Application;
import android.util.Log;
import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoRuntimeSettings;

public class TvXApplication extends Application {
    private static final String TAG = "TvXApplication";
    private static GeckoRuntime sRuntime;
    private static TvXApplication sApplication;
    private static XReadClient sInitialReadClient;

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

        sApplication = this;
        sInitialReadClient = new XReadClient(this);
        if(sInitialReadClient.available())sInitialReadClient.primeHome();
    }

    static XReadClient takeReadClient() {
        XReadClient client=sInitialReadClient;
        sInitialReadClient=null;
        return client!=null?client:new XReadClient(sApplication);
    }

    public static synchronized GeckoRuntime getRuntime() {
        if (sRuntime == null) {
            GeckoRuntimeSettings settings = new GeckoRuntimeSettings.Builder()
                    .javaScriptEnabled(true)
                    .consoleOutput(true)
                    .debugLogging(false)
                    .remoteDebuggingEnabled(BuildConfig.DEBUG)
                    .build();
            sRuntime = GeckoRuntime.create(sApplication, settings);
            Log.i(TAG, "GeckoRuntime created in main process");
        }
        return sRuntime;
    }
}
