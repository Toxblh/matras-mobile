# Ключи для своих пушей Matras: Firebase (Android) и Apple (iOS)

Нужны своему push-прокси (см. [push-proxy.md](push-proxy.md)) и сборке приложения с ID `ru.toxblh.matras`.
Ничего из этого не пересылать в чат: файлы кладутся прямо на сервер (раздел «Куда положить»).

## 1. Firebase — пуши на Android

1. Открыть https://console.firebase.google.com под своим Google-аккаунтом → **Add project** (Создать проект).
   Имя: `Matras`. Google Analytics можно выключить.
2. В проекте: **Add app → Android**.
   - Android package name: `ru.toxblh.matras` (ровно так).
   - App nickname: `Matras`. SHA-1 для пушей не нужен — пропустить.
   - **Download google-services.json** — это файл для сборки приложения.
3. Включить отправку через FCM v1: ⚙ **Project settings → Cloud Messaging**. В блоке
   «Firebase Cloud Messaging API (V1)» должно быть **Enabled**; если нет — «⋮ → Manage API in Google Cloud Console → Enable».
4. Ключ для сервера: ⚙ **Project settings → Service accounts → Generate new private key → Generate key**.
   Скачается JSON вида `matras-xxxxx-firebase-adminsdk-....json` — это секрет (даёт право слать пуши в приложение).
5. Записать **Project ID** (Project settings → General).

Итого для Android: `google-services.json` (для CI сборки APK) и JSON сервисного аккаунта (для push-прокси).

## 2. Apple — пуши и звонки на iOS

Нужен платный аккаунт **Apple Developer Program** (99 $/год) — https://developer.apple.com/account.

1. **Team ID**: Account → Membership details → *Team ID* (10 символов).
2. **App ID**: Certificates, Identifiers & Profiles → **Identifiers → +** → App IDs → App.
   - Bundle ID (Explicit): `ru.toxblh.matras`.
   - Capabilities: **Push Notifications**, **App Groups**, (позже, когда попросим) **Associated Domains**.
   - Так же создать ID расширений: `ru.toxblh.matras.MattermostShare`, `ru.toxblh.matras.NotificationService`,
     `ru.toxblh.matras.ScreenShare` (показ экрана) — у каждого включить **App Groups**.
3. **App Group**: Identifiers → + → App Groups → `group.ru.toxblh.matras`; привязать ко всем четырём App ID.
4. **Ключ APNs** (один на всё, в т.ч. VoIP-пуши для звонков):
   **Keys → +** → имя `Matras Push` → отметить **Apple Push Notifications service (APNs)** → Continue → Register →
   **Download** — файл `AuthKey_XXXXXXXXXX.p8` скачивается **только один раз**, сохранить надёжно.
   Записать **Key ID** (10 символов, есть в имени файла).
   Этот ключ позволяет слать пуши во все приложения твоей команды — хранить как секрет.
5. Для сборки на Mac: Xcode → Settings → Accounts → добавить Apple ID; подпись автоматическая
   (`-allowProvisioningUpdates`), либо ключ **App Store Connect API** (Users and Access → Integrations →
   App Store Connect API → +, роль Developer) — тогда сборку можно делать скриптом без входа в Xcode.

Итого для iOS: `AuthKey_XXXXXXXXXX.p8`, **Key ID**, **Team ID**.

## Куда положить

На сервер Mattermost (прод-хост из mattermost-infra), в каталог секретов по правилам `mattermost-infra/SECRETS.md`,
с правами 600 (рядом с остальными секретами mattermost-infra; включение — `PUSH_PROXY_ENABLED=true`, см. README):

```
secrets/push-proxy/firebase-matras.json   # JSON сервисного аккаунта Firebase
secrets/push-proxy/apns-authkey.p8        # AuthKey_XXXXXXXXXX.p8
secrets/push-proxy/apns-key-id            # одна строка: Key ID
secrets/push-proxy/apns-team-id           # одна строка: Team ID
```

`google-services.json` — в секрет Forgejo Actions репозитория matras-mobile `GOOGLE_SERVICES_JSON`
(Settings → Actions → Secrets), CI подставит его при сборке APK с ID `ru.toxblh.matras`.

После этого сказать — дальше подключу сам: ключи в прокси, переключение сервера MM на прокси, сборка
`ru.toxblh.matras`, VoIP-пуши для входящих звонков gomon.
