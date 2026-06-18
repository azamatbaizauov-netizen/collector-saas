import type { RawDebtRow } from '@repo/rules';

// Интерфейс источника дебиторки (ADR 0003). Бизнес-код не ходит в Drive/xlsx
// напрямую — только через DebtSource. На пилоте реализация GoogleSheetDebtSource
// (помечена temporary), позже заменяется коннектором 1С без правки бизнес-логики.

// Метаданные файла для polling по версии (дешёвый запрос без скачивания).
export interface DebtSourceMetadata {
  // Drive file `version` — растёт при каждой правке. Ключ обнаружения изменений.
  version: string;
  modifiedTime: string;
}

export interface DebtSnapshot {
  metadata: DebtSourceMetadata;
  // Сырые строки в порядке таблицы. Ещё НЕ нормализованы — это делает
  // normalizeDebtRow из @repo/rules. Адаптер только читает и раскладывает по колонкам.
  rows: RawDebtRow[];
}

export interface DebtSource {
  // Дешёвый запрос текущей версии файла (Drive files.get fields=version,modifiedTime).
  getMetadata(): Promise<DebtSourceMetadata>;
  // Полное чтение: скачать .xlsx (Drive files.get_media) + распарсить в сырые строки.
  fetchSnapshot(): Promise<DebtSnapshot>;
}
