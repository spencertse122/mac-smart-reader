export type DriveFile = {
  id: string
  name: string
  mimeType: string
  size?: string
  md5Checksum?: string
  modifiedTime: string
  version?: string
  parents?: string[]
  trashed?: boolean
}

export const FOLDER_MIME = 'application/vnd.google-apps.folder'

export class DriveAuthError extends Error {
  constructor(message = 'Drive authorization failed') {
    super(message)
    this.name = 'DriveAuthError'
  }
}

export class DriveError extends Error {
  status: number
  constructor(status: number, message?: string) {
    super(message ?? `Drive request failed (${status})`)
    this.name = 'DriveError'
    this.status = status
  }
}
