# Свой push-proxy рядом с официальными приложениями

Вопрос: может ли свой push-сервер жить вместе с тем, что уже есть (официальные
приложения Mattermost на iOS/Android + Matras)?

**Коротко: да.** Сервер Mattermost знает только один адрес push-прокси, но прокси
сам решает, куда слать, по префиксу `device_id`. Ставим свой прокси адресом
сервера: префиксы Matras он обслуживает сам (свой Firebase и свой `.p8`), всё
остальное пересылает байт в байт туда, куда сервер шлёт сейчас. Есть одна
ловушка: сервер 11.10 **не пропустит незнакомый префикс** (allowlist, см. §2.1).
Лечится патчем в одну строку в `mattermost-build` или трюком с `-v<N>`.

Состояние кода на 2026-10-01: сервер `v11.10.0` (`~/git/mattermost`, `mattermost-build/MM_VERSION`),
push-proxy `v6.6.0` (на TPNS и HPNS сейчас стоит та же версия: `curl https://push-test.mattermost.com/version`),
matras-mobile ветка `matras` на `release-2.44`.

---

## 1. Как это устроено сейчас

### Сервер

- Один глобальный адрес: `EmailSettings.PushNotificationServer`. Сервер шлёт
  `POST <url>/api/v1/send_push` и `POST <url>/api/v1/ack`
  (`server/channels/app/notification_push.go`: `rawSendToPushProxy`, `SendAckToPushProxy`).
  Маршрутизации «разным клиентам разные прокси» в сервере нет.
- `device_id` сессии имеет вид `<platform>[-v<N>]:<token>`. Перед отправкой
  `SetDeviceIdAndPlatform` режет по первому `:` → `msg.Platform = "android_rn-v2"`,
  `msg.DeviceId = "<token>"` (`server/public/model/push_notification.go`).
- VoIP (с 11.7–11.10): у сессии есть отдельный `VoIPDeviceId`. Если плагин
  шлёт `PushNotification{Transport: "voip"}`, сервер берёт `VoIPDeviceId`
  (если его нет, откатывается на обычный токен с `Transport=standard`).
  Префикс у VoIP-токена тот же, что у обычного (`apple_rn…`), отдельного
  `apple_voip` нет. Тип доставки прокси понимает по полю `transport`.
- Лицензионный гейт (`server/channels/app/notification.go`, `canSendPushNotifications`):
  если в `PushNotificationServer` стоит один из адресов HPNS (`push.mattermost.com`,
  `global/us/eu/ap.push.mattermost.com`, `hpns-de…`), а в лицензии нет
  `MHPNS`, пуши **молча выключаются**. Гейт сравнивает строку в конфиге,
  то есть на адрес нашего прокси он не срабатывает.
- `IdLoaded` (пуш без текста, клиент догружает сообщение сам) требует лицензии:
  без неё `BuildPushNotificationMessage` понижает до `generic`. У нас лицензии нет,
  так что id-loaded недоступен, и свой прокси тут ничего не меняет.
- Заголовки `X-Mattermost-Auth`/`X-Mattermost-ServerID` ставятся только
  enterprise-реализацией `PushProxyInterface`. В нашей сборке её нет, и сервер ходит без них.

### Что стоит у нас

В `mattermost-infra` push-настроек нет (ни в `env/*.env`, ни в compose), значит,
значение лежит в `volumes/mm-config/config.json` на боксе. Лицензии с `MHPNS` у нас нет,
поэтому с HPNS пуши бы не работали. Раз пуши работают, **почти наверняка стоит TPNS
`https://push-test.mattermost.com`** (это и дефолт для новой установки). Проверить:

```bash
mmctl config get EmailSettings.PushNotificationServer
mmctl config get EmailSettings.PushNotificationContents   # generic | full
```

Дальше «upstream» означает то, что вернула эта команда.

### Прокси (mattermost-push-proxy)

- `handleSendNotification` (`server/server.go`) режет `msg.Platform` по первому `-v`:
  `android_rn-v2` превращается в платформу `android_rn` и `appVersion=2`. Затем ищет `pushTargets[platform]`:
  ключ равен `Type` из `ApplePushSettings[]`/`AndroidPushSettings[]` конфига.
  Если ключа нет, отвечает `{"status":"FAIL","error":"...missing platform..."}`.
  Типы в конфиге произвольные, `apple_matras` добавляется одной записью.
