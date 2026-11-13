import axios, { AxiosError, type AxiosRequestConfig } from 'axios'

const TOKEN_KEY = 'cn_access_token'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  withCredentials: true,
  timeout: 30_000,
})

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  try {
    const { data } = await axios.post(
      `${api.defaults.baseURL}/auth/refresh`,
      {},
      { withCredentials: true, timeout: 15_000 },
    )
    const token = data?.data?.accessToken as string | undefined
    if (token) setToken(token)
    return token ?? null
  } catch {
    setToken(null)
    return null
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined
    const url = original?.url ?? ''
    if (error.response?.status === 401 && original && !original._retry && !url.includes('/auth/login') && !url.includes('/auth/refresh')) {
      original._retry = true
      refreshPromise = refreshPromise ?? refreshAccessToken()
      const token = await refreshPromise
      refreshPromise = null
      if (token) {
        original.headers = { ...(original.headers ?? {}), Authorization: `Bearer ${token}` }
        return api(original)
      }
    }
    return Promise.reject(error)
  },
)

export function apiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: { message?: string; details?: unknown } } | undefined
    if (data?.error?.message) return data.error.message
    if (error.code === 'ERR_NETWORK') return 'Cannot reach the server. Check that the API is running.'
    return error.message
  }
  return error instanceof Error ? error.message : 'Something went wrong'
}

export async function get<T>(url: string, params?: Record<string, unknown>, config?: AxiosRequestConfig): Promise<T> {
  const { data } = await api.get(url, { params, ...config })
  return data.data as T
}

export async function getPage<T>(
  url: string,
  params?: Record<string, unknown>,
): Promise<{ items: T[]; meta: { total: number; page: number; pageSize: number; totalPages: number } & Record<string, unknown> }> {
  const { data } = await api.get(url, { params })
  return {
    items: (data.data ?? []) as T[],
    meta: (data.meta ?? { total: 0, page: 1, pageSize: 20, totalPages: 1 }) as never,
  }
}

export async function post<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const { data } = await api.post(url, body ?? {}, config)
  return data.data as T
}

export async function patch<T>(url: string, body?: unknown): Promise<T> {
  const { data } = await api.patch(url, body ?? {})
  return data.data as T
}

export async function put<T>(url: string, body?: unknown): Promise<T> {
  const { data } = await api.put(url, body ?? {})
  return data.data as T
}

export async function del<T>(url: string): Promise<T> {
  const { data } = await api.delete(url)
  return data.data as T
}

export async function downloadFile(url: string, filename: string) {
  const { data } = await api.get(url, { responseType: 'blob' })
  const blobUrl = URL.createObjectURL(data as Blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename
  a.click()
  URL.revokeObjectURL(blobUrl)
}
