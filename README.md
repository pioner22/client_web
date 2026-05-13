# Yagodka Web Client (PWA)

Клавиатурный мессенджер в стиле “терминал”, работающий в браузере и как PWA.

Этот репозиторий содержит **только web‑клиент**. Сервер — отдельный проект, клиент подключается к нему через WebSocket↔TCP gateway (браузер не умеет TCP напрямую).

## Содержание

- Что это
- Возможности
- Архитектура
- Запуск локально
- Desktop-приложение
- Android-приложение
- Сборка и проверка
- Конфигурация
- PWA и обновления
- Скины (темы)

## Что это

Yagodka Web — лёгкий SPA/PWA клиент без тяжёлых фреймворков: максимально быстрый старт, минимальная поверхность атаки и предсказуемое поведение в браузере.

## Возможности

- **Hotkeys / keyboard‑first**: управление через `F1…F7`, `Esc`, `Ctrl+F`, `Enter/Shift+Enter`.
- **Чаты/контакты/доски**: список слева, переписка справа, статусы соединения.
- **Composer “как в мессенджерах”**: авто‑рост `textarea`, кнопки attach/send, видимые фокусы, безопасные tap‑таргеты.
- **Контекстные меню**: ПКМ / long‑press на мобилке для контактов/чатов/досок и сообщений.
- **Закрепы**: несколько закреплённых сообщений на чат + навигация.
- **Файлы/медиа**: превью изображений, viewer, скачивание, история передач.
- **PWA**: offline‑friendly кеширование, “тихое” применение обновления без лишних перезагрузок.

## Архитектура (коротко)

```
Browser/PWA (Vite)  ── WebSocket ──  ws_gateway  ── TCP/NDJSON ──  server
```

- UI: `src/` (vanilla TS, без React/Vue).
- Состояние: `src/stores/` (простое хранилище с подпиской).
- Верстка: компоненты на DOM‑рендерерах (`src/components/**`, `src/pages/**`).
- Стили: `src/scss/**` + скины в `public/skins/**`.

## Запуск локально

Требуется: Node.js 20+, Python 3.10+.

1) Запусти TCP‑сервер (в корне основного проекта):

`ALLOW_INSECURE_DEV=1 SSL_REQUIRE=0 UPDATE_TLS_REQUIRE=0 DB_REQUIRE=0 python3 server/server.py`

2) Запусти WebSocket↔TCP gateway:

`ALLOW_INSECURE_DEV=1 python3 -m server.ws_gateway`

3) Запусти web‑клиент:

```bash
cd client-web
npm install
npm run dev
```

Открой `http://127.0.0.1:5173/`.

## Desktop-приложение

Electron shell использует тот же Vite build, что и PWA:

- dev: `npm run dev` в одном терминале, затем `npm run desktop:dev` во втором;
- локальная unpacked-сборка: `npm run desktop:build`;
- установочные артефакты текущей платформы: `npm run desktop:dist`;
- отдельные targets: `npm run desktop:dist:mac`, `npm run desktop:dist:win`, `npm run desktop:dist:linux`.
- unsigned testing ZIP + feed без Apple secrets: `npm run desktop:dist:mac:unsigned`.
- публикация macOS update feed после проверки и подписи: `npm run desktop:publish:mac`.

По умолчанию desktop dev подключается к `http://127.0.0.1:5173`. Для другого dev URL:

```bash
YAGODKA_DESKTOP_DEV_URL=http://127.0.0.1:5174 npm run desktop:dev
```

Production-сборка по умолчанию открывает локальный bundle `dist/index.html`, а адреса production-инфраструктуры передаёт в renderer через preload:

```bash
YAGODKA_DESKTOP_GATEWAY_URL=wss://yagodka.org/ws \
YAGODKA_DESKTOP_PUBLIC_BASE_URL=https://yagodka.org/ \
YAGODKA_DESKTOP_MEET_URL=https://meet.yagodka.org \
npm run desktop:build
```

Окно стартует развёрнутым, чтобы рабочая область помещалась без ручного растягивания. Для диагностики компактного окна:

```bash
YAGODKA_DESKTOP_DISABLE_MAXIMIZE=1 ./desktop-dist/mac/Yagodka.app/Contents/MacOS/Yagodka
```

### macOS auto-update

Desktop auto-update собран вокруг `electron-updater` и generic feed:

- feed по умолчанию: `https://yagodka.org/desktop-updates/mac/`;
- runtime override: `YAGODKA_DESKTOP_UPDATE_FEED_URL=https://example.com/updates/mac/`;
- отключить feed/runtime checks: `YAGODKA_DESKTOP_UPDATE_FEED_URL=off`;
- включить авто-проверку при старте packaged app: `YAGODKA_DESKTOP_UPDATE_AUTO_CHECK=1`;
- ручная проверка в приложении: `Info` → `Desktop` → `Проверить обновления`.

Для подписанного macOS релиза не хранить секреты в репозитории. Перед `npm run desktop:publish:mac` передаются только env/secrets:

```bash
export CSC_NAME='Developer ID Application: ...'
export APPLE_API_KEY_FILE=/secure/path/AuthKey_XXXX.p8
export APPLE_API_KEY_ID=<app-store-connect-key-id>
export APPLE_API_ISSUER_ID=<app-store-connect-issuer-uuid>
npm run desktop:publish:mac
```

`electron-builder` создаёт `latest-mac.yml` вместе с `dmg`/`zip`; auto-update требует оба macOS target (`dmg` и `zip`). Публикацию feed выполнять только после локального `npm run desktop:build`, тестов и ручного smoke запуска `desktop-dist/mac/Yagodka.app`.

Для текущего unsigned testing contour можно использовать `npm run desktop:dist:mac:unsigned`: он собирает unpacked `.app`, пакует ZIP и генерирует `desktop-dist/latest-mac.yml` без notarization/signing secrets.

## Android-приложение

Android shell собран через Capacitor поверх того же Vite build:

- синхронизировать web build в Android-проект: `npm run android:sync`;
- открыть проект в Android Studio: `npm run android:open`;
- собрать debug APK при установленном Android SDK/JDK 21+: `npm run android:build:debug`.

Native WebView runtime по умолчанию подключается к production endpoints:

- gateway: `wss://yagodka.org/ws`;
- public base: `https://yagodka.org/`;
- meet: `https://meet.yagodka.org`.

Service Worker внутри Capacitor/Android отключён: Android-приложение использует встроенные web assets из APK, а обновления Android идут через новую сборку APK/AAB. Подробный smoke checklist и требования окружения: `ANDROID.md`.

## Сборка и проверка

Из корня основного проекта:

`make web-check`

Локально только web‑часть:

```bash
cd client-web
npm run typecheck
npm run test
npm run build
```

## Конфигурация

### Web client

- `VITE_GATEWAY_URL` (по умолчанию `ws://127.0.0.1:8787/ws`)

### Gateway (ws_gateway)

- `WS_HOST` (default: `127.0.0.1`)
- `WS_PORT` (default: `8787`)
- `TCP_SERVER_ADDR` (default: `127.0.0.1:7777`)
- `WS_MAX_BYTES` (default: `65536`)
- `WS_ALLOWED_ORIGINS` — список origin через запятую. Если не задано — требуется `ALLOW_INSECURE_DEV=1`.

## PWA и обновления

- Клиент работает как PWA: можно “Установить” на главный экран.
- Обновление применяется максимально тихо; при проблемах iOS/WebKit есть защитные обходы (без автоперезагрузок по таймеру).
- Для воспроизведения iOS‑особенностей ввода есть репро‑страница: `public/repro/ios-input-assistant.html`.

## Скины (темы)

- Реестр: `public/skins/skins.json`
- Файлы тем: `public/skins/*.css`
- Сборка скинов в `dist` делается скриптом `scripts/build_skins.mjs`.

## Презентация

См. `PRESENTATION.md`.

## License

GPL-3.0-or-later. См. `LICENSE`.
