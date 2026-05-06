/**
 * État du projet ETL 360 côté blob : `{prefix}/viewer/etl360-project-state.json`
 * (le « projet » côté stockage = répertoire `viewer/`, alimenté par un ZIP importé
 * — archive sous `source/` — ou à terme un dossier équivalent sur le blob).
 */
import type { AnnotationRecord, PanoComparePair } from './etlViewer360Core'
import type { FloorPlanReplacementRecord } from './etlViewer360Core'

export const ETL_VIEWER_PROJECT_STATE_SCHEMA = 'etl360.viewerProjectState.v1' as const

export type PanoViewAxisFlipsRow = { flipX: boolean; flipY: boolean }

/** Schéma v1 : annotations, surcouches d’affichage (noms) et remplacements de plans (optionnel). */
export type EtlViewerProjectStateV1 = {
  schema: typeof ETL_VIEWER_PROJECT_STATE_SCHEMA
  updatedAt: string
  annotations: AnnotationRecord[]
  /** displayLabel / nom affiché par id de panorama */
  panoDisplayLabels: Record<string, string>
  panoFloorAssignments: Record<string, string>
  panoViewAxisFlips: Record<string, PanoViewAxisFlipsRow>
  /**
   * Paires de comparaison (avant / autre) par id du panorama de référence ;
   * l’autre côté est `otherPanoId` (voir `PanoRecord.comparePair`).
   */
  panoComparePairs?: Record<string, PanoComparePair>
  /** Cohérent avec le panneau de remplacement de plan (même sémantique que le localStorage par projet) */
  floorPlanReplacements?: Record<string, FloorPlanReplacementRecord>
}

export function createEmptyEtlViewerProjectStateV1(): EtlViewerProjectStateV1 {
  return {
    schema: ETL_VIEWER_PROJECT_STATE_SCHEMA,
    updatedAt: new Date().toISOString(),
    annotations: [],
    panoDisplayLabels: {},
    panoFloorAssignments: {},
    panoViewAxisFlips: {},
  }
}

export function parseEtlViewerProjectStateV1(raw: unknown): EtlViewerProjectStateV1 | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.schema !== ETL_VIEWER_PROJECT_STATE_SCHEMA) return null
  if (typeof o.updatedAt !== 'string') return null
  if (!Array.isArray(o.annotations)) return null
  if (!o.panoDisplayLabels || typeof o.panoDisplayLabels !== 'object') return null
  if (!o.panoFloorAssignments || typeof o.panoFloorAssignments !== 'object') return null
  if (!o.panoViewAxisFlips || typeof o.panoViewAxisFlips !== 'object') return null
  return o as EtlViewerProjectStateV1
}
