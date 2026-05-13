# Yagodka Android Client

Первый Android-контур использует Capacitor wrapper поверх существующего `client-web`. Это сохраняет общий UI/runtime с Web/PWA/Electron и даёт быстрый путь к APK/AAB без переписывания мессенджера на Kotlin.

## Что входит

- `capacitor.config.ts` с `appId=org.yagodka.app`, `appName=Yagodka`, `webDir=dist`.
- Native Android workspace в `android/`.
- Runtime defaults для Android WebView:
  - `wss://yagodka.org/ws`;
  - `https://yagodka.org/`;
  - `https://meet.yagodka.org`.
- Android permissions для сети, камеры и микрофона.
- Service Worker отключён в Capacitor runtime, чтобы Android shell не пытался работать как PWA cache.
- Update prompt для sideload APK: при серверном `update_required` Android-клиент открывает актуальный APK с `https://yagodka.org/downloads/android/yagodka-android-debug.apk`; пользователь устанавливает APK поверх текущей версии.

## Команды

```bash
cd project_01/client-web
npm install
npm run android:sync
```

Открыть Android Studio:

```bash
npm run android:open
```

Собрать debug APK:

```bash
npm run android:build:debug
```

Debug APK после успешной Gradle-сборки обычно находится здесь:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Требования окружения

Capacitor 8 Android project использует Android Gradle Plugin 8.x и Java source release 21. Для локальной сборки нужен актуальный Android toolchain:

- JDK 21 или новее;
- Android Studio или Android SDK command-line tools;
- установленный Android SDK Platform 36;
- `ANDROID_HOME` или `ANDROID_SDK_ROOT`, указывающий на SDK;
- доступ к `google()` и `mavenCentral()` для Gradle dependencies.

Если этих компонентов нет, `npm run android:sync` всё равно обновляет Android workspace и web assets, но `npm run android:build:debug` будет заблокирован окружением.

Локально проверенная сборочная среда:

- `openjdk@21`;
- `android-commandlinetools`;
- Android SDK Platform 36;
- Android SDK Build Tools 36.0.0.

## Smoke Checklist

1. `npm run typecheck`
2. `npm run test`
3. `npm run android:sync`
4. `npm run android:build:debug`
5. Установить debug APK на Android device/emulator.
6. Проверить стартовый экран авторизации.
7. Проверить подключение к `wss://yagodka.org/ws`.
8. Проверить вход, список контактов/групп/каналов и отправку тестового сообщения.
9. Проверить запросы camera/microphone permissions перед записью медиа или звонком.
10. При `update_required` проверить, что Android открывает скачивание нового APK, а не просто перезагружает старые bundled assets.

## Не входит в первый контур

- Google Play publish.
- Release signing/AAB.
- Silent auto-install для sideload APK: Android требует подтверждение пользователя на установку обновлённого APK.
- FCM/push notifications.
- Нативный Kotlin/Jetpack Compose rewrite.
- Нативный WebRTC слой.
- Background service/offline sync redesign.
