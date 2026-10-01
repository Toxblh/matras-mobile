# Нативные звонки gomon в Matras — архитектурное решение

Дата: 2026-09-29. Контекст: gomon = LiveKit v1.13 + `services/communication` + плагин `ru.corp.comms`; Matras = форк Mattermost Mobile 2.44 (RN 0.83, New Architecture, expo-router). Сейчас звонок живёт в WebView (`app/products/gomon/components/call_host.tsx`), звук — через `@mattermost/calls-native`, входящий на Android — `MMCallsIncomingCall` (CallStyle + full-screen intent).

## Рекомендация

**Вариант (d) «гибрид»: медиа в JS через LiveKit React Native SDK, всё, где участвует ОС, — нативно.**

1. Медиа: `@livekit/react-native` 3.0 + `@livekit/react-native-webrtc` 144 (тот же `livekit-client`, что в meeting-web → общий TS-пакет логики звонка с вебом).
2. Единственный WebRTC-стек в бинарнике: Mattermost Calls переводится на форк `@livekit/react-native-webrtc` через npm-алиас (`"react-native-webrtc": "npm:@livekit/react-native-webrtc@^144"`), `calls-native` на iOS — с `JitsiWebRTC` на `LiveKitWebRTC` (`RTCAudioSession` → `LKRTCAudioSession`). Два стека рядом невозможны (см. ниже). Если владелец готов отказаться от Mattermost Calls — ещё проще: удалить.
3. Платформа: Android — Jetpack Core-Telecom 1.1 (звонок, аудио-эндпоинты, стриминг), CallStyle + Live Updates, PiP с auto-enter, MediaProjection; iOS — CallKit + PushKit (уже есть в `calls-native`, переиспользуем для gomon), PiP через `AVPictureInPictureVideoCallViewController` (есть в форке webrtc: `RTCPIPView`), Broadcast Upload Extension, LiveCommunicationKit — за флагом.
4. Сервер: плагин шлёт пуш с `Transport: voip`; свой push-proxy (форк mattermost-push-proxy ≥ 6.5.0) с собственным `.p8` для `ru.toxblh.matras`. Медиа-API менять не нужно: мобильный клиент делает то же, что веб, — `POST /v1/handoff/redeem` → `POST /v1/calls/{id}/join` → `token` + `livekit_url`.

Почему не WebView: на Android страница живёт только благодаря «1 px видимого WebView»; на iOS WKWebView останавливает захват микрофона/камеры в фоне, не отдаёт кадры для PiP, не умеет screen share и сам владеет `AVAudioSession`, конфликтуя с CallKit. «Идеально на обеих платформах» из WebView не получить.

Почему не полностью нативные SDK (c): они действительно сосуществуют с Jitsi-libwebrtc (Kotlin SDK — классы `livekit.org.webrtc.*`, Swift SDK — `LiveKitWebRTC` xcframework), но это два libwebrtc в бинарнике (+25–30 МБ), Swift SDK 2.17 только SwiftPM (CocoaPods deprecated), и весь мост Room/треки/видео-вью пишется дважды (Fabric-компоненты + TurboModule). Логика звонка с вебом не делится. Оправдано только если спайк (фаза 0) провалится.

## Сравнение вариантов

| | (a) WebView + шелл | (b) LiveKit RN SDK | (c) Swift/Kotlin SDK + мост | (d) гибрид = (b) + нативные модули |
|---|---|---|---|---|
| Фон/блокировка экрана | Android — хак, iOS — капчур останавливается | ок (FGS / CallKit) | ок | ок |
| PiP с видео | Android да, iOS нет | iOS через `RTCPIPView`, Android — PiP активити | да | да |
| Screen share | нет | Android да, iOS через broadcast-ext (Jitsi-схема) | да | да |
| CallKit/Telecom аудио | конфликт с WKWebView | `LKRTCAudioSession` + `AudioSession` API | родные рецепты SDK | как (b) |
| Сосуществование с Calls | ок | **нет** без перевода Calls на форк | ок (prefixed libwebrtc) | Calls на форке |
| Общий код с meeting-web | вся UI | `livekit-client` + TS-ядро | нет | `livekit-client` + TS-ядро |
| Размер | +0 | +~2 МБ (M124→M144) | +25–30 МБ | как (b) |
| Трудоёмкость | 0 | средняя | высокая ×2 | средняя+ |
| Риски | принципиальные | #468 (Hermes/New Arch), форк vs Calls | SPM в RN, два стека | как (b) |

Факт-основа: `@livekit/react-native-webrtc` — форк `react-native-webrtc` с теми же именами (`com.oney.WebRTCModule`, ObjC `WebRTCModule`/`RTCVideoView`, сервис `MediaProjectionService`) → duplicate class на Android и duplicate symbol на iOS при двух копиях; 3.0.0 убрал только коллизии libwebrtc (prefixed AAR/pod). Матрас использует upstream `react-native-webrtc` 124.0.7 без патчей, поэтому алиас на форк — практически drop-in (JS API совпадает; проверить `RTCPIPView` и `MediaProjectionService`).

## Чеклист платформенных API

### Android 14/15/16

- **Core-Telecom** `androidx.core:core-telecom:1.1.0-beta01` (2026-08-26; stable 1.0.1). `registerAppWithTelecom(BASELINE|SUPPORTS_VIDEO_CALLING|SUPPORTS_CALL_STREAMING)`, `addCall(CallAttributesCompat){ CallControlScope }`: `answer/disconnect/setActive/setInactive`, `availableEndpoints`/`currentCallEndpoint`/`requestEndpointChange` (EARPIECE, SPEAKER, BLUETOOTH, WIRED_HEADSET, STREAMING). Telecom сам держит фокус, `MODE_IN_COMMUNICATION` и роутинг — **убрать** `setCommunicationDevice`/SCO из `calls-native` для gomon. Нужен `MANAGE_OWN_CALLS`, `BLUETOOTH_CONNECT` (иначе BT→speaker баг до 1.0.1). API 26–33 — встроенный self-managed `ConnectionService`. Extensions: участники, «поднять руку», kick, local silence — ложатся на наши reactions/hand.
- **Foreground**: на API 34+ Telecom даёт приоритет phoneCall при CallStyle-уведомлении в течение 5 с; свой FGS `microphone|camera` (уже есть `MMCallsForegroundService`) остаётся — камера/микрофон в фоне требуют его; стартовать пока приложение видимо (full-screen intent = видимо). Android 15: без старта из BOOT_COMPLETED, аудио-фокус только top/FGS. Android 16: без новых ограничений.
- **Входящий**: CallStyle + `setFullScreenIntent` (есть). Android 14+: `canUseFullScreenIntent()` → `ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT` (есть); sideload сохраняет разрешение, Play отзывает для «не звонилок».
- **PiP**: `setAutoEnterEnabled(true)`, `setSeamlessResizeEnabled`, `setSourceRectHint`, `RemoteAction` mute/hang up (≤ `getMaxNumPictureInPictureActions()`), aspect 1:2.39–2.39:1; Android 15 `onPictureInPictureUiStateChanged`; Android 16 — predictive back по умолчанию (не полагаться на `onBackPressed`, `BackHandler` RN → `OnBackInvokedCallback`); `androidx.core:core-pip:1.0.0-alpha03`. В RN — `onPictureInPictureModeChanged` в `MainActivity` → событие в JS, `supportsPictureInPicture` + `configChanges` в манифесте.
- **Screen share**: `MediaProjection` — согласие на каждую сессию, `Callback` до `createVirtualDisplay`, FGS `mediaProjection` до `getMediaProjection()` (в SDK встроен `MediaProjectionService`; объявить `FOREGROUND_SERVICE_MEDIA_PROJECTION`). Android 15: чип в статус-баре, стоп при блокировке → `onStop()`.
- **Live Updates** (16 QPR1): `POST_PROMOTED_NOTIFICATIONS` + `setRequestPromotedOngoing(true)` на CallStyle → чип звонка. Telecom-звонки получают чип сами.
- **16 KB**: Jitsi M121+ и LiveKit 144 выровнены; после алиаса проверить `zipalign -P 16`.
- Проксимити: `PROXIMITY_SCREEN_OFF_WAKE_LOCK` (есть).

### iOS 17/18/26

