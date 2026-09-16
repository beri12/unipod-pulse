import type {
  AdminStats,
  AuthResponse,
  CatchUpResponse,
  ChatRequest,
  ChatResponse,
  ConversationDetail,
  ConversationSummary,
  DocumentDetail,
  DocumentDto,
  MeetingDetail,
  MeetingDto,
  MessageDto,
  MessageImportResult,
  Paginated,
  PublicUser,
  QuestionLogDto,
  QuestionStatus,
  SearchResponse,
  SourceKind,
  SourceRef,
  SystemStatus,
  UnansweredQuestionDto,
} from '@unipods/types';
import { api, tokenStore } from './client';

export * from './client';

/** Query parameters accepted by the list endpoints. */
export interface ListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  type?: string;
  channel?: string;
  /** Endpoint-specific filters (announcementsOnly, answered, ...). */
  [key: string]: string | number | boolean | undefined;
}

export const authApi = {
  register: (body: { email: string; name: string; password: string }) =>
    api.post<AuthResponse>('/auth/register', body, { anonymous: true }),
  login: (body: { email: string; password: string }) =>
    api.post<AuthResponse>('/auth/login', body, { anonymous: true }),
  me: () => api.get<PublicUser>('/auth/me'),
  logout: async () => {
    const refreshToken = tokenStore.refresh;
    try {
      await api.post<void>('/auth/logout', refreshToken ? { refreshToken } : {});
    } finally {
      // The local session ends even if the server call fails.
      tokenStore.clear();
    }
  },
  updateProfile: (body: { name?: string; avatarUrl?: string }) =>
    api.patch<PublicUser>('/users/me', body),
};

export const chatApi = {
  ask: (body: ChatRequest) => api.post<ChatResponse>('/chat', body),
  conversations: () => api.get<ConversationSummary[]>('/conversations'),
  conversation: (id: string) => api.get<ConversationDetail>(`/conversations/${id}`),
  remove: (id: string) => api.delete<void>(`/conversations/${id}`),
};

export const documentsApi = {
  list: (query: ListQuery = {}) => api.get<Paginated<DocumentDto>>('/documents', { query }),
  byId: (id: string) => api.get<DocumentDetail>(`/documents/${id}`),
  upload: (form: FormData) => api.post<DocumentDto>('/documents', form),
  process: (id: string) => api.post<DocumentDto>(`/documents/${id}/process`),
  remove: (id: string) => api.delete<void>(`/documents/${id}`),
};

export const meetingsApi = {
  list: (query: ListQuery = {}) => api.get<Paginated<MeetingDto>>('/meetings', { query }),
  byId: (id: string) => api.get<MeetingDetail>(`/meetings/${id}`),
  create: (form: FormData) => api.post<MeetingDto>('/meetings', form),
  importTranscript: (id: string, form: FormData) =>
    api.post<MeetingDto>(`/meetings/${id}/transcript`, form),
  process: (id: string) => api.post<MeetingDto>(`/meetings/${id}/process`),
  remove: (id: string) => api.delete<void>(`/meetings/${id}`),
};

export const messagesApi = {
  list: (query: ListQuery & { announcementsOnly?: boolean } = {}) =>
    api.get<Paginated<MessageDto>>('/messages', { query }),
  channels: () => api.get<Array<{ channel: string; count: number }>>('/messages/channels'),
  import: (form: FormData) => api.post<MessageImportResult>('/messages/import', form),
  remove: (id: string) => api.delete<void>(`/messages/${id}`),
};

export const searchApi = {
  search: (q: string, options: { types?: SourceKind[]; limit?: number } = {}) =>
    api.get<SearchResponse>('/search', {
      query: {
        q,
        limit: options.limit ?? 20,
        ...(options.types?.length ? { types: options.types.join(',') } : {}),
      },
    }),
};

export const catchUpApi = {
  get: (params: { date?: string; from?: string; to?: string } = {}) =>
    api.get<CatchUpResponse>('/catch-up', { query: params }),
};

export const sourcesApi = {
  byId: (id: string) => api.get<SourceRef>(`/sources/${id}`),
};

export const adminApi = {
  stats: () => api.get<AdminStats>('/admin/stats'),
  status: () => api.get<SystemStatus>('/admin/status'),
  knowledge: (query: ListQuery = {}) =>
    api.get<Paginated<SourceRef & { chunkCount: number }>>('/admin/knowledge', { query }),
  unanswered: (query: ListQuery = {}) =>
    api.get<Paginated<UnansweredQuestionDto>>('/questions/unanswered', { query }),
  questionLogs: (query: ListQuery & { answered?: boolean } = {}) =>
    api.get<Paginated<QuestionLogDto>>('/questions/logs', { query }),
  updateQuestion: (id: string, body: { status: QuestionStatus; resolutionNote?: string }) =>
    api.patch<UnansweredQuestionDto>(`/questions/unanswered/${id}`, body),
};

export const healthApi = {
  status: () => api.get<SystemStatus>('/health'),
};
