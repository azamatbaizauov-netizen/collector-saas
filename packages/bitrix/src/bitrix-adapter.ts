import type { CrmAdapter, BitrixContact, BitrixDeal, BitrixInvoice } from './adapter.js';

export interface BitrixAdapterConfig {
  webhookUrl: string;
  portalId: string;
}

export class BitrixAdapter implements CrmAdapter {
  private readonly baseUrl: string;

  constructor(private readonly config: BitrixAdapterConfig) {
    this.baseUrl = config.webhookUrl.replace(/\/$/, '');
  }

  private async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const url = `${this.baseUrl}/${method}.json`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      if (response.status === 503) {
        // Битрикс rate limit — caller должен retry с экспоненциальной задержкой
        throw Object.assign(new Error('Bitrix rate limit'), { code: 'RATE_LIMIT' });
      }
      throw new Error(`Bitrix API error: ${response.status}`);
    }

    const data = (await response.json()) as { result: T; error?: string };
    if (data.error) throw new Error(`Bitrix error: ${data.error}`);
    return data.result;
  }

  async getContact(contactId: string): Promise<BitrixContact> {
    const result = await this.call<Record<string, unknown>>('crm.contact.get', { id: contactId });
    return {
      id: String(result['ID']),
      name: `${result['NAME'] ?? ''} ${result['LAST_NAME'] ?? ''}`.trim(),
      phone: (result['PHONE'] as Array<{ VALUE: string }> | undefined)?.[0]?.VALUE,
      email: (result['EMAIL'] as Array<{ VALUE: string }> | undefined)?.[0]?.VALUE,
      customFields: Object.fromEntries(
        Object.entries(result).filter(([k]) => k.startsWith('UF_AICOL_')),
      ),
    };
  }

  async getDealsForContact(contactId: string): Promise<BitrixDeal[]> {
    const result = await this.call<Array<Record<string, unknown>>>('crm.deal.list', {
      filter: { CONTACT_ID: contactId },
      select: ['ID', 'CONTACT_ID', 'TITLE', 'STAGE_ID', 'OPPORTUNITY', 'CURRENCY_ID', 'CLOSEDATE'],
    });

    return result.map((d) => ({
      id: String(d['ID']),
      contactId: String(d['CONTACT_ID']),
      title: String(d['TITLE'] ?? ''),
      stageId: String(d['STAGE_ID'] ?? ''),
      opportunity: BigInt(Math.round(Number(d['OPPORTUNITY'] ?? 0) * 100)),
      currency: String(d['CURRENCY_ID'] ?? 'KZT'),
      closeDate: d['CLOSEDATE'] ? new Date(String(d['CLOSEDATE'])) : undefined,
    }));
  }

  async getInvoicesForContact(_contactId: string): Promise<BitrixInvoice[]> {
    // TODO: реализовать через crm.invoice.list или смарт-процессы Битрикса
    return [];
  }

  async setCustomField(contactId: string, fieldName: string, value: unknown): Promise<void> {
    await this.call('crm.contact.update', {
      id: contactId,
      fields: { [fieldName]: value },
    });
  }

  async addTimelineComment(
    entityType: 'contact' | 'deal',
    entityId: string,
    comment: string,
  ): Promise<void> {
    await this.call('crm.timeline.comment.add', {
      fields: {
        ENTITY_TYPE: entityType === 'contact' ? 'contact' : 'deal',
        ENTITY_ID: entityId,
        COMMENT: comment,
      },
    });
  }

  async createTask(params: {
    title: string;
    description: string;
    responsibleId: string;
    deadlineAt?: Date;
  }): Promise<string> {
    const fields: Record<string, unknown> = {
      TITLE: params.title,
      DESCRIPTION: params.description,
      RESPONSIBLE_ID: params.responsibleId,
    };
    if (params.deadlineAt) {
      fields['DEADLINE'] = params.deadlineAt.toISOString();
    }
    const id = await this.call<string>('tasks.task.add', { fields });
    return id;
  }
}
