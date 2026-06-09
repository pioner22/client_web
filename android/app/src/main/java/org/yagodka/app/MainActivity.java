package org.yagodka.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int YAGODKA_STATUS_BAR = Color.rgb(9, 13, 19);
    private static final int YAGODKA_NAV_BAR = Color.rgb(12, 18, 26);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureSystemBars();
        configureWebView();
    }

    private void configureSystemBars() {
        Window window = getWindow();
        if (window == null) return;

        window.setStatusBarColor(YAGODKA_STATUS_BAR);
        window.setNavigationBarColor(YAGODKA_NAV_BAR);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            int flags = window.getDecorView().getSystemUiVisibility();
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            window.getDecorView().setSystemUiVisibility(flags);
        }
    }

    private void configureWebView() {
        if (getBridge() == null || getBridge().getWebView() == null) return;

        WebView webView = getBridge().getWebView();
        webView.setBackgroundColor(YAGODKA_STATUS_BAR);
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> openExternalUrl(url));
    }

    private void openExternalUrl(String rawUrl) {
        String url = rawUrl == null ? "" : rawUrl.trim();
        if (url.isEmpty()) return;
        if (url.startsWith("blob:") || url.startsWith("data:")) {
            Toast.makeText(this, "Файл готов внутри Ягодки. Откройте просмотр и используйте «Поделиться».", Toast.LENGTH_LONG).show();
            return;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(intent);
        } catch (ActivityNotFoundException ex) {
            Toast.makeText(this, "Не удалось открыть ссылку для скачивания.", Toast.LENGTH_LONG).show();
        } catch (Exception ex) {
            Toast.makeText(this, "Не удалось открыть внешнюю ссылку.", Toast.LENGTH_LONG).show();
        }
    }
}
