/** Subset of Meta's webhook payload that this bot actually reads. */
export interface CloudTextMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { caption?: string };
  video?: { caption?: string };
  context?: { from?: string; id?: string };
}

export interface CloudContact {
  wa_id: string;
  profile?: { name?: string };
}

export interface CloudChangeValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: CloudContact[];
  messages?: CloudTextMessage[];
  statuses?: unknown[];
}

export interface CloudWebhookBody {
  object?: string;
  entry?: { id?: string; changes?: { field?: string; value?: CloudChangeValue }[] }[];
}