- Apple: `.p8` (`AppleAuthKeyFile`, `AppleAuthKeyID`, `AppleTeamID`) + `ApplePushTopic` = bundle id.
  При `transport=voip` та же запись шлёт PushKit с topic `<ApplePushTopic>.voip`,
  `apns-push-type: voip` (с 6.5.0; `sendVoIPNotification` в `apple_notification_server.go`).
  Отдельный ключ или сертификат для VoIP не нужен.
- Android: `ServiceFileLocation` указывает на JSON сервисного аккаунта Firebase (FCM HTTP v1).
- При ответах APNs/FCM «токен мёртв» прокси возвращает `status: REMOVE`, и сервер помечает
  сессию (`SessionPropLastRemovedDeviceId` / `…VoIPDeviceId`), после чего перестаёт слать на этот токен.
- `/api/v1/ack` только считает метрики доставки, на логику ничего не влияет.
- Встроенный rate limit: `ThrottlePerSec` (по умолчанию 300) с группировкой по
  `ThrottleVaryByHeader` (`X-Forwarded-For`).

### Клиент (matras-mobile)

Префикс ставится в двух местах:

- обычный токен: `app/init/push_notifications.ts`, `onRemoteNotificationsRegistered`
  (около строки 340): `android_rn` / `apple_rn` (+`beta`, если `isBetaApp`) + `-v2:`;
- VoIP-токен iOS: `app/init/calls_native.ts`, `onVoIPTokenUpdated` (около строки 118):
  `apple_rn[beta]-v2:`;
- константы: `app/constants/device.ts` (`PUSH_NOTIFY_ANDROID_REACT_NATIVE`, `PUSH_NOTIFY_APPLE_REACT_NATIVE`);
- `isBetaApp` = `applicationId.includes('rnbeta')` (`app/utils/general/index.ts`).

Токены попадают на сервер при логине (`device_id`, `voip_device_id`) и при каждом
старте через `setExtraSessionProps` (`app/actions/remote/entry/common.ts`).
Поэтому смена префикса подхватывается без перелогина.

Android сейчас: `applicationId com.mattermost.rnbeta`, `android/app/google-services.json`
от Firebase-проекта Mattermost (`api-7231322553409637977-752355`). Работает
только потому, что TPNS держит ключ этого проекта. Нативный Android-код префикс не трогает.

---

## 2. Схема сосуществования

```
Mattermost 11.10 ── PushNotificationServer = https://push.<наш домен> ──► наш proxy (форк)
                                                                           │
          platform ∈ {android_matras, apple_matras} ───────────────────────┤──► FCM (наш Firebase)
          (transport=voip для apple_matras → topic ru.toxblh.matras.voip)  │──► APNs (наш .p8)
                                                                           │
          всё остальное (android_rn, apple_rn, apple_rnbeta, …) ───────────┘──► upstream (TPNS)
                                                                                 тело и ответ 1:1
```

Официальные приложения продолжают регистрироваться как `android_rn-v2` / `apple_rn-v2`,
их пуши уходят тем же путём, что и сейчас, только через лишний хоп.
Matras регистрируется как `android_matras-v2` / `apple_matras-v2` и получает пуши
от нашего Firebase/APNs, включая VoIP для gomon (`sub_type=comms_call`).

### 2.1. Ловушка: allowlist префиксов в сервере 11.10

Коммит `93d0e6198d` «Route Calls pushes through a VoIP token if present» (#36726, вошёл в
`v11.10.0`) добавил проверку в `server/public/model/session.go`:

```go
var standardDevicePlatforms = []string{"apple_rn", "apple_rnbeta", "android_rn"}
var voIPDevicePlatforms     = []string{"apple_rn", "apple_rnbeta"}
```

Проверку зовут `app/login.go` (логин), `api4/user.go` (`attachDeviceIds`, это
`setExtraSessionProps`) и `web/oauth.go`. Незнакомый префикс получает **400**, а логин
с `device_id=android_matras-v2:…` **падает целиком**. Суффикс `-v<N>` перед проверкой
отрезается.

Два выхода:

