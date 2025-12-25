# Yagodka Web Client (PWA)

Клавиатурный мессенджер в стиле “терминал”, работающий в браузере и как PWA.

Этот репозиторий содержит **только web‑клиент**. Сервер — отдельный проект, клиент подключается к нему через WebSocket↔TCP gateway (браузер не умеет TCP напрямую).

## Содержание

- Что это
- Возможности
- Архитектура
- Запуск локально
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
