package cn.deeloo.tvxbrowser;

import android.util.Log;

/** App diagnostics are available only in debug builds; URLs and bridge data stay out of release logs. */
final class AppLog {
    private AppLog() {}

    static void d(String tag, String message) { if (BuildConfig.DEBUG) Log.d(tag, message); }
    static void i(String tag, String message) { if (BuildConfig.DEBUG) Log.i(tag, message); }
    static void w(String tag, String message) { if (BuildConfig.DEBUG) Log.w(tag, message); }
    static void e(String tag, String message) { if (BuildConfig.DEBUG) Log.e(tag, message); }
    static void e(String tag, String message, Throwable error) {
        if (BuildConfig.DEBUG) Log.e(tag, message, error);
    }
}
