import type { AntimonyApi } from '../../shared/api'

declare global {
  interface Window {
    antimony: AntimonyApi
  }
}
