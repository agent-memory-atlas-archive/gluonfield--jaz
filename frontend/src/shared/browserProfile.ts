export const BROWSER_PROFILE_CHANNELS = {
  list: 'jaz:browser-profile-list',
  import: 'jaz:browser-profile-import',
}

export type BrowserProfile = {
  id: string
  browser: string
  name: string
  cookies: boolean
  passwords: boolean
}

export type BrowserImportSelection = {
  cookies: boolean
  passwords: boolean
}

export type BrowserImportCount = {
  imported: number
  failed: number
  skipped?: number
  error?: string
}

export type BrowserImportResult = {
  cookies?: BrowserImportCount
  passwords?: BrowserImportCount
}

export interface BrowserProfileAPI {
  list(): Promise<BrowserProfile[]>
  import(profileId: string, selection: BrowserImportSelection): Promise<BrowserImportResult>
}
