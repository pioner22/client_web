# Yagodka Web/PWA Client

Браузерный клиент Ягодки: Vite SPA, PWA, service worker, скины и web runtime для подключения к WebSocket gateway.

Этот репозиторий содержит только Web/PWA исходники. Android/Capacitor и macOS/Electron вынесены в отдельные репозитории.

## Что внутри

- `src/` - UI, runtime, stores, features и DOM-компоненты.
- `public/` - статические файлы, PWA manifest, service worker assets, скины.
- `scripts/` - сборка PWA, скинов, тестовый runner.
- `test/` - web/PWA regression tests.

## Локальный запуск

Требуется Node.js 20+.

```bash
npm install
npm run dev
```

По умолчанию dev-клиент ждёт gateway на `ws://127.0.0.1:8787/ws`. Для другого адреса:

```bash
VITE_GATEWAY_URL=wss://yagodka.org/ws npm run dev
```

## Проверки

```bash
npm run typecheck
npm run test
npm run build
```

## PWA и обновления

Клиент устанавливается как PWA и обновляется через web build/service worker. Android APK и macOS desktop updates не находятся в этом репозитории.

## Скины

- Реестр: `public/skins/skins.json`
- Файлы тем: `public/skins/*.css`
- Сборка скинов выполняется внутри `npm run build`.

## License

GPL-3.0-or-later. См. `LICENSE`.
