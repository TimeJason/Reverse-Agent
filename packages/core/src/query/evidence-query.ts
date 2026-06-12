export interface CursorPage<T> {
  items: T[];
  next_cursor?: string;
}

export interface TrafficSearchQuery {
  project_id: string;
  host?: string;
  method?: string;
  path_contains?: string;
  status_code?: number;
  status_min?: number;
  status_max?: number;
  content_type?: string;
  capture_session_id?: string;
  observed_from?: string;
  observed_to?: string;
  cursor?: string;
  limit?: number;
}

export interface LogSearchQuery {
  project_id: string;
  level?: string;
  service?: string;
  trace_id?: string;
  request_id?: string;
  message_contains?: string;
  observed_from?: string;
  observed_to?: string;
  cursor?: string;
  limit?: number;
}
