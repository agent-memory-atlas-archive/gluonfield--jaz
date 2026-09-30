export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function readAPIResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) {
        message = body.error
      }
    } catch {
      // non-JSON error body; keep the status text
    }
    throw new ApiError(res.status, message)
  }
  const body = await res.text()
  // 202 and 204 acknowledge a write; an empty 200 is still a broken contract.
  if (!body && (res.status === 202 || res.status === 204)) return undefined as T
  return JSON.parse(body) as T
}
