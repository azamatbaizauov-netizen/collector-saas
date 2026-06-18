import ExcelJS from 'exceljs';
import { google } from 'googleapis';
import type { RawDebtRow } from '@repo/rules';
import type { DebtSource, DebtSourceMetadata, DebtSnapshot } from './adapter.js';

// Источник дебиторки = Google Sheet «Дебиторка LR» (ADR 0003). Файл — загруженный
// .xlsx (НЕ нативная Google Таблица), поэтому Sheets API не читает: качаем через
// Drive API (files.get alt=media) и парсим exceljs. TEMPORARY: заменяется
// коннектором 1С без правки бизнес-логики (нормализатор живёт в @repo/rules).

export interface GoogleSheetDebtSourceConfig {
  // Путь к JSON-ключу сервисного аккаунта (GOOGLE_APPLICATION_CREDENTIALS). Секрет.
  credentialsPath: string;
  // fileId таблицы в Drive (DEBT_SHEET_FILE_ID).
  fileId: string;
  // Имя листа. По умолчанию «Отчёт МОПа», fallback — первый лист.
  sheetName?: string;
}

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DEFAULT_SHEET_NAME = 'Отчёт МОПа';
const HEADER_ROWS = 1; // первая строка — заголовки колонок

// Распаковка значения ячейки exceljs: формулы → result, rich-text/гиперссылки → text.
function cellValue(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return (v as { result: unknown }).result; // formula / sharedFormula
    if ('text' in v) return (v as { text: unknown }).text; // hyperlink
    if ('richText' in v) {
      return (v as { richText: { text: string }[] }).richText.map((p) => p.text).join('');
    }
    if ('error' in v) return null;
  }
  return v;
}

export class GoogleSheetDebtSource implements DebtSource {
  private readonly drive;
  private readonly fileId: string;
  private readonly sheetName: string;

  constructor(config: GoogleSheetDebtSourceConfig) {
    const auth = new google.auth.GoogleAuth({
      keyFile: config.credentialsPath,
      scopes: [DRIVE_SCOPE],
    });
    this.drive = google.drive({ version: 'v3', auth });
    this.fileId = config.fileId;
    this.sheetName = config.sheetName ?? DEFAULT_SHEET_NAME;
  }

  async getMetadata(): Promise<DebtSourceMetadata> {
    const res = await this.drive.files.get({
      fileId: this.fileId,
      fields: 'version,modifiedTime',
      supportsAllDrives: true,
    });
    return {
      version: res.data.version ?? '',
      modifiedTime: res.data.modifiedTime ?? '',
    };
  }

  async fetchSnapshot(): Promise<DebtSnapshot> {
    const metadata = await this.getMetadata();

    const res = await this.drive.files.get(
      { fileId: this.fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' },
    );
    const buffer = Buffer.from(res.data as ArrayBuffer);

    const workbook = new ExcelJS.Workbook();
    // cast к точному типу параметра load: расхождение generic-параметра Buffer
    // между @types/node и типами exceljs (не any, чисто версии типов).
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet(this.sheetName) ?? workbook.worksheets[0];
    if (!sheet) {
      throw new Error(`Лист не найден в .xlsx (искали «${this.sheetName}»)`);
    }

    const rows: RawDebtRow[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber <= HEADER_ROWS) return;
      const c = (col: number) => cellValue(row.getCell(col));
      // Колонки A–N по раскладке ADR 0003. K (превышение) и L (косяк) не маппим —
      // превышение пересчитываем сами, косяк нам не нужен на импорте.
      rows.push({
        client: c(1), // A
        mop: c(2), // B
        city: c(3), // C
        phone: c(4), // D
        debt: c(5), // E
        aroseDate: c(6), // F
        promisedDate: c(7), // G
        lastPaymentDate: c(8), // H
        daysWithoutPayment: c(9), // I
        limit: c(10), // J
        comments: c(13), // M
        lastPaymentRaw: c(14), // N
      });
    });

    return { metadata, rows };
  }
}
