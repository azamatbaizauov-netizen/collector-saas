export interface BitrixContact {
  id: string;
  name: string;
  phone?: string | undefined;
  email?: string | undefined;
  customFields: Record<string, unknown>;
}

export interface BitrixDeal {
  id: string;
  contactId: string;
  title: string;
  stageId: string;
  opportunity: bigint;
  currency: string;
  closeDate?: Date | undefined;
}

export interface BitrixInvoice {
  id: string;
  contactId: string;
  dealId?: string;
  amount: bigint;
  currency: string;
  dueDate: Date;
  paidAt?: Date;
  status: 'UNPAID' | 'PAID' | 'OVERDUE';
}

export interface CrmAdapter {
  getContact(contactId: string): Promise<BitrixContact>;
  getDealsForContact(contactId: string): Promise<BitrixDeal[]>;
  getInvoicesForContact(contactId: string): Promise<BitrixInvoice[]>;
  setCustomField(contactId: string, fieldName: string, value: unknown): Promise<void>;
  addTimelineComment(entityType: 'contact' | 'deal', entityId: string, comment: string): Promise<void>;
  createTask(params: {
    title: string;
    description: string;
    responsibleId: string;
    deadlineAt?: Date;
  }): Promise<string>;
}
