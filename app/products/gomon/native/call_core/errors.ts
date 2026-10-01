// Server messages are written for developers (often in English). People see a clear Russian
// sentence by error code; a server message that is already Russian is shown as is.

const RU_BY_CODE: Record<string, string> = {
  validation: "Проверьте введённые данные.",
  conflict: "Действие конфликтует с текущим состоянием. Обновите страницу и попробуйте снова.",
  version_conflict: "Данные изменил кто-то другой. Обновите страницу.",
  gone: "Это больше недоступно.",
  forbidden: "Недостаточно прав для этого действия.",
  not_found: "Не найдено.",
  unauthenticated: "Сеанс истёк — войдите снова.",
  unavailable: "Сервис временно недоступен. Попробуйте позже.",
  rate_limited: "Слишком много попыток. Подождите немного.",
  invalid_transition: "Сейчас это действие недоступно.",
  internal: "Внутренняя ошибка. Попробуйте ещё раз.",
  upstream: "Внешний сервис не ответил. Попробуйте позже.",
  too_large: "Файл слишком большой.",
  unsupported_media_type: "Неподдерживаемый формат файла.",
  slot_taken: "Это время уже занято.",
  room_in_other_call: "Переговорка уже подключена к другому звонку.",
  checkin_closed: "Время отметки прошло.",
  no_booking: "У вас нет брони этой переговорки.",
  tag_disabled: "Эта метка отключена.",
  idempotency_mismatch: "Повторный запрос не совпал с исходным. Обновите страницу.",
  network: "Нет связи с сервером.",
};

export function humanError(code: string, message: string): string {
  if (/[А-Яа-яЁё]/.test(message)) return message;
  return RU_BY_CODE[code] ?? (message || "Что-то пошло не так.");
}