- **CallKit + PushKit**: каждый VoIP-пуш → `reportNewIncomingCall` синхронно в делегате (иначе kill/бан); `apns-push-type: voip`, topic `<bundle>.voip`, priority 10, expiration 0; `.p8` работает. Всё это уже в `calls-native` (`PushKitController`, `CallKitProvider`): научить `sub_type=comms_call`, `supportsVideo=true`, `includesCallsInRecents` — на усмотрение.
- **Аудио**: `LKRTCAudioSession.useManualAudio=true`; в `didActivate` → `audioSessionDidActivate` + `isAudioEnabled=true`, `.playAndRecord/.videoChat`; RN SDK 3.0: `registerGlobals({autoConfigureAudioSession:false})`, `AudioSession.configureAudio/start/stop`. `AudioSessionManager.swift` уже держит `RTCAudioSession` — переименовать класс, логику оставить.
- **PiP**: `AVPictureInPictureVideoCallViewController` + `ContentSource(activeVideoCallSourceView:)` + `AVSampleBufferDisplayLayer` — реализовано в форке (`PIPController.m`, `RTCPIPView`). Камера в фоне: iOS 18 + `voip` в `UIBackgroundModes` → `isMultitaskingCameraAccessSupported=true` без entitlement (entitlement `com.apple.developer.avfoundation.multitasking-camera-access` только для target < 18). Установить `isMultitaskingCameraAccessEnabled=true`.
- **Screen share**: Broadcast Upload Extension `ru.toxblh.matras.broadcast`, app group `group.ru.toxblh.matras` (есть), лимит 50 МБ, IPC по unix-socket (Jitsi `SocketConnection` — в форке). ScreenCaptureKit (iOS 17+) только в Swift SDK — не наш путь.
- **Dynamic Island / Live Activity**: CallKit-звонок уже даёт системный индикатор; ActivityKit — только если хотим участников/таймер (WWDC26 #223: landscape island). Не в первых фазах.
- **LiveCommunicationKit** (17.4+): Apple на WWDC26 (#226) советует мигрировать с `CXProvider`; групповые семантики (`members`, merge). За флагом после CallKit — библиотеки/`calls-native` его не знают.
- **Handoff**: `NSUserActivity` с `channel_id/call_id`, `NSUserActivityTypes`, тот же Team ID; принимающая сторона заново делает join. Для веб→приложение — Universal Links (`applinks:` AASA) на `/call/<id>`.
- Фон: `voip` + `audio` уже в Info.plist.

### Сервер / плагин / push-proxy

- Сервер MM ≥ 11.7: `PushNotification.Transport = "voip"` → берёт `Session.VoIPDeviceId` (только `apple_rn*`; Android — обычный FCM data-пуш, как сейчас). Плагин: в `pushIncoming` добавить `Transport: model.PushTransportVoIP` (Android-сессии получат обычный пуш автоматически). Пуш VoIP несёт `sub_type/channel_id/server_id/sender_*` — хватает для `acceptGomonFromPush`.
- Push-proxy ≥ 6.5.0 (PR #158, 2026-06): VoIP-путь без новых ключей, берёт `.p8` из записи `apple_rn`. Хостед HPNS обслуживает только бандлы Mattermost → **свой proxy обязателен** (планировался: `apple_matras`/`android_matras`, остальное форвардить). Клиент регистрирует `voipDeviceId` уже (`storeVoIPDeviceToken`).
- Медиа-API без изменений. Опционально: `/v1/integrations/mattermost/handoff` может возвращать сразу `token+livekit_url` для доверенного мобильного клиента (экономит один round-trip).

## Стратегия UI

Нативный RN UI, ядро — общий TS-пакет `comms-core` (вынести из `apps/meeting-web/src/call/*` и `extensions/*`: подключение, состояние участников, протокол data-channel для reactions/hand, companion, телеметрия). Веб остаётся эталоном; паритет держится через один протокол, а не одинаковую вёрстку.

Native-first (без них WebView не отпустить): звук, камера, спикер/сетка, screen-share view (просмотр), участники, device picker (Telecom endpoints / `AVAudioSession` route), mute/hang-up из уведомления/PiP/CallKit. Вторая волна: reactions, hand, чат (это тред MM — открываем родной экран треда, синхронизация уже есть), companion (без mic/cam, звук выключен), запись/транскрипция (кнопки = REST), SIP dial-out (REST). Остаётся в вебе: гость по PIN, просмотр записей — открываем в системном браузере.

## План по фазам (каждая — релиз в Releases)

| Фаза | Содержание | Срок |
|---|---|---|
| **0. Спайк «один WebRTC»** | Алиас `react-native-webrtc`→форк 144; `calls-native` iOS на `LiveKitWebRTC`; сборка Android (CI als-huge) и iOS (Mac владельца); Mattermost Calls работает; `@livekit/react-native` 3.0 подключается к комнате gomon по токену из `/join`, звук в обе стороны на Hermes/New Arch (issue #468); 16 KB; дельта APK. Go/no-go для (d), иначе (c). | 1–2 нед |
| **1. Нативный звонок** | `comms-core`; экран звонка RN: аудио+камера, сетка/спикер, участники, device picker через существующий `calls-native`; FGS; плавающая панель как сейчас. WebView остаётся для гостей/PIN. Android-релиз. | 3–4 нед |
| **2. Android-платформа** | Core-Telecom вместо ручного роутинга; PiP auto-enter + actions; MediaProjection screen share; Live Updates; predictive back; прогон на Pixel/Samsung/Xiaomi. | 2–3 нед |
| **3. iOS-платформа** | Свой push-proxy + `Transport: voip` в плагине; `comms_call` в `PushKitController`/`CallKitProvider`; аудио через CallKit; PiP + multitasking camera; Broadcast Upload Extension; TestFlight. Требует Mac. | 3–4 нед |
| **4. Паритет и полировка** | Reactions, hand, чат-тред, companion, запись/транскрипция, SIP; LCK за флагом; Handoff; удаление WebView-пути (кроме гостей). | 2–3 нед |

Итого ~3 месяца одним разработчиком; фазы 2 и 3 параллелятся.

## Риски и де-риск

- **Форк webrtc ломает Calls** → спайк фазы 0 первым; откат — алиас снимается одной строкой. План Б — (c) для gomon или отказ от Calls.
- **#468 `new Room()` на Hermes/New Arch** → проверить в спайке на RN 0.83; при воспроизведении — 2.12 + prefixed-AAR сами (форк) или дождаться фикса.
- **iOS без CI** → всё iOS-тестирование на Mac владельца; заложить время; Mac-раннер Forgejo — отдельная задача.
- **Full-screen intent при Play-публикации** → мы sideload; при выходе в Play — декларация «звонилка».
- **Core-Telecom на вендорских прошивках** → ручной роутинг из `calls-native` оставить как фолбэк по флагу.
- **VoIP-пуш без `reportNewIncomingCall`** → правило уже соблюдено в `PushKitController`; для `comms_call` не добавлять async перед репортом.
- **Rebase за upstream** → всё новое в `app/products/gomon/*` и `libraries/`, правки upstream-файлов минимальны (алиас, `AppDelegate`, манифест).

## Тестирование

Устройства: Pixel (Android 16, эмулятор API 36 для smoke), Samsung One UI (Telecom/BT), Xiaomi (FSI, автозапуск), iPhone iOS 18 и 26, iPad; BT-гарнитура, проводные наушники. Сценарии: входящий при выключенном экране/убитом приложении, ответ из CallKit/CallStyle, сворачивание/PiP/блокировка 10 мин, переключение маршрутов, второй звонок (Calls vs gomon — один активный), screen share, потеря сети. Автоматика: Jest на `comms-core` (уже есть тесты `connection.test.ts`, `store.test.ts`), сборка на als-huge на каждый push, ручной чек-лист перед релизом.

## Открытые вопросы владельцу

1. Нужен ли вообще Mattermost Calls рядом с gomon? Отказ снимает форк-риск целиком.
2. Минимальная iOS: 18 (PiP-камера без entitlement, LCK) или 17?
3. Когда переезжаем на `ru.toxblh.matras` для Android (свой Firebase) — вместе со своим push-proxy в фазе 3?
4. Где хостить push-proxy (VPS gomon.toxblh.ru?) и кто держит `.p8`.
5. Гости по PIN и просмотр записей на мобильном — нужны нативно или браузер достаточно?
6. Публикация в Play/App Store планируется? (FSI-декларация, VoIP-ревью.)

## Итоги фазы 0 (2026-10-01, ветка `gomon-native`)

Решение владельца изменило фазу 0: Mattermost Calls **удалён**, алиас `react-native-webrtc` → форк не понадобился — в бинарнике один WebRTC-стек, LiveKit.

### Что удалено

- `app/products/calls` целиком: экраны звонка/участников/host controls, плавающая панель, баннеры входящих, кнопки в шапке DM и в channel actions, включение Calls в настройках канала, экран «Звонки» в настройках уведомлений, слэш-команда `/call` (и в чек-листах плейбуков), WS-обработчики `custom_com.mattermost.calls_*`, REST-миксин, загрузка конфига Calls при подключении.
- Зависимости: `react-native-webrtc` 124.0.7 (+ патч и типы), `@mattermost/calls` (calls-common), `fflate`.
- Посты `custom_calls` рендерятся как обычные. Субтитры записей Calls в галерее остались (`app/screens/gallery/renderers/video/captions.ts`). Значок звонка в списке каналов теперь показывает живые звонки gomon. WS не закрывается в фоне, пока идёт звонок gomon.
- Android: пуш `sub_type=calls` больше не звонит — показывается как обычное сообщение; звонилка (`MMCallsIncomingCall`, `CallActionReceiver`, CallStyle) работает только для `comms_call`.
- `app/init/calls_native.ts` оставляет только нужное gomon: запрос FSI, VoIP-токен iOS, «Завершить» из уведомления текущего звонка. Ответ на CallKit-звонок (iOS, если сервер ещё шлёт VoIP-пуши Calls) сразу завершается — присоединять не к чему.

### Что осталось от calls-native и как изменилось

`@mattermost/calls-native` остаётся (входящий на Android, FGS `microphone|camera`, аудиосессия/маршруты, CallKit/PushKit на iOS). Android-часть не зависела от WebRTC — без изменений. iOS: podspec зависел от `JitsiWebRTC ~> 124` (его приносил `react-native-webrtc`); теперь `LiveKitWebRTC = 144.7559.15`, `import LiveKitWebRTC`, `RTCAudioSession` → `LKRTCAudioSession` (`AudioSessionManager.swift`, `CallsBridge.swift`). **Не собрано** — нужен Mac: `pod install` (уйдёт JitsiWebRTC из `Podfile.lock`/`project.pbxproj`), проверить Swift-имена `LKRTC*`.

### Добавленные зависимости

| Пакет | Версия | Заметки |
|---|---|---|
| `@livekit/react-native` | 3.0.0 | peer: `livekit-client ^2.19`, `@livekit/react-native-webrtc ^144.2` |
| `@livekit/react-native-webrtc` | 144.2.0 | Android `io.github.webrtc-sdk:android-prefixed:144.7559.15` (~22 МБ AAR), iOS pod `LiveKitWebRTC 144.7559.15`; Java-пакет по-прежнему `com.oney.WebRTCModule` (конфликтовал бы с `react-native-webrtc`, теперь его нет) |
| `livekit-client` | 2.22.3 | meeting-web на 2.15.8 — ниже peer SDK; для общего `comms-core` поднять веб до 2.22 |

Нативная инициализация: Android — `LiveKitReactNative.setup(this, CommunicationAudioType)` в `MainApplication.onCreate` до RN; iOS — `LivekitReactNative.setup()` в `AppDelegate` после `CallsBridge.bootstrap()`. Разрешения Android (CAMERA, RECORD_AUDIO, FGS camera/microphone, BLUETOOTH_CONNECT) и ключи Info.plist (камера, микрофон, `audio`+`voip`) уже были. `FOREGROUND_SERVICE_MEDIA_PROJECTION` не добавлен — screen share не в фазе 0 (сервис `MediaProjectionService` из webrtc-библиотеки в манифест мёрджится, как и раньше).

### Прототип нативного звонка

`app/products/gomon/native/`: `api.ts` (redeem → join → leave, как `apps/meeting-web/src/api.ts`, API на origin из `join_url`), `livekit.ts`, `native_call.tsx`, `flag.ts`. Флаг — долгое нажатие на заголовок звонка (любого), хранится в app DB (`Global` `gomonNativeCalls`), по умолчанию выключен; действует со следующего звонка. Экран: сетка камер 1–2 колонки, mic / camera / аудиовыход / завершить, та же плавающая панель при сворачивании (общие `useGomonCallSession` и `GomonCallLayout` с WebView-звонком). Аудио — через calls-native (как у WebView), `registerGlobals({autoConfigureAudioSession: false})`; `AudioSession` LiveKit не запускается.

SDK подгружается `require()` при первом нативном звонке, а не в `index.ts`: `@livekit/react-native` при импорте ставит глобальные полифилы (DOMException, TextEncoder/Decoder, web streams, `crypto.randomUUID`, Symbol.asyncIterator) — дефолтный WebView-путь их не получает. Когда нативный звонок станет основным — перенести `registerGlobals` в старт.

### Найденные конфликты и риски

- **#468** (`new Room()` → «Cannot read property 'prototype' of undefined» на Hermes/New Arch, открыт, 0 ответов): в репро автор берёт `Room` из `@livekit/react-native`, где его нет (он в `livekit-client`) — вероятно, ошибка репро; вторая половина (нет `DOMException`) закрыта полифилом в 3.0. У нас `Room` из `livekit-client`. Проверить на устройстве — это главный go/no-go.
- Два хозяина аудио на Android: LiveKit ADM (usage VOICE_COMMUNICATION) и calls-native (`MODE_IN_COMMUNICATION`, фокус, `setCommunicationDevice`). Прототип не запускает `AudioSession` LiveKit — проверить эхо, маршрут earpiece/speaker/BT после включения микрофона (маршрут переустанавливается после публикации).
- iOS: `CallsBridge.bootstrap()` ставит `useManualAudio = true`, звук WebRTC включается только в `startAudioSession()`/CallKit `didActivate` — прототип вызывает его, но без Mac не проверено.
- `LiveKitReactNative.setup` создаёт `JavaAudioDeviceModule` при старте приложения — проверить холодный старт и что WebView-звонок (Chromium, свой WebRTC) не задет.
- Жёсткая сетка без пагинации: при >6 участниках плитки мелкие (фаза 1).
- CLAUDE.md/`app/constants` (upstream) ещё упоминают Calls — не трогали ради дешёвого rebase; константы `Screens.CALL*`, `WebsocketEvents.CALLS_*` — мёртвые, но безвредные. При rebase правки upstream в удалённом `app/products/calls` дадут modify/delete-конфликты — решать `git rm`.

### Что должна проверить сборка CI (`.forgejo/workflows/android.yml`)

1. `npm ci` по новому lock; `npm run check` (tsc + lint).
2. Предзагрузка `android-prefixed-144.7559.15.aar` через зеркала (добавлена в шаг ~/.m2) и загрузка `com.github.davidliu:audioswitch` с JitPack.
3. `assembleRelease` без `Duplicate class com.oney.*`/`org.webrtc.*`, мёрдж манифеста без ошибок.
4. Размер APK (arm64) против предыдущего релиза и `zipalign -c -P 16 -v 4` (16 KB страницы для `liblkjingle_peerconnection_so.so`).

### Ручная проверка на устройстве

1. Холодный старт, вход, каналы, посты `custom_calls` видны как обычные.
2. WebView-звонок (флаг выключен): старт/вход, входящий пуш (экран блокировки), ответ/отклонение, сворачивание, маршруты, «Завершить» из уведомления — как до фазы 0.
3. Долгое нажатие на заголовок → тост «включены»; следующий звонок: соединение (нет #468), звук в обе стороны с вебом, камера в обе стороны, mic/camera вкл/выкл, earpiece/speaker/BT, сворачивание 5 мин с заблокированным экраном (FGS), выход → участник исчезает у веба сразу (leave в API), завершение звонка с веба закрывает экран.
4. iOS (Mac): `pod install`, сборка, оба пути.

### Следующие шаги

Фаза 1: вынести `comms-core` из meeting-web (поднять веб на `livekit-client` 2.22), экран звонка (спикер/сетка, участники, реакции), `registerGlobals` при старте, решить судьбу аудио (calls-native vs `AudioSession` LiveKit → затем Core-Telecom), нативный путь по умолчанию после прогона на Pixel/Samsung/Xiaomi; iOS-сборка на Mac.

## Итоги фазы 1 (2026-10-01, ветка `gomon-native`)

Нативный экран звонка на Android готов быть основным: **по умолчанию на Android звонок gomon идёт через LiveKit SDK**, WebView — запасной путь (долгое нажатие на заголовок звонка, выбор хранится в app DB; явный выбор из фазы 0 сохраняется). iOS пока остаётся на WebView по умолчанию — нативный путь там не собран и не проверен (фаза 3).

### Что сделано

- `app/products/gomon/native/shared/` — копии чистого TS из `apps/meeting-web` (comms `dc0ae61`) с пометкой источника: `connection.ts` (SM3) и `fit.ts` (FitTiles) дословно с тестами; `telemetry.ts` (платформа — параметр, отправитель внедряется, браузерные слушатели заменены NetInfo/AppState), `conf.ts` (руки, реакции, серверные пакеты `topic=conf`), `chat.ts` (стор чата без загрузки файлов). До пакета `comms-core` (фаза 4) синхронизировать руками.
- `use_call.ts` — движок звонка как `InCall` веба: redeem → join → connect; снимок звонка (роли, руки, приглашения) по `/v1/events` + медленный опрос; вердикты сервера (звонок завершён, удалён, `ROOM_DELETED`) закрывают экран; переподключения LiveKit — баннер; если LiveKit сдался, а звонок жив, — новый join до 90 с (NetInfo будит попытку сразу при появлении сети); выход/«Завершить для всех»/модератор один — завершить, как в вебе; телеметрия `/v1/diagnostics` (`platform: android`).
- Экран (`native_call.tsx`, `stage.tsx`, `sheets.tsx`): сетка FitTiles (портретные камеры остаются портретными, 4 на страницу), вид «докладчик» (закреп, последняя демонстрация, активный говорящий) с лентой; тап — закрепить, тап по демонстрации — на весь экран; зеркальная фронталка, инициалы без камеры, значки микрофона и руки, обводка говорящего, индикатор качества сети, летящие реакции и лента реакций. Кнопки: микрофон, камера (+ смена фронт/тыл), вывод звука (старый пикер calls-native), рука, чат со счётчиком, «Ещё»: реакции, участники (микрофон/камера, роли, руки, приглашённые), пригласить, скопировать ссылку, раскладка. Свернуть — та же плавающая панель; FGS получает тип camera, если камеру включили посреди звонка. Строки — `gomon.*` (ru/en).
- SDK и `registerGlobals` грузятся хостом звонка при первом нативном звонке (`native/index.ts` → `globals.ts`).
- Отладка без входа в Mattermost: в debug-сборке `__gomonDebugJoin(joinUrl)` (через `Runtime.evaluate` отладчика Metro); `__gomonRoom` — комната для проверки статистики.

### Как проверялось

Эмулятор Pixel 7 API 36 arm64 (`p1` на Mac, поддельные камеры, без звука хоста) ⇄ headless Chromium с веб-клиентом на https://gomon.toxblh.ru (поддельные камера/микрофон, «экран» — canvas). Вызовы, гранты и коды — HMAC-подписанными `/v1/integrations/mattermost/*`, как `rec-live.mjs`; сценарий веб-стороны — `comms/tests/e2e/tools/p1-web-peer.mjs` (команды построчно из файла). Статистика — `getRTCStatsReport` с обеих сторон. Скриншоты — `docs/evidence/phase1/`.

| Проверка | Результат | Доказательство |
|---|---|---|
| Подключение, видео в обе стороны | ок: телефон шлёт 720×1280, получает 640×360 | `01-*` |
| Звук в обе стороны | ок по статистике: телефон получает звук веба (energy > 0), шлёт свой (у эмулятора `-no-audio` — тишина, DTX); на слух не проверено | — |
| Микрофон/камера телефона вкл/выкл видны вебу, и наоборот | ок | `02`, `03` |
| Смена камеры фронт/тыл | ок (`restartTrack({facingMode})`) | — |
| Демонстрация экрана с веба: вид «докладчик», на весь экран | ок | `04`, `05` |
| Чат в обе стороны, счётчик непрочитанных, клавиатура не закрывает поле | ок | `06` |
| Реакции и рука в обе стороны (очередь рук, позиция) | ок | `07`, `08-*` |
| Участники, пригласить (QA-пользователь), скопировать ссылку | ок | `10`–`12` |
| Закрепить, раскладка «докладчик», обводка говорящего | ок | `13`, `16`, `17` |
| Свернуть в панель; приложение в фоне 2+ мин | ок: звук и камера идут, FGS `camera|microphone`, «Hang Up» в уведомлении; возврат без переподключения | `09`, `14`, `15` |
| Авиарежим 10 с | ок: восстановление сигналом LiveKit за ~11 с после сети | `18` |
| Авиарежим 55 с (LiveKit сдался) | ок: новый join через ~3 с после сети, медиа в обе стороны | `19` |
| Выход участника | ок: веб видит уход за ~0,5 с, FGS снят | — |
| Организатор с участниками: «Выйти / Завершить для всех» | ок, веб получает `SESSION_ENDED` | `20` |
| Организатор один: «Завершить» без диалога | ок, звонок `ENDED (ended_by_moderator)` | `21` |
| Веб-организатор завершил звонок | ок, экран телефона закрылся за ~3 с | — |
| Вывод звука (динамик/телефон) | ок, `MODE_IN_COMMUNICATION`, звук идёт после переключения | `22` |
| Телеметрия | ок: батчи `platform=android` приняты (`comms_client_batches_by_sdk_total`), `dropped=0` | — |

### Что не проверено / не сделано

- **Вход в Mattermost на эмуляторе не делался**: старт через плагин, ответ на входящий (пуш/WS) и тосты (snack bar рисуется только в залогиненных экранах) проверены только по коду — путь `openGomonCall` → флаг → нативный экран не менялся с фазы 0. Нужен прогон на телефоне владельца.
- Звук на слух, эхо, Bluetooth/проводная гарнитура — только на реальном устройстве.
- Демонстрация экрана **с телефона** нет (фаза 2, MediaProjection). Отправка файлов в чат, модерация (выключить другим микрофон, spotlight, лобби, гостевые ссылки, запись) — только веб (фаза 4); просьба включить микрофон и «вас выключили» — принимаются.
- В фоне удалённое видео продолжает декодироваться (adaptive stream не знает о фоне) — расход батареи; решать вместе с PiP (фаза 2).
- iOS не собирался.

### Риски

- Два хозяина звука на Android (LiveKit ADM + маршрутизация calls-native) работают на эмуляторе; на Samsung/Xiaomi и с BT — не проверено, следующий шаг Core-Telecom.
- Перезапуск JS (Fast Refresh в debug) переоткрывает звонок с уже погашенным одноразовым кодом — в релизе не встречается, но при пересоздании компонента звонка экран закроется с ошибкой «код использован». Можно хранить токен сессии в `CurrentGomonCall`.
- Размер кадра своей камеры берётся по ориентации окна (RTCView не отдаёт поворот); чужие — по `publication.dimensions`.
- Копии `shared/` разойдутся с вебом без пакета.

### Что нужно фазе 2

Core-Telecom (эндпоинты, фокус) вместо ручного роутинга; PiP с auto-enter и действиями mute/hang-up, пауза видео в фоне; MediaProjection для демонстрации с телефона; Live Updates; predictive back; прогон на Pixel/Samsung/Xiaomi с входом в Mattermost (входящий из пуша при выключенном экране, ответ из CallStyle).

## Итоги фазы 2 (2026-10-01, ветка `gomon-native`, Android)

Звонок gomon на Android зарегистрирован в системе через Jetpack Core-Telecom; PiP, демонстрация экрана с телефона, действия в уведомлении и PiP. iOS-файлы и общий TurboModule-спек `calls-native` не тронуты: всё Android-новое — в `libraries/@mattermost/calls-native/android`, `android/` и `app/products/gomon/native/android_*`.

### Что сделано

- **Core-Telecom** `androidx.core:core-telecom:1.1.0-beta01` (`MMCallsTelecom.kt`). `registerAppWithTelecom(BASELINE | SUPPORTS_VIDEO_CALLING)`, `addCallWithExtensions` (видео, `SUPPORTS_SET_INACTIVE`) с расширением local call silence. Исходящий/свой звонок регистрируется при старте сессии звонка (`call_session.ts` → `startTelecomCall`, общий путь для LiveKit и WebView), входящий — прямо из пуша рядом с CallStyle-уведомлением (`MMCallsIncomingCall.show`). JS-старт для того же канала **отвечает** на звонящий вызов (`answer(video)`), иначе добавляет исходящий и `setActive`. «Отклонить» → `REJECTED`, 30 с без ответа → `MISSED`, завершение → `LOCAL`.
- **Маршруты**: при Telecom-звонке `calls-native` больше не трогает `MODE_IN_COMMUNICATION`/фокус/`setCommunicationDevice` — `setAudioRoute` → `requestEndpointChange`, список и текущий маршрут — из `availableEndpoints`/`currentCallEndpoint` в прежнем формате `AudioRoute`, поэтому JS-пикер не менялся. Ручной роутинг остаётся фолбэком: API < 28, нет `android.software.telecom`, регистрация не удалась (`startCall` → `false`). Датчик приближения по-прежнему держится на маршруте «Телефон» (теперь — эндпоинт Telecom).
- **Mute в обе стороны**: приложение → система (`updateIsLocallySilenced`, снятие системного mute при включении микрофона), система → приложение (`isMuted` без первого значения, local silence, `onSetInactive` = удержание → микрофон выкл). Ответ гарнитурой/машиной: Telecom `onAnswer` → событие `GomonTelecomAnswer` → `acceptGomonFromPush` (JS жив) или answer-PendingIntent с BAL-разрешением (JS нет). Завершение системой → `GOMON_LEAVE`.
- **FGS**: `MMCallsForegroundService` = `phoneCall|microphone|camera` (phoneCall — только при активном Telecom-звонке; сервис перезапускается с ним после регистрации). Разрешения `MANAGE_OWN_CALLS`, `FOREGROUND_SERVICE_PHONE_CALL`, `FOREGROUND_SERVICE_MEDIA_PROJECTION`, `POST_PROMOTED_NOTIFICATIONS`.
- **Уведомление звонка**: `CallStyle.forOngoingCall` + «Выключить/Включить микрофон» и «Остановить показ» (пока идёт демонстрация); `android.requestPromotedOngoing=true` (Live Updates). Состояние передаёт `MMCallsPlatform.setCallState(muted, sharing)`.
- **PiP** (`MMCallsPip.kt`, `MainActivity`): `supportsPictureInPicture`; пока полноэкранный звонок показывает видео — `setAutoEnterEnabled(true)`, `setSeamlessResizeEnabled(true)`, соотношение по видео плитки (1:2.39…2.39:1), RemoteAction «микрофон» и «завершить», `FLAG_KEEP_SCREEN_ON`; до API 31 — `onUserLeaveHint`. В PiP рисуется одна плитка (`pickPipTile`: демонстрация → говорящий → последний говорящий → любое видео → своя камера). Закрытие окна PiP → звонок сворачивается в плавающую панель. В PiP активити на паузе, а приостановленный React-хост не монтирует Fabric-изменения (окно замирало на старом кадре, «Завершить» не размонтировало звонок) — `MainActivity` держит хост resumed, пока активити в PiP.
- **Пауза видео в фоне**: удалённое видео декодируется только там, где смонтировано (`videoViewOf`): фон без PiP — ни одной `VideoTrack`, adaptive stream ставит треки на паузу; возврат — монтируются снова.
- **Демонстрация экрана**: «Ещё» → «Показать экран» (`setScreenShareEnabled`; MediaProjection с согласием на сессию, FGS `mediaProjection` из `@livekit/react-native-webrtc`), баннер «Вы показываете экран / Остановить показ», свой экран на сцене не показывается. LiveKit только останавливает трек — трек дополнительно `release()`, иначе сервис mediaProjection библиотеки оставался висеть. Звук демонстрации (AudioPlaybackCapture) не делали.
- **Назад** (predictive back, target 36): прежний `BackHandler` → свернуть, работает.
- Тесты: `android_pip.test.ts` (выбор PiP-плитки, режим отрисовки видео).

### Как проверялось

Эмулятор `p1` (API 36, Android 16 `BE2A.250530`, arm64) ⇄ headless Chromium. Стенд gomon.toxblh.ru в этот раз не использовался (секрет плагина для `p1-web-peer.mjs` агенту недоступен): вместо него локальный `livekit-server --dev` 1.9.12 и заглушка media-API (`redeem`/`join`/снимок звонка) + страница с `livekit-client` (поддельная камера, canvas-«экран»). Входящий — имитация FCM-пуша `sub_type=comms_call` через `adb shell am broadcast` (без входа в Mattermost), после ответа звонок открывался `__gomonDebugJoin(url, true, channelId)` — теперь хук принимает канал пуша. Скриншоты — `docs/evidence/phase2/`.

| Проверка | Результат | Доказательство |
|---|---|---|
| Звонок регистрируется в Telecom | ок: `dumpsys telecom` — `state=ACTIVE … prop=[ self_mng], voip=true`, PhoneAccount `SelfManaged SuppVideo Video TransactOps`; `MODE_IN_COMMUNICATION` | `01` |
| FGS-типы | ок: `MMCallsForegroundService types=0xC4` (phoneCall+camera+microphone) | — |
| Чип звонка в статус-баре | ок (Telecom) | `06` |
| Mute из уведомления / PiP ↔ приложение | ок в обе стороны, значок в PiP меняется | `04` |
| Mute из системы (BT/машина) | **не проверено**: эмулятор не даёт выключить звук Telecom-звонка извне (`KEYCODE_MUTE` не доходит, InCallService для self-managed нет) | — |
| Эндпоинты | частично: Telecom эмулятора отдаёт только «Динамик» (наушника нет), пикер показывает ровно его; переключение earpiece/BT/проводные — только на устройстве | — |
| Входящий: экран блокировки, полноэкранный UI | ок, Telecom `RINGING` | `12` |
| Ответ кнопкой гарнитуры (`KEYCODE_HEADSETHOOK`) | ок: `HeadsetMediaButton` → `onAnswer` → `ACTIVE`, звонок приложения переиспользует этот вызов | — |
| Ответ из полноэкранного UI | ок: приложение открывается, старт звонка канала → `answer` → `ACTIVE` (тот же call id) | — |
| Отклонить / не ответить 30 с | ок: `REJECTED` / `MISSED` | — |
| PiP auto-enter по Home, повторные входы | ок, видео идёт (декодирование растёт) | `02`, `02b` |
| PiP: действия микрофон и «Завершить» | ок; «Завершить» снимает звонок, Telecom, FGS и окно PiP | `03`, `04` |
| Закрыть PiP → панель | ок | `05` |
| Пауза видео в фоне | ок: экран выкл. — `framesDecoded` стоит, после возврата растёт; своя камера всё время уходит вебу | — |
| Демонстрация экрана с телефона | ок: веб получает `screen_share` 1080×2400, FGS `mediaProjection`, системный чип записи экрана | `08`–`11` |
| Остановка показа из уведомления / баннера | ок, сервис mediaProjection снимается | — |
| «Завершить» из уведомления | ок: Telecom `SET_DISCONNECTED (LOCAL)`, FGS снят | — |
| Назад → свернуть | ок | `07` |
| Live Updates (promoted) | запрошено (`requestPromotedOngoing`), но образ эмулятора — 16.0 без QPR1, продвижения нет | — |

### Что не проверено

- Реальные устройства: Pixel (Android 16 QPR1+ — Live Updates), Samsung One UI и Xiaomi/HyperOS (Telecom на вендорских прошивках, FSI, автозапуск), BT-гарнитура/машина (ответ, mute, маршрут), проводные наушники, наушник + датчик приближения.
- Ответ на входящий с настоящим Mattermost-входом и пушем сервера (здесь — имитация пуша и debug-join); ответ гарнитурой при **убитом** JS (ветка с PendingIntent).
- API < 28 (ручной роутинг) и API 28–33 (бэкпорт Core-Telecom через `ConnectionService`) — эмуляторов нет.
- Звук на слух и эхо под Telecom.

### Риски

- Core-Telecom 1.1.0 — beta; на вендорских прошивках возможен отказ регистрации — тогда фолбэк на ручной роутинг (проверить, что он срабатывает, а не висит 5 с таймаута).
- Ответ гарнитурой при убитом процессе зависит от права на запуск активити из фона (BAL); при запрете звонок будет «принят» в Telecom, но экран не откроется до тапа по уведомлению.
- Держим React-хост resumed в PiP: таймеры и рендер работают, AppState в PiP = `active` (видео-режим решает флаг PiP). Если RN изменит жизненный цикл хоста — пересмотреть.
- Один BT-эндпоинт в пикере (первый из списка Telecom) — при двух гарнитурах выбора нет.
- Демонстрация без звука; на Android 14+ согласие спрашивается на каждую сессию (так задумано системой).

## Итоги фазы 3 (2026-10-01, ветка `gomon-ios`)

iOS-платформа для нативного звонка. Собирается на Mac (Xcode 26.6, симулятор iOS 26.5); всё, что требует устройства или ключей Apple, собрано и подготовлено, но не проверено.

### Что сделано

- **Нативный звонок по умолчанию и на iOS.** WebView — запасной путь за тем же флагом (долгое нажатие на заголовок); CallKit — только у нативного звонка (WKWebView сам владеет аудиосессией).
- **CallKit** (`@mattermost/calls-native`): провайдер — `supportsVideo`, входящий и исходящий — видеозвонки. `native/callkit_session.ts`: звонок из приложения сообщает исходящий CallKit-звонок (`reportOutgoingCall` → `reportConnected` → `reportEnded`), mute из приложения отражается на экране CallKit, mute и «Завершить» из CallKit/экрана блокировки приходят в звонок (`CallMuted`, `CallEnded` → `GOMON_LEAVE`, только для своего UUID).
- **Аудио.** `CallsBridge.bootstrap` ставит `LKRTCAudioSession.useManualAudio`; на симуляторе проверено, что AVAudioEngine-ADM LiveKit (144) это соблюдает: при `isAudioEnabled=false` движок останавливается. Значит, CallKit-рецепт calls-native (`didActivate` → `audioSessionDidActivate` + `isAudioEnabled=true`) и есть передача сессии LiveKit; `AudioSession` LiveKit не запускается (`autoConfigureAudioSession:false`), `setEngineAvailability` не нужен. Исправлено: `startAudioSession` (путь без CallKit) всегда включает `isAudioEnabled` — раньше категория `playAndRecord` от прошлого звонка давала ранний выход, и движок второго звонка не стартовал.
- **VoIP-пуш.** `PushKitController` синхронно репортит `comms_call` в CallKit (как раньше, теперь видео). JS (`app/init/calls_native.ts`): «Ответить» → `acceptGomonFromPush` (`POST /plugins/ru.corp.comms/api/v1/channels/{id}/accept`, при неудаче — join живого звонка), открытый звонок усыновляет CallKit-звонок (`gomon/callkit.ts`); если звонок не открылся — `reportEnded(failed)`; «Отклонить» → `declineGomonFromPush`. Debug-сборка: `xcrun simctl spawn booted notifyutil -p ru.toxblh.matras.debug-voip` прогоняет тестовый пуш через тот же путь (без проверки подписи) — у симулятора нет PushKit-пушей.
- **Префикс устройства** — `app/utils/push_platform`: `apple_matras` для `ru.toxblh.matras`, иначе `apple_rnbeta`/`apple_rn`; один и тот же для обычного и VoIP-токена (`push_notifications.ts`, `calls_native.ts`). Android не менялся (`android_rn`).
- **PiP**: одна удалённая плитка (камера говорящего, иначе демонстрация) рисуется через PiP-вид форка WebRTC (`AVPictureInPictureVideoCallViewController` + `AVSampleBufferDisplayLayer`), `startAutomatically`/`stopAutomatically`. `WebRTCModuleOptions.enableMultitaskingCameraAccess = true` (iOS 18+ с `voip` в фоновых режимах — без entitlement).
- **Демонстрация экрана**: таргет `ScreenShare` (Broadcast Upload Extension, `$(MATRAS_BUNDLE_ID).ScreenShare`, app group), кадры JPEG по unix-сокету `rtc_SSFD` в контейнере группы — формат, который читает `ScreenCapturer` форка (сжатый пример Jitsi, `ios/ScreenShare/SampleHandler.swift`); в «Ещё» пункт «Показать экран» (iOS) — системный пикер, затем `setScreenShareEnabled`.
- **Идентичность в одном месте**: `ios/Matras.xcconfig` (базовая конфигурация проекта): `MATRAS_BUNDLE_ID`, `MATRAS_APP_GROUP = group.$(MATRAS_BUNDLE_ID)`. Из них — bundle id всех четырёх таргетов, `AppGroupIdentifier`/`RTCAppGroupIdentifier` в Info.plist, группы в entitlements, keychain group. Пока `com.mattermost.rnbeta`; переход на `ru.toxblh.matras` — одна строка после регистрации App ID (credentials-setup.md). `DEVELOPMENT_TEAM` в таргетах — всё ещё команда Mattermost, поменять вместе с переходом (сделано в фазе 4: `MATRAS_TEAM_ID`).
- Русские тексты запросов разрешений (`ru.lproj/InfoPlist.strings`). Фоновые режимы `audio`+`voip` уже были.
- `Podfile.lock`/проект после `pod install`: `LiveKitWebRTC` вместо `JitsiWebRTC` (хвост фазы 0).
- **Сервер** (comms `eb83806`): `pushIncoming` шлёт `Transport: voip` — iOS-сессии с VoIP-токеном получают PushKit, Android и сессии без VoIP-токена — обычный пуш (сервер откатывается сам, MM ≥ 11.10). `server/public` v0.3.1 → v0.4.3 (первая с `PushTransportVoIP` после 0.4.2), `go 1.26.3` (golang в ALT p11 — 1.26.7), плагин 0.1.15. `go vet`, `go test` — ок.

### Как проверялось

Симулятор iPhone 17 Pro (iOS 26.5), debug-сборка с ad-hoc подписью (`CODE_SIGN_IDENTITY=-`: без подписи RNKeychain падает на старте — нет keychain-entitlement). Стенд gomon.toxblh.ru не использовался — HMAC-секрет плагина агенту не выдан; вместо него стенд без секретов (comms `5feb74f`): LiveKit dev-server v1.9.12 в podman на Linux + `tests/e2e/tools/p3-mock-api.mjs` (эндпоинты медиа-API, которые зовёт телефон; реакции — серверные пакеты `topic=conf` через `RoomService.SendData`) + `p3-lk-peer.mjs` (headless Chromium «Анна Веб», поддельные камера/микрофон). Звонок открывается `__gomonDebugJoin` через CDP Metro (порт 8092), тапы — `idb` (idb-companion из Homebrew на Mac). Скриншоты — `docs/evidence/phase3/`.

| Проверка | Результат | Доказательство |
|---|---|---|
| Сборка приложения и расширения `ScreenShare` (симулятор) | ок | — |
| Подключение, видео с веба на телефон | ок: 640×360, 15 fps | `01` |
| Видео с телефона | нет: у симулятора нет камеры (трек публикуется, кадров 0) | — |
| Микрофон/камера вкл/выкл, плитки и значки | ок, веб видит mute | `02`, `03` |
| Чат в обе стороны, счётчик непрочитанных | ок (через мок API) | `03`, `04` |
| «Ещё»: реакции, участники, «Показать экран» | ок; реакции в обе стороны | `05`, `06` |
| Свернуть в панель | ок | `07` |
| Строки звонка на русском | ок (после `scripts/generate-assets.js` — `dist/assets` на Mac были от фазы 0) | `01`–`07` |
| Исходящий CallKit | на симуляторе не работает: `callservicesd` сразу разрывает — «there wont be a UI to host the call»; поэтому вне устройства (`expo-device isDevice`) CallKit пропускается и звук включает calls-native | — |
| Звук | RTP с веба приходит (байты растут), но не играет (`totalAudioEnergy` 0); у Simulator нет доступа к микрофону Mac (TCC), голосовой движок не стартует — на устройстве | — |
| Авто-PiP при уходе в фон | на симуляторе нет: PiP-контроллер создаётся, SpringBoard отвечает `ShouldAutoPiP: NO` (нет активной аудиосессии звонка) — на устройстве | — |
| PushKit-токен | выдаётся и на симуляторе (160 символов, лог calls-native) | — |
| Входящий из VoIP-пуша (debug: `notifyutil -p ru.toxblh.matras.debug-voip`) | путь PushKit → `reportNewIncomingCall` (видео) отрабатывает; симулятор не показывает CallKit-экран и сразу завершает звонок («no UI to host the call») — ответ/отклонение только на устройстве | `08-voip-debug-push.log` |

### Что нужно устройство и ключи Apple

1. Членство Apple Developer, App ID `ru.toxblh.matras` (+ `.NotificationService`, `.MattermostShare`, `.ScreenShare`), группа `group.ru.toxblh.matras`, ключ APNs `.p8` — credentials-setup.md; затем `MATRAS_BUNDLE_ID` в `Matras.xcconfig` и `MATRAS_TEAM_ID` в `ios/Matras.local.xcconfig` (фаза 4).
2. Свой push-proxy с `apple_matras` (push-proxy.md) и патч allowlist префиксов в сервере MM 11.10 (§2.1) — **до** выпуска сборки с `ru.toxblh.matras`, иначе логин с `apple_matras-v2:` получит 400.
3. На iPhone (iOS 18 и 26): входящий из VoIP-пуша при убитом приложении и на экране блокировки, ответ/отклонение из CallKit, mute/завершить из CallKit, звук в обе стороны и маршруты (динамик/BT), PiP при уходе в фон и камера в PiP, демонстрация экрана из расширения, 10 мин в фоне.
4. Проверить, что пуши плагина подписаны сервером: VoIP-путь Gekidou требует подпись (`verifyVoIPSignature`, `requireSignature: true`), неподписанный пуш звонит и сразу сбрасывается.

### Риски

- Плагин шлёт `voip` всем iOS-сессиям с VoIP-токеном, включая официальное приложение Mattermost (`apple_rn*`, его PushKit-путь для Calls): оно покажет CallKit-звонок, к которому не сможет присоединиться. Если у пользователей есть официальное приложение — слать VoIP только Matras-сессиям (по префиксу `apple_matras`, когда появится) или отказаться от него.
- Исходящий CallKit на симуляторе не проверяется вовсе (пропускается) — первый прогон на устройстве покажет, всё ли верно с `didActivate` и звуком.
- LiveCommunicationKit не делали (флаг в фазе 4); CallKit покрывает нужное.
- Отладочные крючки (`__gomonDebugJoin`, Darwin-уведомление тестового звонка) — только в debug-сборке.

## Итоги фазы 4 (2026-10-02, ветка `gomon-native`)

Паритет нативного экрана с веб-звонком (InCall + расширения) и полировка. Ветка с фазами 2 (Android) и 3 (iOS) после слияния собирается на обеих платформах без правок (Android `assembleDebug` arm64 обычный и dev-вариант, iOS — симулятор).

### Общий код вместо копий

- **comms `packages/call-core`** (`@comms/call-core`): автомат соединения SM3, FitTiles, протокол `conf` (руки, реакции, серверные пакеты), стор чата (непрочитанные, упоминания, seen-ревизия — хранилище внедряется), ядро телеметрии (статистика, батчи, слушатели комнаты и транспортов; события LiveKit — по именам, без импорта `livekit-client`), «Сообщить о проблеме» (немедленный отчёт + дополнение), модели записи и SIP (подписи состояний, тела команд, текст для партнёра, DTMF), русские тексты ошибок API. Без зависимостей, без DOM/React — одни и те же файлы работают в браузере и в Hermes. Тесты пакета гоняет `npx vitest run` meeting-web (50 тестов), `npx tsc -p ../../packages/call-core` проверяет его отдельно (добавлено в `make build`).
- **meeting-web** импортирует `@comms/call-core` (alias в `vite.config.ts`, `paths` в `tsconfig.json`); у себя оставил только браузерное: подкласс `CallTelemetry` (window/document/navigator, keepalive), подкласс `ChatStore` (sessionStorage, XHR-загрузка), `appContext`. Поведение то же; `tsc -b`, vitest, `vite build` — ок. **livekit-client 2.15.8 → 2.22.3** (как в Matras), versions.lock обновлён.
- **Matras**: `scripts/sync-call-core.sh <comms>` копирует `packages/call-core/src/*.ts` (без тестов) байт в байт в `app/products/gomon/native/call_core/` и пишет `VERSION` (коммит comms + sha256); CI (`android.yml`) запускает `scripts/sync-call-core.sh --check`. ESLint каталог пропускает (стиль comms). Руками не править: менять comms, затем sync.
- Сборка meeting-web теперь требует весь репозиторий comms (пакет лежит рядом с `apps/`): если выкладка собирает из копии одного `apps/meeting-web`, добавить `packages/`.

### Что сделано в нативном экране

| Возможность | Как |
|---|---|
| Файлы в чате | скрепка → «Фото или видео из галереи» / «Сделать фото» / «Файл» (тот же `FilePickerUtil`, что у постов), прогресс загрузки, лимит размера из политики чата, тексты ошибок как в вебе; полученные картинки — превью (короткая inline-ссылка), тап открывает файл |
| Модерация | плашка «X просится в звонок (+N)» с «Отклонить/Впустить», лобби в «Участниках», «Выключить микрофоны всем», на каждого: выключить микрофон / попросить включить / опустить руку / сделать соведущим / удалить (с подтверждением); «Гостевая ссылка и доступ»: ссылка на встречу, гостевая ссылка (создать/скопировать/отозвать), закрыть/открыть вход; «Завершить для всех» — как было |
| Запись | «Начать запись»: «Видео и звук» / «Только звук (для ИИ)», «Сделать саммари» (если сервер предлагает), срок хранения; «Остановить»; индикатор «● REC 1:23» у всех; тосты о старте/остановке (честный исход: READY/PARTIAL/FAILED); «Записи встреч» открывает `/recordings` в браузере |
| Телефон (SIP) | пункт есть, если в снимке звонка есть `sip`: номер для дозвона + PIN, «Отправить партнёру» (системный Share), набор номера (клавиатура) или сотрудника/партнёра из справочника, линии с состояниями, «Отменить / Положить трубку / Повторить», тоновый набор (`publishDtmf`) |
| Режим компаньона | «Ещё» → вкл/выкл: микрофон и камера выключены (кнопки скрыты), голоса участников — громкость 0 (и у вошедших позже); плашка с «Выйти из режима компаньона» |
| Сеть не пропускает медиа | экран веба MEDIA_FAILED: «Не удалось подключить звук и видео…», подсказка, «Повторить» (новый join в той же сессии) / «Закрыть». Раньше недоступный медиасервер давал алерт «не удалось подключиться» |
| Сообщить о проблеме | отчёт уходит сразу при открытии (статистика ~30 с, кто что публикует, состояние), затем чипы симптомов и комментарий — дополнением к тому же `report_id`, тот же формат, что у веба |

Надёжность:
- **Одноразовый код**: после redeem токен сессии хранится в `CurrentGomonCall.session`; пересозданный компонент звонка (повтор после сбоя сети, Fast Refresh) делает join с ним, код повторно не гасится. Проверено: «Повторить» — без второго `/v1/handoff/redeem`.
- **Dev deep link до входа**: хост звонка и так смонтирован в корневом `_layout.tsx`, вне `(authenticated)`. Проверено на чистом dev-приложении (`pm clear`, без входа в Mattermost): `matrasdev://gomon/join?url=…` открывает звонок (`01`). Код не менялся.
- **iOS `DEVELOPMENT_TEAM`** = `$(MATRAS_TEAM_ID)` из `ios/Matras.xcconfig` (пусто в репозитории; для устройства — `ios/Matras.local.xcconfig`, в `.gitignore`, подключается `#include?`). Проверено `-showBuildSettings`.
- **iOS в фоне**: видео декодируется только у плитки PiP; остальные `VideoTrack` размонтируются (adaptive stream их ставит на паузу). Симулятор: в фоне камера веба `enabled=false`, кадры стоят, демонстрация (плитка PiP) идёт; после возврата обе снова декодируются.
- **Найдено и исправлено**: (1) у плитки менялась толщина рамки, когда участник начинал/переставал говорить, — нативный вид видео на Android менял размер, и плитка становилась пустой (например, когда собеседник выключал микрофон). Рамка теперь всегда 2 px, меняется только цвет (`10`). `accessibilityLabel` плитки оставлена постоянной (имя): менять пропсы вида с видео без нужды не стоит. (2) Обновление CallStyle-уведомления (mute/демонстрация) в момент старта или остановки FGS падало `IllegalArgumentException` («CallStyle notifications must be for a foreground service») — сервис принимает обновления только после `startForeground`, отказ логируется.

Полировка: строки RU/EN (`gomon.*`, ~100 новых), роли и подписи доступности у кнопок, листов (лист больше не склеивает всё содержимое в один элемент VoiceOver), плиток, реакций (по-русски «Нравится»…), чипов, радиокнопок; тактильный отклик на микрофон, камеру, руку, реакции, отправку, модераторские действия, тоны; звонок на весь экран поворачивается (приложение на телефонах портретное — как галерея, разблокируем ориентацию, пока звонок развёрнут), отступы под вырез в ландшафте, листы в ландшафте и «Ещё» со скроллом, на планшете лист не шире 640. Тёмная тема у звонка намеренно постоянная (как у веба и видеозвонилок); системные алерты — по теме ОС.

### Как проверялось

Стенд без секретов: LiveKit dev-server v1.9.12 в podman на Linux + **`comms/tests/e2e/tools/p4-mock-api.mjs`** (comms `97a9e5f`; всё, что вызывает паритет: лобби, lock, mute, просьба включить микрофон (серверные пакеты с адресатом), удаление (`RemoveParticipant`), запись со снимком, SIP-ноги с переходами DIALING→RINGING→ANSWERED, справочник, файлы чата с raw-телом и ссылками, отчёты с `report_id`; одноразовые коды и переключатель «медиасервер недоступен») + `p3-lk-peer.mjs` («Анна Веб», поддельные камера/микрофон, canvas-демонстрация через `eval`). Эмулятор `p1` (Android 16, arm64) с Metro и dev-вариант (вшитый бандл); симулятор iPhone 17 Pro (iOS 26.5), ad-hoc подпись. Скриншоты — `docs/evidence/phase4/`.

Важно для стенда: у Linux-машины два интерфейса в одной сети (Wi-Fi и USB-Ethernet) — LiveKit `--dev` отвечал на ICE не с того адреса, и даже локальный Chromium не соединялся. Решение — конфиг с `rtc.node_ip` и `rtc.interfaces.includes: [<проводной>]` вместо `--dev`.

| Проверка | Результат | Доказательство |
|---|---|---|
| Сборка слитой ветки: Android arm64 (обычный и dev), iOS симулятор | ок, правок не потребовалось | — |
| Dev deep link без входа в Mattermost | ок | `01` |
| «Ещё» со всеми пунктами (организатор) | ок | `02`, `23` (iOS) |
| Запись «Только звук (для ИИ)» + саммари, срок по умолчанию | ок: сервер получил `mode=audio, summary=true, retention=90d`; REC с таймером | `03`, `04`, `24` (iOS) |
| Остановка записи | ок | `05` |
| Гостевая ссылка, закрыть вход | ок | `06` |
| Гость стучится → плашка → «Впустить» | ок | `07`, `08` |
| Выключить микрофон Анне / попросить включить | ок: веб получил `muted` и `unmute_request` | `09` |
| Собеседник выключил микрофон — плитка не пропадает | ок после исправления рамки | `10` |
| Набор номера, нога «На связи», тоны 5#1, «Положить трубку» | ок | `11`, `12` |
| Чат: картинка от веба с превью; файл с телефона (DocumentsUI) | ок: тело загрузки — содержимое файла, сообщение с `file_id` | `13`–`15`, `25` (iOS) |
| Сообщить о проблеме | ок: немедленный отчёт с `peers`, `window_ms`; дополнение `{symptoms, comment}` с тем же `report_id` | `16` |
| Режим компаньона | ок: веб видит выключенные микрофон и камеру; громкость удалённых — 0 (`_setVolume`) | `17` |
| MEDIA_FAILED и «Повторить» | ок: экран веба; повтор — join без повторного redeem, звонок восстановлен | `18`, `19` |
| Ландшафт: звонок и «Ещё» | ок | `20`, `21` |
| «Завершить для всех» | ок: звонок `ENDED`, комната удалена | `22` |
| iOS: фон — видео только у плитки PiP | ок (статистика `framesDecoded`/`enabled`) | — |

### Что не сделано / не проверено

- Звук на слух, Bluetooth, реальная камера iOS, PiP и CallKit на iOS, гостевой (не организатор) вид на устройстве — эмулятор/симулятор этого не дают (стенд умеет `ROLE=participant`).
- Не перенесено из веба: трансляция (broadcast) и чат зрителей, «spotlight» модератора, ожидаемые партнёры по телефону и политика входа партнёров, удаление сообщений чата, упоминания в чате, выбор устройств (на телефоне — маршрут звука), «скрыть себя», отключение записи PiP по кнопке.
- Не делалось (план фазы 4): LiveCommunicationKit за флагом, Handoff, удаление WebView-пути (WebView остаётся запасным за долгим нажатием на заголовок).
- Подписи состояний SIP и сроков хранения записи — из `call-core`, только по-русски (как в вебе) и в английской локали приложения.
- Тосты (snack bar) видны только в залогиненных экранах — на стенде без входа их не видно (запись, приглашения, ошибки модерации).

### Риски

- Пакет `call-core` без DOM/`livekit-client`: события комнаты — строками; при смене имён в новом `livekit-client` телеметрия замолчит без ошибки компиляции (имена проверены для 2.22.3).
- `RemoteParticipant.getVolume()` в RN после `setVolume(0)` возвращает 1 (особенность livekit-client: `elementVolume=0` — «ложь»); режим компаньона на слух не проверен.
- Разблокировка ориентации на время звонка: если поверх развёрнутого звонка открыть галерею и закрыть её, галерея вернёт портрет — звонок повернётся только после сворачивания/разворачивания.
- Модерация доверяет `conf.can.*` и `my_role` из снимка; права проверяет сервер, ошибки — тостом.

## Что проверить на устройствах (владельцу)

Android (Pixel 16 QPR1+, Samsung One UI, Xiaomi/HyperOS):
1. Вход в Mattermost, звонок из канала (кнопка) и входящий из пуша при выключенном экране и убитом приложении; ответ из CallStyle и гарнитурой.
2. Звук в обе стороны на слух, эхо; динамик / телефон / Bluetooth / проводные; mute из уведомления, PiP и гарнитуры.
3. Камера фронт/тыл, PiP по Home, демонстрация экрана, 10 мин с заблокированным экраном.
4. Паритет на реальном сервере gomon: файл в чат из галереи, с камеры и из «Файлов» (большой файл — лимит, PDF/картинка — открытие), запись «Только звук (для ИИ)» + саммари (саммари приходит в чат), лобби гостя по гостевой ссылке, mute/просьба/удаление участника, закрытие входа, SIP (если у организации есть транк): дозвон на номер и сотрудника, тоны в IVR.
5. Режим компаньона в переговорке (тишина, чат/руки работают), «Сообщить о проблеме» (отчёт виден в SRE-боте/диагностике).
6. Плохая сеть: сеть без UDP/корпоративный Wi-Fi → экран «Не удалось подключить звук и видео», смена сети → «Повторить».
7. Повернуть телефон в развёрнутом звонке (ландшафт), планшет (листы по центру).
8. Dev-приложение рядом с основным: `matrasdev://gomon/join?url=…` до входа.
9. Обновление уведомления звонка при быстром повторном входе (раньше падало) — не падает.

iOS (iPhone iOS 18 и 26, ключи Apple):
1. `MATRAS_TEAM_ID` в `ios/Matras.local.xcconfig`, сборка на устройство всех таргетов (с `ScreenShare`).
2. Всё из фазы 3: VoIP-пуш → CallKit при убитом приложении, ответ/отклонение, mute/завершить из CallKit, звук и маршруты, PiP при уходе в фон и камера в PiP, демонстрация из расширения.
3. В фоне с PiP: декодируется только плитка PiP (батарея), после возврата — все плитки.
4. Паритет (как Android п. 4–7), особенно VoiceOver: пункты листов читаются по одному, реакции — словами.

## Источники

- LiveKit RN SDK, релизы: https://github.com/livekit/client-sdk-react-native/releases ; PR #455 (prefixed WebRTC): https://github.com/livekit/client-sdk-react-native/pull/455 ; issue #468: https://github.com/livekit/client-sdk-react-native/issues/468 ; #134 New Arch: https://github.com/livekit/client-sdk-react-native/issues/134
- `@livekit/react-native-webrtc` gradle/podspec: https://github.com/livekit/react-native-webrtc/blob/master/android/build.gradle , https://github.com/livekit/react-native-webrtc/blob/master/livekit-react-native-webrtc.podspec ; коллизии #51: https://github.com/livekit/react-native-webrtc/issues/51 ; PR #94: https://github.com/livekit/react-native-webrtc/pull/94
- react-native-webrtc 124.0.8, 16 KB: https://github.com/react-native-webrtc/react-native-webrtc/releases , https://github.com/react-native-webrtc/react-native-webrtc/issues/1804 ; PiP PR #1710: https://github.com/react-native-webrtc/react-native-webrtc/pull/1710
- LiveKit Swift SDK: https://github.com/livekit/client-sdk-swift ; CallKit: https://livekit-client-sdk-swift.mintlify.app/platforms/callkit-integration ; screen share: https://github.com/livekit/client-sdk-swift/blob/main/Docs/ios-screen-sharing.md ; Android SDK: https://github.com/livekit/client-sdk-android
- Core-Telecom: https://developer.android.com/jetpack/androidx/releases/core , https://developer.android.com/develop/connectivity/telecom/voip-app/telecom , https://developer.android.com/develop/connectivity/telecom/voip-app/api-updates , https://android-developers.googleblog.com/2026/05/voip-native-visibility-telecom-alpha.html
- FGS: https://developer.android.com/develop/background-work/services/fgs/service-types , https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start , https://developer.android.com/about/versions/15/behavior-changes-15
- FSI: https://source.android.com/docs/core/permissions/fsi-limits , https://support.google.com/googleplay/android-developer/answer/13392821
- PiP: https://developer.android.com/develop/ui/views/picture-in-picture , https://developer.android.com/about/versions/16/behavior-changes-16 ; MediaProjection: https://developer.android.com/media/grow/media-projection ; Live Updates: https://developer.android.com/develop/ui/views/notifications/live-update
- PushKit: https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit ; CallKit: https://developer.apple.com/documentation/callkit/cxprovider ; LCK: https://developer.apple.com/documentation/livecommunicationkit , https://developer.apple.com/videos/play/wwdc2026/226/
- PiP iOS: https://developer.apple.com/documentation/avkit/adopting-picture-in-picture-for-video-calls ; multitasking camera: https://developer.apple.com/documentation/avfoundation/avcapturesession/ismultitaskingcameraaccesssupported , https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.avfoundation.multitasking-camera-access
- APNs: https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns ; Handoff: https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/Handoff/AdoptingHandoff/AdoptingHandoff.html
- Mattermost push-proxy 6.5.0 / VoIP: https://github.com/mattermost/mattermost-push-proxy/releases , https://github.com/mattermost/mattermost-push-proxy/blob/master/server/apple_notification_server.go ; свой proxy: https://docs.mattermost.com/deployment-guide/mobile/host-your-own-push-proxy-service
- Код: `public@v0.4.4/model/push_notification.go` (`PushTransportVoIP`), `model/session.go` (`VoIPDeviceId`), `plugins/mattermost/server/plugin.go:pushIncoming`, `services/communication/internal/httpapi/server.go` (`/v1/handoff/redeem`, `/v1/calls/{id}/join`), `libraries/@mattermost/calls-native/ios/Source/Managers/*`.
