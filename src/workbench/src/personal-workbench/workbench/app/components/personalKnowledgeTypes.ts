export interface Note {
  id: string
  title: string
  bodyMarkdown: string
  createdAt: number
  updatedAt: number
  revision: number
}

export type PageKind = 'note' | 'document'

export interface BrainPage {
  refId: string
  kind: PageKind
  collectedAt: number
  asset?: {
    status: 'managed'
    title: string
    sourceLabel: string
    contentKind: 'file' | 'directory'
    sourceDocumentId?: string
    sourcePath?: string
  }
}

export interface BrainLink {
  from: string
  to: string
}

export interface Theme {
  id: string
  name: string
  color: string
  origin: 'agent' | 'user'
}

export interface Assignment {
  refId: string
  themeId: string
  by: 'agent' | 'user'
  locked: boolean
}
