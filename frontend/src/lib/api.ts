const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init)
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try { const body = await response.json(); message = body.detail || message } catch { /* keep default */ }
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message))
  }
  return response.json() as Promise<T>
}

export type FeatureDrift = {
  feature: string; test: string; statistic: number; p_value: number; psi: number; drifted: boolean; severity: string;
  reference_mean: number; current_mean: number; reference_std?: number; current_std?: number
}
export type MonitoringRun = {
  id?: number; run_id?: number; created_at: string; rows_scanned: number; drifted_features: number; drift_share: number;
  accuracy: number | null; precision: number | null; recall: number | null; f1: number | null; status: string;
  results?: { features: FeatureDrift[]; prediction_distribution: {label: string; count: number}[]; metrics_available: boolean; metrics_note: string; metrics: Record<string, number> }
}
export type Alert = { id: number; run_id: number; feature: string; severity: string; message: string; created_at: string; acknowledged: number }
export type Dashboard = { total_runs: number; open_alerts: number; latest_run: MonitoringRun | null; recent_runs: MonitoringRun[]; model: {name: string; version: string; type: string; status: string} }

export const api = {
  health: () => request<{status: string}>('/api/health'),
  dashboard: () => request<Dashboard>('/api/dashboard'),
  models: () => request<Array<{id: number; name: string; version: string; model_type: string; status: string}>>('/api/models'),
  runs: () => request<MonitoringRun[]>('/api/runs'),
  run: (id: number) => request<MonitoringRun & {results: NonNullable<MonitoringRun['results']>}>(`/api/runs/${id}`),
  alerts: () => request<Alert[]>('/api/alerts'),
  monitor: (file: File) => {
    const body = new FormData(); body.append('file', file)
    return request<MonitoringRun>('/api/monitor', { method: 'POST', body })
  },
  acknowledge: (id: number, acknowledged: boolean) => request<Alert>(`/api/alerts/${id}`, {
    method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({acknowledged}),
  }),
}
