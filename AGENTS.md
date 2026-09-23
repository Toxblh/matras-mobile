# Matras — форк Mattermost Mobile

Ниже правила форка. Архитектура, команды и тесты приложения — в [CLAUDE.md](./CLAUDE.md) (файл upstream, без нужды не править).

## Ветки и ремоуты

| Ветка | Что это | Правило |
|---|---|---|
| `main` | зеркало upstream `main` | только fast-forward, своих коммитов нет |
| `matras` | форк: наши коммиты поверх тега релиза upstream | вся работа здесь; собирается и ставится на телефоны |

Базовый тег сейчас: **`release-2.44`** (после rebase обновить эту строку).

Ремоуты: `origin` = Forgejo `saratovmost/matras-mobile`, `github` = `Toxblh/matras-mobile`, `upstream` = `mattermost/mattermost-mobile` (push запрещён). Пушим всегда в оба: `origin` и `github`.

## Как вести разработку

- Один коммит = одно законченное изменение. Префикс области: `calls:`, `search:`, `license:`, `ci:`, `brand:`, `docs:`.
- Своё — по возможности новыми файлами; правки файлов upstream минимальные, чтобы rebase был дешёвым.
- Чужой PR из upstream берём `git cherry-pick -x <sha>` и пишем в тело коммита ссылку на PR. Когда PR влит в upstream, коммит выпадает при следующем rebase.
- Перед коммитом: `npm run tsc && npm run lint`, тесты затронутых файлов `npx jest <path>`.
- Никаких трейлеров `Co-Authored-By` и других пометок об инструменте в коммитах.
- Список наших изменений: `git log --oneline release-2.44..matras`.

## Обновление за upstream (раз в релиз)

```bash
git fetch upstream --tags
git checkout main && git merge --ff-only upstream/main && git push origin main && git push github main
git checkout matras
git rebase --onto <новый тег> <старый тег> matras     # rerere включён: конфликт решается один раз
npm ci && npm run tsc && npm run lint
git push --force-with-lease origin matras && git push --force-with-lease github matras
git push origin --tags && git push github --tags
```

Затем поправить базовый тег в этом файле.

## Сборка

- **Android**: Forgejo Actions, `.forgejo/workflows/android.yml`. Запускается на push в `matras`, публикует APK в Releases. Без секрета keystore APK подписывается debug-ключом.
- **iOS**: собирается на своём Mac-раннере, workflow добавим отдельно.
- **Локально** (Linux): Node 24 (`.nvmrc`), JDK 17 и Android SDK лежат в `~/.local/opt/node24`, `~/.local/opt/jdk17`, `~/Android/Sdk`; эмулятор `pixel` (Pixel 6, API 36).
  `npm ci` требует `ANDROID_HOME` и `emulator` в PATH (preinstall-проверка solidarity).
  ```bash
  export JAVA_HOME=~/.local/opt/jdk17 ANDROID_HOME=~/Android/Sdk ANDROID_SDK_ROOT=~/Android/Sdk
  export PATH=~/.local/opt/node24/bin:$JAVA_HOME/bin:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH
  npm ci
  emulator -avd pixel &          # эмулятор
  npm run android                # debug-сборка и запуск
  ```

---

# AGENTS.md

Follow [CLAUDE.md](./CLAUDE.md) for architecture, coding conventions, and how to test this React Native app.

## Cursor Cloud Agents

Checked-in Cloud Agent config lives under [`.cursor/`](.cursor/). The VM is Linux and is meant for **PR babysitting** (lint, TypeScript, Jest, GitHub checks), not for iOS/Android simulators or native builds.

Cloud-only instructions are in [`.cursor/cursor.md`](.cursor/cursor.md) (copied to `.cursor/AGENTS.md` at boot). Human overview: [`.cursor/README.md`](.cursor/README.md).