**A (рекомендую): патч сервера.** Новый `mattermost-build/patches/0016-feat-push-allow-matras-device-prefixes.patch`
на три строки: добавить `"android_matras"`, `"apple_matras"` в `standardDevicePlatforms`
и `"apple_matras"` в `voIPDevicePlatforms`. Кроме этой проверки префиксы встречаются только
в enterprise-метриках (`enterprise/metrics/metrics.go`, там это просто лейблы). Патч раскатываем
**до** выпуска клиента с новым префиксом. Имя платформы не должно содержать `-v`,
иначе прокси отрежет лишнее.

**B (без патча, запасной): версия как метка.** Клиент шлёт `android_rn-v1000:<token>` /
`apple_rn-v1000:<token>`. Сервер это пропускает (`-v1000` отрезается), прокси получает
`platform=android_rn`, `appVersion=1000`, и форк правилом «`appVersion >= 1000` обслуживаем
сами, иначе форвардим» разводит трафик. Работает на ванильном сервере, но это хак на
семантике версий: если upstream начнёт использовать номер версии, придётся чинить.

### 2.2. Что меняем в форке прокси

Одно место: `handleSendNotification` в `server/server.go`.

1. Прочитать тело в `[]byte` (`io.ReadAll`) и декодировать из него.
2. Если платформа до `-v` нам не знакома (нет в `pushTargets`), не отвечать `FAIL`,
   а `POST` **исходных байтов** на `<Upstream>/api/v1/send_push`
   (`Content-Type: application/json`, таймаут `SendTimeoutSec`) и вернуть серверу
   статус и тело ответа upstream как есть. Так сохраняются `REMOVE` для мёртвых
   токенов официальных приложений и строка `-v2` в платформе.
3. `/api/v1/ack`: отвечать `200` локально для всех. Ack только для метрик; можно
   форвардить не-наши, но это не обязательно.
4. В конфиг одно поле `UpstreamPushServer` (пустое значит «не форвардить, отвечать FAIL
   как раньше»).
5. Проверка: `server_test.go`, два кейса через `httptest.Server` в роли upstream:
   незнакомая платформа уходит в upstream 1:1 (включая `REMOVE`), `android_matras-v2`
   не уходит.

Конфиг (только наши типы, всё остальное уходит в upstream):

```json
{
  "ListenAddress": ":8066",
  "ThrottlePerSec": 300,
  "ThrottleVaryByHeader": "X-Forwarded-For",
  "SendTimeoutSec": 30,
  "RetryTimeoutSec": 8,
  "UpstreamPushServer": "https://push-test.mattermost.com",
  "ApplePushSettings": [{
    "Type": "apple_matras",
    "ApplePushUseDevelopment": false,
    "ApplePushTopic": "ru.toxblh.matras",
    "AppleAuthKeyFile": "/secrets/AuthKey_XXXXXXXXXX.p8",
    "AppleAuthKeyID": "XXXXXXXXXX",
    "AppleTeamID": "YYYYYYYYYY"
  }],
  "AndroidPushSettings": [{
    "Type": "android_matras",
    "ServiceFileLocation": "/secrets/firebase-matras.json"
  }],
  "EnableMetrics": true,
  "LogLevel": "info"
}
```

Debug-сборки из Xcode получают sandbox-токены APNs. Для них понадобится вторая запись
`apple_matrasdev` с `ApplePushUseDevelopment: true` и соответствующий префикс в dev-сборке.
TestFlight и Ad Hoc работают через production.

### 2.3. Что меняем в matras-mobile

- `app/constants/device.ts`: `PUSH_NOTIFY_ANDROID_MATRAS: 'android_matras'`,
  `PUSH_NOTIFY_APPLE_MATRAS: 'apple_matras'`.
- `app/init/push_notifications.ts` и `app/init/calls_native.ts`: выбирать префикс
  **по applicationId/bundle id**: `ru.toxblh.matras` получает `*_matras`, всё остальное
  (сборки `com.mattermost.rnbeta`) остаётся на `android_rn`/`apple_rnbeta`.
  Тогда старые и новые сборки живут одновременно, и каждая ходит в «свой» Firebase.
  Лучше вынести выбор в одну функцию в новом файле, чтобы правка upstream-файлов
  свелась к одной строке и rebase оставался дешёвым.
- `isBetaApp` для `ru.toxblh.matras` станет `false`. Нужно проверить, что ещё от него
  зависит (например, тестовые серверы), и не завязывать префикс на этот флаг.
- Android: `applicationId`/`namespace` → `ru.toxblh.matras`, новый `google-services.json`
  из нашего Firebase-проекта. Это **новое приложение**: ставится рядом со старым,
  пользователи логинятся заново, старый `rnbeta` удаляется потом.
- iOS: bundle `ru.toxblh.matras`, capabilities Push Notifications + Background Modes
  `voip`/`remote-notification` (уже в `Info.plist`); NotificationService extension тоже
  под наш team и App Group.
- Плагин `ru.corp.comms`: в `pushIncoming` поставить `Transport: model.PushTransportVoIP`.
  Android-сессии и iOS без VoIP-токена сервер сам переведёт на обычный пуш.

---

## 3. Что сломается или за чем следить

| Тема | Что происходит | Что делать |
|---|---|---|
| Allowlist 11.10 | новый префикс даёт 400 на логине | патч 0016 до релиза клиента (§2.1) |
| Новый хоп | прокси недоступен, значит пуши не идут **никому**, включая официальные приложения | healthcheck `/version`, `restart: unless-stopped`, алерт; откат в §4 |
| Ответ upstream | если форк не вернёт `REMOVE` от TPNS 1:1, сервер продолжит слать на мёртвые токены | форвардить тело ответа как есть, покрыть тестом |
| Rate limit | прокси: 300 rps с группировкой по `X-Forwarded-For`, за Caddy это IP сервера, запас огромный. TPNS видит тот же один IP, что и сейчас | — |
| id-loaded | без лицензии недоступен независимо от прокси | контент пуша идёт через TPNS/наш прокси и FCM/APNs, это решает `PushNotificationContents` |
| Приватность | сейчас текст пушей Matras-Android идёт через TPNS Mattermost; после переезда только через наш прокси + Google/Apple | плюс переезда |
| HPNS | с HPNS-адресом в конфиге пуши у нас выключены (лицензия). Форвард из нашего прокси в HPNS гейт в сервере не заметит, но HPNS по условиям только для Enterprise/Professional/Cloud | форвардить в TPNS, как сейчас |
| TPNS-условия | документация: TPNS для **некоммерческих** self-hosted, без SLA, «не для прода», только для магазинных приложений Mattermost. Мы уже в этой серой зоне (и Matras на `rnbeta` тоже) | переезд Matras на свой прокси убирает из серой зоны его; официальные приложения остаются в ней, пока они есть |
| Ack | ack приходит от клиента на сервер, сервер шлёт его в прокси; это только метрики | локальный `200` |
| VoIP без `reportNewIncomingCall` | iOS банит приложение за PushKit без CallKit | правило соблюдено в `PushKitController`, для `comms_call` сохранить |
| Два Firebase | FCM-токен от проекта A не работает с ключом проекта B | префикс строго по app id (§2.3) |
| Секреты | `.p8` даёт право слать пуши во **все** приложения команды Apple; JSON Firebase равен праву слать в проект | файлы `0600`, вне git, по образцу `SECRETS.md` |

---

## 4. Миграция без простоя

1. **Узнать upstream**: `mmctl config get EmailSettings.PushNotificationServer`.
2. **Поднять прокси** (форк, образ в Forgejo registry) рядом с Mattermost:
   сервис в `mattermost-infra/docker-compose.yml`, vhost `push.<домен>` в Caddy
   (TLS автоматически) или внутренний адрес `http://push-proxy:8066`, если сервер ходит
   к нему внутри docker-сети. Наружу его светить не нужно: клиенты к прокси не
   ходят, только сервер. Сначала конфиг только с `UpstreamPushServer`, без наших типов.
3. **Смоук форварда**: `curl -XPOST .../api/v1/send_push` с `platform=android_rn-v2`,
   `server_id=x`, `device_id=bogus`. Ответ должен совпадать с тем, что даёт TPNS напрямую.
4. **Переключить сервер** (горячая настройка, рестарт не нужен):
   `mmctl config set EmailSettings.PushNotificationServer http://push-proxy:8066`,
   либо `MM_EMAILSETTINGS_PUSHNOTIFICATIONSERVER` в `env/mattermost.prod.env`,
   чтобы значение жило в git. Пуши официальных приложений и текущего Matras идут
   как раньше; проверить на своём телефоне через System Console → «Send test push»
   или по реальному сообщению.
5. **Патч 0016** в `mattermost-build`, выкатить образ.
6. **Добавить наши типы** в конфиг прокси (Firebase JSON, `.p8`), рестарт прокси (секунды).
7. **Выпустить Matras** `ru.toxblh.matras` (Android APK, iOS TestFlight) с новым префиксом.
   Пользователи ставят и логинятся, старый `rnbeta` продолжает работать через TPNS,
   пока его не удалят.
8. **Плагин**: `Transport: voip` для `comms_call`.

### Откат

- Прокси сломался: `mmctl config set EmailSettings.PushNotificationServer <старый upstream>`.
  Официальные приложения и `rnbeta` оживают сразу. Новый Matras без нашего прокси пуши
  не получит (TPNS не знает ни наш Firebase, ни наш bundle), поэтому держать старую
  сборку до стабилизации.
- Патч 0016 безопасен и в откате: он только расширяет allowlist.

---

## 5. Что нужно от владельца

1. **Firebase-проект** (свой Google-аккаунт организации), Android-приложение
   `ru.toxblh.matras`, скачать `google-services.json` (в репо, это не секрет) и
   **JSON-ключ сервисного аккаунта** с правом FCM (`Firebase Cloud Messaging API (V1)`
   включён; роль `Firebase Cloud Messaging Admin` или Editor). JSON является секретом.
2. **Apple Developer Program** (организация, нужен для TestFlight/App Store):
   App ID `ru.toxblh.matras` с Push Notifications, **APNs Auth Key `.p8`** + **Key ID** +
   **Team ID**. Ключ скачивается один раз, его надо сохранить.
3. **Хостинг**: тот же бокс, что и Mattermost (контейнер ~20 МБ RAM), либо любой
   с исходящим доступом к `fcm.googleapis.com`, `oauth2.googleapis.com`, `api.push.apple.com:443`
   и к upstream (`push-test.mattermost.com`).
4. **Домен + TLS**: нужны, только если прокси живёт не в той же docker-сети, что сервер.
   Тогда `push.<домен>` через Caddy (Let's Encrypt автоматически) и ограничение
   доступа по IP сервера.
5. Решение: патч сервера (A) или трюк с версией (B).

---

## Источники

- Сервер: https://github.com/mattermost/mattermost/blob/v11.10.0/server/channels/app/notification_push.go
  (`rawSendToPushProxy`, `SendAckToPushProxy`, VoIP-fallback, id-loaded license gate)
- Лицензионный гейт HPNS: https://github.com/mattermost/mattermost/blob/v11.10.0/server/channels/app/notification.go
- Allowlist префиксов: https://github.com/mattermost/mattermost/blob/v11.10.0/server/public/model/session.go ,
  PR https://github.com/mattermost/mattermost/pull/36726
- URL HPNS/TPNS и `SetDeviceIdAndPlatform`: https://github.com/mattermost/mattermost/blob/v11.10.0/server/public/model/push_notification.go ,
  дефолт: https://github.com/mattermost/mattermost/blob/v11.10.0/server/public/model/config.go
- Прокси: https://github.com/mattermost/mattermost-push-proxy (`server/server.go`: разбор `-v`, `pushTargets`, `/ack`, throttle;
  `server/apple_notification_server.go`: VoIP; `config/mattermost-push-proxy.sample.json`),
  релизы: https://github.com/mattermost/mattermost-push-proxy/releases
- Свой прокси, HPNS и TPNS (TPNS только для некоммерческих self-hosted, без SLA, только магазинные приложения):
  https://docs.mattermost.com/deployment-guide/mobile/host-your-own-push-proxy-service.html
- Настройка Push Notification Server:
  https://docs.mattermost.com/administration-guide/configure/environment-configuration-settings.html
- Условия: https://mattermost.com/terms-of-use/
- PushKit: https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit
- APNs token auth: https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns
- FCM HTTP v1: https://firebase.google.com/docs/cloud-messaging/migrate-v1
