/**
 * etlViewer360/etlViewer360Core.ts
 *
 * Logique métier et rendu WebGL du viewer 360 : annotations, import ZIP, E57,
 * viewers Three.js embarqués, utilitaires plein écran. Aucun JSX.
 *
 * Repères, quaternions, conversions source↔viewer et offset UV panorama :
 * voir COORDINATE_SYSTEMS.md dans ce dossier.
 *
 * Dépendances : three, jszip, utif, react (type MutableRefObject), etlSpatial.
 *
 * Gabarits intégrés (ids, couleurs, listes matière / SOL, alias d import) : fichier
 * {@link ./annotationIntegratedCatalog.json} charge par {@link ./annotationIntegratedCatalog.ts}.
 */

import * as THREE from 'three'
import JSZip from 'jszip'
import * as UTIF from 'utif'
import type { MutableRefObject } from 'react'
import { floorImageCornersWorldXYZ, parseFlexibleCsvRows } from '@shared/core/lib/etlSpatial'
import { spatialReferenceFromE57ArrayBuffer } from '@shared/core/lib/e57SpatialRef'
import type { FloorMapAsset } from '@shared/core/types/etlSpatial'
import {
  type AnnotationSpecFieldKey,
  type AnnCreationSpecForm,
  ANNOTATION_SPEC_FIELD_ORDER,
  ANNOTATION_SPEC_FIELD_LABELS,
  parseOptionalNonNegativeNumber,
  annotationHasSpecValue,
  annotationSpecEditorSlotsWithValues,
  emptyAnnCreationSpecForm,
  annCreationSpecFormFromBuiltinDefaults,
  buildAnnotationSpecPatchFromCreationForm,
  parseBuiltinSpecKeysFromRaw,
  parseBuiltinSpecDefaultsFromRaw,
  annotationBuiltinSpecLineParts,
  parseAnnotationSpecFromImportJsonRaw,
  parseAnnotationSpecFromCsvRow,
  creationSpecFormFromPartialDefaults,
  annotationToCreationSpecForm,
  ANNOTATION_SPEC_FIELD_BY_KEY,
} from './annotationSpec'
import type { AnnotationTemplateId, AnnotationTemplateDef } from './annotationIntegratedCatalog'
import {
  ANNOTATION_TEMPLATES,
  ANNOTATION_TEMPLATE_LIST,
  parseAnnotationTemplateId,
  isIntegratedTemplateOverrideId,
  INTEGRATED_SURFACE_AUTRE_VALUE,
  ETL360_MUR_MATIERE_PRESET_KEY,
  ETL360_MUR_MATIERE_AUTRE_KEY,
  ETL360_SOL_MATIERE_PRESET_KEY,
  ETL360_SOL_MATIERE_AUTRE_KEY,
  DEFAUT_MUR_MATIERE_CHOICES,
  SOL_MATIERE_CHOICES,
  SOL_TEMPLATE_CHECKBOX_FIELDS,
  matiereWidgetProfileFor,
  integratedSurfaceMatiereTemplateId,
  defaultIntegratedSurfaceMatiereCustom,
  parseSolTemplateCheckboxStored,
} from './annotationIntegratedCatalog'

export type { AnnotationTemplateId, AnnotationTemplateDef } from './annotationIntegratedCatalog'
export {
  ANNOTATION_TEMPLATES,
  ANNOTATION_TEMPLATE_LIST,
  parseAnnotationTemplateId,
  isIntegratedTemplateOverrideId,
  INTEGRATED_SURFACE_AUTRE_VALUE,
  ETL360_MUR_MATIERE_PRESET_KEY,
  ETL360_MUR_MATIERE_AUTRE_KEY,
  ETL360_SOL_MATIERE_PRESET_KEY,
  ETL360_SOL_MATIERE_AUTRE_KEY,
  DEFAUT_MUR_MATIERE_CHOICES,
  SOL_MATIERE_CHOICES,
  SOL_TEMPLATE_CHECKBOX_FIELDS,
  matiereWidgetProfileFor,
  integratedSurfaceMatiereTemplateId,
  defaultIntegratedSurfaceMatiereCustom,
  parseSolTemplateCheckboxStored,
}

const ETL360_DEBUG_INGEST_PATH = '/__debug-ingest/546eb8'
const ETL360_VITE_DEV_PORT = 5173

/** POST vers le middleware Vite (même dossier que vite.config.ts) ; en dev cross-port, vise explicitement le port Vite. */
export function etl360PostDebugIngest(payload: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  const dev = import.meta.env.DEV
  const port = window.location.port
  const urls = new Set<string>()
  urls.add(ETL360_DEBUG_INGEST_PATH)
  if (dev) {
    urls.add(`${window.location.origin}${ETL360_DEBUG_INGEST_PATH}`)
    if (port !== String(ETL360_VITE_DEV_PORT)) {
      urls.add(`http://localhost:${ETL360_VITE_DEV_PORT}${ETL360_DEBUG_INGEST_PATH}`)
    }
  }
  for (const url of urls) {
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '546eb8' },
      body: JSON.stringify(payload),
    }).catch(() => {})
  }
}

export type { AnnotationSpecFieldKey, AnnCreationSpecForm } from './annotationSpec'
export {
  ANNOTATION_SPEC_FIELD_ORDER,
  ANNOTATION_SPEC_FIELD_LABELS,
  ANNOTATION_SPEC_FIELD_BY_KEY,
  parseOptionalNonNegativeNumber,
  annotationHasSpecValue,
  emptyAnnCreationSpecForm,
  annCreationSpecFormFromBuiltinDefaults,
  creationSpecFormFromPartialDefaults,
  annotationToCreationSpecForm,
  buildAnnotationSpecPatchFromCreationForm,
  parseBuiltinSpecKeysFromRaw,
  parseBuiltinSpecDefaultsFromRaw,
} from './annotationSpec'

/** Schémas et préfixe de nom de fichier pour les annotations par panorama (export / import). */
export const ETL360_ANNOTATIONS_SCHEMA_V1 = 'rapportoa-etl-viewer360-annotations/v1' as const
export const ETL360_ANNOTATIONS_SCHEMA_V2 = 'rapportoa-etl-viewer360-annotations/v2' as const
export const ETL360_ANNOTATIONS_SCHEMA_V3 = 'rapportoa-etl-viewer360-annotations/v3' as const
export const ETL360_ANNOTATIONS_SCHEMA_V4 = 'rapportoa-etl-viewer360-annotations/v4' as const
export const ETL360_ANNOTATIONS_SCHEMA = ETL360_ANNOTATIONS_SCHEMA_V4
export const ETL360_ANNOTATIONS_FILE_PREFIX = 'etl360.annotations' as const
/**
 * Plafond du 1er passage (reservoir sur le texte XYZ) : limite mémoire / temps de parse.
 * Un 2e sous-échantillonnage ramène au nombre cible selon la taille du nuage source.
 */
export const ETL360_E57_RESERVOIR_CAP = 400_000
/**
 * Décalage longitudinal appliqué à la texture pano dans le viewer Three.js.
 * 0.25 = 90° (compensation d'orientation d'encodage sur la sphère du viewer).
 */
const PANO_TEXTURE_U_OFFSET = 0.25

/**
 * Conversion yaw/pitch -> UV équirectangulaire telle qu'affichée par le viewer sphérique.
 * Important: la sphère est inversée sur X (geometry.scale(-1,1,1)) puis la texture est décalée de +0.25 en U.
 * La relation finale est donc u = (0.25 - yaw/(2π)) + 0.25 = 0.5 - yaw/(2π).
 */
function panoViewerYawPitchToTextureUv(yaw: number, pitch: number): { u: number; v: number } {
  const uu = 0.5 - yaw / (2 * Math.PI)
  const vv = 0.5 - pitch / Math.PI
  return { u: ((uu % 1) + 1) % 1, v: THREE.MathUtils.clamp(vv, 0, 0.999999) }
}

export type Vec3 = { x: number; y: number; z: number }
export type Quaternion = { x: number; y: number; z: number; w: number }
export type YawPitch = { yaw: number; pitch: number }
export type AnnotationKind = 'point' | 'zone' | 'text'
export type AnnotationTextTone = 'black' | 'lightGray'
export type AnnotationZone = { yawSpan: number; pitchSpan: number }
export type AnnotationOrigin =
  | 'terrain_observation'
  | 'added_annotation'
  | 'ai_detection'
  /** Annotation créée depuis le mode client (remarque terrain côté client). */
  | 'client_remark'
export type ZoneHandleMode =
  | 'move'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
export type ZoneBounds = { leftYaw: number; rightYaw: number; topPitch: number; bottomPitch: number }

export type PanoRecord = {
  id: string
  filename: string
  /** Libellé affiché / renommable par l'utilisateur (sinon `filename`). */
  displayLabel?: string
  /** Couleur d’identification (#rrggbb) : liste panoramas, carte, nuage E57, poses 3D. */
  viewerColor?: string
  /** Libellé d'étage assigné côté UI (ex. N1), utilisé pour les marqueurs voisins. */
  floorLabel?: string
  /** Rang d'étage croissant (bas -> haut), utilisé pour choisir ▼ / ● / ▲. */
  floorOrder?: number
  imageUrl: string
  imageExists: boolean
  /**
   * Échec du téléchargement paresseux (Azure) : évite l’overlay « en cours » infini.
   * Effacer (réessai) en remettant à false.
   */
  imageBlobLoadFailed?: boolean
  /** Chemin blob de l'image sur Azure (pour le chargement paresseux depuis l'index viewer). */
  blobPath?: string
  position: Vec3
  orientation: Quaternion
  /** Correction locale d’affichage : inversion horizontale du repère pano (hors ZIP). */
  viewFlipX?: boolean
  /** Correction locale d’affichage : inversion verticale du repère pano (hors ZIP). */
  viewFlipY?: boolean
  /**
   * Comparaison avant / autre prise : référence un autre `PanoRecord` du même projet
   * (défini sur le panorama « principal / avant », le second est `otherPanoId`).
   */
  comparePair?: PanoComparePair
}

/**
 * Lien entre deux `PanoRecord` pour l’affichage « avant / après ».
 */
export type PanoComparePair = {
  /** Id de l’autre panorama (même site, autre prise de vue). */
  otherPanoId: string
  /** Libellé du panneau côté ce panorama. Défaut : « Avant ». */
  labelBefore?: string
  /** Libellé du panneau côté `otherPanoId`. Défaut : « Après ». */
  labelAfter?: string
  extra?: Record<string, unknown>
}

/** Statut de la remarque client liée à une annotation (workflow lecture / validation). */
export type AnnotationClientRemarkStatus = 'non-lu' | 'lu' | 'confirmé'

export type AnnotationClientRemark = {
  text: string
  status: AnnotationClientRemarkStatus
  /** ISO 8601 — dernière mise à jour de la remarque. */
  updatedAt?: string
}

export function parseAnnotationClientRemarkStatus(value: unknown): AnnotationClientRemarkStatus {
  const s = String(value ?? 'non-lu')
    .trim()
    .toLowerCase()
  if (s === 'lu' || s === 'read' || s === 'lue') return 'lu'
  if (s === 'confirmé' || s === 'confirme' || s === 'confirmed' || s === 'valide' || s === 'validé') return 'confirmé'
  return 'non-lu'
}

function parseClientRemarkFromImport(raw: unknown): { clientRemark?: AnnotationClientRemark } {
  const r = raw as { clientRemark?: unknown; client_remark?: unknown }
  const cr = r?.clientRemark ?? r?.client_remark
  if (!cr || typeof cr !== 'object') return {}
  const o = cr as Record<string, unknown>
  const text = String(o.text ?? '').trim()
  const status = parseAnnotationClientRemarkStatus(o.status ?? o.statut)
  const updatedAt = parseOptionalTrimmedString(o.updatedAt ?? o.updated_at)
  return {
    clientRemark: {
      text,
      status,
      ...(updatedAt ? { updatedAt } : {}),
    },
  }
}

export type AnnotationRecord = {
  id: string
  panoId: string
  label: string
  identifier?: string
  description?: string
  /** Couleur du marqueur sur le panorama (#rrggbb). Absent = couleur par défaut. */
  color?: string
  yawPitch: YawPitch
  kind?: AnnotationKind
  zone?: AnnotationZone
  /** Texte affiché dans la zone (annotations textuelles uniquement). */
  textContent?: string
  /** Taille du texte en px écran (annotations textuelles uniquement). */
  textSizePx?: number
  /** Palette texte limitée pour la lisibilité sur panorama. */
  textTone?: AnnotationTextTone
  /** Projection 3D de l annotation dans le nuage de points, si resolue par raycast. */
  pointCloudTarget?: Vec3
  /** Si vrai, conserve la cible nuage définie manuellement (ex. repositionnement sur plan). */
  pointCloudTargetLocked?: boolean
  positionLocked?: boolean
  /** Gabarit (lampe, prise, alarme…) : couleur du type + caractéristiques proposées. */
  templateId?: AnnotationTemplateId
  /** Origine métier de l'annotation (indépendante du gabarit). */
  origin?: AnnotationOrigin
  /** Gabarit utilisateur (id stable, défini localement). */
  userTemplateId?: string
  /** Valeurs des caractéristiques libres du gabarit utilisateur (clé = id technique). */
  customTemplateValues?: Record<string, string>
  /** Durée de vie (texte libre, ex. 50 000 h, 5 ans). */
  lifespan?: string
  /** Consommation électrique (texte libre, ex. 12 W, 8 kWh/an). */
  electricConsumption?: string
  /** Production lumineuse (éclairement en lux). */
  lightOutputLux?: number
  /** Matière / composition. */
  material?: string
  /** Poids en kilogrammes. */
  weightKg?: number
  /** Prix d'achat (nombre, devise non stockée). */
  purchasePrice?: number
  /** Longueur de fissure (cm). */
  crackLengthCm?: number
  /** Largeur de fissure (cm). */
  crackWidthCm?: number
  /**
   * Opacité du remplissage coloré du rectangle zone sur le panorama (0–1, typ. 0,04–0,5).
   * Uniquement pour `kind` « zone » (remplissage) ; pour « texte » sert surtout aux vignettes / export.
   */
  zoneFillOpacity?: number
  /** Remarque client (mode client / suivi hors chantier). */
  clientRemark?: AnnotationClientRemark
}

/** Listes déroulantes : fond sombre + color-scheme pour éviter texte clair sur fond clair (ex. Windows). */
export const ETL360_SELECT_BASE =
  'rounded-lg border border-white/20 bg-slate-950 text-gray-100 shadow-sm [color-scheme:dark] [&>option]:bg-slate-900 [&>option]:text-gray-100'

export const ETL360_DEFAULT_ZONE_OVERLAY_FILL_OPACITY = 20 / 255

/** Borne l’opacité de remplissage des zones (fraction 0–1). */
export function clampZoneFillOpacity(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return ETL360_DEFAULT_ZONE_OVERLAY_FILL_OPACITY
  return Math.min(0.5, Math.max(0.04, n))
}

/** Opacité à appliquer pour une annotation avec zone (zone ou texte). */
export function annotationZoneFillOpacityForRender(ann: AnnotationRecord): number {
  const k = annotationKind(ann)
  if ((k !== 'zone' && k !== 'text') || !ann.zone) return ETL360_DEFAULT_ZONE_OVERLAY_FILL_OPACITY
  return clampZoneFillOpacity(ann.zoneFillOpacity)
}

/** Opacité 0–1 → octet alpha hex (2 caractères) pour suffixe #RRGGBBAA. */
export function annotationZoneFillOpacityToHexByte(opacity: number): string {
  const a = Math.min(255, Math.max(0, Math.round(Number(opacity) * 255)))
  return a.toString(16).padStart(2, '0')
}

export function formatIntegratedSurfaceMatierePart(ann: AnnotationRecord): string | undefined {
  const p = ann.templateId ? matiereWidgetProfileFor(ann.templateId) : undefined
  if (!p) return undefined
  const cv = ann.customTemplateValues ?? {}
  const preset = String(cv[p.presetKey] ?? '').trim()
  const autre = String(cv[p.autreKey] ?? '').trim()
  const labelFor = (val: string) => p.choices.find(c => c.value === val)?.label
  const linePrefix = (p.detailLineLabel ?? 'Matière').trim() || 'Matière'
  if (preset === INTEGRATED_SURFACE_AUTRE_VALUE) {
    return autre ? `${linePrefix}: ${autre}` : undefined
  }
  if (preset) {
    const lab = labelFor(preset) ?? preset
    return `${linePrefix}: ${lab}`
  }
  if (autre) return `${linePrefix}: ${autre}`
  return undefined
}

/** Cases optionnelles liées au profil « matière » (ex. signalement sol). */
export function formatMatiereWidgetCheckboxLine(ann: AnnotationRecord): string | undefined {
  const p = matiereWidgetProfileFor(ann.templateId)
  const fields = p?.checkboxFields
  if (!p || !fields?.length) return undefined
  const cv = ann.customTemplateValues ?? {}
  const labels: string[] = []
  for (const { key, label } of fields) {
    if (parseSolTemplateCheckboxStored(cv[key])) labels.push(label)
  }
  if (!labels.length) return undefined
  const prefix = (p.checkboxLinePrefix ?? 'Signalement').trim() || 'Signalement'
  return `${prefix}: ${labels.join(', ')}`
}

/** @deprecated Préférer {@link formatMatiereWidgetCheckboxLine}. */
export function formatSolTemplateCheckboxLine(ann: AnnotationRecord): string | undefined {
  return formatMatiereWidgetCheckboxLine(ann)
}

/** Entrée utilisateur qui surcharge un gabarit prédéfini (si présente dans `userTemplates`). */
export function integratedTemplateOverride(
  id: AnnotationTemplateId,
  userTemplates: UserAnnotationTemplate[]
): UserAnnotationTemplate | undefined {
  const t = userTemplates.find(u => u.id === id)
  return t && isIntegratedTemplateOverrideId(t.id) ? t : undefined
}

export type UserAnnotationTemplateCharacteristic = {
  key: string
  label: string
  defaultValue: string
}

export type UserAnnotationTemplate = {
  id: string
  name: string
  color: string
  characteristics: UserAnnotationTemplateCharacteristic[]
  /** Champs techniques partagés avec les gabarits intégrés (durée de vie, matière, etc.). */
  builtinSpecKeys?: AnnotationSpecFieldKey[]
  /** Valeurs par défaut pour les champs standard (chaînes ; lux / kg / prix parsés à l’enregistrement). */
  builtinSpecDefaults?: Partial<Record<AnnotationSpecFieldKey, string>>
  /** Si vrai, les nouvelles annotations créées avec ce gabarit ont la position verrouillée par défaut. */
  positionLockedDefault?: boolean
}

export const ETL360_USER_TEMPLATES_SCHEMA = 'etl360.userTemplates.v1' as const

export function userTemplatesStorageKey(projectCode: string): string {
  return `etl360.userTemplates.v1:${projectCode.trim() || 'local'}`
}

export const ETL360_PANO_VIEW_AXIS_FLIPS_SCHEMA = 'etl360.panoViewAxisFlips.v1' as const

export function panoViewAxisFlipsStorageKey(projectCode: string): string {
  return `${ETL360_PANO_VIEW_AXIS_FLIPS_SCHEMA}:${projectCode.trim() || 'local'}`
}

export type PanoViewAxisFlipsRow = { flipX: boolean; flipY: boolean }

export type FloorPlanReplacementMode = 'drawn' | 'imported'
export type FloorPlanReplacementAnchorPair = {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
}
export type FloorPlanReplacementRecord = {
  floorLabel: string
  mode: FloorPlanReplacementMode
  imageDataUrl: string
  updatedAt: string
  /**
   * Dimensions en pixels de `imageDataUrl` au moment de l’enregistrement (pour recaler
   * `worldToPixel` du GeoTIFF d’origine sur le bitmap affiché).
   */
  replacedPixelWidth?: number
  replacedPixelHeight?: number
  /**
   * Décalage (px) du coin haut-gauche du plan par rapport au coin du fichier exporté, lorsque
   * l’import a été rogné (bords haut / gauche / bas / droit) : nécessite de translater m02, m12.
   */
  replacedContentInsetLeftPx?: number
  replacedContentInsetTopPx?: number
  anchorPairs?: FloorPlanReplacementAnchorPair[]
  /** Mode tracé: SVG vectoriel final (data URL). */
  drawSvgDataUrl?: string
  /** Mode tracé: scène Fabric sérialisée pour reprise d’édition. */
  drawSceneJson?: string
  /** Mode tracé: couleur d’outil mémorisée pour reprise ultérieure. */
  drawStrokeColor?: string
  /** Mode tracé: épaisseur d’outil mémorisée pour reprise ultérieure. */
  drawStrokeWidth?: number
}

export const ETL360_FLOOR_PLAN_REPLACEMENTS_SCHEMA = 'etl360.floorPlanReplacements.v1' as const

export function floorPlanReplacementsStorageKey(projectCode: string): string {
  return `${ETL360_FLOOR_PLAN_REPLACEMENTS_SCHEMA}:${projectCode.trim() || 'local'}`
}

export function parseFloorPlanReplacementsFromStorage(raw: string | null): Record<string, FloorPlanReplacementRecord> {
  try {
    const o = JSON.parse(raw || '{}') as {
      schema?: string
      replacements?: Record<
        string,
        {
          floorLabel?: unknown
          mode?: unknown
          imageDataUrl?: unknown
          updatedAt?: unknown
          replacedPixelWidth?: unknown
          replacedPixelHeight?: unknown
          replacedContentInsetLeftPx?: unknown
          replacedContentInsetTopPx?: unknown
          anchorPairs?: Array<Record<string, unknown>>
          drawSvgDataUrl?: unknown
          drawSceneJson?: unknown
          drawStrokeColor?: unknown
          drawStrokeWidth?: unknown
        }
      >
    }
    if (o?.schema !== ETL360_FLOOR_PLAN_REPLACEMENTS_SCHEMA || !o.replacements || typeof o.replacements !== 'object') {
      return {}
    }
    const out: Record<string, FloorPlanReplacementRecord> = {}
    for (const [key, rec] of Object.entries(o.replacements)) {
      const floorLabel = String(rec?.floorLabel ?? key ?? '').trim()
      if (!floorLabel) continue
      const modeRaw = String(rec?.mode ?? '').trim().toLowerCase()
      const mode: FloorPlanReplacementMode = modeRaw === 'drawn' ? 'drawn' : modeRaw === 'imported' ? 'imported' : 'imported'
      const imageDataUrl = String(rec?.imageDataUrl ?? '').trim()
      if (!imageDataUrl) continue
      const updatedAt = String(rec?.updatedAt ?? new Date().toISOString())
      const rawPairs = Array.isArray(rec?.anchorPairs) ? rec!.anchorPairs : []
      const anchorPairs: FloorPlanReplacementAnchorPair[] = rawPairs
        .map(p => ({
          sourceX: Number((p as any).sourceX),
          sourceY: Number((p as any).sourceY),
          targetX: Number((p as any).targetX),
          targetY: Number((p as any).targetY),
        }))
        .filter(
          p =>
            Number.isFinite(p.sourceX) &&
            Number.isFinite(p.sourceY) &&
            Number.isFinite(p.targetX) &&
            Number.isFinite(p.targetY)
        )
      out[floorLabel] = {
        floorLabel,
        mode,
        imageDataUrl,
        updatedAt,
        ...(anchorPairs.length > 0 ? { anchorPairs } : {}),
        ...(typeof rec?.drawSvgDataUrl === 'string' && rec.drawSvgDataUrl.trim()
          ? { drawSvgDataUrl: rec.drawSvgDataUrl.trim() }
          : {}),
        ...(typeof rec?.drawSceneJson === 'string' && rec.drawSceneJson.trim()
          ? { drawSceneJson: rec.drawSceneJson }
          : {}),
        ...(typeof rec?.drawStrokeColor === 'string' && rec.drawStrokeColor.trim()
          ? { drawStrokeColor: rec.drawStrokeColor.trim() }
          : {}),
        ...(Number.isFinite(Number(rec?.drawStrokeWidth))
          ? { drawStrokeWidth: Math.max(1, Math.min(50, Number(rec?.drawStrokeWidth))) }
          : {}),
        ...(Number.isFinite(Number(rec?.replacedPixelWidth)) && Number(rec.replacedPixelWidth! as number) >= 1
          ? { replacedPixelWidth: Math.floor(Number(rec.replacedPixelWidth)) }
          : {}),
        ...(Number.isFinite(Number(rec?.replacedPixelHeight)) && Number(rec.replacedPixelHeight! as number) >= 1
          ? { replacedPixelHeight: Math.floor(Number(rec.replacedPixelHeight)) }
          : {}),
        ...(Number.isFinite(Number(rec?.replacedContentInsetLeftPx))
          ? { replacedContentInsetLeftPx: Number(rec.replacedContentInsetLeftPx) }
          : {}),
        ...(Number.isFinite(Number(rec?.replacedContentInsetTopPx))
          ? { replacedContentInsetTopPx: Number(rec.replacedContentInsetTopPx) }
          : {}),
      }
    }
    return out
  } catch {
    return {}
  }
}

export function serializeFloorPlanReplacementsToStorage(
  replacements: Record<string, FloorPlanReplacementRecord>
): string {
  return JSON.stringify({ schema: ETL360_FLOOR_PLAN_REPLACEMENTS_SCHEMA, replacements }, null, 0)
}

// ─── Low-cost mode: authoring state ───────────────────────────────────────────

export type LowCostPanoEntry = {
  id: string
  filename: string
  displayLabel?: string
  viewerColor?: string
  imageDataUrl: string
  /**
   * Repère **source** identique à `PanoRecord.position` : **X, Y** = coordonnées horizontales du
   * plan (même couple que `pixelToWorldXY` / GeoTIFF), **Z** = altitude d’étage.
   * (Avant v2 le stockage local mélangeait Y/Z — migration au chargement.)
   */
  positionWorld: Vec3
  /** Orientation as Euler yaw (radians around Y, 0 = north). */
  orientationYawRad: number
  assignedFloorLabel: string
}

export type LowCostFloorVisualMode = 'blank' | 'drawn' | 'imported' | 'cloud-slice'

export type LowCostProjectState = {
  floorCount: number
  sliceCenters: number[]
  panos: LowCostPanoEntry[]
  /** Statut du visuel par étage (clé = label `N1`, `N2`...). Optionnel pour migration douce. */
  floorVisuals?: Record<string, LowCostFloorVisualMode>
  /** Indicateur informatif : un nuage de points a-t-il été chargé pour ce projet ? */
  hasCloud?: boolean
}

/** Clé `localStorage` (ne pas renommer : conserver les projets déjà enregistrés). */
export const ETL360_LOWCOST_PROJECT_STORAGE_KEY = 'etl360.lowcost.v1' as const
/** Contenu JSON : v1 mélangeait altitude (Y) et 2ᵉ horizontal (Z) — lire avec migration. */
export const ETL360_LOWCOST_SCHEMA_V1 = 'etl360.lowcost.v1' as const
export const ETL360_LOWCOST_SCHEMA = 'etl360.lowcost.v2' as const
const ETL360_LOWCOST_MODE_SCHEMA = 'etl360.lowcostMode.v1' as const

export function lowCostModeStorageKey(projectCode: string): string {
  return `${ETL360_LOWCOST_MODE_SCHEMA}:${projectCode.trim() || 'local'}`
}

export function lowCostProjectStorageKey(projectCode: string): string {
  return `${ETL360_LOWCOST_PROJECT_STORAGE_KEY}:${projectCode.trim() || 'local'}`
}

export function loadLowCostModeFromStorage(projectCode: string): boolean {
  try {
    return localStorage.getItem(lowCostModeStorageKey(projectCode)) === '1'
  } catch {
    return false
  }
}

export function saveLowCostModeToStorage(projectCode: string, enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(lowCostModeStorageKey(projectCode), '1')
    else localStorage.removeItem(lowCostModeStorageKey(projectCode))
  } catch { /* quota */ }
}

function migrateLowCostPanoV1YAltSwapZHorizontalToSourceConvention(entry: LowCostPanoEntry): LowCostPanoEntry {
  const w = entry.positionWorld
  return {
    ...entry,
    positionWorld: { x: w.x, y: w.z, z: w.y },
  }
}

export function parseLowCostProjectFromStorage(projectCode: string): LowCostProjectState | null {
  try {
    const raw = localStorage.getItem(lowCostProjectStorageKey(projectCode))
    if (!raw) return null
    const o = JSON.parse(raw) as { schema?: string; state?: LowCostProjectState }
    if (!o.state) return null
    const fileSchema = o.schema
    const needsV1Migration =
      fileSchema == null || fileSchema === ETL360_LOWCOST_SCHEMA_V1 || fileSchema === ''
    if (!needsV1Migration && fileSchema !== ETL360_LOWCOST_SCHEMA) return null
    const s = o.state
    const floorVisualsRaw = (s as { floorVisuals?: unknown }).floorVisuals
    let floorVisuals: Record<string, LowCostFloorVisualMode> | undefined
    if (floorVisualsRaw && typeof floorVisualsRaw === 'object') {
      floorVisuals = {}
      for (const [k, v] of Object.entries(floorVisualsRaw as Record<string, unknown>)) {
        if (v === 'blank' || v === 'drawn' || v === 'imported' || v === 'cloud-slice') {
          floorVisuals[k] = v
        }
      }
    }
    const panos: LowCostPanoEntry[] = Array.isArray(s.panos)
      ? s.panos
          .filter((p: unknown) => p && typeof p === 'object' && typeof (p as LowCostPanoEntry).id === 'string')
          .map((p: unknown) => {
            const pe = p as Record<string, unknown>
            const pos = pe.positionWorld as Record<string, unknown> | undefined
            return {
              id: String(pe.id),
              filename: String(pe.filename ?? ''),
              displayLabel: pe.displayLabel ? String(pe.displayLabel) : undefined,
              viewerColor: pe.viewerColor ? String(pe.viewerColor) : undefined,
              imageDataUrl: String(pe.imageDataUrl ?? ''),
              positionWorld: {
                x: Number(pos?.x ?? 0),
                y: Number(pos?.y ?? 0),
                z: Number(pos?.z ?? 0),
              },
              orientationYawRad: Number(pe.orientationYawRad ?? 0),
              assignedFloorLabel: String(pe.assignedFloorLabel ?? ''),
            }
          })
      : []
    return {
      floorCount: Math.max(0, Math.round(Number(s.floorCount) || 0)),
      sliceCenters: Array.isArray(s.sliceCenters) ? s.sliceCenters.filter(v => Number.isFinite(v)).map(Number) : [],
      panos: needsV1Migration ? panos.map(migrateLowCostPanoV1YAltSwapZHorizontalToSourceConvention) : panos,
      floorVisuals,
      hasCloud: typeof (s as { hasCloud?: unknown }).hasCloud === 'boolean'
        ? Boolean((s as { hasCloud?: unknown }).hasCloud)
        : undefined,
    }
  } catch {
    return null
  }
}

export function serializeLowCostProjectToStorage(state: LowCostProjectState): string {
  return JSON.stringify({ schema: ETL360_LOWCOST_SCHEMA, state }, null, 0)
}

/** Convert low-cost yaw to the quaternion expected by PanoRecord.orientation. */
export function lowCostYawToQuaternion(yawRad: number): Quaternion {
  const half = yawRad / 2
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }
}

/** Convert a low-cost pano entry to a standard PanoRecord. */
export function lowCostPanoToRecord(entry: LowCostPanoEntry): PanoRecord {
  return {
    id: entry.id,
    filename: entry.filename,
    displayLabel: entry.displayLabel,
    viewerColor: entry.viewerColor,
    imageUrl: entry.imageDataUrl,
    imageExists: !!entry.imageDataUrl,
    position: { ...entry.positionWorld },
    orientation: lowCostYawToQuaternion(entry.orientationYawRad),
  }
}

// ─── End low-cost mode ────────────────────────────────────────────────────────

export function parsePanoViewAxisFlipsFromStorage(raw: string | null): Record<string, PanoViewAxisFlipsRow> {
  try {
    const o = JSON.parse(raw || '{}') as {
      schema?: string
      flips?: Record<string, { flipX?: unknown; flipY?: unknown }>
    }
    if (o?.schema !== ETL360_PANO_VIEW_AXIS_FLIPS_SCHEMA || !o.flips || typeof o.flips !== 'object') return {}
    const out: Record<string, PanoViewAxisFlipsRow> = {}
    for (const [k, v] of Object.entries(o.flips)) {
      const id = k.trim()
      if (!id) continue
      out[id] = { flipX: Boolean(v?.flipX), flipY: Boolean(v?.flipY) }
    }
    return out
  } catch {
    return {}
  }
}

export function serializePanoViewAxisFlipsToStorage(
  flips: Record<string, PanoViewAxisFlipsRow>
): string {
  return JSON.stringify({ schema: ETL360_PANO_VIEW_AXIS_FLIPS_SCHEMA, flips }, null, 0)
}

/** Historique des gabarits choisis (clés `t:…` / `u:…`) pour remonter les plus récents dans les listes. */
export const ETL360_RECENT_TEMPLATE_CHOICES_SCHEMA = 'etl360.recentTemplateChoices.v1' as const

export function recentTemplateChoicesStorageKey(projectCode: string): string {
  return `${ETL360_RECENT_TEMPLATE_CHOICES_SCHEMA}:${projectCode.trim() || 'local'}`
}

export function parseRecentTemplateChoicesJson(raw: string | null, maxLen = 40): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    const out: string[] = []
    for (const x of v) {
      const s = String(x).trim()
      if (!s) continue
      out.push(s)
      if (out.length >= maxLen) break
    }
    return out
  } catch {
    return []
  }
}

export function bumpRecentTemplateChoices(prev: string[], pick: string, maxLen = 40): string[] {
  const p = pick.trim()
  if (!p) return prev
  const without = prev.filter(x => x !== p)
  without.unshift(p)
  return without.slice(0, maxLen)
}

export function normalizeTemplatePickerSearch(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function templatePickerRowMatchesSearch(label: string, key: string, query: string): boolean {
  const q = normalizeTemplatePickerSearch(query)
  if (!q) return true
  const blob = `${normalizeTemplatePickerSearch(label)} ${normalizeTemplatePickerSearch(key)}`
  return blob.includes(q)
}

/** Valeur de liste déroulante unifiée : `t:id` intégré, `u:id` perso, ou chaîne vide. */
export function templatePickerKeyFromParts(
  templateId: AnnotationTemplateId | '' | undefined,
  userTemplateId: string | '' | undefined
): string {
  const ut = String(userTemplateId ?? '').trim()
  if (ut) return `u:${ut}`
  const tid = templateId ? String(templateId).trim() : ''
  if (tid) return `t:${tid}`
  return ''
}

export function parseCustomTemplateValues(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k).trim()
    if (!key) continue
    out[key] = String(v ?? '').trim()
  }
  return Object.keys(out).length ? out : undefined
}

export function buildCharacteristicsWithKeys(
  rows: Array<{ label: string; defaultValue: string }>
): UserAnnotationTemplateCharacteristic[] {
  return buildCharacteristicsFromEditorRows(rows.map(r => ({ label: r.label, defaultValue: r.defaultValue })))
}

/** Édition : conserve les clés existantes ; nouvelles lignes sans clé en reçoivent une dérivée du libellé. */
export function buildCharacteristicsFromEditorRows(
  rows: Array<{ key?: string; label: string; defaultValue: string }>
): UserAnnotationTemplateCharacteristic[] {
  const used = new Set<string>()
  const out: UserAnnotationTemplateCharacteristic[] = []
  for (const r of rows) {
    const label = r.label.trim()
    if (!label) continue
    let k = r.key?.trim()
    if (k && used.has(k)) k = undefined
    if (!k) {
      let base = label
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
      if (!base) base = `champ_${out.length + 1}`
      let candidate = base
      let n = 0
      while (used.has(candidate)) {
        n += 1
        candidate = `${base}_${n}`
      }
      k = candidate
    }
    used.add(k)
    out.push({ key: k, label, defaultValue: r.defaultValue.trim() })
  }
  return out
}

export function compactStringRecord(r: Record<string, string>): Record<string, string> | undefined {
  const o: Record<string, string> = {}
  for (const [k, v] of Object.entries(r)) {
    const t = String(v).trim()
    if (t) o[k] = t
  }
  return Object.keys(o).length ? o : undefined
}

export function userTemplateDefaultsRecord(t: UserAnnotationTemplate): Record<string, string> {
  const o: Record<string, string> = {}
  for (const c of t.characteristics) o[c.key] = c.defaultValue
  return o
}

export function parseUserTemplatesFromStorage(json: string): UserAnnotationTemplate[] {
  try {
    const raw = JSON.parse(json)
    if (raw?.schema !== ETL360_USER_TEMPLATES_SCHEMA || !Array.isArray(raw?.templates)) return []
    return (raw.templates as unknown[])
      .map((t: any) => {
        const id = String(t?.id ?? '').trim()
        const name = String(t?.name ?? '').trim()
        const color = tryParseAnnotationColorHex(t?.color)
        const ch = Array.isArray(t?.characteristics) ? t.characteristics : []
        const characteristics: UserAnnotationTemplateCharacteristic[] = ch
          .map((c: any) => ({
            key: String(c?.key ?? '').trim(),
            label: String(c?.label ?? '').trim(),
            defaultValue: String(c?.defaultValue ?? '').trim(),
          }))
          .filter((c: UserAnnotationTemplateCharacteristic) => c.key && c.label)
        const builtinSpecKeys = parseBuiltinSpecKeysFromRaw(t?.builtinSpecKeys)
        const builtinSpecDefaults = parseBuiltinSpecDefaultsFromRaw(t?.builtinSpecDefaults, builtinSpecKeys)
        const positionLockedDefault = t?.positionLockedDefault === true
        const hasCustom = characteristics.length > 0
        const hasBuiltin = builtinSpecKeys.length > 0
        if (!id || !name || !color || (!hasCustom && !hasBuiltin)) return null
        return {
          id,
          name,
          color,
          characteristics,
          ...(hasBuiltin ? { builtinSpecKeys } : {}),
          ...(builtinSpecDefaults ? { builtinSpecDefaults } : {}),
          ...(positionLockedDefault ? { positionLockedDefault: true } : {}),
        }
      })
      .filter(Boolean) as UserAnnotationTemplate[]
  } catch {
    return []
  }
}

export function resolvedTemplateLabel(ann: AnnotationRecord, userTemplates: UserAnnotationTemplate[]): string | null {
  if (ann.templateId && ANNOTATION_TEMPLATES[ann.templateId]) {
    return effectiveIntegratedTemplateDef(ann.templateId, userTemplates).label
  }
  if (ann.userTemplateId) {
    const u = userTemplates.find(t => t.id === ann.userTemplateId)
    return u?.name ?? null
  }
  return null
}

export function annotationTemplateLabel(id: AnnotationTemplateId | undefined): string | null {
  if (!id || !ANNOTATION_TEMPLATES[id]) return null
  return ANNOTATION_TEMPLATES[id].label
}

/** Champs affichés : union des champs du gabarit et des champs déjà renseignés. */
export function annotationSpecSlotsFromRecord(
  ann: AnnotationRecord,
  userTemplates?: UserAnnotationTemplate[]
): AnnotationSpecFieldKey[] {
  const withValues = ANNOTATION_SPEC_FIELD_ORDER.filter(k => annotationHasSpecValue(ann, k))
  const fromIntegratedTemplate =
    ann.templateId && ANNOTATION_TEMPLATES[ann.templateId]
      ? effectiveIntegratedTemplateDef(ann.templateId, userTemplates ?? []).specKeys
      : []
  let fromUserTemplate: AnnotationSpecFieldKey[] = []
  if (ann.userTemplateId && userTemplates?.length) {
    const u = userTemplates.find(t => t.id === ann.userTemplateId)
    fromUserTemplate = u?.builtinSpecKeys ?? []
  }
  const merged = new Set<AnnotationSpecFieldKey>([
    ...fromIntegratedTemplate,
    ...fromUserTemplate,
    ...withValues,
  ])
  return ANNOTATION_SPEC_FIELD_ORDER.filter(k => merged.has(k))
}

export type E57ParseResult = {
  positions: Float32Array
  sourcePointCount: number
  displayedPointCount: number
  bounds: {
    minX: number
    minY: number
    minZ: number
    maxX: number
    maxY: number
    maxZ: number
  }
}

export type E57ViewerStats = {
  fileName: string
  sourcePointCount: number
  displayedPointCount: number
  /** SCR déclaré pour les coordonnées du nuage (manifest E57). */
  spatialReference?: string
}

export type E57PointCloudChunkMeta = {
  id: string
  file: string
  pointCount: number
  byteLength: number
}

/** Ordre des 3 flottants par point dans chaque .bin avant passage au repère monde XYZ du viewer. */
export const ETL360_CHUNK_AXES_ORDERS = ['xyz', 'yxz', 'xzy', 'zyx', 'zxy', 'yzx'] as const
export type ETL360ChunkAxesOrder = (typeof ETL360_CHUNK_AXES_ORDERS)[number]

export type E57PointCloudManifest = {
  version: number | string
  format: string
  sourcePointCount: number
  displayedPointCount: number
  bounds: E57ParseResult['bounds']
  chunks: E57PointCloudChunkMeta[]
  pointStrideFloats?: number
  createdAt?: string
  /** SCR des XYZ (ex. « EPSG:2169 ») — renseigné par le pipeline d export si disponible. */
  spatialReference?: string
  /** Code EPSG horizontal alternatif (entier). */
  epsg?: number
  /**
   * Décode les triplets float32 des chunks : pour chaque point stocké (a,b,c), on pose
   * monde X = a|b|c selon la permutation (ex. `yxz` → X=b, Y=a, Z=c). Absent = `xyz`.
   * Utile si un outil a regénéré un E57 depuis les .bin avec un mauvais ordre d axes.
   */
  chunkAxesOrder?: string
  /** Translation [dx,dy,dz] ajoutée après permutation (même unités que les points). */
  chunkTranslation?: readonly [number, number, number] | number[]
}

const CHUNK_AXES_SOURCE_INDEX: Record<ETL360ChunkAxesOrder, readonly [number, number, number]> = {
  xyz: [0, 1, 2],
  yxz: [1, 0, 2],
  xzy: [0, 2, 1],
  zyx: [2, 1, 0],
  zxy: [2, 0, 1],
  yzx: [1, 2, 0],
}

/**
 * Les exports E57 utilisés dans ce projet arrivent en pratique sous la forme X,Z,Y.
 * En absence d’indication explicite dans le manifest, on les remappe donc vers X,Y,Z.
 */
const ETL360_DEFAULT_RAW_E57_AXES_ORDER: ETL360ChunkAxesOrder = 'xyz'

export function parseChunkAxesOrderFromManifest(m: E57PointCloudManifest | null | undefined): ETL360ChunkAxesOrder {
  if (!m) return ETL360_DEFAULT_RAW_E57_AXES_ORDER
  const raw = (m as Record<string, unknown>).chunkAxesOrder
  const s =
    typeof raw === 'string' ? raw.trim().toLowerCase() : ETL360_DEFAULT_RAW_E57_AXES_ORDER
  if ((ETL360_CHUNK_AXES_ORDERS as readonly string[]).includes(s)) return s as ETL360ChunkAxesOrder
  return ETL360_DEFAULT_RAW_E57_AXES_ORDER
}

export function parseChunkTranslationFromManifest(m: E57PointCloudManifest | null | undefined): [
  number,
  number,
  number,
] {
  if (!m) return [0, 0, 0]
  const t = (m as Record<string, unknown>).chunkTranslation
  if (Array.isArray(t) && t.length >= 3) {
    const c = (x: unknown) => {
      const n = typeof x === 'number' ? x : Number(x)
      return Number.isFinite(n) ? n : 0
    }
    return [c(t[0]), c(t[1]), c(t[2])]
  }
  return [0, 0, 0]
}

/**
 * Repère monde attendu par le viewer : X,Y,Z après permutation + translation déclarées dans le manifest.
 */
export function decodeE57ChunkPositionsBuffer(
  rawPositions: Float32Array,
  manifest: E57PointCloudManifest
): Float32Array {
  const order = parseChunkAxesOrderFromManifest(manifest)
  const [tx, ty, tz] = parseChunkTranslationFromManifest(manifest)
  if (order === 'xyz' && tx === 0 && ty === 0 && tz === 0) {
    return rawPositions
  }
  const [ix, iy, iz] = CHUNK_AXES_SOURCE_INDEX[order]
  const out = new Float32Array(rawPositions.length)
  for (let i = 0; i + 2 < rawPositions.length; i += 3) {
    const a = rawPositions[i]
    const b = rawPositions[i + 1]
    const c = rawPositions[i + 2]
    const triplet = [a, b, c] as const
    out[i] = triplet[ix] + tx
    out[i + 1] = triplet[iy] + ty
    out[i + 2] = triplet[iz] + tz
  }
  return out
}

/** Couleur par défaut des marqueurs d’annotation sur le panorama (#rrggbb). */
export const ETL360_DEFAULT_ANNOTATION_COLOR = '#2563eb'

export function tryParseAnnotationColorHex(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined
  const s = String(input).trim()
  if (!s) return undefined
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const r = s[1]
    const g = s[2]
    const b = s[3]
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return undefined
}

/** Teinte distincte stable par indice (séquence dorée), lisible sur fond sombre. */
export function panoViewerColorHexForStableIndex(index: number): string {
  const h = (index * 0.618033988749895) % 1
  const c = new THREE.Color().setHSL(h, 0.68, 0.52)
  return `#${c.getHexString()}`
}

/**
 * Attribue `viewerColor` à chaque panorama (#rrggbb) : conserve une couleur CSV/JSON valide,
 * sinon couleur dérivée de l’ordre stable des `id`.
 */
export function ensurePanoViewerColors(panos: PanoRecord[]): PanoRecord[] {
  if (panos.length === 0) return panos
  const uniqueIds = Array.from(new Set(panos.map(p => p.id)))
  uniqueIds.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  const idToIndex = new Map(uniqueIds.map((id, i) => [id, i]))
  return panos.map(p => {
    const parsed = p.viewerColor ? tryParseAnnotationColorHex(p.viewerColor) : undefined
    if (parsed) return { ...p, viewerColor: parsed }
    const idx = idToIndex.get(p.id) ?? 0
    return { ...p, viewerColor: panoViewerColorHexForStableIndex(idx) }
  })
}

/** Définition effective (libellé, couleur, champs standard) : défaut applicatif + surcharge locale. */
export function effectiveIntegratedTemplateDef(
  id: AnnotationTemplateId,
  userTemplates: UserAnnotationTemplate[]
): AnnotationTemplateDef {
  const base = ANNOTATION_TEMPLATES[id]
  const ov = integratedTemplateOverride(id, userTemplates)
  const mergedBuiltinDefaults = (): Partial<Record<AnnotationSpecFieldKey, string>> | undefined => {
    const m: Partial<Record<AnnotationSpecFieldKey, string>> = {
      ...base.builtinSpecDefaults,
      ...ov?.builtinSpecDefaults,
    }
    return Object.keys(m).length ? m : undefined
  }
  if (!ov) {
    const md = mergedBuiltinDefaults()
    return md ? { ...base, builtinSpecDefaults: md } : { ...base }
  }
  const c = tryParseAnnotationColorHex(ov.color) ?? base.color
  const specKeys =
    ov.builtinSpecKeys && ov.builtinSpecKeys.length > 0
      ? ANNOTATION_SPEC_FIELD_ORDER.filter(k => ov.builtinSpecKeys!.includes(k))
      : [...base.specKeys]
  const md = mergedBuiltinDefaults()
  return {
    id,
    label: ov.name.trim() || base.label,
    color: c,
    specKeys,
    ...(md ? { builtinSpecDefaults: md } : {}),
  }
}

export function annotationRecordColor(ann: AnnotationRecord, userTemplates?: UserAnnotationTemplate[]): string {
  const c = tryParseAnnotationColorHex(ann.color)
  if (c) return c
  if (ann.templateId && ANNOTATION_TEMPLATES[ann.templateId]) {
    return effectiveIntegratedTemplateDef(ann.templateId, userTemplates ?? []).color
  }
  if (ann.userTemplateId && userTemplates?.length) {
    const u = userTemplates.find(t => t.id === ann.userTemplateId)
    if (u) return u.color
  }
  if (annotationOrigin(ann) === 'terrain_observation') return '#000000'
  if (annotationOrigin(ann) === 'client_remark') return '#10b981'
  return ETL360_DEFAULT_ANNOTATION_COLOR
}

export function annotationKind(annotation: AnnotationRecord): AnnotationKind {
  if (annotation.kind === 'text') return 'text'
  if (annotation.kind === 'zone' || annotation.zone) return 'zone'
  return 'point'
}

export function annotationPositionLocked(annotation: AnnotationRecord): boolean {
  return annotation.positionLocked === true
}

export function parseAnnotationOrigin(raw: unknown): AnnotationOrigin | undefined {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (!v) return undefined
  if (v === 'terrain_observation' || v === 'terrainobservation' || v === 'terrain') return 'terrain_observation'
  if (v === 'added_annotation' || v === 'addedannotation' || v === 'added' || v === 'manual') return 'added_annotation'
  if (v === 'ai_detection' || v === 'aidetection' || v === 'ai' || v === 'ia_detection' || v === 'ia') return 'ai_detection'
  if (
    v === 'client_remark' ||
    v === 'clientremark' ||
    v === 'remarque_client' ||
    v === 'remarqueclient' ||
    v === 'client_note' ||
    v === 'remark_client'
  ) {
    return 'client_remark'
  }
  return undefined
}

/** Origine métier d'une annotation (fallback rétrocompatible avec anciens JSON). */
export function annotationOrigin(annotation: AnnotationRecord): AnnotationOrigin {
  if (annotation.origin) return annotation.origin
  if (annotation.templateId === 'observations_sur_terrain') return 'terrain_observation'
  return 'added_annotation'
}

/** Convention sol à utiliser pour les plans (XY source pour terrain, XZ viewer sinon). */
export function annotationUsesSourceWorldHorizontalXY(annotation: AnnotationRecord): boolean {
  return annotationOrigin(annotation) === 'terrain_observation'
}

/** Texture discrète de pastille selon l'origine métier (sans remplacer la couleur principale). */
export function annotationOriginMarkerTextureCss(origin: AnnotationOrigin): string {
  switch (origin) {
    case 'terrain_observation':
      return 'repeating-linear-gradient(135deg, rgba(255,255,255,0.7) 0 1.2px, rgba(255,255,255,0) 1.2px 3.2px)'
    case 'ai_detection':
      return 'repeating-linear-gradient(90deg, rgba(255,255,255,0.7) 0 1px, rgba(255,255,255,0) 1px 2.6px)'
    case 'client_remark':
      return 'repeating-linear-gradient(45deg, rgba(255,255,255,0.55) 0 2px, rgba(255,255,255,0) 2px 5px)'
    case 'added_annotation':
    default:
      return 'none'
  }
}

export function normalizeYawRad(value: number): number {
  const twoPi = Math.PI * 2
  let v = value % twoPi
  if (v <= -Math.PI) v += twoPi
  if (v > Math.PI) v -= twoPi
  return v
}

export function shortestYawDelta(from: number, to: number): number {
  return normalizeYawRad(to - from)
}

export function buildZoneFromCorners(a: YawPitch, b: YawPitch): { center: YawPitch; zone: AnnotationZone } {
  const yawDelta = shortestYawDelta(a.yaw, b.yaw)
  const pitchA = THREE.MathUtils.clamp(a.pitch, -Math.PI / 2, Math.PI / 2)
  const pitchB = THREE.MathUtils.clamp(b.pitch, -Math.PI / 2, Math.PI / 2)
  return {
    center: {
      yaw: normalizeYawRad(a.yaw + yawDelta / 2),
      pitch: THREE.MathUtils.clamp((pitchA + pitchB) / 2, -Math.PI / 2, Math.PI / 2),
    },
    zone: {
      yawSpan: Math.max(Math.abs(yawDelta), THREE.MathUtils.degToRad(1.2)),
      pitchSpan: Math.max(Math.abs(pitchB - pitchA), THREE.MathUtils.degToRad(1.2)),
    },
  }
}

export function annotationFocusYawPitch(annotation: AnnotationRecord): YawPitch {
  return annotation.yawPitch
}

export function annotationZoneBounds(annotation: AnnotationRecord): ZoneBounds | null {
  if (annotationKind(annotation) === 'point' || !annotation.zone) return null
  return {
    leftYaw: annotation.yawPitch.yaw - annotation.zone.yawSpan / 2,
    rightYaw: annotation.yawPitch.yaw + annotation.zone.yawSpan / 2,
    topPitch: annotation.yawPitch.pitch + annotation.zone.pitchSpan / 2,
    bottomPitch: annotation.yawPitch.pitch - annotation.zone.pitchSpan / 2,
  }
}

export function zoneBoundsToAnnotationPatch(bounds: ZoneBounds): Pick<AnnotationRecord, 'yawPitch' | 'zone' | 'kind'> {
  return {
    kind: 'zone',
    yawPitch: {
      yaw: normalizeYawRad((bounds.leftYaw + bounds.rightYaw) / 2),
      pitch: THREE.MathUtils.clamp((bounds.topPitch + bounds.bottomPitch) / 2, -Math.PI / 2, Math.PI / 2),
    },
    zone: {
      yawSpan: Math.max(Math.abs(bounds.rightYaw - bounds.leftYaw), THREE.MathUtils.degToRad(1.2)),
      pitchSpan: Math.max(Math.abs(bounds.topPitch - bounds.bottomPitch), THREE.MathUtils.degToRad(1.2)),
    },
  }
}

export function unwrapYawNear(reference: number, yaw: number): number {
  return reference + shortestYawDelta(reference, yaw)
}

/** Coins de la zone en espace (leftYaw/rightYaw × topPitch/bottomPitch), ordre NW, NE, SE, SW. */
export type ZoneCornerIndex = 0 | 1 | 2 | 3

export function zoneCornerYawPitch(bounds: ZoneBounds, corner: ZoneCornerIndex): YawPitch {
  const { leftYaw, rightYaw, topPitch, bottomPitch } = bounds
  switch (corner) {
    case 0:
      return { yaw: normalizeYawRad(leftYaw), pitch: topPitch }
    case 1:
      return { yaw: normalizeYawRad(rightYaw), pitch: topPitch }
    case 2:
      return { yaw: normalizeYawRad(rightYaw), pitch: bottomPitch }
    case 3:
      return { yaw: normalizeYawRad(leftYaw), pitch: bottomPitch }
    default:
      return { yaw: normalizeYawRad(leftYaw), pitch: topPitch }
  }
}

/** Coin diagonal dans le rectangle yaw/pitch (0↔2, 1↔3). */
export function zoneDiagonalCornerIndex(corner: ZoneCornerIndex): ZoneCornerIndex {
  return (corner ^ 2) as ZoneCornerIndex
}

export function zoneBoundsFromCenterAndZone(center: YawPitch, zone: AnnotationZone): ZoneBounds {
  const pseudo: AnnotationRecord = {
    id: '',
    panoId: '',
    label: '',
    kind: 'zone',
    yawPitch: center,
    zone,
  }
  return annotationZoneBounds(pseudo)!
}

export function clampMovedZoneBoundsPitch(bounds: ZoneBounds): ZoneBounds {
  const span = bounds.topPitch - bounds.bottomPitch
  if (bounds.topPitch > Math.PI / 2) {
    const shift = bounds.topPitch - Math.PI / 2
    return {
      ...bounds,
      topPitch: Math.PI / 2,
      bottomPitch: Math.PI / 2 - span,
    }
  }
  if (bounds.bottomPitch < -Math.PI / 2) {
    const shift = -Math.PI / 2 - bounds.bottomPitch
    return {
      ...bounds,
      topPitch: -Math.PI / 2 + span,
      bottomPitch: -Math.PI / 2,
    }
  }
  return bounds
}

/** RGB 0–255 pour jsPDF à partir de la couleur d’annotation (hex normalisé). */
export function annotationHexToRgb255(hex: string): [number, number, number] {
  const c = tryParseAnnotationColorHex(hex) ?? ETL360_DEFAULT_ANNOTATION_COLOR
  const m = /^#([0-9a-f]{6})$/i.exec(c)
  if (!m) return [37, 99, 235]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Niveau de gris du texte (0 ou 255) pour rester lisible sur fond coloré (WCAG luminance). */
export function textGrayForAnnotationBackground(hex: string): number {
  const [r255, g255, b255] = annotationHexToRgb255(hex)
  const r = r255 / 255
  const g = g255 / 255
  const b = b255 / 255
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L > 0.52 ? 0 : 255
}

/**
 * Miniature rectilinéaire (même convention yaw/pitch que le viewer : atan2(x,z), asin(y))
 * à partir d’une image équirectangulaire.
 */
function applyAxisFlipsToYawPitchForPanoExport(
  yaw: number,
  pitch: number,
  flips?: { flipX?: boolean; flipY?: boolean }
): YawPitch {
  let yw = yaw
  if (flips?.flipX) yw = normalizeYawRad(-yw)
  if (flips?.flipY) yw = normalizeYawRad(Math.PI - yw)
  return { yaw: yw, pitch }
}

export async function renderAnnotationViewThumbnail(
  imageUrl: string,
  annotation: AnnotationRecord,
  userTemplates: UserAnnotationTemplate[] | undefined = undefined,
  sizePx = 160,
  fovDeg = 68,
  jpegQuality = 0.88,
  exposureMultiplier = 1,
  panoAxisFlips?: { flipX?: boolean; flipY?: boolean }
): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const sw = img.naturalWidth
        const sh = img.naturalHeight
        if (sw < 2 || sh < 2) {
          resolve(null)
          return
        }
        const srcCanvas = document.createElement('canvas')
        srcCanvas.width = sw
        srcCanvas.height = sh
        const sctx = srcCanvas.getContext('2d', { willReadFrequently: true })
        if (!sctx) {
          resolve(null)
          return
        }
        sctx.drawImage(img, 0, 0)
        const srcData = sctx.getImageData(0, 0, sw, sh)
        const src = srcData.data

        const center = applyAxisFlipsToYawPitchForPanoExport(
          annotation.yawPitch.yaw,
          annotation.yawPitch.pitch,
          panoAxisFlips
        )
        const D = new THREE.Vector3(
          Math.sin(center.yaw) * Math.cos(center.pitch),
          Math.sin(center.pitch),
          Math.cos(center.yaw) * Math.cos(center.pitch)
        ).normalize()
        const worldUp = new THREE.Vector3(0, 1, 0)
        const right = new THREE.Vector3().copy(worldUp).cross(D)
        if (right.lengthSq() < 1e-10) right.set(1, 0, 0).cross(D)
        right.normalize()
        const up = new THREE.Vector3().copy(D).cross(right).normalize()

        const halfTan = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2)
        const outCanvas = document.createElement('canvas')
        outCanvas.width = sizePx
        outCanvas.height = sizePx
        const octx = outCanvas.getContext('2d')
        if (!octx) {
          resolve(null)
          return
        }
        const outImg = octx.createImageData(sizePx, sizePx)
        const od = outImg.data

        const sample = (u: number, v: number): [number, number, number, number] => {
          u = ((u % 1) + 1) % 1
          v = Math.min(Math.max(v, 0), 0.999999)
          const x = u * (sw - 1)
          const y = v * (sh - 1)
          const x0 = Math.floor(x)
          const y0 = Math.floor(y)
          const x1 = Math.min(x0 + 1, sw - 1)
          const y1 = Math.min(y0 + 1, sh - 1)
          const fx = x - x0
          const fy = y - y0
          const idx = (xi: number, yi: number) => (yi * sw + xi) * 4
          const i00 = idx(x0, y0)
          const i10 = idx(x1, y0)
          const i01 = idx(x0, y1)
          const i11 = idx(x1, y1)
          const lerp = (a: number, b: number, t: number) => a + (b - a) * t
          return [
            lerp(lerp(src[i00], src[i10], fx), lerp(src[i01], src[i11], fx), fy),
            lerp(lerp(src[i00 + 1], src[i10 + 1], fx), lerp(src[i01 + 1], src[i11 + 1], fx), fy),
            lerp(lerp(src[i00 + 2], src[i10 + 2], fx), lerp(src[i01 + 2], src[i11 + 2], fx), fy),
            lerp(lerp(src[i00 + 3], src[i10 + 3], fx), lerp(src[i01 + 3], src[i11 + 3], fx), fy),
          ]
        }

        const exp = Number.isFinite(exposureMultiplier) ? Math.max(0.05, Math.min(4, exposureMultiplier)) : 1
        for (let j = 0; j < sizePx; j++) {
          for (let i = 0; i < sizePx; i++) {
            const ndcX = ((i + 0.5) / sizePx) * 2 - 1
            const ndcY = ((j + 0.5) / sizePx) * 2 - 1
            const ray = new THREE.Vector3()
              .copy(D)
              .addScaledVector(right, ndcX * halfTan)
              .addScaledVector(up, -ndcY * halfTan)
            ray.normalize()
            const yawS = Math.atan2(ray.x, ray.z)
            const pitchS = Math.asin(THREE.MathUtils.clamp(ray.y, -1, 1))
            const { u: uTex, v: vTex } = panoViewerYawPitchToTextureUv(yawS, pitchS)
            const [rr, gg, bb, aa] = sample(uTex, vTex)
            const o = (j * sizePx + i) * 4
            od[o] = Math.max(0, Math.min(255, rr * exp))
            od[o + 1] = Math.max(0, Math.min(255, gg * exp))
            od[o + 2] = Math.max(0, Math.min(255, bb * exp))
            od[o + 3] = aa > 0 ? aa : 255
          }
        }
        octx.putImageData(outImg, 0, 0)
        const stroke = annotationRecordColor(annotation, userTemplates)
        const projectToView = (yaw: number, pitch: number): { x: number; y: number; visible: boolean } => {
          const flipped = applyAxisFlipsToYawPitchForPanoExport(yaw, pitch, panoAxisFlips)
          const ray = new THREE.Vector3(
            Math.sin(flipped.yaw) * Math.cos(flipped.pitch),
            Math.sin(flipped.pitch),
            Math.cos(flipped.yaw) * Math.cos(flipped.pitch)
          ).normalize()
          const forward = ray.dot(D)
          if (forward <= 1e-6) return { x: 0, y: 0, visible: false }
          const ndcX = ray.dot(right) / (forward * halfTan)
          const ndcY = -ray.dot(up) / (forward * halfTan)
          return {
            x: ((ndcX + 1) * 0.5) * sizePx,
            y: ((ndcY + 1) * 0.5) * sizePx,
            visible: Math.abs(ndcX) <= 1.3 && Math.abs(ndcY) <= 1.3,
          }
        }
        const zFill = annotationZoneFillOpacityForRender(annotation)
        const zStroke = Math.min(0.95, zFill + 0.34)
        octx.strokeStyle = `${stroke}${annotationZoneFillOpacityToHexByte(zStroke)}`
        octx.fillStyle = `${stroke}${annotationZoneFillOpacityToHexByte(zFill)}`
        octx.lineWidth = Math.max(1.0, sizePx * 0.01)
        if (annotationKind(annotation) !== 'point' && annotation.zone) {
          const halfYaw = annotation.zone.yawSpan / 2
          const halfPitch = annotation.zone.pitchSpan / 2
          const corners = [
            projectToView(normalizeYawRad(annotation.yawPitch.yaw - halfYaw), annotation.yawPitch.pitch + halfPitch),
            projectToView(normalizeYawRad(annotation.yawPitch.yaw + halfYaw), annotation.yawPitch.pitch + halfPitch),
            projectToView(normalizeYawRad(annotation.yawPitch.yaw + halfYaw), annotation.yawPitch.pitch - halfPitch),
            projectToView(normalizeYawRad(annotation.yawPitch.yaw - halfYaw), annotation.yawPitch.pitch - halfPitch),
          ]
          if (corners.every(c => c.visible)) {
            const xs = corners.map(c => c.x)
            const ys = corners.map(c => c.y)
            const left = Math.max(0, Math.min(...xs))
            const top = Math.max(0, Math.min(...ys))
            const width = Math.min(sizePx, Math.max(...xs)) - left
            const height = Math.min(sizePx, Math.max(...ys)) - top
            const inset = Math.max(1.4, sizePx * 0.006)
            const drawLeft = left + inset
            const drawTop = top + inset
            const drawW = Math.max(width - inset * 2, 2)
            const drawH = Math.max(height - inset * 2, 2)
            octx.fillRect(drawLeft, drawTop, drawW, drawH)
            octx.strokeRect(drawLeft, drawTop, drawW, drawH)
            if (annotationKind(annotation) === 'text') {
              const text = (annotation.textContent || annotation.description || annotation.identifier || '').trim()
              if (text) {
                octx.fillStyle = annotationTextColorCss(annotation)
                octx.textAlign = 'center'
                octx.textBaseline = 'middle'
                octx.font = `${Math.max(10, Math.min(28, annotationTextSizePx(annotation) * 0.8))}px sans-serif`
                octx.fillText(text, drawLeft + drawW / 2, drawTop + drawH / 2)
              }
            }
          }
        } else {
          const pt = projectToView(annotation.yawPitch.yaw, annotation.yawPitch.pitch)
          if (pt.visible) {
            const r = Math.max(2.6, sizePx * 0.042)
            octx.beginPath()
            octx.arc(pt.x, pt.y, r, 0, Math.PI * 2)
            octx.fill()
            octx.stroke()
          }
        }
        // Le focus est correct mais l'image exportée est latéralement inversée :
        // appliquer un miroir horizontal final pour aligner le PDF avec la vue panorama.
        const mirroredCanvas = document.createElement('canvas')
        mirroredCanvas.width = sizePx
        mirroredCanvas.height = sizePx
        const mctx = mirroredCanvas.getContext('2d')
        if (!mctx) {
          resolve(outCanvas.toDataURL('image/jpeg', jpegQuality))
          return
        }
        mctx.translate(sizePx, 0)
        mctx.scale(-1, 1)
        mctx.drawImage(outCanvas, 0, 0)
        resolve(mirroredCanvas.toDataURL('image/jpeg', jpegQuality))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = imageUrl
  })
}

/** Stocke une couleur seulement si elle diffère du défaut (JSON plus léger). */
export function annotationColorForRecord(hexFromPicker: string): string | undefined {
  const c = tryParseAnnotationColorHex(hexFromPicker)
  if (!c || c === ETL360_DEFAULT_ANNOTATION_COLOR) return undefined
  return c
}

/**
 * Couleur à l’enregistrement lors de la création : si un gabarit propose une couleur de base,
 * la valeur du sélecteur (pipette / color picker) prime dès qu’elle en diffère (casse / forme hex normalisée).
 * Sans gabarit, même règle que {@link annotationColorForRecord} + défaut applicatif.
 */
export function resolveAnnotationCreationColor(options: {
  pickerHex: string
  /** Couleur du gabarit intégré effectif ou du gabarit perso (surcharges locales incluses). */
  templateBaseColor?: string | undefined
}): string {
  const picked = tryParseAnnotationColorHex(options.pickerHex) ?? ETL360_DEFAULT_ANNOTATION_COLOR
  const baseRaw = options.templateBaseColor
  if (baseRaw) {
    const base = tryParseAnnotationColorHex(baseRaw) ?? ETL360_DEFAULT_ANNOTATION_COLOR
    if (picked.toLowerCase() !== base.toLowerCase()) return picked
    return base
  }
  return annotationColorForRecord(options.pickerHex) ?? ETL360_DEFAULT_ANNOTATION_COLOR
}

export function parseAnnotationTextTone(raw: unknown): AnnotationTextTone | undefined {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
  if (!v) return undefined
  if (v === 'black' || v === 'dark' || v === 'noir') return 'black'
  if (v === 'lightgray' || v === 'light_gray' || v === 'gray' || v === 'grisclair' || v === 'gris_clair')
    return 'lightGray'
  return undefined
}

export function parseAnnotationTextSizePx(raw: unknown): number | undefined {
  const n = toFiniteNumber(raw, Number.NaN)
  if (!Number.isFinite(n)) return undefined
  return Math.max(10, Math.min(72, n))
}

export function annotationTextTone(annotation: AnnotationRecord): AnnotationTextTone {
  return annotation.textTone === 'lightGray' ? 'lightGray' : 'black'
}

export function annotationTextColorCss(annotation: AnnotationRecord): string {
  return annotationTextTone(annotation) === 'lightGray' ? '#d1d5db' : '#0f172a'
}

export function annotationTextSizePx(annotation: AnnotationRecord): number {
  const n = parseAnnotationTextSizePx(annotation.textSizePx)
  return n ?? 20
}

export type AnnotationsDocument = {
  schema:
    | typeof ETL360_ANNOTATIONS_SCHEMA_V1
    | typeof ETL360_ANNOTATIONS_SCHEMA_V2
    | typeof ETL360_ANNOTATIONS_SCHEMA_V3
    | typeof ETL360_ANNOTATIONS_SCHEMA_V4
  panoId: string
  panoDisplayName?: string
  /** Étage manuel du panorama (libellé du plan, ex. N3) — schéma v2. */
  assignedFloorLabel?: string
  projectCode?: string
  exportedAt: string
  annotations: AnnotationRecord[]
}

export type ExtractedDataset = {
  panos: PanoRecord[]
  annotations: AnnotationRecord[]
  /** Annotations issues d un CSV *control_points* dans le ZIP (prioritaires sur les doublons d id). */
  controlPointAnnotations: AnnotationRecord[]
  objectUrls: string[]
  floorMapAssets: FloorMapAsset[]
  importWarnings: string[]
  /** Fichiers etl360.annotations.*.json trouvés dans le ZIP. */
  perPanoAnnotationDocs: AnnotationsDocument[]
  /** Package E57 lu depuis le même ZIP (contrat ZIP unique). */
  e57Package?: {
    manifest: E57PointCloudManifest
    chunks: Array<{ meta: E57PointCloudChunkMeta; positions: Float32Array }>
  }
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase().trim()
}

export function detectZipRootPrefix(paths: string[]): string {
  let prefix = ''
  for (const value of paths) {
    const raw = value.replace(/\\/g, '/').replace(/^\/+/, '').trim()
    if (!raw) continue
    const slash = raw.indexOf('/')
    if (slash <= 0) return ''
    const current = raw.slice(0, slash + 1)
    if (!prefix) {
      prefix = current
      continue
    }
    if (current.toLowerCase() !== prefix.toLowerCase()) return ''
  }
  return prefix
}

export function stripZipRootPrefix(value: string, rootPrefix: string): string {
  const raw = value.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  const prefix = rootPrefix.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').trim()
  if (!prefix) return raw
  const withSlash = `${prefix}/`
  return raw.toLowerCase().startsWith(withSlash.toLowerCase()) ? raw.slice(withSlash.length) : raw
}

export function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

type ImportedAngleField = 'yaw' | 'pitch' | 'zoneYawSpan' | 'zonePitchSpan'
type ImportedAngleNormalization = {
  value: number
  raw: number | null
  unit: 'rad' | 'deg->rad' | 'fallback'
}

const ETL360_IMPORTED_ANGLE_DEBUG_LIMIT = 80
let etl360ImportedAngleDebugCount = 0
let etl360ImportedAngleConvertedAnnotations = 0
let etl360ImportedAngleConvertedFields = 0

export function resetImportedAngleNormalizationDebugStats(): void {
  etl360ImportedAngleDebugCount = 0
  etl360ImportedAngleConvertedAnnotations = 0
  etl360ImportedAngleConvertedFields = 0
}

export function readImportedAngleNormalizationDebugStats(): {
  convertedAnnotations: number
  convertedFields: number
  loggedSamples: number
} {
  return {
    convertedAnnotations: etl360ImportedAngleConvertedAnnotations,
    convertedFields: etl360ImportedAngleConvertedFields,
    loggedSamples: etl360ImportedAngleDebugCount,
  }
}

function shouldInterpretImportedAngleAsDegrees(field: ImportedAngleField, value: number): boolean {
  const abs = Math.abs(value)
  switch (field) {
    case 'yaw':
      return abs > Math.PI * 2 + 0.2
    case 'pitch':
      return abs > Math.PI + 0.05
    case 'zoneYawSpan':
      return abs > Math.PI * 2 + 0.2
    case 'zonePitchSpan':
      return abs > Math.PI + 0.05
    default:
      return false
  }
}

function normalizeImportedAngleToRad(
  field: ImportedAngleField,
  rawValue: unknown,
  fallback: number
): ImportedAngleNormalization {
  const raw = toFiniteNumber(rawValue, Number.NaN)
  if (!Number.isFinite(raw)) {
    return { value: fallback, raw: null, unit: 'fallback' }
  }

  const asRad = shouldInterpretImportedAngleAsDegrees(field, raw) ? THREE.MathUtils.degToRad(raw) : raw
  const unit: ImportedAngleNormalization['unit'] =
    shouldInterpretImportedAngleAsDegrees(field, raw) ? 'deg->rad' : 'rad'

  if (field === 'yaw') {
    return { value: normalizeYawRad(asRad), raw, unit }
  }
  if (field === 'pitch') {
    return { value: THREE.MathUtils.clamp(asRad, -Math.PI / 2, Math.PI / 2), raw, unit }
  }
  if (field === 'zoneYawSpan') {
    return { value: THREE.MathUtils.clamp(Math.abs(asRad), 0, Math.PI * 2), raw, unit }
  }
  return { value: THREE.MathUtils.clamp(Math.abs(asRad), 0, Math.PI), raw, unit }
}

function debugImportedAnnotationAngleNormalization(payload: {
  annotationId: string
  panoId: string
  sourceKind: string
  yaw: ImportedAngleNormalization
  pitch: ImportedAngleNormalization
  zoneYawSpan: ImportedAngleNormalization
  zonePitchSpan: ImportedAngleNormalization
}): void {
  const hasConversion =
    payload.yaw.unit === 'deg->rad' ||
    payload.pitch.unit === 'deg->rad' ||
    payload.zoneYawSpan.unit === 'deg->rad' ||
    payload.zonePitchSpan.unit === 'deg->rad'
  if (!hasConversion) return
  etl360ImportedAngleConvertedAnnotations += 1
  if (payload.yaw.unit === 'deg->rad') etl360ImportedAngleConvertedFields += 1
  if (payload.pitch.unit === 'deg->rad') etl360ImportedAngleConvertedFields += 1
  if (payload.zoneYawSpan.unit === 'deg->rad') etl360ImportedAngleConvertedFields += 1
  if (payload.zonePitchSpan.unit === 'deg->rad') etl360ImportedAngleConvertedFields += 1
  if (etl360ImportedAngleDebugCount >= ETL360_IMPORTED_ANGLE_DEBUG_LIMIT) return
  etl360ImportedAngleDebugCount += 1
  etl360PostDebugIngest({
    sessionId: '546eb8',
    runId: 'import-angle-normalization',
    hypothesisId: 'Hann',
    location: 'etlViewer360Core.ts:normalizeImportedAnnotation',
    message: 'annotation import angles normalized from degrees to radians',
    data: {
      annotationId: payload.annotationId,
      panoId: payload.panoId,
      sourceKind: payload.sourceKind,
      yaw: payload.yaw,
      pitch: payload.pitch,
      zoneYawSpan: payload.zoneYawSpan,
      zonePitchSpan: payload.zonePitchSpan,
      debugCount: etl360ImportedAngleDebugCount,
    },
    timestamp: Date.now(),
  })
}

export function parseOptionalTrimmedString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const s = String(value).trim()
  return s || undefined
}

/**
 * Lit le SCR déclaré dans manifest.json (champs usuels du pipeline ZIP E57).
 * Pour un SCR issu du fichier E57 source, préférer {@link resolvedPointCloudSpatialReference}
 * ou {@link spatialReferenceFromE57ArrayBuffer} sur le binaire.
 */
export function spatialReferenceFromE57Manifest(m: E57PointCloudManifest | null | undefined): string | undefined {
  if (!m) return undefined
  const any = m as Record<string, unknown>
  const sr = parseOptionalTrimmedString(any.spatialReference)
  if (sr) return sr
  const horiz = parseOptionalTrimmedString(any.horizontalCRS ?? any.horizontal_crs)
  if (horiz) return horiz
  const crs = parseOptionalTrimmedString(any.crs ?? any.srs)
  if (crs) return crs
  const epsgRaw = any.epsg ?? any.EPSG
  const n = typeof epsgRaw === 'number' ? epsgRaw : epsgRaw != null ? Number(epsgRaw) : Number.NaN
  if (Number.isFinite(n) && n > 0) return `EPSG:${Math.floor(n)}`
  return undefined
}

/**
 * SCR nuage : d abord manifest (ZIP reconstitué), sinon début du fichier E57 brut (heuristique EPSG dans le XML).
 */
export function resolvedPointCloudSpatialReference(options: {
  manifest?: E57PointCloudManifest | null
  e57ArrayBuffer?: ArrayBuffer | null
}): string | undefined {
  const fromManifest = spatialReferenceFromE57Manifest(options.manifest ?? undefined)
  if (fromManifest) return fromManifest
  const buf = options.e57ArrayBuffer
  if (buf && buf.byteLength > 0) return spatialReferenceFromE57ArrayBuffer(buf)
  return undefined
}

export { spatialReferenceFromE57ArrayBuffer }

/** Fusionne champs du gabarit et champs dont le formulaire a une valeur (éditeur). */
export function mergeSpecSlotsForEditor(
  templateId: AnnotationTemplateId | '',
  values: AnnCreationSpecForm,
  userTemplateBuiltinKeys: AnnotationSpecFieldKey[] = [],
  userTemplates: UserAnnotationTemplate[] = []
): AnnotationSpecFieldKey[] {
  const tplKeys =
    templateId && ANNOTATION_TEMPLATES[templateId]
      ? effectiveIntegratedTemplateDef(templateId, userTemplates).specKeys
      : []
  const withValue = annotationSpecEditorSlotsWithValues(values)
  const merged = new Set<AnnotationSpecFieldKey>([...tplKeys, ...userTemplateBuiltinKeys, ...withValue])
  return ANNOTATION_SPEC_FIELD_ORDER.filter(k => merged.has(k))
}

export function parseCsvRows(csvText: string): Array<Record<string, string>> {
  return parseFlexibleCsvRows(csvText)
}

export function getRowValue(row: Record<string, string>, keys: string[]): string {
  for (const [rawKey, value] of Object.entries(row)) {
    const normalizedKey = rawKey.trim().toLowerCase()
    if (keys.includes(normalizedKey)) {
      const v = String(value || '').trim()
      if (v) return v
    }
  }
  return ''
}

const CONTROL_POINT_WARN_DIST_M = 180

/**
 * CSV de points de contrôle (fichier *control_points*.csv dans le ZIP) : colonnes id + x,y,z monde (même SCR que les poses pano).
 * Chaque ligne devient une annotation « point » : id = identifiant du point, sans description, panorama le plus proche + yaw/pitch.
 */
export function buildAnnotationsFromControlPointsZipCsv(
  csvText: string,
  panos: PanoRecord[]
): { annotations: AnnotationRecord[]; warnings: string[] } {
  const warnings: string[] = []
  const annotations: AnnotationRecord[] = []
  if (!panos.length) {
    warnings.push('aucun panorama pour projeter les points.')
    return { annotations, warnings }
  }
  const stripped = csvText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'))
    .join('\n')
  const rows = stripped ? parseCsvRows(stripped) : []
  if (!rows.length) {
    warnings.push('fichier vide ou sans lignes de donnees apres les commentaires #.')
    return { annotations, warnings }
  }

  for (const row of rows) {
    const id = getRowValue(row, ['id', 'name', 'point_id', 'pointid', 'code', 'label'])
    if (!id) continue
    const sx = Number(getRowValue(row, ['x', 'east', 'easting']))
    const sy = Number(getRowValue(row, ['y', 'north', 'northing']))
    const sz = Number(getRowValue(row, ['z', 'alt', 'altitude', 'height', 'elev', 'elevation']))
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sz)) {
      warnings.push(`ligne id « ${id} » : coordonnees x/y/z invalides, ignoree.`)
      continue
    }

    let best: PanoRecord | null = null
    let bestD2 = Infinity
    for (const p of panos) {
      const dx = sx - p.position.x
      const dy = sy - p.position.y
      const dz = sz - p.position.z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 < bestD2) {
        bestD2 = d2
        best = p
      }
    }
    if (!best) continue

    const distM = Math.sqrt(bestD2)
    if (distM > CONTROL_POINT_WARN_DIST_M) {
      warnings.push(
        `point « ${id} » : panorama le plus proche (${best.id}) a ${distM.toFixed(1)} m — verifier le SCR ou les coordonnees.`
      )
    }

    const vPoint = sourceWorldToViewerPosition({ x: sx, y: sy, z: sz })
    const vPano = sourceWorldToViewerPosition(best.position)
    const yp = worldOffsetToPanoMarkerYawPitch(
      vPoint.x - vPano.x,
      vPoint.y - vPano.y,
      vPoint.z - vPano.z,
      best
    )
    if (!yp) {
      warnings.push(`point « ${id} » : impossible de calculer yaw/pitch sur le pano ${best.id}, ignore.`)
      continue
    }

    annotations.push({
      id,
      panoId: best.id,
      label: id,
      identifier: id,
      kind: 'point',
      origin: 'terrain_observation',
      yawPitch: yp,
      pointCloudTarget: { x: sx, y: sy, z: sz },
    })
  }

  if (annotations.length === 0 && rows.length > 0) {
    warnings.push('aucune annotation creee (verifiez les en-tetes id, x, y, z).')
  }
  return { annotations, warnings }
}

export function basename(path: string): string {
  const p = normalizePath(path)
  const parts = p.split('/')
  return parts[parts.length - 1] || p
}

function mimeTypeFromFilename(filename: string): string {
  const ext = extensionFromFilename(filename)
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff'
  return 'application/octet-stream'
}

async function readZipEntryBlobWithMime(entry: JSZip.JSZipObject, filenameHint?: string): Promise<Blob> {
  const buffer = await entry.async('arraybuffer')
  return new Blob([buffer], { type: mimeTypeFromFilename(filenameHint || entry.name) })
}

export function findBestImageEntry(
  imageEntries: Array<{ key: string; file: JSZip.JSZipObject }>,
  imageRef: string
): JSZip.JSZipObject | null {
  const normalizedRef = normalizePath(imageRef)
  const byExact = imageEntries.find(entry => normalizePath(entry.key) === normalizedRef)
  if (byExact) return byExact.file
  const refBase = basename(normalizedRef)
  const byBase = imageEntries.find(entry => basename(entry.key) === refBase)
  return byBase?.file ?? null
}

export async function parsePanosFromJsonFile(
  jsonText: string,
  imageEntries: Array<{ key: string; file: JSZip.JSZipObject }>
): Promise<{ panos: PanoRecord[]; objectUrls: string[]; warnings: string[] }> {
  const objectUrls: string[] = []
  const warnings: string[] = []
  const raw = JSON.parse(jsonText)
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.panos) ? raw.panos : []
  const panos: PanoRecord[] = []
  for (const item of list) {
    const id = String(item?.id ?? item?.panoId ?? '').trim()
    if (!id) continue
    const filename = String(item?.filename ?? item?.image ?? item?.imageName ?? `${id}.jpg`).trim()
    const imageRef = String(item?.imageUrl ?? item?.imagePath ?? item?.filename ?? item?.image ?? '').trim()
    const imageEntry = imageRef ? findBestImageEntry(imageEntries, imageRef) : findBestImageEntry(imageEntries, filename)
    let imageUrl = ''
    let imageExists = false
    if (imageEntry) {
      const blob = await readZipEntryBlobWithMime(imageEntry, filename)
      imageUrl = URL.createObjectURL(blob)
      objectUrls.push(imageUrl)
      imageExists = true
    } else {
      warnings.push(`Image introuvable pour pano ${id} (${filename}).`)
    }
    const vc = tryParseAnnotationColorHex(item?.viewerColor ?? item?.viewer_color ?? item?.panoColor)
    const comparePair = parsePanoComparePairFromImportRaw(
      item?.comparePair ?? item?.compare_pair ?? item?.panoCompare ?? item?.pano_compare
    )
    panos.push({
      id,
      filename,
      imageUrl,
      imageExists,
      ...(vc ? { viewerColor: vc } : {}),
      ...(comparePair ? { comparePair } : {}),
      position: {
        x: toFiniteNumber(item?.position?.x ?? item?.x),
        y: toFiniteNumber(item?.position?.y ?? item?.y),
        z: toFiniteNumber(item?.position?.z ?? item?.z),
      },
      orientation: {
        x: toFiniteNumber(item?.orientation?.x ?? 0),
        y: toFiniteNumber(item?.orientation?.y ?? 0),
        z: toFiniteNumber(item?.orientation?.z ?? 0),
        w: toFiniteNumber(item?.orientation?.w ?? 1, 1),
      },
    })
  }
  return { panos, objectUrls, warnings }
}

export async function parsePanosFromCsvFile(
  csvText: string,
  imageEntries: Array<{ key: string; file: JSZip.JSZipObject }>
): Promise<{ panos: PanoRecord[]; objectUrls: string[]; warnings: string[] }> {
  const rows = parseCsvRows(csvText)
  const objectUrls: string[] = []
  const panos: PanoRecord[] = []
  const warnings: string[] = []
  for (const row of rows) {
    const id = getRowValue(row, ['id', 'panoid', 'pano_id'])
    if (!id) continue
    const filename =
      getRowValue(row, ['filename', 'image', 'image_name', 'imagepath', 'image_path']) || `${id}.jpg`
    const imageRef = getRowValue(row, [
      'imageurl',
      'image_url',
      'path',
      'filename',
      'image',
      'imagepath',
      'image_path',
    ])
    const imageEntry = imageRef ? findBestImageEntry(imageEntries, imageRef) : findBestImageEntry(imageEntries, filename)
    let imageUrl = ''
    let imageExists = false
    if (imageEntry) {
      const blob = await readZipEntryBlobWithMime(imageEntry, filename)
      imageUrl = URL.createObjectURL(blob)
      objectUrls.push(imageUrl)
      imageExists = true
    } else {
      warnings.push(`Image introuvable pour pano ${id} (${filename}).`)
    }
    const vcRow = tryParseAnnotationColorHex(
      getRowValue(row, ['viewercolor', 'viewer_color', 'pano_color', 'pano_viewer_color', 'couleur_pano']) ||
        undefined
    )
    panos.push({
      id,
      filename,
      imageUrl,
      imageExists,
      ...(vcRow ? { viewerColor: vcRow } : {}),
      position: {
        x: toFiniteNumber(
          getRowValue(row, [
            'pano_pos_x',
            'x',
            'pos_x',
            'position_x',
            'easting',
            'east',
            'utm_x',
            'e',
            'pano_x',
            'scanpos_x',
          ]),
          Number.NaN
        ),
        y: toFiniteNumber(
          getRowValue(row, [
            'pano_pos_y',
            'y',
            'pos_y',
            'position_y',
            'northing',
            'north',
            'utm_y',
            'n',
            'pano_y',
            'scanpos_y',
          ]),
          Number.NaN
        ),
        z: toFiniteNumber(
          getRowValue(row, [
            'pano_pos_z',
            'z',
            'pos_z',
            'position_z',
            'altitude',
            'elevation',
            'height',
            'h',
            'z_m',
            'pano_z',
            'scanpos_z',
          ]),
          Number.NaN
        ),
      },
      orientation: {
        x: toFiniteNumber(getRowValue(row, ['ox', 'orient_x', 'qx', 'pano_ori_x']), 0),
        y: toFiniteNumber(getRowValue(row, ['oy', 'orient_y', 'qy', 'pano_ori_y']), 0),
        z: toFiniteNumber(getRowValue(row, ['oz', 'orient_z', 'qz', 'pano_ori_z']), 0),
        w: toFiniteNumber(getRowValue(row, ['ow', 'orient_w', 'qw', 'pano_ori_w']), 1),
      },
    })
  }
  return { panos, objectUrls, warnings }
}

/**
 * Construit des `PanoRecord[]` à partir du texte CSV d'un projet ETL, sans charger les images.
 * Chaque pano a `imageUrl = ''`, `imageExists = false`, et `blobPath` pointant vers le blob Azure.
 * Utilisé par le flow index viewer (Phase 3) pour un chargement paresseux des panoramas.
 *
 * @param csvText       - Contenu du fichier CSV de poses panoramas
 * @param filenameToBlobPath - Map filename (basename, insensible à la casse) → blobPath Azure
 * @returns PanoRecord[] avec positions/orientations mais sans images chargées
 */
export function parsePanosFromCsvTextLazy(
  csvText: string,
  filenameToBlobPath: Map<string, string>
): { panos: PanoRecord[]; warnings: string[] } {
  const rows = parseCsvRows(csvText)
  const panos: PanoRecord[] = []
  const warnings: string[] = []
  for (const row of rows) {
    const id = getRowValue(row, ['id', 'panoid', 'pano_id'])
    if (!id) continue
    const filename = getRowValue(row, ['filename', 'image', 'image_name', 'imagepath', 'image_path']) || `${id}.jpg`
    const imageRef = getRowValue(row, ['imageurl', 'image_url', 'path', 'filename', 'image', 'imagepath', 'image_path'])
    // Résolution du blobPath : on cherche d'abord par imageRef, puis par filename
    const lookupKey = (k: string) => (k || '').toLowerCase().split('/').pop() || k.toLowerCase()
    const blobPath =
      (imageRef ? filenameToBlobPath.get(lookupKey(imageRef)) : undefined) ??
      filenameToBlobPath.get(lookupKey(filename)) ??
      undefined
    if (!blobPath) {
      warnings.push(`Image introuvable dans l'index viewer pour pano ${id} (${filename}).`)
    }
    const vcRow = tryParseAnnotationColorHex(
      getRowValue(row, ['viewercolor', 'viewer_color', 'pano_color', 'pano_viewer_color', 'couleur_pano']) || undefined
    )
    panos.push({
      id,
      filename,
      imageUrl: '',
      imageExists: false,
      blobPath,
      ...(vcRow ? { viewerColor: vcRow } : {}),
      position: {
        x: toFiniteNumber(
          getRowValue(row, ['pano_pos_x', 'x', 'pos_x', 'position_x', 'easting', 'east', 'utm_x', 'e', 'pano_x', 'scanpos_x']),
          Number.NaN
        ),
        y: toFiniteNumber(
          getRowValue(row, ['pano_pos_y', 'y', 'pos_y', 'position_y', 'northing', 'north', 'utm_y', 'n', 'pano_y', 'scanpos_y']),
          Number.NaN
        ),
        z: toFiniteNumber(
          getRowValue(row, [
            'pano_pos_z',
            'z',
            'pos_z',
            'position_z',
            'altitude',
            'h',
            'height',
            'utm_z',
            'pano_z',
            'scanpos_z',
            'elev',
            'elevation',
          ]),
          Number.NaN
        ),
      },
      orientation: {
        x: toFiniteNumber(getRowValue(row, ['ox', 'orient_x', 'qx', 'pano_ori_x']), 0),
        y: toFiniteNumber(getRowValue(row, ['oy', 'orient_y', 'qy', 'pano_ori_y']), 0),
        z: toFiniteNumber(getRowValue(row, ['oz', 'orient_z', 'qz', 'pano_ori_z']), 0),
        w: toFiniteNumber(getRowValue(row, ['ow', 'orient_w', 'qw', 'pano_ori_w']), 1),
      },
    })
  }
  return { panos, warnings }
}

/** Import JSON / CSV : `comparePair` sur un pano, ou alias `panoCompare` (ancien nom) avec `secondaryPanoId`. */
export function parsePanoComparePairFromImportRaw(raw: unknown): PanoComparePair | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const otherPanoId = String(
    o.otherPanoId ?? o.other_pano_id ?? o.secondaryPanoId ?? o.secondary_pano_id ?? ''
  ).trim()
  if (!otherPanoId) return undefined
  const labelBeforeFromNew =
    typeof o.labelBefore === 'string' && o.labelBefore.trim() ? o.labelBefore.trim() : undefined
  const labelAfterFromNew =
    typeof o.labelAfter === 'string' && o.labelAfter.trim() ? o.labelAfter.trim() : undefined
  const labelBefore =
    labelBeforeFromNew ||
    (typeof o.labelPrimary === 'string' && o.labelPrimary.trim() ? o.labelPrimary.trim() : undefined)
  const labelAfter =
    labelAfterFromNew ||
    (typeof o.labelSecondary === 'string' && o.labelSecondary.trim() ? o.labelSecondary.trim() : undefined)
  const extra = o.extra
  const out: PanoComparePair = { otherPanoId }
  if (labelBefore) out.labelBefore = labelBefore
  if (labelAfter) out.labelAfter = labelAfter
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    out.extra = extra as Record<string, unknown>
  }
  return out
}

export function normalizeImportedAnnotation(raw: any, fallbackId: string): AnnotationRecord | null {
  const panoId = String(raw?.panoId ?? raw?.pano_id ?? '').trim()
  if (!panoId) return null
  const id = String(raw?.id ?? fallbackId).trim() || fallbackId
  const rawUserTemplateId = parseOptionalTrimmedString(raw?.userTemplateId ?? raw?.user_template_id)
  const templateId = rawUserTemplateId
    ? undefined
    : parseAnnotationTemplateId(raw?.templateId ?? raw?.template ?? raw?.gabarit)
  const parsedOrigin = parseAnnotationOrigin(raw?.origin ?? raw?.annotationOrigin ?? raw?.annotation_origin)
  const origin: AnnotationOrigin = parsedOrigin ?? (templateId === 'observations_sur_terrain' ? 'terrain_observation' : 'added_annotation')
  const parsedColor = tryParseAnnotationColorHex(raw?.color ?? raw?.markerColor)
  const templateFallbackColor =
    templateId && ANNOTATION_TEMPLATES[templateId] ? ANNOTATION_TEMPLATES[templateId].color : undefined
  const effectiveParsed = parsedColor ?? tryParseAnnotationColorHex(templateFallbackColor)
  const color =
    effectiveParsed && effectiveParsed !== ETL360_DEFAULT_ANNOTATION_COLOR ? effectiveParsed : undefined
  const rawKind = String(raw?.kind ?? raw?.type ?? raw?.annotationType ?? '').trim().toLowerCase()
  const yawNorm = normalizeImportedAngleToRad('yaw', raw?.yawPitch?.yaw ?? raw?.yaw, 0)
  const pitchNorm = normalizeImportedAngleToRad('pitch', raw?.yawPitch?.pitch ?? raw?.pitch, 0)
  const zoneYawNorm = normalizeImportedAngleToRad('zoneYawSpan', raw?.zone?.yawSpan ?? raw?.zoneYawSpan, Number.NaN)
  const zonePitchNorm = normalizeImportedAngleToRad(
    'zonePitchSpan',
    raw?.zone?.pitchSpan ?? raw?.zonePitchSpan,
    Number.NaN
  )
  const zoneYawSpan = zoneYawNorm.value
  const zonePitchSpan = zonePitchNorm.value
  const hasZone = zoneYawSpan > 0 && zonePitchSpan > 0
  const kind: AnnotationKind = rawKind === 'text' && hasZone ? 'text' : rawKind === 'zone' && hasZone ? 'zone' : 'point'
  const textContent = parseOptionalTrimmedString(raw?.textContent ?? raw?.text ?? raw?.texte)
  const textTone = parseAnnotationTextTone(raw?.textTone ?? raw?.textColorMode ?? raw?.text_color_mode)
  const textSizePx = parseAnnotationTextSizePx(raw?.textSizePx ?? raw?.textSize ?? raw?.text_size_px)
  debugImportedAnnotationAngleNormalization({
    annotationId: id,
    panoId,
    sourceKind: rawKind || 'unknown',
    yaw: yawNorm,
    pitch: pitchNorm,
    zoneYawSpan: zoneYawNorm,
    zonePitchSpan: zonePitchNorm,
  })
  return {
    id,
    panoId,
    label: String(raw?.label ?? raw?.identifier ?? id ?? '').trim(),
    identifier: String(raw?.identifier ?? '').trim() || undefined,
    description: String(raw?.description ?? '').trim() || undefined,
    ...(color ? { color } : {}),
    yawPitch: {
      yaw: yawNorm.value,
      pitch: pitchNorm.value,
    },
    ...(hasZone
      ? {
          kind,
          zone: {
            yawSpan: zoneYawSpan,
            pitchSpan: zonePitchSpan,
          },
        }
      : { kind: 'point' as const }),
    ...(kind === 'text' && textContent ? { textContent } : {}),
    ...(kind === 'text' && textTone ? { textTone } : {}),
    ...(kind === 'text' && textSizePx !== undefined ? { textSizePx } : {}),
    ...(hasZone && (kind === 'zone' || kind === 'text')
      ? {
          zoneFillOpacity: clampZoneFillOpacity(
            raw?.zoneFillOpacity ?? raw?.zone_fill_opacity ?? raw?.zoneFillOpacityFraction
          ),
        }
      : {}),
    ...(raw?.pointCloudTarget &&
    Number.isFinite(raw.pointCloudTarget.x) &&
    Number.isFinite(raw.pointCloudTarget.y) &&
    Number.isFinite(raw.pointCloudTarget.z)
      ? {
          pointCloudTarget: {
            x: Number(raw.pointCloudTarget.x),
            y: Number(raw.pointCloudTarget.y),
            z: Number(raw.pointCloudTarget.z),
          },
        }
      : {}),
    ...(raw?.positionLocked === true || raw?.position_locked === true || raw?.lockedPosition === true
      ? { positionLocked: true }
      : {}),
    ...(kind !== 'text' && templateId ? { templateId } : {}),
    origin,
    ...(kind !== 'text' && rawUserTemplateId ? { userTemplateId: rawUserTemplateId } : {}),
    ...(kind !== 'text'
      ? (() => {
          const cv = parseCustomTemplateValues(raw?.customTemplateValues ?? raw?.custom_template_values)
          return cv ? { customTemplateValues: cv } : {}
        })()
      : {}),
    ...(kind !== 'text' ? parseAnnotationSpecFromImportJsonRaw(raw) : {}),
    ...parseClientRemarkFromImport(raw),
  }
}

export function parseAnnotationsFromRows(rows: Array<Record<string, string>>): AnnotationRecord[] {
  return rows
    .map((row, index) => {
      const id = String(row.id || row.annotationId || `ann-${index + 1}`).trim()
      const panoId = String(row.panoId || row.pano_id || '').trim()
      if (!panoId) return null
      return normalizeImportedAnnotation(
        {
          id,
          panoId,
          label: row.label || row.identifier || id,
          identifier: row.identifier,
          description: row.description,
          type: row.type || row.kind || row.annotationType,
          color: getRowValue(row, ['color', 'marker_color', 'markercolor', 'couleur']) || undefined,
          yaw: row.yaw || row.yaw_rad,
          pitch: row.pitch || row.pitch_rad,
          zoneYawSpan: row.zoneYawSpan || row.zone_yaw_span || row.zone_yaw_span_rad,
          zonePitchSpan: row.zonePitchSpan || row.zone_pitch_span || row.zone_pitch_span_rad,
          textContent: getRowValue(row, ['textcontent', 'text', 'texte']),
          textTone: getRowValue(row, ['texttone', 'text_color_mode', 'textcolormode']),
          textSizePx: getRowValue(row, ['textsizepx', 'text_size_px', 'textsize']),
          origin: getRowValue(row, ['origin', 'annotation_origin', 'annotationorigin']),
          ...parseAnnotationSpecFromCsvRow(row, getRowValue),
          templateId: getRowValue(row, ['templateid', 'template', 'gabarit']),
        },
        id
      )
    })
    .filter(Boolean) as AnnotationRecord[]
}

export function parseAnnotationsFromJson(jsonText: string): AnnotationRecord[] {
  const raw = JSON.parse(jsonText)
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.annotations) ? raw.annotations : []
  return list
    .map((item, index) => normalizeImportedAnnotation(item, `ann-${index + 1}`))
    .filter(Boolean) as AnnotationRecord[]
}

export function sanitizePanoIdForFilename(panoId: string): string {
  return panoId.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'pano'
}

/** Nomenclature fichier : etl360.annotations.<panoId_sanitized>.json */
export function buildAnnotationsFilename(panoId: string): string {
  return `${ETL360_ANNOTATIONS_FILE_PREFIX}.${sanitizePanoIdForFilename(panoId)}.json`
}

export function matchesAnnotationsFilename(name: string): boolean {
  const n = normalizePath(name)
  return n.startsWith(`${ETL360_ANNOTATIONS_FILE_PREFIX.toLowerCase()}.`) && n.endsWith('.json')
}

/** Motifs « code d'étage » sur le seul nom de fichier (sans extension), pour dossiers plans/. */
const FLOOR_LABEL_FROM_BASENAME_RE =
  /^(n-?\d+|r\+?\d+|floor[_-]?\d+|level[_-]?\d+|niveau[_-]?\d+|story[_-]?\d+|floor[_-]?(?:minus[_-]?one|zero|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth))$/i

export function inferFloorLabelFromPath(name: string): string | null {
  const n = normalizePath(name)
  const match = n.match(
    /(?:^|\/)(n-?\d+|r\+?\d+|floor[_-]?\d+|level[_-]?\d+|floor[_-]?(?:minus[_-]?one|zero|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth))(?:\.[^.]+)?$/i
  )
  if (match?.[1]) return match[1].toUpperCase().replace(/_/g, '')
  const etageMatch = n.match(/(?:^|\/).*?(?:etage|étage)[_-]?(-?\d+)(?:\.[^.]+)?$/i)
  if (etageMatch?.[1]) return `N${Number(etageMatch[1])}`
  const inFloorsFolder = /(^|\/)(floors?|plans?|floor[_-]?plans?(?:[_-][^/]+)?)(\/|$)/i.test(n)
  if (!inFloorsFolder) return null
  // Sous-dossier explicite : viewer/plans/N2/chantier.tif → N2 (le fichier seul peut être neutre, ex. seco_etl_*.tif).
  const pathParts = n.split('/').filter(Boolean)
  if (pathParts.length >= 2) {
    const parentDir = pathParts[pathParts.length - 2]!
    const fromParent = inferFloorLabelFromPath(parentDir)
    if (fromParent) return fromParent
  }
  const base = basename(n).replace(/\.[^.]+$/, '').trim()
  if (!base) return null
  // Livrables ETL SECO : le GeoTIFF est souvent nommé comme le chantier (ex. seco_etl_3_site.tif),
  // pas comme un étage — ne pas en faire un libellé d'étage (sinon étage « fantôme » sans sémantique N1…).
  if (/\betl\b/i.test(base)) return null
  const baseFloorLike = base.match(FLOOR_LABEL_FROM_BASENAME_RE)
  if (baseFloorLike?.[1]) return baseFloorLike[1].toUpperCase().replace(/_/g, '')
  const baseEtage = base.match(/^(?:etage|étage)[_-]?(-?\d+)$/i)
  if (baseEtage?.[1]) return `N${Number(baseEtage[1])}`
  return null
}

export type GeoTiffSpatialMeta = {
  floorAltitude?: number
  /** SCR déduit des GeoKeys (ex. EPSG:2169). */
  crsLabel?: string
  worldToPixel?: {
    m00: number
    m01: number
    m02: number
    m10: number
    m11: number
    m12: number
    width: number
    height: number
  }
}

/** GeoTIFF GeoKeyDirectory tag */
const GEO_KEY_DIRECTORY_TAG = 34735
/** GeoTIFF GeoAsciiParamsTag */
const GEO_ASCII_PARAMS_TAG = 34737

/** ProjectedCSTypeGeoKey — code EPSG du SCR projeté lorsque standard. */
const GK_PROJECTED_CS_TYPE = 3072
/** GeographicTypeGeoKey */
const GK_GEOGRAPHIC_TYPE = 2048
/** VerticalCSTypeGeoKey */
const GK_VERTICAL_CS_TYPE = 4096
/** Valeur « user-defined » : lire la citation ASCII. */
const GEO_USER_DEFINED = 32767

function toUint16ArrayGeo(raw: unknown): Uint16Array | null {
  if (raw instanceof Uint16Array) return raw
  if (Array.isArray(raw)) {
    const u = new Uint16Array(raw.length)
    for (let i = 0; i < raw.length; i += 1) u[i] = Number(raw[i]) & 0xffff
    return u
  }
  if (raw instanceof Uint8Array && raw.byteLength % 2 === 0) {
    return new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2)
  }
  return null
}

function readGeoAsciiParams(ifd: any): string {
  const raw = ifd?.[`t${GEO_ASCII_PARAMS_TAG}`]
  if (raw == null) return ''
  if (typeof raw === 'string') return raw
  if (raw instanceof Uint8Array) {
    let s = ''
    for (let i = 0; i < raw.length; i += 1) {
      const c = raw[i]
      if (c === 0) s += '|'
      else if (c >= 32 && c < 127) s += String.fromCharCode(c)
    }
    return s.replace(/\|+/g, '|').trim()
  }
  return ''
}

/**
 * Extrait un libellé SCR depuis le tag GeoKeyDirectory (34735) du GeoTIFF.
 */
export function parseGeoTiffCrsLabelFromIfd(ifd: any): string | undefined {
  const keys = toUint16ArrayGeo(ifd?.[`t${GEO_KEY_DIRECTORY_TAG}`])
  if (!keys || keys.length < 8) return undefined
  const numKeys = keys[3]
  if (!Number.isFinite(numKeys) || numKeys <= 0 || keys.length < 4 + numKeys * 4) return undefined

  let projected = 0
  let geographic = 0
  let vertical = 0

  for (let i = 0; i < numKeys; i += 1) {
    const o = 4 + i * 4
    const keyId = keys[o]
    const tiffTagLoc = keys[o + 1]
    const count = keys[o + 2]
    const value = keys[o + 3]
    if (tiffTagLoc !== 0 || count !== 1) continue
    if (keyId === GK_PROJECTED_CS_TYPE) projected = value
    else if (keyId === GK_GEOGRAPHIC_TYPE) geographic = value
    else if (keyId === GK_VERTICAL_CS_TYPE) vertical = value
  }

  const parts: string[] = []
  if (projected > 0 && projected !== GEO_USER_DEFINED) {
    parts.push(`EPSG:${projected}`)
  } else if (projected === GEO_USER_DEFINED) {
    const cite = readGeoAsciiParams(ifd).replace(/\|/g, ' ').trim()
    if (cite) parts.push(cite)
    else parts.push('SCR projeté (utilisateur, GeoKey 32767 — citation absente)')
  }
  if (geographic > 0 && geographic !== GEO_USER_DEFINED && projected <= 0) {
    parts.push(`EPSG:${geographic} (géographique)`)
  }
  if (vertical > 0 && vertical !== GEO_USER_DEFINED) {
    parts.push(`EPSG:${vertical} (vertical)`)
  }

  if (parts.length === 0) return undefined
  return parts.join(' · ')
}

export function parseGeoTiffSpatialMeta(buffer: ArrayBuffer): GeoTiffSpatialMeta {
  try {
    const ifds = UTIF.decode(buffer)
    if (!ifds || ifds.length === 0) return {}
    const ifd: any = ifds[0]
    const crsLabel = parseGeoTiffCrsLabelFromIfd(ifd)
    const t34264: number[] | undefined = Array.isArray(ifd?.t34264) ? ifd.t34264 : undefined
    if (!t34264 || t34264.length < 12) {
      return crsLabel ? { crsLabel } : {}
    }

    const width = Number(ifd?.t256 || ifd?.width || 0)
    const height = Number(ifd?.t257 || ifd?.height || 0)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 1 || height <= 1) {
      return crsLabel ? { crsLabel } : {}
    }

    // GeoTIFF ModelTransformationTag (4x4 row-major): world = M * [u,v,w,1]^T
    // x = a*u + b*v + tx ; y = c*u + d*v + ty
    const a = Number(t34264[0])
    const b = Number(t34264[1])
    const tx = Number(t34264[3])
    const c = Number(t34264[4])
    const d = Number(t34264[5])
    const ty = Number(t34264[7])
    const floorAltitude = Number(t34264[11])

    const det = a * d - b * c
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
      return {
        ...(Number.isFinite(floorAltitude) ? { floorAltitude } : {}),
        ...(crsLabel ? { crsLabel } : {}),
      }
    }

    // Inverse 2x2: [u,v]^T = A^-1 * ([x,y]^T - t)
    const inv00 = d / det
    const inv01 = -b / det
    const inv10 = -c / det
    const inv11 = a / det

    const m02 = -(inv00 * tx + inv01 * ty)
    const m12 = -(inv10 * tx + inv11 * ty)

    return {
      ...(Number.isFinite(floorAltitude) ? { floorAltitude } : {}),
      ...(crsLabel ? { crsLabel } : {}),
      worldToPixel: {
        m00: inv00,
        m01: inv01,
        m02,
        m10: inv10,
        m11: inv11,
        m12,
        width,
        height,
      },
    }
  } catch {
    return {}
  }
}

/**
 * Assigne chaque panorama à un étage en se basant **d’abord** sur l’altitude
 * `position.z` (typiquement la colonne **`pano_pos_z`** du CSV de poses), puis
 * (départage) sur l’emprise 2D du GeoTIFF si `worldToPixel` existe.
 * Repère source : `x` / `y` = sol, `z` = altitude.
 * u,v : [0, W-1]×[0, H-1] comme ailleurs dans le viewer.
 */
export function assignPanosToFloorsAutomatically(panos: PanoRecord[], floorMapAssets: FloorMapAsset[]): Record<string, string> {
  const assets = floorMapAssets.filter(a => !!a.floorLabel)
  if (!assets.length) return {}
  const result: Record<string, string> = {}
  const EPS = 1e-5
  const PEN_2D_HORS_EMPRISE = 1
  const sortTie = (
    a: { zPrimary: number; xyTie: number; floorLabel: string },
    b: { zPrimary: number; xyTie: number; floorLabel: string }
  ): number => {
    if (a.zPrimary !== b.zPrimary) return a.zPrimary - b.zPrimary
    if (a.xyTie !== b.xyTie) return a.xyTie - b.xyTie
    return a.floorLabel.localeCompare(b.floorLabel, undefined, { numeric: true, sensitivity: 'base' })
  }

  for (const pano of panos) {
    const x = pano.position.x
    const y = pano.position.y
    const z = pano.position.z
    const hasXy = Number.isFinite(x) && Number.isFinite(y)
    const hasZ = Number.isFinite(z)
    if (!hasXy && !hasZ) continue

    const cands: Array<{ zPrimary: number; xyTie: number; floorLabel: string }> = []

    for (const asset of assets) {
      const wp = asset.worldToPixel
      const floorZ = Number.isFinite(asset.floorAltitude) ? Number(asset.floorAltitude) : Number.NaN
      const zMin = Number.isFinite(asset.sliceMinZ) ? Number(asset.sliceMinZ) : Number.NaN
      const zMax = Number.isFinite(asset.sliceMaxZ) ? Number(asset.sliceMaxZ) : Number.NaN
      const zInside =
        hasZ && Number.isFinite(zMin) && Number.isFinite(zMax) ? z >= zMin - EPS && z <= zMax + EPS : false
      const dz =
        hasZ && Number.isFinite(floorZ)
          ? Math.abs(z - floorZ)
          : hasZ && Number.isFinite(zMin) && Number.isFinite(zMax)
            ? z < zMin
              ? zMin - z
              : z - zMax
            : 1e9

      // Score altitude uniquement (plus bas = mieux) — jamais dominé par le 2D
      const zPrimary = !hasZ
        ? 0
        : zInside
          ? Number.isFinite(floorZ) && Number.isFinite(z)
            ? Math.min(Math.abs(z - floorZ), 1e6)
            : 0
          : Math.min(dz + 0.35, 1e9)

      let xyTie = 0
      if (hasXy && wp) {
        const u = wp.m00 * x + wp.m01 * y + wp.m02
        const v = wp.m10 * x + wp.m11 * y + wp.m12
        const w1 = Math.max(0, wp.width - 1)
        const h1 = Math.max(0, wp.height - 1)
        const inside2d = u >= -EPS && u <= w1 + EPS && v >= -EPS && v <= h1 + EPS
        if (inside2d) {
          const du = u - w1 * 0.5
          const dv = v - h1 * 0.5
          const center = Math.hypot(du, dv) / Math.max(1, w1, h1)
          xyTie = center * 0.02
        } else {
          xyTie = PEN_2D_HORS_EMPRISE
        }
      }

      cands.push({ zPrimary, xyTie, floorLabel: asset.floorLabel })
    }

    cands.sort(sortTie)
    if (cands[0]) result[pano.id] = cands[0].floorLabel
  }
  return result
}

export type NearestCloudFloorAlignOptions = {
  /** Demi-épaisseur (m) pour dériver une bande Z à partir de `floorAltitude` seul. défaut 0,225 */
  sliceHalfM?: number
  /** Stride sur le tableau de positions (3 floats par point). défaut 4 */
  positionStride?: number
}

/** Entrée pour dimensionner les poignées Fabric (import plan) selon le raster importé et le scale CSS. */
export type FloorPlanImportControlMetricsInput = {
  importSrcW: number
  importSrcH: number
  /** Facteur `transform: scale()` sur le wrapper (≤ 1 quand le canvas est réduit dans la modale). */
  canvasCssScale: number
}

/** Tailles / traits des poignées (px canvas Fabric, pas px écran). */
export type FloorPlanImportControlMetrics = {
  edgeBar: number
  depthBar: number
  strokePx: number
  cornerSize: number
  touchCornerSize: number
  rotRadius: number
}

/**
 * Poignées proportionnelles au **plus grand côté** du bitmap importé (ex. page PDF rasterisée),
 * avec surcroit quand `canvasCssScale` est petit (les poignées seraient sinon minuscules à l’écran).
 */
export function floorPlanImportControlMetrics(input: FloorPlanImportControlMetricsInput): FloorPlanImportControlMetrics {
  const iw = Math.max(1, Number.isFinite(input.importSrcW) ? input.importSrcW : 1)
  const ih = Math.max(1, Number.isFinite(input.importSrcH) ? input.importSrcH : 1)
  const ref = Math.max(iw, ih)
  const css = Math.max(0.06, Math.min(1, Number.isFinite(input.canvasCssScale) ? input.canvasCssScale : 1))
  const visBoost = 1 / css

  const base = Math.max(10, Math.min(140, ref * 0.0055))
  const edgeBar = Math.round(Math.max(16, Math.min(96, base * visBoost * 1.15)))
  const depthBar = Math.round(Math.max(48, Math.min(280, base * visBoost * 3.6)))
  const strokePx = Math.max(2.25, Math.min(7, base * 0.095 * visBoost))
  const cornerSize = Math.round(Math.max(18, Math.min(100, base * 1.65 * visBoost)))
  const touchCornerSize = Math.round(Math.max(52, Math.min(240, cornerSize * 2.35)))
  const rotRadius = Math.round(Math.max(12, Math.min(56, base * 1.2 * visBoost)))
  return { edgeBar, depthBar, strokePx, cornerSize, touchCornerSize, rotRadius }
}

export type FloorPlanImportLayerKey = 'importedRaster' | 'originalPlan'

/** Retourne les calques manquants pour la modale d’import (raster importé vs plan d’étage d’origine). */
export function floorPlanImportMissingLayers(input: {
  importedDataUrl: string | null | undefined
  originalPlanImageUrl: string | null | undefined
}): FloorPlanImportLayerKey[] {
  const miss: FloorPlanImportLayerKey[] = []
  const imp = String(input.importedDataUrl ?? '').trim()
  const orig = String(input.originalPlanImageUrl ?? '').trim()
  if (!imp || imp === 'data:,') miss.push('importedRaster')
  if (!orig) miss.push('originalPlan')
  return miss
}

function floorAssetZBandForCloudPlacement(
  asset: FloorMapAsset,
  sliceHalfM: number
): { z0: number; z1: number; zRef: number } | null {
  const zMin = asset.sliceMinZ
  const zMax = asset.sliceMaxZ
  if (Number.isFinite(zMin) && Number.isFinite(zMax)) {
    const zRef = Number.isFinite(asset.floorAltitude) ? Number(asset.floorAltitude) : (zMin + zMax) / 2
    return { z0: zMin, z1: zMax, zRef }
  }
  const fz = asset.floorAltitude
  if (Number.isFinite(fz)) {
    const h = sliceHalfM
    return { z0: fz - h, z1: fz + h, zRef: fz }
  }
  return null
}

function zDistanceOutsideBand(z: number, z0: number, z1: number): number {
  const lo = Math.min(z0, z1)
  const hi = Math.max(z0, z1)
  if (z >= lo && z <= hi) return 0
  if (z < lo) return lo - z
  return z - hi
}

/**
 * Moyenne des points du nuage dont la distance horizontale à (px,py) est minimale (égalité incluse).
 */
function averageCloudPointsAtMinHorizontalDist(
  positions: Float32Array,
  px: number,
  py: number,
  stride: number
): { x: number; y: number; z: number } | null {
  let bestD2 = Number.POSITIVE_INFINITY
  const n = Math.floor(positions.length / 3)
  for (let i = 0; i < n; i += stride) {
    const o = i * 3
    const x = positions[o]!
    const y = positions[o + 1]!
    const z = positions[o + 2]!
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    const dx = x - px
    const dy = y - py
    const d2 = dx * dx + dy * dy
    if (d2 < bestD2) bestD2 = d2
  }
  if (!Number.isFinite(bestD2) || bestD2 === Number.POSITIVE_INFINITY) return null
  const eps = Math.max(1e-10, bestD2 * 1e-12 + 1e-18)
  let sx = 0
  let sy = 0
  let sz = 0
  let c = 0
  for (let i = 0; i < n; i += stride) {
    const o = i * 3
    const x = positions[o]!
    const y = positions[o + 1]!
    const z = positions[o + 2]!
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    const dx = x - px
    const dy = y - py
    const d2 = dx * dx + dy * dy
    if (d2 <= bestD2 + eps) {
      sx += x
      sy += y
      sz += z
      c += 1
    }
  }
  if (c === 0) return null
  return { x: sx / c, y: sy / c, z: sz / c }
}

function pickNearestFloorAssetForZ(
  assetsWithBand: Array<{ asset: FloorMapAsset; band: { z0: number; z1: number; zRef: number } }>,
  z: number
): FloorMapAsset | null {
  const inside = assetsWithBand.filter(({ band }) => zDistanceOutsideBand(z, band.z0, band.z1) === 0)
  if (inside.length > 0) {
    const chosen = inside.reduce((best, cur) => {
      const da = Math.abs(z - cur.band.zRef)
      const db = Math.abs(z - best.band.zRef)
      if (da < db - 1e-9) return cur
      if (Math.abs(da - db) < 1e-9) {
        return cur.asset.floorLabel.localeCompare(best.asset.floorLabel, undefined, {
          numeric: true,
          sensitivity: 'base',
        }) < 0
          ? cur
          : best
      }
      return best
    })
    return chosen.asset
  }
  const chosen = assetsWithBand.reduce((best, cur) => {
    const da = zDistanceOutsideBand(z, cur.band.z0, cur.band.z1)
    const db = zDistanceOutsideBand(z, best.band.z0, best.band.z1)
    if (da < db - 1e-9) return cur
    if (Math.abs(da - db) < 1e-9) {
      return cur.asset.floorLabel.localeCompare(best.asset.floorLabel, undefined, {
        numeric: true,
        sensitivity: 'base',
      }) < 0
        ? cur
        : best
    }
    return best
  })
  return chosen.asset
}

/**
 * À partir de la pose CSV (X,Y), prend les points du nuage à distance horizontale minimale, utilise leur Z
 * pour choisir l’étage GeoTIFF le plus proche (bande Z / altitude), puis aligne la pose pano sur la moyenne
 * (X,Y,Z) de ce sous-ensemble (pas de rayon de cylindre).
 */
export function assignNearestFloorAndPositionsFromCloudPoint(
  panos: PanoRecord[],
  floorMapAssets: FloorMapAsset[],
  sourcePositions: Float32Array,
  options?: NearestCloudFloorAlignOptions
): { panoFloorAssignments: Record<string, string>; panos: PanoRecord[]; warnings: string[] } {
  const sliceHalfM = Math.max(0.025, options?.sliceHalfM ?? 0.225)
  const stride = Math.max(1, Math.floor(options?.positionStride ?? 4))

  const warnings: string[] = []
  const assetsWithBand = floorMapAssets
    .map(asset => ({ asset, band: floorAssetZBandForCloudPlacement(asset, sliceHalfM) }))
    .filter((x): x is { asset: FloorMapAsset; band: { z0: number; z1: number; zRef: number } } => !!x.band)

  if (assetsWithBand.length === 0) {
    warnings.push(
      'Aucun plan GeoTIFF avec altitude (bande Z ou floorAltitude) — impossible de comparer au nuage.'
    )
    return { panoFloorAssignments: {}, panos, warnings }
  }

  const panoFloorAssignments: Record<string, string> = {}
  const panosOut: PanoRecord[] = []

  for (const pano of panos) {
    const px = pano.position.x
    const py = pano.position.y
    const pz = pano.position.z
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      panosOut.push(pano)
      continue
    }

    const near = averageCloudPointsAtMinHorizontalDist(sourcePositions, px, py, stride)
    if (!near) {
      warnings.push(`Pano ${pano.displayLabel ?? pano.id} : aucun point nuage — pose inchangée.`)
      panosOut.push(pano)
      continue
    }

    const chosenAsset = pickNearestFloorAssetForZ(assetsWithBand, near.z)
    const label = chosenAsset?.floorLabel?.trim()
    if (!label) {
      panosOut.push(pano)
      continue
    }

    panoFloorAssignments[pano.id] = label
    panosOut.push({
      ...pano,
      position: {
        x: near.x,
        y: near.y,
        z: Number.isFinite(near.z) ? near.z : pz,
      },
    })
  }

  return { panoFloorAssignments, panos: panosOut, warnings }
}

/**
 * Ne conserve que les assignations d'étage dont le libellé existe parmi les plans importés.
 * Évite les étages « fantômes » (ex. ancien N6 en localStorage) et les panoramas mal classés
 * lorsque le même code projet a servi à un autre jeu de plans.
 */
export function filterFloorAssignmentsToKnownPlans(
  assignments: Record<string, string>,
  floorMapAssets: FloorMapAsset[]
): Record<string, string> {
  const valid = new Set<string>()
  for (const a of floorMapAssets) {
    const lab = a.floorLabel?.trim()
    if (lab) valid.add(lab)
  }
  if (valid.size === 0) return { ...assignments }
  const out: Record<string, string> = {}
  for (const [panoId, raw] of Object.entries(assignments)) {
    const v = String(raw ?? '').trim()
    if (v && valid.has(v)) out[panoId] = v
  }
  return out
}

export function buildFloorOrderByAltitude(floorMapAssets: FloorMapAsset[]): Record<string, number> {
  const byLabel = new Map<string, number>()
  for (const asset of floorMapAssets) {
    const label = asset.floorLabel?.trim()
    if (!label) continue
    const z = Number(asset.floorAltitude)
    if (!Number.isFinite(z)) continue
    if (!byLabel.has(label) || z < (byLabel.get(label) as number)) byLabel.set(label, z)
  }
  const sorted = Array.from(byLabel.entries()).sort((a, b) => a[1] - b[1])
  const order: Record<string, number> = {}
  sorted.forEach(([label], idx) => {
    order[label] = idx
  })
  return order
}

/** Extension fichier (avec le point), par défaut .jpg si absente. */
export function extensionFromFilename(filename: string): string {
  const m = /\.[a-zA-Z0-9]{1,8}$/i.exec(filename.trim())
  return m ? m[0].toLowerCase() : '.jpg'
}

/**
 * Numéro d'étage affiché 1..N (bas → haut) par libellé de plan, pour le pattern etage_*_pano_*.
 */
export function etageDisplayNumberByFloorLabel(
  floorByPanoId: Record<string, string>,
  floorMapAssets: FloorMapAsset[]
): Map<string, number> {
  const labels = new Set<string>()
  for (const v of Object.values(floorByPanoId)) {
    const s = String(v || '').trim()
    if (s) labels.add(s)
  }
  const labelToMinOrder = new Map<string, number>()
  for (const a of floorMapAssets) {
    const lab = a.floorLabel?.trim()
    if (!lab || !labels.has(lab)) continue
    if (a.floorOrder === undefined || a.floorOrder === null) continue
    const prev = labelToMinOrder.get(lab)
    if (prev === undefined || a.floorOrder < prev) labelToMinOrder.set(lab, a.floorOrder)
  }
  const ordered = [...labels].sort((a, b) => {
    const oa = labelToMinOrder.get(a)
    const ob = labelToMinOrder.get(b)
    if (oa !== undefined && ob !== undefined && oa !== ob) return oa - ob
    if (oa !== undefined && ob === undefined) return -1
    if (oa === undefined && ob !== undefined) return 1
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  })
  const map = new Map<string, number>()
  ordered.forEach((lab, i) => map.set(lab, i + 1))
  return map
}

/**
 * Renommage affiché à l'import ZIP : etage_{numéro étage}_pano_{index sur l'étage}.
 * L'ordre dans chaque étage suit l'ordre de fusion des panoramas (ZIP + préfixe id).
 */
export function applyZipImportAutoPanoNames(
  panos: PanoRecord[],
  floorByPanoId: Record<string, string>,
  floorMapAssets: FloorMapAsset[]
): PanoRecord[] {
  const etageByLabel = etageDisplayNumberByFloorLabel(floorByPanoId, floorMapAssets)
  const counterByFloorKey = new Map<string, number>()
  return panos.map(p => {
    const fl = (floorByPanoId[p.id] || '').trim()
    const floorKey = fl || '__unassigned__'
    const next = (counterByFloorKey.get(floorKey) || 0) + 1
    counterByFloorKey.set(floorKey, next)
    const etage = fl ? etageByLabel.get(fl) ?? 0 : 0
    const base = `etage_${etage}_pano_${next}`
    const ext = extensionFromFilename(p.filename)
    return {
      ...p,
      displayLabel: base,
      filename: `${base}${ext}`,
    }
  })
}

export async function convertTiffBlobToJpegBlob(tiffBlob: Blob, debugLabel: string): Promise<Blob | null> {
  const log = (...args: unknown[]) => console.log('[ETL360][TIFF]', debugLabel, ...args)
  try {
    log('debut conversion, blob size octets=', tiffBlob.size)
    const buffer = await tiffBlob.arrayBuffer()
    const head = new Uint8Array(buffer.slice(0, 8))
    log(
      'en-tete (8o)=',
      Array.from(head)
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ')
    )
    const ifds = UTIF.decode(buffer)
    log('UTIF.decode ifds count=', ifds?.length ?? 0)
    if (!ifds || ifds.length === 0) {
      log('echec: aucun IFD')
      return null
    }
    const ifd = ifds[0]
    UTIF.decodeImage(buffer, ifd)
    const rgba = UTIF.toRGBA8(ifd)
    log('toRGBA8 length=', rgba?.length ?? 0)
    const width = Number((ifd as any).width || 0)
    const height = Number((ifd as any).height || 0)
    log('dimensions ifd width x height=', width, height)
    if (!width || !height) {
      log('echec: dimensions invalides')
      return null
    }
    if (width * height > 25_000_000) {
      log('attention: image tres grande (pixels=', width * height, '), risque echec canvas/toBlob')
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      log('echec: getContext 2d null')
      return null
    }

    const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height)
    ctx.putImageData(imageData, 0, 0)
    log('putImageData ok')

    const jpegBlob = await new Promise<Blob | null>(resolve => {
      canvas.toBlob(blob => {
        log('canvas.toBlob result type=', blob?.type, 'size=', blob?.size ?? null)
        resolve(blob)
      }, 'image/jpeg', 0.92)
    })
    if (!jpegBlob) log('echec: toBlob a retourne null')
    return jpegBlob
  } catch (err) {
    console.warn('[ETL360][TIFF]', debugLabel, 'exception', err)
    return null
  }
}

export function buildAnnotationsDocument(
  pano: PanoRecord,
  list: AnnotationRecord[],
  projectCode: string,
  assignedFloorLabel: string
): AnnotationsDocument {
  const floor = assignedFloorLabel.trim()
  const annotations = list.map(ann => ({
    id: ann.id,
    panoId: ann.panoId,
    label: ann.label,
    identifier: ann.identifier,
    description: ann.description,
    kind: annotationKind(ann),
    ...(ann.color ? { color: ann.color } : {}),
    ...(annotationPositionLocked(ann) ? { positionLocked: true } : {}),
    yawPitch: ann.yawPitch,
    ...(annotationKind(ann) !== 'point' && ann.zone ? { zone: ann.zone } : {}),
    ...(annotationKind(ann) === 'text' && ann.textContent?.trim() ? { textContent: ann.textContent.trim() } : {}),
    ...(annotationKind(ann) === 'text' && ann.textTone ? { textTone: ann.textTone } : {}),
    ...(annotationKind(ann) === 'text' && ann.textSizePx !== undefined ? { textSizePx: ann.textSizePx } : {}),
    ...(ann.pointCloudTarget
      ? {
          pointCloudTarget: {
            x: ann.pointCloudTarget.x,
            y: ann.pointCloudTarget.y,
            z: ann.pointCloudTarget.z,
          },
        }
      : {}),
    ...(annotationKind(ann) !== 'text' && ann.lifespan ? { lifespan: ann.lifespan } : {}),
    ...(annotationKind(ann) !== 'text' && ann.electricConsumption ? { electricConsumption: ann.electricConsumption } : {}),
    ...(annotationKind(ann) !== 'text' && ann.lightOutputLux !== undefined ? { lightOutputLux: ann.lightOutputLux } : {}),
    ...(annotationKind(ann) !== 'text' && ann.material ? { material: ann.material } : {}),
    ...(annotationKind(ann) !== 'text' && ann.weightKg !== undefined ? { weightKg: ann.weightKg } : {}),
    ...(annotationKind(ann) !== 'text' && ann.purchasePrice !== undefined ? { purchasePrice: ann.purchasePrice } : {}),
    ...(annotationKind(ann) !== 'text' && ann.crackLengthCm !== undefined ? { crackLengthCm: ann.crackLengthCm } : {}),
    ...(annotationKind(ann) !== 'text' && ann.crackWidthCm !== undefined ? { crackWidthCm: ann.crackWidthCm } : {}),
    ...((annotationKind(ann) === 'zone' || annotationKind(ann) === 'text') && ann.zone
      ? { zoneFillOpacity: clampZoneFillOpacity(ann.zoneFillOpacity) }
      : {}),
    ...(annotationKind(ann) !== 'text' && ann.templateId ? { templateId: ann.templateId } : {}),
    origin: annotationOrigin(ann),
    ...(annotationKind(ann) !== 'text' && ann.userTemplateId ? { userTemplateId: ann.userTemplateId } : {}),
    ...(annotationKind(ann) !== 'text' && ann.customTemplateValues && Object.keys(ann.customTemplateValues).length
      ? { customTemplateValues: ann.customTemplateValues }
      : {}),
    ...(ann.clientRemark
      ? {
          clientRemark: {
            text: ann.clientRemark.text.trim(),
            status: ann.clientRemark.status,
            ...(ann.clientRemark.updatedAt?.trim() ? { updatedAt: ann.clientRemark.updatedAt.trim() } : {}),
          },
        }
      : {}),
  }))
  return {
    schema: ETL360_ANNOTATIONS_SCHEMA_V4,
    panoId: pano.id,
    panoDisplayName: pano.displayLabel?.trim() || pano.filename,
    assignedFloorLabel: floor || undefined,
    projectCode: projectCode || undefined,
    exportedAt: new Date().toISOString(),
    annotations,
  }
}

export function parseAnnotationsDocument(text: string): AnnotationsDocument | null {
  try {
    const raw = JSON.parse(text)
    const s = raw?.schema
    if (
      s !== ETL360_ANNOTATIONS_SCHEMA_V1 &&
      s !== ETL360_ANNOTATIONS_SCHEMA_V2 &&
      s !== ETL360_ANNOTATIONS_SCHEMA_V3 &&
      s !== ETL360_ANNOTATIONS_SCHEMA_V4
    ) {
      return null
    }
    if (typeof raw?.panoId !== 'string' || !Array.isArray(raw?.annotations)) return null
    const annotations = (raw.annotations as any[])
      .map((item, index) => normalizeImportedAnnotation(item, `ann-${index + 1}`))
      .filter((a): a is AnnotationRecord => a !== null)
    return {
      schema: s,
      panoId: raw.panoId,
      panoDisplayName: raw.panoDisplayName,
      assignedFloorLabel: raw.assignedFloorLabel,
      projectCode: raw.projectCode,
      exportedAt: raw.exportedAt,
      annotations,
    }
  } catch {
    return null
  }
}

export function downloadJsonFile(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function newAnnotationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Ligne récapitulative des champs techniques (PDF, infobulle). */
export function formatAnnotationSpecsLine(
  ann: AnnotationRecord,
  userTemplates: UserAnnotationTemplate[] = []
): string {
  if (annotationKind(ann) === 'text') return ''
  const parts: string[] = [...annotationBuiltinSpecLineParts(ann)]
  const surfacePart = formatIntegratedSurfaceMatierePart(ann)
  if (surfacePart) parts.push(surfacePart)
  const matiereCb = formatMatiereWidgetCheckboxLine(ann)
  if (matiereCb) parts.push(matiereCb)
  const ut = ann.userTemplateId ? userTemplates.find(t => t.id === ann.userTemplateId) : undefined
  if (ut && ann.customTemplateValues) {
    for (const c of ut.characteristics) {
      const v = ann.customTemplateValues[c.key]
      if (v !== undefined && String(v).trim()) parts.push(`${c.label}: ${v}`)
    }
  }
  if (ann.templateId && ann.customTemplateValues) {
    const iov = integratedTemplateOverride(ann.templateId, userTemplates)
    if (iov) {
      for (const c of iov.characteristics) {
        const v = ann.customTemplateValues[c.key]
        if (v !== undefined && String(v).trim()) parts.push(`${c.label}: ${v}`)
      }
    }
  }
  return parts.join(' · ')
}

/** Texte d’infobulle : identifiant — description (ou seulement l’identifiant). */
export function annotationHoverTitle(
  annotation: AnnotationRecord,
  userTemplates: UserAnnotationTemplate[] = []
): string {
  const ident = annotation.identifier || annotation.label || annotation.id
  const desc = (annotation.description || '').trim()
  const tpl = resolvedTemplateLabel(annotation, userTemplates)
  const kind = annotationKind(annotation)
  const origin = annotationOrigin(annotation)
  const originBadge = origin === 'client_remark' ? '[Remarque client]' : ''
  const lockSuffix = annotationPositionLocked(annotation) ? ' [position verrouillee]' : ''
  const specs = formatAnnotationSpecsLine(annotation, userTemplates)
  const textInfo =
    kind === 'text' && (annotation.textContent || '').trim()
      ? `Texte: ${(annotation.textContent || '').trim()}`
      : ''
  const baseParts = [
    originBadge,
    tpl ? `[${tpl}]` : '',
    `id: ${ident}${lockSuffix}`,
    desc ? `notes: ${desc}` : '',
  ].filter(Boolean)
  const base = baseParts.join(' — ')
  const tails = [specs, textInfo].filter(Boolean).join(' · ')
  return tails ? `${base} · ${tails}` : base
}

function annotationHoverTooltipText(
  annotation: AnnotationRecord,
  userTemplates: UserAnnotationTemplate[] = []
): string {
  const ident = annotation.identifier || annotation.label || annotation.id
  const desc = (annotation.description || '').trim()
  const tpl = resolvedTemplateLabel(annotation, userTemplates)
  const kind = annotationKind(annotation)
  const lines: string[] = []
  if (annotationOrigin(annotation) === 'client_remark') lines.push('Remarque client')
  if (tpl) lines.push(tpl)
  lines.push(`id: ${ident}`)
  if (desc) lines.push(`notes: ${desc}`)
  if (annotationPositionLocked(annotation)) lines.push('Position verrouillee')
  const specs = formatAnnotationSpecsLine(annotation, userTemplates)
  if (specs) lines.push(specs)
  if (kind === 'text' && (annotation.textContent || '').trim()) {
    lines.push(`Texte: ${(annotation.textContent || '').trim()}`)
  }
  return lines.join('\n')
}

function neighborPanoHoverTooltipText(titlePrefix: string, pano: PanoRecord): string {
  const label = pano.displayLabel?.trim() || pano.filename || pano.id
  const floorLabel = (pano.floorLabel || '').trim()
  return [titlePrefix, label, floorLabel ? `Etage: ${floorLabel}` : '']
    .filter(Boolean)
    .join('\n')
}

export function localStorageKeyForPano(projectCode: string, panoId: string): string {
  const p = projectCode.trim() || 'local'
  return `etl360.v1.annotations:${p}:${panoId}`
}

export function localStorageKeyForPanoExposure(projectCode: string, panoId: string): string {
  const p = projectCode.trim() || 'local'
  return `etl360.v1.exposure:${p}:${panoId}`
}

async function readResolvedE57Package(
  entries: JSZip.JSZipObject[],
  zipRootPrefix = ''
): Promise<{ manifest: E57PointCloudManifest; chunks: Array<{ meta: E57PointCloudChunkMeta; positions: Float32Array }> }> {
  const manifestEntry =
    entries.find(entry => normalizePath(stripZipRootPrefix(entry.name, zipRootPrefix)) === 'manifest.json') ||
    entries.find(entry => basename(entry.name).toLowerCase() === 'manifest.json')
  if (!manifestEntry) {
    throw new Error('ZIP invalide : manifest.json du nuage E57 introuvable.')
  }

  let manifest: E57PointCloudManifest
  try {
    manifest = JSON.parse(await manifestEntry.async('text')) as E57PointCloudManifest
  } catch {
    throw new Error('ZIP invalide : manifest.json du nuage E57 illisible.')
  }
  if (manifest.format !== 'point-chunks-v1') {
    throw new Error(`Format de package E57 non supporte: ${String(manifest.format || '')}`)
  }
  if (!Array.isArray(manifest.chunks) || manifest.chunks.length === 0) {
    throw new Error('ZIP invalide : aucun chunk E57 declare dans manifest.json.')
  }

  const chunks: Array<{ meta: E57PointCloudChunkMeta; positions: Float32Array }> = []
  for (const chunk of manifest.chunks) {
    const targetPath = normalizePath(chunk.file)
    const entry =
      entries.find(item => normalizePath(stripZipRootPrefix(item.name, zipRootPrefix)) === targetPath) ||
      entries.find(item => basename(item.name).toLowerCase() === basename(chunk.file).toLowerCase())
    if (!entry) {
      throw new Error(`ZIP incomplet : chunk E57 manquant (${chunk.file}).`)
    }
    const buffer = await entry.async('arraybuffer')
    if (buffer.byteLength % 12 !== 0) {
      throw new Error(`Chunk E57 invalide (${chunk.file}) : taille binaire inattendue.`)
    }
    const raw = new Float32Array(buffer)
    chunks.push({ meta: chunk, positions: decodeE57ChunkPositionsBuffer(raw, manifest) })
  }
  const order = parseChunkAxesOrderFromManifest(manifest)
  const [dx, dy, dz] = parseChunkTranslationFromManifest(manifest)
  if (order === 'xyz' && dx === 0 && dy === 0 && dz === 0) {
    return { manifest, chunks }
  }
  let combinedLen = 0
  for (const c of chunks) combinedLen += c.positions.length
  const combined = new Float32Array(combinedLen)
  let offset = 0
  for (const c of chunks) {
    combined.set(c.positions, offset)
    offset += c.positions.length
  }
  const recomputed = computePointCloudXYBounds(combined)
  const manifestOut: E57PointCloudManifest = recomputed
    ? { ...manifest, bounds: recomputed }
    : { ...manifest }
  return { manifest: manifestOut, chunks }
}

function computePointCloudXYBounds(positions: Float32Array): {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
} | null {
  if (positions.length < 3) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]
    const y = positions[i + 1]
    const z = positions[i + 2]
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return null
  }
  return { minX, maxX, minY, maxY, minZ, maxZ }
}

function buildAltitudeClustersFromPanos(
  panos: PanoRecord[],
  mergeTolerance = 0.25
): Array<{ center: number; count: number }> {
  const zs = panos
    .map(p => p.position.z)
    .filter(z => Number.isFinite(z))
    .map(z => Number(z))
    .sort((a, b) => a - b)
  if (zs.length === 0) return []
  const clusters: Array<{ sum: number; count: number; center: number }> = []
  for (const z of zs) {
    const last = clusters[clusters.length - 1]
    if (!last || Math.abs(z - last.center) > mergeTolerance) {
      clusters.push({ sum: z, count: 1, center: z })
      continue
    }
    last.sum += z
    last.count += 1
    last.center = last.sum / last.count
  }
  return clusters.map(c => ({ center: c.center, count: c.count }))
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), 'image/png')
  })
}

/**
 * Build an altitude histogram from point cloud positions.
 * Returns bin centers (altitude) and counts, suitable for drawing a Y/Z profile.
 * Altitude axis is positions[i+1] (Three.js Y convention used in the pipeline).
 */
export function buildAltitudeHistogram(
  positions: Float32Array,
  binCount = 120
): { bins: Array<{ alt: number; count: number }>; minAlt: number; maxAlt: number } {
  const bounds = computePointCloudXYBounds(positions)
  if (!bounds) return { bins: [], minAlt: 0, maxAlt: 0 }
  const minAlt = bounds.minY
  const maxAlt = bounds.maxY
  const span = Math.max(maxAlt - minAlt, 1e-6)
  const counts = new Uint32Array(binCount)
  for (let i = 1; i < positions.length; i += 3) {
    const alt = positions[i]
    if (!Number.isFinite(alt)) continue
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor(((alt - minAlt) / span) * (binCount - 1))))
    counts[idx]++
  }
  const bins: Array<{ alt: number; count: number }> = []
  for (let i = 0; i < binCount; i++) {
    bins.push({ alt: minAlt + (i + 0.5) * (span / binCount), count: counts[i] })
  }
  return { bins, minAlt, maxAlt }
}

/**
 * Build a 2D side profile image (horizontal extent × altitude) from the point cloud.
 * The Y axis of the image is altitude (top = maxAlt, bottom = minAlt).
 * The X axis uses the longest horizontal span (X or Z).
 * Returns a JPEG data URL and the altitude bounds used for rendering.
 */
export function buildSideProfileDataUrl(
  positions: Float32Array,
  opts: { width?: number; height?: number } = {}
): { dataUrl: string; minAlt: number; maxAlt: number } | null {
  const bounds = computePointCloudXYBounds(positions)
  if (!bounds) return null

  const W = Math.max(200, opts.width ?? 700)
  const H = Math.max(100, opts.height ?? 320)

  const minAlt = bounds.minY
  const maxAlt = bounds.maxY
  const spanAlt = Math.max(maxAlt - minAlt, 1e-6)

  // Choose the horizontal axis with the largest span
  const spanX = bounds.maxX - bounds.minX
  const spanZ = bounds.maxZ - bounds.minZ
  const useZ = spanZ > spanX
  const minHoriz = useZ ? bounds.minZ : bounds.minX
  const spanHoriz = Math.max(useZ ? spanZ : spanX, 1e-6)

  const hist = new Uint32Array(W * H)
  let maxBin = 0

  for (let i = 0; i + 2 < positions.length; i += 3) {
    const horiz = useZ ? positions[i + 2] : positions[i]
    const alt = positions[i + 1]
    if (!Number.isFinite(horiz) || !Number.isFinite(alt)) continue
    const u = Math.max(0, Math.min(W - 1, Math.round(((horiz - minHoriz) / spanHoriz) * (W - 1))))
    // Flip V so high altitude = top
    const v = Math.max(0, Math.min(H - 1, Math.round((1 - (alt - minAlt) / spanAlt) * (H - 1))))
    const bin = v * W + u
    const next = Math.min(65535, hist[bin] + 1)
    hist[bin] = next
    if (next > maxBin) maxBin = next
  }

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const img = ctx.createImageData(W, H)
  for (let p = 0; p < hist.length; p++) {
    const v = hist[p]
    const o = p * 4
    if (v === 0) {
      img.data[o] = 8; img.data[o + 1] = 10; img.data[o + 2] = 18; img.data[o + 3] = 255
    } else {
      const t = Math.sqrt(v / maxBin)
      img.data[o]     = Math.round(20 + t * 110)
      img.data[o + 1] = Math.round(50 + t * 170)
      img.data[o + 2] = Math.round(90 + t * 165)
      img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.88), minAlt, maxAlt }
}

/**
 * Build a small top-down floor plan image for a given altitude slice.
 * Used as a mini-preview in the slice placement UI.
 */
export function buildSlicePreviewDataUrl(
  positions: Float32Array,
  altCenter: number,
  sliceThickness = 0.30,
  W = 180,
  H = 140
): string | null {
  const bounds = computePointCloudXYBounds(positions)
  if (!bounds) return null

  const half = sliceThickness / 2
  const minZ = altCenter - half
  const maxZ = altCenter + half

  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6)
  const spanY = Math.max(bounds.maxZ - bounds.minZ, 1e-6)
  const scaleX = (W - 1) / spanX
  const scaleY = (H - 1) / spanY

  const hist = new Uint32Array(W * H)
  let maxBin = 0

  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]
    const z = positions[i + 1] // altitude
    const y = positions[i + 2]
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    if (z < minZ || z > maxZ) continue
    const u = Math.max(0, Math.min(W - 1, Math.round((x - bounds.minX) * scaleX)))
    const v = Math.max(0, Math.min(H - 1, Math.round((y - bounds.minZ) * scaleY)))
    const bin = v * W + u
    const next = Math.min(65535, hist[bin] + 1)
    hist[bin] = next
    if (next > maxBin) maxBin = next
  }

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const img = ctx.createImageData(W, H)
  for (let p = 0; p < hist.length; p++) {
    const v = hist[p]
    const o = p * 4
    const intensity = v <= 0 || maxBin <= 0 ? 10 : Math.min(255, Math.round(22 + Math.sqrt(v / maxBin) * 220))
    img.data[o] = intensity; img.data[o + 1] = intensity; img.data[o + 2] = intensity; img.data[o + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.80)
}

export async function buildFloorMapAssetsFromPointCloudSlices(options: {
  positions: Float32Array
  panos: PanoRecord[]
  objectUrlsSink?: string[]
  mergeToleranceMeters?: number
  sliceHeightMeters?: number
  rasterWidthPx?: number
  /** Explicit slice center altitudes (Z); when provided, pano-based clustering is skipped. */
  explicitSliceCenters?: number[]
}): Promise<{ floorMapAssets: FloorMapAsset[]; warnings: string[] }> {
  const warnings: string[] = []
  const bounds = computePointCloudXYBounds(options.positions)
  if (!bounds) {
    warnings.push('Nuage E57 invalide : impossible de calculer des plans d etage.')
    return { floorMapAssets: [], warnings }
  }

  const mergeTolerance = Math.max(0.01, options.mergeToleranceMeters ?? 0.15)
  const sliceHeight = Math.max(0.05, options.sliceHeightMeters ?? 0.45)
  const rasterWidth = Math.max(320, Math.min(1600, Math.floor(options.rasterWidthPx ?? 900)))
  const halfSlice = sliceHeight / 2

  let zCenters: number[]
  if (options.explicitSliceCenters && options.explicitSliceCenters.length > 0) {
    zCenters = options.explicitSliceCenters
  } else {
    const clusters = buildAltitudeClustersFromPanos(options.panos, mergeTolerance)
    zCenters = clusters.length > 0 ? clusters.map(c => c.center) : [((bounds.minY + bounds.maxY) / 2) || 0]
  }

  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6)
  const spanY = Math.max(bounds.maxZ - bounds.minZ, 1e-6)
  const rasterHeight = Math.max(260, Math.min(1400, Math.round(rasterWidth * (spanY / spanX))))
  const scaleX = (rasterWidth - 1) / spanX
  const scaleY = (rasterHeight - 1) / spanY

  const floorMapAssets: FloorMapAsset[] = []
  for (let idx = 0; idx < zCenters.length; idx += 1) {
    const centerZ = zCenters[idx]
    const minZ = centerZ - halfSlice
    const maxZ = centerZ + halfSlice
    const hist = new Uint16Array(rasterWidth * rasterHeight)
    let keptPoints = 0
    let maxBin = 0
    for (let i = 0; i + 2 < options.positions.length; i += 3) {
      const x = options.positions[i]
      const z = options.positions[i + 1]
      const y = options.positions[i + 2]
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
      if (z < minZ || z > maxZ) continue
      const u = Math.max(0, Math.min(rasterWidth - 1, Math.round((x - bounds.minX) * scaleX)))
      const v = Math.max(0, Math.min(rasterHeight - 1, Math.round((y - bounds.minZ) * scaleY)))
      const bin = v * rasterWidth + u
      const next = Math.min(65535, hist[bin] + 1)
      hist[bin] = next
      if (next > maxBin) maxBin = next
      keptPoints += 1
    }
    if (keptPoints === 0) {
      warnings.push(`Aucun point E57 pour la coupe d etage ${idx + 1} (Z=${centerZ.toFixed(2)}m).`)
      continue
    }

    const canvas = document.createElement('canvas')
    canvas.width = rasterWidth
    canvas.height = rasterHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      warnings.push(`Canvas indisponible pour generer le plan d etage ${idx + 1}.`)
      continue
    }
    const image = ctx.createImageData(rasterWidth, rasterHeight)
    for (let p = 0; p < hist.length; p += 1) {
      const v = hist[p]
      const intensity = v <= 0 || maxBin <= 0 ? 12 : Math.min(255, Math.round(24 + Math.sqrt(v / maxBin) * 215))
      const o = p * 4
      image.data[o] = intensity
      image.data[o + 1] = intensity
      image.data[o + 2] = intensity
      image.data[o + 3] = 255
    }
    ctx.putImageData(image, 0, 0)

    const blob = await canvasToPngBlob(canvas)
    if (!blob) {
      warnings.push(`Export PNG impossible pour le plan d etage ${idx + 1}.`)
      continue
    }
    const imageUrl = URL.createObjectURL(blob)
    options.objectUrlsSink?.push(imageUrl)
    const floorLabel = `N${idx + 1}`
    floorMapAssets.push({
      floorLabel,
      imageUrl,
      sourcePath: `pointcloud-slice:${floorLabel}`,
      sourceType: 'pointcloud-slice',
      floorAltitude: centerZ,
      sliceMinZ: minZ,
      sliceMaxZ: maxZ,
      worldToPixel: {
        m00: scaleX,
        m01: 0,
        m02: -bounds.minX * scaleX,
        m10: 0,
        m11: scaleY,
        m12: -bounds.minZ * scaleY,
        width: rasterWidth,
        height: rasterHeight,
      },
    })
  }
  return { floorMapAssets, warnings }
}

/**
 * Plans d'étage « vides » pour le mode low-cost sans nuage de points : grille + consigne,
 * avec géoréférencement XY arbitraire cohérent pour placer les panoramas.
 * Les altitudes `sliceCenters` servent surtout à la hauteur par défaut des panos (Y monde).
 */
export async function buildLowCostPlaceholderFloorMapAssets(options: {
  floorCount: number
  objectUrlsSink?: string[]
  rasterWidthPx?: number
  /** 'grid' = ancien rendu sombre quadrillé. 'blank-black' = fond noir uni avec petite mention. */
  variant?: 'grid' | 'blank-black'
}): Promise<{ floorMapAssets: FloorMapAsset[]; warnings: string[]; sliceCenters: number[] }> {
  const warnings: string[] = []
  const n = Math.max(1, Math.min(20, Math.floor(Number(options.floorCount) || 1)))
  const rasterWidth = Math.max(480, Math.min(1200, Math.floor(options.rasterWidthPx ?? 720)))
  const rasterHeight = Math.max(360, Math.round(rasterWidth * 0.75))
  const variant = options.variant ?? 'grid'
  const minX = -25
  const maxX = 25
  const minH = -18.75
  const maxH = 18.75
  const spanX = Math.max(maxX - minX, 1e-6)
  const spanH = Math.max(maxH - minH, 1e-6)
  const scaleX = (rasterWidth - 1) / spanX
  const scaleY = (rasterHeight - 1) / spanH
  const sliceCenters = Array.from({ length: n }, (_, i) => i * 3.0)
  const floorMapAssets: FloorMapAsset[] = []

  for (let idx = 0; idx < n; idx += 1) {
    const canvas = document.createElement('canvas')
    canvas.width = rasterWidth
    canvas.height = rasterHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      warnings.push(`Canvas indisponible pour le plan placeholder ${idx + 1}.`)
      continue
    }
    if (variant === 'blank-black') {
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, rasterWidth, rasterHeight)
      ctx.fillStyle = '#1f2937'
      ctx.font = '11px system-ui,Segoe UI,sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`Étage ${idx + 1} — sans visuel`, rasterWidth / 2, rasterHeight - 10)
    } else {
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(0, 0, rasterWidth, rasterHeight)
      ctx.strokeStyle = '#334155'
      ctx.lineWidth = 1
      for (let g = 0; g <= 10; g += 1) {
        const x = (g / 10) * rasterWidth
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, rasterHeight)
        ctx.stroke()
        const y = (g / 10) * rasterHeight
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(rasterWidth, y)
        ctx.stroke()
      }
      ctx.fillStyle = '#e2e8f0'
      ctx.font = 'bold 20px system-ui,Segoe UI,sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`Étage ${idx + 1} (${sliceCenters[idx].toFixed(1)} m)`, rasterWidth / 2, rasterHeight / 2 - 18)
      ctx.font = '13px system-ui,Segoe UI,sans-serif'
      ctx.fillStyle = '#94a3b8'
      ctx.fillText('Tracez le plan ou importez un PDF / image', rasterWidth / 2, rasterHeight / 2 + 10)
    }

    const blob = await canvasToPngBlob(canvas)
    if (!blob) {
      warnings.push(`Export PNG impossible pour le plan placeholder ${idx + 1}.`)
      continue
    }
    const imageUrl = URL.createObjectURL(blob)
    options.objectUrlsSink?.push(imageUrl)
    const centerZ = sliceCenters[idx]
    const halfSlice = 0.15
    const floorLabel = `N${idx + 1}`
    floorMapAssets.push({
      floorLabel,
      imageUrl,
      sourcePath: `lowcost/placeholder:${floorLabel}`,
      sourceType: 'image-import',
      floorAltitude: centerZ,
      sliceMinZ: centerZ - halfSlice,
      sliceMaxZ: centerZ + halfSlice,
      worldToPixel: {
        m00: scaleX,
        m01: 0,
        m02: -minX * scaleX,
        m10: 0,
        m11: scaleY,
        m12: -minH * scaleY,
        width: rasterWidth,
        height: rasterHeight,
      },
    })
  }

  return { floorMapAssets, warnings, sliceCenters }
}

/** Demi-épaisseur Z par défaut autour de l altitude GeoTIFF (~45 cm de bande). */
const ETL360_DEFAULT_GEOTIFF_FLOOR_SLICE_HALF_M = 0.225

/**
 * Un plan d étage par fichier `.tif` / `.tiff` dans le ZIP : image (JPEG dérivé si possible),
 * `worldToPixel` / `floorAltitude` issus de parseGeoTiffSpatialMeta, tranche Z pour l assignation.
 */
export async function buildFloorMapAssetsFromZipGeotiffs(options: {
  allEntries: JSZip.JSZipObject[]
  objectUrlsSink: string[]
  importWarnings: string[]
  /** Demi-épaisseur verticale (m) autour de `floorAltitude` pour sliceMinZ/sliceMaxZ. */
  floorSliceHalfMeters?: number
  zipRootPrefix?: string
}): Promise<FloorMapAsset[]> {
  const { allEntries, objectUrlsSink, importWarnings, floorSliceHalfMeters, zipRootPrefix = '' } = options
  const half = Math.max(0.025, floorSliceHalfMeters ?? ETL360_DEFAULT_GEOTIFF_FLOOR_SLICE_HALF_M)

  const tiffEntries = allEntries.filter(entry => !entry.dir && /\.tif(f)?$/i.test(entry.name))
  if (tiffEntries.length === 0) return []

  type Prepared = { name: string; entry: JSZip.JSZipObject; geo: GeoTiffSpatialMeta; jpeg: Blob | null }
  const prepared: Prepared[] = []
  for (const entry of tiffEntries) {
    const visibleName = stripZipRootPrefix(entry.name, zipRootPrefix)
    try {
      const blob = await entry.async('blob')
      const buffer = await blob.arrayBuffer()
      const geo = parseGeoTiffSpatialMeta(buffer)
      const jpeg = await convertTiffBlobToJpegBlob(blob, visibleName)
      prepared.push({ name: visibleName, entry, geo, jpeg })
    } catch {
      importWarnings.push(`Plan ${visibleName} : lecture GeoTIFF impossible, plan ignore.`)
    }
  }
  if (prepared.length === 0) return []

  prepared.sort((a, b) => {
    const fa = Number(a.geo.floorAltitude)
    const fb = Number(b.geo.floorAltitude)
    if (Number.isFinite(fa) && Number.isFinite(fb) && fa !== fb) return fa - fb
    if (Number.isFinite(fa) && !Number.isFinite(fb)) return -1
    if (!Number.isFinite(fa) && Number.isFinite(fb)) return 1
    return normalizePath(a.name).localeCompare(normalizePath(b.name), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  })

  const usedLabels = new Set<string>()
  const assets: FloorMapAsset[] = []

  for (let i = 0; i < prepared.length; i += 1) {
    const { name, entry, geo, jpeg } = prepared[i]
    const inferred = inferFloorLabelFromPath(name)
    const baseLabel = inferred || `N${i + 1}`
    let floorLabel = baseLabel
    let suf = 0
    while (usedLabels.has(floorLabel)) {
      suf += 1
      floorLabel = `${baseLabel}#${suf}`
    }
    usedLabels.add(floorLabel)

    const blobForUrl = jpeg ?? (await entry.async('blob'))
    const imageUrl = URL.createObjectURL(blobForUrl)
    objectUrlsSink.push(imageUrl)

    const fz = geo.floorAltitude
    const zOk = Number.isFinite(fz)

    assets.push({
      floorLabel,
      imageUrl,
      sourcePath: name,
      sourceType: 'geotiff-zip',
      ...(zOk ? { floorAltitude: fz, sliceMinZ: fz - half, sliceMaxZ: fz + half } : {}),
      ...(geo.worldToPixel ? { worldToPixel: geo.worldToPixel } : {}),
      ...(geo.crsLabel ? { crsHint: geo.crsLabel } : {}),
    })

    if (!jpeg) {
      importWarnings.push(
        `Conversion TIFF → JPEG impossible pour ${name} — l aperçu peut être vide selon le navigateur.`
      )
    }
    if (!geo.worldToPixel) {
      importWarnings.push(
        `Plan ${name} : géoréférencement 2D (worldToPixel) absent ou illisible — assignation surtout par altitude Z.`
      )
    }
    if (!zOk) {
      importWarnings.push(
        `Plan ${name} : altitude d étage absente des métadonnées GeoTIFF — tranche Z non appliquée pour ce plan.`
      )
    }
  }

  return assets
}

/**
 * Construit des FloorMapAssets depuis une liste d'entrées blob (par ex. issues de l'index viewer).
 * Pour chaque entrée, télécharge le blob TIFF via `downloadFn`, parse les métadonnées GeoTIFF
 * et convertit en JPEG pour l'affichage.
 *
 * @param entries       Liste `{ filename, blobPath }` (typiquement `viewerIndex.floorPlans`).
 * @param downloadFn    Fonction async qui prend un `blobPath` et retourne un `Blob`.
 * @param objectUrlsSink Tableau dans lequel les objectURLs créés seront poussés (pour nettoyage ultérieur).
 * @param importWarnings Tableau de messages d'avertissement (en écriture).
 * @param options        Options optionnelles, dont `floorSliceHalfMeters`.
 */
export async function buildFloorMapAssetsFromBlobEntries(
  entries: Array<{ filename: string; blobPath: string }>,
  downloadFn: (blobPath: string) => Promise<Blob>,
  objectUrlsSink: string[],
  importWarnings: string[],
  options?: { floorSliceHalfMeters?: number }
): Promise<FloorMapAsset[]> {
  const half = Math.max(0.025, options?.floorSliceHalfMeters ?? 0.225)

  type Prepared = { name: string; blobPath: string; geo: GeoTiffSpatialMeta; jpeg: Blob | null; rawBlob: Blob }
  const prepared: Prepared[] = []

  for (const entry of entries) {
    try {
      const rawBlob = await downloadFn(entry.blobPath)
      const buffer = await rawBlob.arrayBuffer()
      const geo = parseGeoTiffSpatialMeta(buffer)
      const jpeg = await convertTiffBlobToJpegBlob(rawBlob, entry.filename)
      prepared.push({ name: entry.filename, blobPath: entry.blobPath, geo, jpeg, rawBlob })
    } catch {
      importWarnings.push(`Plan ${entry.filename} : téléchargement ou lecture TIFF impossible, plan ignoré.`)
    }
  }

  if (prepared.length === 0) return []

  prepared.sort((a, b) => {
    const fa = Number(a.geo.floorAltitude)
    const fb = Number(b.geo.floorAltitude)
    if (Number.isFinite(fa) && Number.isFinite(fb) && fa !== fb) return fa - fb
    if (Number.isFinite(fa) && !Number.isFinite(fb)) return -1
    if (!Number.isFinite(fa) && Number.isFinite(fb)) return 1
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })

  const usedLabels = new Set<string>()
  const assets: FloorMapAsset[] = []

  for (let i = 0; i < prepared.length; i++) {
    const { name, blobPath, geo, jpeg, rawBlob } = prepared[i]
    const inferred = inferFloorLabelFromPath(name) || inferFloorLabelFromPath(blobPath) || null
    const baseLabel = inferred || `N${i + 1}`
    let floorLabel = baseLabel
    let suf = 0
    while (usedLabels.has(floorLabel)) {
      suf++
      floorLabel = `${baseLabel}#${suf}`
    }
    usedLabels.add(floorLabel)

    const blobForUrl = jpeg ?? rawBlob
    const imageUrl = URL.createObjectURL(blobForUrl)
    objectUrlsSink.push(imageUrl)

    const fz = geo.floorAltitude
    const zOk = Number.isFinite(fz)

    assets.push({
      floorLabel,
      imageUrl,
      sourcePath: name,
      sourceType: 'geotiff-zip',
      ...(zOk ? { floorAltitude: fz, sliceMinZ: fz! - half, sliceMaxZ: fz! + half } : {}),
      ...(geo.worldToPixel ? { worldToPixel: geo.worldToPixel } : {}),
      ...(geo.crsLabel ? { crsHint: geo.crsLabel } : {}),
    })

    if (!jpeg) {
      importWarnings.push(`Conversion TIFF → JPEG impossible pour ${name} — aperçu brut utilisé.`)
    }
    if (!geo.worldToPixel) {
      importWarnings.push(`Plan ${name} : géoréférencement 2D absent — assignation par altitude Z uniquement.`)
    }
    if (!zOk) {
      importWarnings.push(`Plan ${name} : altitude d'étage absente — tranche Z non appliquée.`)
    }
  }

  return assets
}

export async function extractDatasetFromZip(
  file: File,
  zipOptions?: { geotiffFloorSliceHalfMeters?: number }
): Promise<ExtractedDataset> {
  // Passer le Blob/File directement évite un double buffer mémoire (ArrayBuffer) avant chargement.
  const zip = await JSZip.loadAsync(file)
  const allEntries = Object.values(zip.files).filter(entry => !entry.dir)
  const zipRootPrefix = detectZipRootPrefix(allEntries.map(entry => entry.name))
  const importWarnings: string[] = []

  // ── Détection structure multi-sessions (points_cloud/ + panoramas/) ─────
  const _multiSession = detectMultiSessionStructure(allEntries, zipRootPrefix)
  if (_multiSession.isMultiSession) {
    return extractDatasetFromMultiSessionZip(allEntries, zipRootPrefix, _multiSession, importWarnings, zipOptions)
  }

  const imageEntries = allEntries.filter(entry => /\.(jpe?g|png|webp)$/i.test(entry.name)).map(entry => ({
    key: stripZipRootPrefix(entry.name, zipRootPrefix),
    file: entry,
  }))
  if (imageEntries.length === 0) {
    throw new Error('ZIP invalide : aucune image panorama (jpg/png/webp) detectee.')
  }

  const panoCsvEntry =
    allEntries.find(entry => /(pano|pose)/i.test(entry.name) && /\.csv$/i.test(entry.name)) ||
    allEntries.find(entry => /\.csv$/i.test(entry.name))
  if (!panoCsvEntry) {
    throw new Error('ZIP invalide : fichier CSV des prises de vues manquant.')
  }

  let panos: PanoRecord[] = []
  const objectUrls: string[] = []
  try {
    const parsed = await parsePanosFromCsvFile(await panoCsvEntry.async('text'), imageEntries)
    panos = parsed.panos
    objectUrls.push(...parsed.objectUrls)
    importWarnings.push(...parsed.warnings)
  } catch {
    throw new Error('CSV prises de vues illisible ou incompatible.')
  }

  if (panos.length === 0) {
    const panoJsonEntry = allEntries.find(entry => /(pano|pose)/i.test(entry.name) && /\.json$/i.test(entry.name))
    if (panoJsonEntry) {
      try {
        const parsed = await parsePanosFromJsonFile(await panoJsonEntry.async('text'), imageEntries)
        panos = parsed.panos
        objectUrls.push(...parsed.objectUrls)
        importWarnings.push('CSV present mais vide/invalide : fallback JSON pano/pose utilise (compat legacy).')
        importWarnings.push(...parsed.warnings)
      } catch {
        /* ignore */
      }
    }
  }
  if (panos.length === 0) {
    throw new Error('Aucun panorama exploitable depuis le CSV des prises de vues.')
  }

  let annotations: AnnotationRecord[] = []
  const annJsonEntry = allEntries.find(
    entry =>
      /annot/i.test(entry.name) &&
      /\.json$/i.test(entry.name) &&
      !matchesAnnotationsFilename(stripZipRootPrefix(entry.name, zipRootPrefix))
  )
  if (annJsonEntry) {
    try {
      annotations = parseAnnotationsFromJson(await annJsonEntry.async('text'))
    } catch {
      annotations = []
    }
  }
  if (annotations.length === 0) {
    const annCsvEntry = allEntries.find(entry => /annot/i.test(entry.name) && /\.csv$/i.test(entry.name))
    if (annCsvEntry) {
      try {
        const rows = parseCsvRows(await annCsvEntry.async('text'))
        annotations = parseAnnotationsFromRows(rows)
      } catch {
        annotations = []
      }
    }
  }

  const perPanoAnnotationDocs: AnnotationsDocument[] = []
  for (const entry of allEntries) {
    if (!matchesAnnotationsFilename(stripZipRootPrefix(entry.name, zipRootPrefix))) continue
    try {
      const text = await entry.async('text')
      const doc = parseAnnotationsDocument(text)
      if (doc) perPanoAnnotationDocs.push(doc)
    } catch {
      /* ignore fichier JSON invalide */
    }
  }

  let controlPointAnnotations: AnnotationRecord[] = []
  const controlPointsCsvEntry = allEntries.find(
    entry =>
      /control[_\s.-]*points/i.test(entry.name) &&
      /\.csv$/i.test(entry.name) &&
      normalizePath(stripZipRootPrefix(entry.name, zipRootPrefix)) !==
        normalizePath(stripZipRootPrefix(panoCsvEntry.name, zipRootPrefix))
  )
  if (controlPointsCsvEntry && panos.length > 0) {
    try {
      const cpText = await controlPointsCsvEntry.async('text')
      const built = buildAnnotationsFromControlPointsZipCsv(cpText, panos)
      controlPointAnnotations = built.annotations
      const fname = basename(controlPointsCsvEntry.name)
      for (const w of built.warnings) {
        importWarnings.push(`Points de controle (${fname}): ${w}`)
      }
    } catch {
      importWarnings.push(`Points de controle : impossible de lire ${basename(controlPointsCsvEntry.name)}.`)
    }
  }

  let e57Package: ExtractedDataset['e57Package']
  try {
    e57Package = await readResolvedE57Package(allEntries, zipRootPrefix)
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'ZIP invalide : package E57 manquant ou illisible.')
  }

  const floorMapAssets = await buildFloorMapAssetsFromZipGeotiffs({
    allEntries,
    objectUrlsSink: objectUrls,
    importWarnings,
    floorSliceHalfMeters: zipOptions?.geotiffFloorSliceHalfMeters,
    zipRootPrefix,
  })

  return {
    panos,
    annotations,
    controlPointAnnotations,
    objectUrls,
    floorMapAssets,
    importWarnings,
    perPanoAnnotationDocs,
    e57Package,
  }
}

// ─── Helpers structure multi-sessions (points_cloud/ + panoramas/) ────────────

/**
 * Détecte si le ZIP présente une structure multi-sessions avec des sous-dossiers
 * points_cloud/<session>/ et/ou panoramas/<session>/ (format ETL SECO / open3d_vision).
 */
function detectMultiSessionStructure(
  allEntries: JSZip.JSZipObject[],
  zipRootPrefix: string,
): { isMultiSession: boolean; pointCloudDirs: string[]; panoramaDirs: string[] } {
  const pcSet = new Set<string>()
  const panoSet = new Set<string>()
  for (const e of allEntries) {
    const sp = normalizePath(stripZipRootPrefix(e.name, zipRootPrefix))
    if (/^points_cloud\//i.test(sp)) {
      const parts = sp.split('/')
      if (parts.length >= 3) pcSet.add(`points_cloud/${parts[1]}/`)
    }
    if (/^panoramas\//i.test(sp)) {
      const parts = sp.split('/')
      if (parts.length >= 3) panoSet.add(`panoramas/${parts[1]}/`)
    }
  }
  return {
    isMultiSession: pcSet.size > 0 || panoSet.size > 0,
    pointCloudDirs: [...pcSet].sort(),
    panoramaDirs: [...panoSet].sort(),
  }
}

/** Lit un package point-cloud (manifest + chunks) depuis un sous-dossier précis. */
async function readE57PackageFromDir(
  allEntries: JSZip.JSZipObject[],
  sessionDir: string,
  zipRootPrefix: string,
): Promise<{ manifest: E57PointCloudManifest; chunks: Array<{ meta: E57PointCloudChunkMeta; positions: Float32Array }> } | null> {
  const strip = (p: string) => normalizePath(stripZipRootPrefix(p, zipRootPrefix))
  const dirEntries = allEntries.filter(e => strip(e.name).toLowerCase().startsWith(sessionDir.toLowerCase()))
  const manifestEntry = dirEntries.find(e => basename(e.name).toLowerCase() === 'manifest.json')
  if (!manifestEntry) return null
  let manifest: E57PointCloudManifest
  try {
    manifest = JSON.parse(await manifestEntry.async('text')) as E57PointCloudManifest
  } catch { return null }
  if (manifest.format !== 'point-chunks-v1' || !Array.isArray(manifest.chunks) || manifest.chunks.length === 0) return null
  const chunks: Array<{ meta: E57PointCloudChunkMeta; positions: Float32Array }> = []
  for (const chunk of manifest.chunks) {
    const chunkBase = basename(chunk.file).toLowerCase()
    const entry = dirEntries.find(e => basename(e.name).toLowerCase() === chunkBase)
    if (!entry) continue
    const buffer = await entry.async('arraybuffer')
    if (buffer.byteLength % 12 !== 0) continue
    chunks.push({ meta: chunk, positions: decodeE57ChunkPositionsBuffer(new Float32Array(buffer), manifest) })
  }
  if (chunks.length === 0) return null
  return { manifest, chunks }
}

/** Fusionne plusieurs packages E57 (plusieurs sessions) en un seul. */
function mergeE57Packages(
  packages: Array<{ manifest: E57PointCloudManifest; chunks: Array<{ meta: E57PointCloudChunkMeta; positions: Float32Array }> }>,
): { manifest: E57PointCloudManifest; chunks: Array<{ meta: E57PointCloudChunkMeta; positions: Float32Array }> } {
  if (packages.length === 0) throw new Error('Aucun package E57 valide.')
  if (packages.length === 1) return packages[0]
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
  let totalPoints = 0
  const mergedChunks: Array<{ meta: E57PointCloudChunkMeta; positions: Float32Array }> = []
  let ci = 0
  for (const pkg of packages) {
    const b = pkg.manifest.bounds
    if (b) {
      if (b.minX < minX) minX = b.minX; if (b.maxX > maxX) maxX = b.maxX
      if (b.minY < minY) minY = b.minY; if (b.maxY > maxY) maxY = b.maxY
      if (b.minZ < minZ) minZ = b.minZ; if (b.maxZ > maxZ) maxZ = b.maxZ
    }
    for (const c of pkg.chunks) {
      ci++
      const id = `chunk-${String(ci).padStart(4, '0')}`
      mergedChunks.push({ meta: { ...c.meta, id, file: `${id}.bin` }, positions: c.positions })
      totalPoints += c.positions.length / 3
    }
  }
  const base = packages[0].manifest
  return {
    manifest: {
      ...base,
      displayedPointCount: Math.round(totalPoints),
      bounds: {
        minX: Number.isFinite(minX) ? minX : 0, maxX: Number.isFinite(maxX) ? maxX : 0,
        minY: Number.isFinite(minY) ? minY : 0, maxY: Number.isFinite(maxY) ? maxY : 0,
        minZ: Number.isFinite(minZ) ? minZ : 0, maxZ: Number.isFinite(maxZ) ? maxZ : 0,
      },
      chunks: mergedChunks.map(c => c.meta),
    },
    chunks: mergedChunks,
  }
}

/**
 * Parse les panoramas d'une session (sous-dossier panoramas/<label>/).
 * Les images sont filtrées au sous-dossier pour éviter les conflits de noms entre sessions.
 * Les IDs pano sont préfixés par le nom de session.
 */
async function parsePanoSession(
  sessionDir: string,
  sessionLabel: string,
  allEntries: JSZip.JSZipObject[],
  zipRootPrefix: string,
): Promise<{ panos: PanoRecord[]; objectUrls: string[]; warnings: string[] }> {
  const strip = (p: string) => normalizePath(stripZipRootPrefix(p, zipRootPrefix))
  const sessionEntries = allEntries.filter(e => strip(e.name).toLowerCase().startsWith(sessionDir.toLowerCase()))
  const sessionImageEntries = sessionEntries
    .filter(e => /\.(jpe?g|png|webp)$/i.test(e.name))
    .map(e => ({ key: strip(e.name), file: e }))
  const csvEntry =
    sessionEntries.find(e => /(pano|pose)/i.test(e.name) && /\.csv$/i.test(e.name)) ||
    sessionEntries.find(e => /\.csv$/i.test(e.name))
  if (!csvEntry || sessionImageEntries.length === 0) {
    return { panos: [], objectUrls: [], warnings: [`Session pano "${sessionLabel}" : CSV ou images manquants.`] }
  }
  const parsed = await parsePanosFromCsvFile(await csvEntry.async('text'), sessionImageEntries)
  // Préfixer les IDs pour éviter les conflits entre sessions ayant les mêmes indices (0, 1, 2…)
  const idPrefix = sessionLabel.replace(/[^a-zA-Z0-9]/g, '_') + '_'
  return {
    panos: parsed.panos.map(p => ({ ...p, id: idPrefix + p.id })),
    objectUrls: parsed.objectUrls,
    warnings: parsed.warnings,
  }
}

/**
 * Extraction complète depuis un ZIP à structure multi-sessions open3d_vision :
 *   points_cloud/<session>/manifest.json + chunk-XXXX.bin
 *   panoramas/<session>/pano-poses.csv + NNNNN-pano.jpg
 *   floor_plans/ ou floor_plans_EPSG_XXXX/ → GeoTIFF facultatifs
 * Pas d'annotations requises (ignorées si absentes).
 */
async function extractDatasetFromMultiSessionZip(
  allEntries: JSZip.JSZipObject[],
  zipRootPrefix: string,
  sessionDirs: { pointCloudDirs: string[]; panoramaDirs: string[] },
  importWarnings: string[],
  zipOptions?: { geotiffFloorSliceHalfMeters?: number },
): Promise<ExtractedDataset> {
  const objectUrls: string[] = []

  // ── Panoramas ─────────────────────────────────────────────────────────────
  let allPanos: PanoRecord[] = []
  for (const panoDir of sessionDirs.panoramaDirs) {
    const label = panoDir.replace(/^panoramas\//i, '').replace(/\/$/, '')
    try {
      const r = await parsePanoSession(panoDir, label, allEntries, zipRootPrefix)
      allPanos = [...allPanos, ...r.panos]
      objectUrls.push(...r.objectUrls)
      importWarnings.push(...r.warnings)
    } catch (e) {
      importWarnings.push(`Session pano "${label}" : ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Fallback : pas de sous-dossiers panoramas/ → chercher images + CSV à la racine
  if (allPanos.length === 0 && sessionDirs.panoramaDirs.length === 0) {
    const rootImages = allEntries
      .filter(e => /\.(jpe?g|png|webp)$/i.test(e.name))
      .map(e => ({ key: normalizePath(stripZipRootPrefix(e.name, zipRootPrefix)), file: e }))
    const rootCsv =
      allEntries.find(e => /(pano|pose)/i.test(e.name) && /\.csv$/i.test(e.name)) ||
      allEntries.find(e => /\.csv$/i.test(e.name))
    if (rootCsv && rootImages.length > 0) {
      try {
        const r = await parsePanosFromCsvFile(await rootCsv.async('text'), rootImages)
        allPanos = r.panos
        objectUrls.push(...r.objectUrls)
        importWarnings.push(...r.warnings)
      } catch { /* ignore */ }
    }
  }

  if (allPanos.length === 0) {
    throw new Error('Aucun panorama exploitable (sous-dossiers panoramas/ vides ou CSV manquant).')
  }

  // ── Nuages de points ──────────────────────────────────────────────────────
  let e57Package: ExtractedDataset['e57Package']
  const pcPackages: Array<{
    manifest: E57PointCloudManifest
    chunks: Array<{ meta: E57PointCloudChunkMeta; positions: Float32Array }>
  }> = []
  for (const pcDir of sessionDirs.pointCloudDirs) {
    try {
      const pkg = await readE57PackageFromDir(allEntries, pcDir, zipRootPrefix)
      if (pkg) pcPackages.push(pkg)
    } catch (e) {
      importWarnings.push(`Point cloud "${pcDir}" : ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (pcPackages.length > 0) {
    try { e57Package = mergeE57Packages(pcPackages) } catch { /* nuage optionnel */ }
  }

  // ── Plans de sol (GeoTIFF, facultatifs) ───────────────────────────────────
  const floorMapAssets = await buildFloorMapAssetsFromZipGeotiffs({
    allEntries,
    objectUrlsSink: objectUrls,
    importWarnings,
    floorSliceHalfMeters: zipOptions?.geotiffFloorSliceHalfMeters,
    zipRootPrefix,
  })

  return {
    panos: allPanos,
    annotations: [],
    controlPointAnnotations: [],
    objectUrls,
    floorMapAssets,
    importWarnings,
    perPanoAnnotationDocs: [],
    e57Package,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function extractE57PointCloudPackageFromZip(file: File): Promise<{
  manifest: E57PointCloudManifest
  chunks: Array<{ meta: E57PointCloudChunkMeta; positions: Float32Array }>
}> {
  const zip = await JSZip.loadAsync(file)
  const allEntries = Object.values(zip.files).filter(entry => !entry.dir)
  const zipRootPrefix = detectZipRootPrefix(allEntries.map(entry => entry.name))
  return readResolvedE57Package(allEntries, zipRootPrefix)
}

export function parseXyzWithReservoirDownsample(xyzText: string, maxPoints: number): E57ParseResult {
  const keep = Math.max(1, Math.floor(maxPoints))
  const selected = new Float32Array(keep * 3)
  let selectedCount = 0
  let seen = 0

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  let idx = 0
  while (idx < xyzText.length) {
    const nl = xyzText.indexOf('\n', idx)
    const end = nl === -1 ? xyzText.length : nl
    const line = xyzText.slice(idx, end).trim()
    idx = nl === -1 ? xyzText.length : nl + 1
    if (!line) continue

    const parts = line.split(/\s+/)
    if (parts.length < 3) continue
    const rawX = Number(parts[0])
    const rawZ = Number(parts[1])
    const rawY = Number(parts[2])
    const x = rawX
    const y = rawY
    const z = rawZ
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue

    seen += 1
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z

    if (selectedCount < keep) {
      const base = selectedCount * 3
      selected[base] = x
      selected[base + 1] = y
      selected[base + 2] = z
      selectedCount += 1
      continue
    }

    const replaceIndex = Math.floor(Math.random() * seen)
    if (replaceIndex < keep) {
      const base = replaceIndex * 3
      selected[base] = x
      selected[base + 1] = y
      selected[base + 2] = z
    }
  }

  if (seen === 0 || selectedCount === 0) {
    throw new Error('Aucun point XYZ exploitable trouve dans le fichier E57.')
  }

  return {
    positions: selectedCount === selected.length / 3 ? selected : selected.slice(0, selectedCount * 3),
    sourcePointCount: seen,
    displayedPointCount: selectedCount,
    bounds: { minX, minY, minZ, maxX, maxY, maxZ },
  }
}

/** Nombre de points à afficher selon le total de points dans le fichier (downsample agressif si très volumineux). */
export function computeTargetDisplayPointCount(sourcePointCount: number): number {
  const n = Math.max(0, Math.floor(sourcePointCount))
  if (n === 0) return 0
  if (n <= 200_000) return n
  if (n <= 600_000) return 150_000
  if (n <= 1_800_000) return 85_000
  if (n <= 5_000_000) return 48_000
  if (n <= 15_000_000) return 30_000
  if (n <= 45_000_000) return 18_000
  if (n <= 120_000_000) return 12_000
  return 8_000
}

/** Sous-échantillonnage uniforme parmi `pointCount` triplets déjà stockés dans `src` (longueur >= pointCount * 3). */
export function subsamplePositionsUniform(src: Float32Array, pointCount: number, target: number): Float32Array {
  const n = Math.max(0, Math.floor(pointCount))
  const k = Math.max(1, Math.min(Math.floor(target), n))
  if (k >= n) return n * 3 === src.length ? src : src.slice(0, n * 3)

  const out = new Float32Array(k * 3)
  const pick = new Int32Array(k)
  for (let i = 0; i < k; i += 1) pick[i] = i
  for (let i = k; i < n; i += 1) {
    const j = Math.floor(Math.random() * (i + 1))
    if (j < k) pick[j] = i
  }
  for (let t = 0; t < k; t += 1) {
    const idx = pick[t]
    const ob = t * 3
    const sb = idx * 3
    out[ob] = src[sb]
    out[ob + 1] = src[sb + 1]
    out[ob + 2] = src[sb + 2]
  }
  return out
}

export function parseXyzWithAdaptiveDownsample(xyzText: string): E57ParseResult {
  const first = parseXyzWithReservoirDownsample(xyzText, ETL360_E57_RESERVOIR_CAP)
  const target = computeTargetDisplayPointCount(first.sourcePointCount)
  if (target <= 0) return first
  if (first.displayedPointCount <= target) return first

  const positions = subsamplePositionsUniform(first.positions, first.displayedPointCount, target)
  return {
    ...first,
    positions,
    displayedPointCount: target,
  }
}

/** Taille à partir de laquelle on prévient que la conversion E57→XYZ en mémoire peut échouer (navigateur). */
export const ETL360_E57_LARGE_FILE_BYTES = 120 * 1024 * 1024

/**
 * Lit le contenu d’un fichier choisi par l’utilisateur.
 * `arrayBuffer()` échoue souvent avec NotReadableError sur OneDrive / « en ligne uniquement » ;
 * on retente avec FileReader dans ce cas.
 */
export async function readUserFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  try {
    return await file.arrayBuffer()
  } catch (first: unknown) {
    const domName = first instanceof DOMException ? first.name : ''
    try {
      return await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const r = reader.result
          if (r instanceof ArrayBuffer) resolve(r)
          else reject(new Error('FileReader: resultat inattendu'))
        }
        reader.onerror = () => {
          reject(reader.error ?? new Error('FileReader: lecture impossible'))
        }
        reader.readAsArrayBuffer(file)
      })
    } catch {
      if (domName === 'NotReadableError') {
        throw new Error(
          'Lecture impossible (NotReadableError). Cause frequente : fichier OneDrive / SharePoint « en ligne uniquement » ou non synchronise, ou fichier verrouille. Telecharge une copie 100 % locale (hors dossier cloud), ou « Gardez toujours sur cet appareil », puis reessayez.'
        )
      }
      throw first
    }
  }
}

export function formatE57LoadError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotReadableError') {
    return (
      'Lecture impossible : fichier inaccessible (cloud non synchronise, verrouille, ou droits insuffisants). ' +
      'Utilise une copie locale du .e57 hors OneDrive, ou synchronise le dossier avant import.'
    )
  }
  const msg = error instanceof Error ? error.message : String(error)
  if (/could not be read|permission problems|NotReadableError/i.test(msg)) {
    return (
      'Lecture fichier impossible. Si le .e57 est dans OneDrive / SharePoint : ouvrez Proprietes du fichier et ' +
      'decochez « Economiser de l espace » / assurez-vous qu il est bien telecharge, ou copiez-le vers un dossier local (ex. Bureau), puis reimportez.'
    )
  }
  if (/memory|out of memory|allocation|wasm|string longer|0x1fffffe8/i.test(msg)) {
    return (
      'Memoire ou conversion insuffisante : ce nuage est probablement trop gros pour une conversion navigateur directe. ' +
      'Generez d abord un package ZIP via le script Python externe, puis chargez ce ZIP dans le viewer.'
    )
  }
  return msg || 'Impossible de lire ce fichier E57.'
}

const E57_PANO_COLORIZE_MAX_EDGE = 2048

export type PanoColorizationBitmap = {
  width: number
  height: number
  data: Uint8ClampedArray
}

export async function loadPanoImageBitmapForColorization(imageUrl: string): Promise<PanoColorizationBitmap | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        let w = img.naturalWidth
        let h = img.naturalHeight
        if (w < 2 || h < 2) {
          resolve(null)
          return
        }
        const scale = Math.min(1, E57_PANO_COLORIZE_MAX_EDGE / Math.max(w, h))
        w = Math.max(2, Math.floor(w * scale))
        h = Math.max(2, Math.floor(h * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        const id = ctx.getImageData(0, 0, w, h)
        resolve({ width: w, height: h, data: id.data })
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = imageUrl
  })
}

export function sampleEquirectImageBilinear(
  bitmap: PanoColorizationBitmap,
  u: number,
  v: number
): [number, number, number] {
  const sw = bitmap.width
  const sh = bitmap.height
  const src = bitmap.data
  const uu = ((u % 1) + 1) % 1
  const vv = Math.min(Math.max(v, 0), 0.999999)
  const x = uu * (sw - 1)
  const y = vv * (sh - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, sw - 1)
  const y1 = Math.min(y0 + 1, sh - 1)
  const fx = x - x0
  const fy = y - y0
  const idx = (xi: number, yi: number) => (yi * sw + xi) * 4
  const i00 = idx(x0, y0)
  const i10 = idx(x1, y0)
  const i01 = idx(x0, y1)
  const i11 = idx(x1, y1)
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  return [
    lerp(lerp(src[i00], src[i10], fx), lerp(src[i01], src[i11], fx), fy),
    lerp(lerp(src[i00 + 1], src[i10 + 1], fx), lerp(src[i01 + 1], src[i11 + 1], fx), fy),
    lerp(lerp(src[i00 + 2], src[i10 + 2], fx), lerp(src[i01 + 2], src[i11 + 2], fx), fy),
  ]
}

/**
 * Déplacement monde depuis l'origine du pano → yaw/pitch dans le repère caméra du panorama.
 * Inverse algébrique du raycast nuage (même R et mêmes angles que raycastPanoYawPitchToPointHit).
 *
 * Vue d’ensemble des étapes (repère source, q⁻¹, puis source→viewer) : COORDINATE_SYSTEMS.md.
 */
export function worldOffsetToPanoYawPitch(dx: number, dy: number, dz: number, pano: PanoRecord): YawPitch | null {
  return worldOffsetToPanoYawPitchWithQuaternionMode(dx, dy, dz, pano, 'inverse')
}

/**
 * Variante explicite pour comparer les conventions quaternion :
 * - inverse: q^-1 (convention NavVis : q mappe local→monde, donc q^-1 mappe monde→local)
 * - direct: q appliqué directement (conservé pour diagnostic)
 * Le résultat du quaternion (repère source Z-up) est converti en repère viewer (Y-up)
 * avant le calcul yaw/pitch.
 */
export function worldOffsetToPanoYawPitchWithQuaternionMode(
  dx: number,
  dy: number,
  dz: number,
  pano: PanoRecord,
  mode: 'inverse' | 'direct'
): YawPitch | null {
  const srcDelta = viewerWorldDeltaToSource(dx, dy, dz)
  const to = new THREE.Vector3(srcDelta.x, srcDelta.y, srcDelta.z)
  const dist = to.length()
  if (!Number.isFinite(dist) || dist < 1e-6) return null
  to.multiplyScalar(1 / dist)
  const q = new THREE.Quaternion(
    pano.orientation.x,
    pano.orientation.y,
    pano.orientation.z,
    pano.orientation.w
  )
  if (
    !Number.isFinite(q.x) ||
    !Number.isFinite(q.y) ||
    !Number.isFinite(q.z) ||
    !Number.isFinite(q.w) ||
    q.lengthSq() < 1e-12
  ) {
    return null
  }
  q.normalize()
  if (mode === 'inverse') q.invert()
  to.applyQuaternion(q)
  const localViewer = sourceWorldDeltaToViewer(to.x, to.y, to.z)
  return {
    yaw: Math.atan2(localViewer.x, localViewer.z),
    pitch: Math.asin(THREE.MathUtils.clamp(localViewer.y, -1, 1)),
  }
}

export function worldOffsetToPanoMarkerYawPitch(dx: number, dy: number, dz: number, pano: PanoRecord): YawPitch | null {
  return worldOffsetToPanoYawPitchWithQuaternionMode(dx, dy, dz, pano, 'inverse')
}

/**
 * Vecteur monde (delta depuis la position du pano) exprimé dans le repère caméra du panorama.
 * Variante sans allocation : écrit dans `out`, utilise `qScratch` comme quaternion temporaire.
 */
export function worldDeltaToPanoLocalMut(
  out: THREE.Vector3,
  dx: number,
  dy: number,
  dz: number,
  pano: PanoRecord,
  qScratch: THREE.Quaternion
): boolean {
  const srcDelta = viewerWorldDeltaToSource(dx, dy, dz)
  out.set(srcDelta.x, srcDelta.y, srcDelta.z)
  qScratch.set(pano.orientation.x, pano.orientation.y, pano.orientation.z, pano.orientation.w)
  if (
    !Number.isFinite(qScratch.x) ||
    !Number.isFinite(qScratch.y) ||
    !Number.isFinite(qScratch.z) ||
    !Number.isFinite(qScratch.w) ||
    qScratch.lengthSq() < 1e-12
  ) {
    return false
  }
  qScratch.normalize()
  qScratch.invert()
  out.applyQuaternion(qScratch)
  const tmpY = out.y
  out.y = out.z
  out.z = tmpY
  return true
}

/**
 * Repère source (poses pano / GeoTIFF) : X,Y au sol et Z = altitude.
 * Repère viewer / nuage E57 : X,Z au sol et Y = altitude.
 */
export function sourceWorldToViewerPosition(position: Vec3): Vec3 {
  return { x: position.x, y: position.z, z: position.y }
}

/** Inverse de `sourceWorldToViewerPosition` (repère viewer E57 → repère source NavVis / GeoTIFF). */
export function viewerWorldToSourcePosition(v: Vec3): Vec3 {
  return { x: v.x, y: v.z, z: v.y }
}

/**
 * Pose « source » à utiliser pour cartes, dataset spatial et overlay E57 lorsque le mode développeur
 * « Repère XZY » est actif : cohérent avec l’ancien placement `sourceWorldToViewer` + échange Y↔Z viewer.
 */
export function panoSourcePositionForE57DevAxesXzy(position: Vec3, devAxesXzy: boolean): Vec3 {
  if (!devAxesXzy) return { ...position }
  const v = sourceWorldToViewerPosition(position)
  const d = { x: v.x, y: v.z, z: v.y }
  return viewerWorldToSourcePosition(d)
}

/**
 * Inverse de {@link panoSourcePositionForE57DevAxesXzy} : repasse une pose « source » telle qu’utilisée
 * par le dataset spatial / le plan (repère XZY dev) vers les coordonnées CSV NavVis d’origine.
 */
export function panoRawSourcePositionFromE57DevAdjustedPosition(adj: Vec3, devAxesXzy: boolean): Vec3 {
  if (!devAxesXzy) return { ...adj }
  return { x: adj.x, y: adj.z, z: adj.y }
}

/**
 * Les deltas monde utilisent la même permutation que les positions :
 * source (X,Y sol,Z altitude) <-> viewer (X,Z sol,Y altitude).
 * La permutation est involutive, donc viewer->source == source->viewer.
 */
export function sourceWorldDeltaToViewer(dx: number, dy: number, dz: number): Vec3 {
  return { x: dx, y: dz, z: dy }
}

export function viewerWorldDeltaToSource(dx: number, dy: number, dz: number): Vec3 {
  return { x: dx, y: dz, z: dy }
}

/**
 * Composantes horizontales (repère source : X,Y au sol) de la direction de regard
 * correspondant au yaw/pitch du viewer sphérique, en appliquant l’orientation du pano.
 * Inverse partielle de `worldOffsetToPanoYawPitch` : même quaternion q (local→monde source).
 */
export function panoViewerYawPitchToSourceGroundDir(
  yawRad: number,
  pitchRad: number,
  pano: PanoRecord | null
): { dx: number; dy: number } | null {
  const cp = Math.cos(pitchRad)
  const lvx = Math.sin(yawRad) * cp
  const lvy = Math.sin(pitchRad)
  const lvz = Math.cos(yawRad) * cp
  const toX = lvx
  const toY = lvz
  const toZ = lvy
  const q = new THREE.Quaternion(
    pano?.orientation.x ?? 0,
    pano?.orientation.y ?? 0,
    pano?.orientation.z ?? 0,
    pano?.orientation.w ?? 1
  )
  if (
    !Number.isFinite(q.x) ||
    !Number.isFinite(q.y) ||
    !Number.isFinite(q.z) ||
    !Number.isFinite(q.w) ||
    q.lengthSq() < 1e-12
  ) {
    const h = Math.hypot(toX, toY)
    if (h < 1e-9) return null
    return { dx: toX, dy: toY }
  }
  q.normalize()
  const v = new THREE.Vector3(toX, toY, toZ)
  v.applyQuaternion(q)
  const hx = v.x
  const hy = v.y
  const hz = v.z
  const horiz = Math.hypot(hx, hy)
  if (horiz < 1e-9) return null
  return { dx: hx, dy: hy }
}

/**
 * Direction monde (pano → point) transformée en UV équirectangulaire (même convention que les miniatures annotation).
 */
export function worldPointToPanoEquirectUv(px: number, py: number, pz: number, pano: PanoRecord): { u: number; v: number } | null {
  const { x: ox, y: oy, z: oz } = sourceWorldToViewerPosition(pano.position)
  if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(oz)) return null
  const yp = worldOffsetToPanoYawPitch(px - ox, py - oy, pz - oz, pano)
  if (!yp) return null
  return panoViewerYawPitchToTextureUv(yp.yaw, yp.pitch)
}

export class EmbeddedE57PointCloudViewer {
  private container: HTMLDivElement
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private pointChunks: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>[] = []
  /** Positions des caméras / panoramas (ZIP NavVis), affichées dans une autre couleur. */
  private panoCameraOverlay: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null
  /** Orientation des caméras : segment partant du point de pose. */
  private panoCameraOrientationOverlay: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null
  /** Annotations projetees dans le nuage, affichees en vert. */
  private annotationOverlay: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null
  /** Plans d'étage texturés (géoréférencement worldToPixel), semi-transparents. */
  private floorPlanGroup: THREE.Group | null = null
  private floorPlanLoadGeneration = 0
  /** Dernières bornes du nuage : sert au calibrage de la taille des points (caméras incluses). */
  private lastCloudBounds: E57ParseResult['bounds'] | null = null
  private resizeObserver: ResizeObserver | null = null
  private animationFrame = 0
  private target = new THREE.Vector3()
  private yaw = 0
  private pitch = 0.35
  private distance = 20
  /** Clic gauche : orbite ; clic molette : panoramique (translation de la cible). */
  private pointerMode: 'none' | 'orbit' | 'pan' = 'none'
  private dragStart = { x: 0, y: 0, yaw: 0, pitch: 0 }
  private panLastClient = { x: 0, y: 0 }
  private readonly _panFwd = new THREE.Vector3()
  private readonly _panRight = new THREE.Vector3()
  private readonly _panUp = new THREE.Vector3()

  constructor(container: HTMLDivElement) {
    this.container = container
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xe2e8f0)
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1_000_000)
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.domElement.style.display = 'block'
    this.container.appendChild(this.renderer.domElement)

    const ambient = new THREE.AmbientLight(0xffffff, 0.9)
    this.scene.add(ambient)
    const key = new THREE.DirectionalLight(0xffffff, 0.55)
    key.position.set(0.4, 0.8, 1)
    this.scene.add(key)

    this.bindEvents()
    this.resizeObserver = new ResizeObserver(() => this.onResize())
    this.resizeObserver.observe(this.container)
    this.animate()
  }

  /**
   * @deprecated La permutation XZY est appliquée côté parent (`panoSourcePositionForE57DevAxesXzy`) sur les
   * positions pano transmises à `setPanoCameraOverlay` / plans — ce setter ne fait plus rien.
   */
  setDeveloperViewerAxesXzy(_enabled: boolean): void {}

  private bindEvents(): void {
    this.container.addEventListener('pointerdown', this.onPointerDown)
    this.container.addEventListener('pointermove', this.onPointerMove)
    this.container.addEventListener('pointerup', this.onPointerUp)
    this.container.addEventListener('pointerleave', this.onPointerLeave)
    this.container.addEventListener('pointercancel', this.onPointerUp)
    this.container.addEventListener('auxclick', this.onMiddleAuxClick)
    this.container.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('resize', this.onResize)
  }

  private onMiddleAuxClick = (event: MouseEvent): void => {
    if (event.button === 1) event.preventDefault()
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button === 0) {
      this.pointerMode = 'orbit'
      this.dragStart = { x: event.clientX, y: event.clientY, yaw: this.yaw, pitch: this.pitch }
      try {
        this.container.setPointerCapture(event.pointerId)
      } catch {
        /* ignore */
      }
      return
    }
    if (event.button === 1) {
      event.preventDefault()
      this.pointerMode = 'pan'
      this.panLastClient = { x: event.clientX, y: event.clientY }
      try {
        this.container.setPointerCapture(event.pointerId)
      } catch {
        /* ignore */
      }
    }
  }

  private applyPanFromPixelDelta(dxPx: number, dyPx: number): void {
    const cp = Math.cos(this.pitch)
    const sinY = Math.sin(this.yaw)
    const cosY = Math.cos(this.yaw)
    const camX = this.target.x + this.distance * cp * sinY
    const camY = this.target.y + this.distance * Math.sin(this.pitch)
    const camZ = this.target.z + this.distance * cp * cosY
    this._panFwd.set(this.target.x - camX, this.target.y - camY, this.target.z - camZ).normalize()
    const worldUp = new THREE.Vector3(0, 1, 0)
    this._panRight.crossVectors(worldUp, this._panFwd)
    if (this._panRight.lengthSq() < 1e-12) {
      this._panRight.set(1, 0, 0)
    } else {
      this._panRight.normalize()
    }
    this._panUp.crossVectors(this._panFwd, this._panRight).normalize()
    const h = Math.max(this.renderer.domElement.clientHeight, 1)
    const k = (Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)) * 2 * this.distance) / h
    this.target.addScaledVector(this._panRight, dxPx * k)
    this.target.addScaledVector(this._panUp, -dyPx * k)
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (this.pointerMode === 'orbit' && (event.buttons & 1) !== 0) {
      const dx = event.clientX - this.dragStart.x
      const dy = event.clientY - this.dragStart.y
      this.yaw = this.dragStart.yaw - dx * 0.005
      this.pitch = THREE.MathUtils.clamp(this.dragStart.pitch + dy * 0.005, -1.45, 1.45)
      return
    }
    if (this.pointerMode === 'pan' && (event.buttons & 4) !== 0) {
      const dx = event.clientX - this.panLastClient.x
      const dy = event.clientY - this.panLastClient.y
      this.panLastClient.x = event.clientX
      this.panLastClient.y = event.clientY
      if (dx !== 0 || dy !== 0) this.applyPanFromPixelDelta(dx, dy)
    }
  }

  private onPointerUp = (event: PointerEvent): void => {
    try {
      if (this.container.hasPointerCapture(event.pointerId)) {
        this.container.releasePointerCapture(event.pointerId)
      }
    } catch {
      /* ignore */
    }
    this.pointerMode = 'none'
  }

  private onPointerLeave = (event: PointerEvent): void => {
    try {
      if (this.container.hasPointerCapture(event.pointerId)) {
        this.container.releasePointerCapture(event.pointerId)
      }
    } catch {
      /* ignore */
    }
    this.pointerMode = 'none'
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    this.distance = THREE.MathUtils.clamp(this.distance * (event.deltaY > 0 ? 1.08 : 0.92), 0.05, 5_000_000)
  }

  private onResize = (): void => {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    this.camera.aspect = width / Math.max(height, 1)
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  /** Taille de point du nuage principal (même formule que les chunks E57). */
  private computeCloudPointSize(bounds: E57ParseResult['bounds'], pointCount: number): number {
    const dx = bounds.maxX - bounds.minX
    const dy = bounds.maxY - bounds.minY
    const dz = bounds.maxZ - bounds.minZ
    const diag = Math.max(Math.hypot(dx, dy, dz), 1e-6)
    const densityBoost = THREE.MathUtils.clamp(120_000 / Math.max(pointCount, 1), 1, 10)
    return THREE.MathUtils.clamp((diag / 900) * densityBoost, 0.008, 4)
  }

  private buildPointMaterial(bounds: E57ParseResult['bounds'], pointCount: number): THREE.PointsMaterial {
    const pointSize = this.computeCloudPointSize(bounds, pointCount)
    return new THREE.PointsMaterial({ size: pointSize, color: 0x7dd3fc, sizeAttenuation: true })
  }

  private buildVertexColorPointMaterial(bounds: E57ParseResult['bounds'], pointCount: number): THREE.PointsMaterial {
    const pointSize = this.computeCloudPointSize(bounds, pointCount)
    return new THREE.PointsMaterial({
      size: pointSize,
      vertexColors: true,
      color: 0xffffff,
      sizeAttenuation: true,
    })
  }

  /** Caméras / annotations : exactement 2× la taille des points du nuage affiché (même bounds + décompte). */
  private overlayMarkerPointSize(cloudPointSize: number): number {
    return cloudPointSize * 2
  }

  private overlayOrientationLength(bounds: E57ParseResult['bounds']): number {
    const dx = bounds.maxX - bounds.minX
    const dy = bounds.maxY - bounds.minY
    const dz = bounds.maxZ - bounds.minZ
    const diag = Math.max(Math.hypot(dx, dy, dz), 1e-6)
    return THREE.MathUtils.clamp(diag / 42, 0.12, 4.5)
  }

  private buildPanoCameraVertexColorMaterial(cloudPointSize: number): THREE.PointsMaterial {
    return new THREE.PointsMaterial({
      size: this.overlayMarkerPointSize(cloudPointSize),
      vertexColors: true,
      color: 0xffffff,
      sizeAttenuation: true,
    })
  }

  /** Marqueurs annotations : couleur par vertex, taille 2× le nuage (comme les caméras). */
  private buildAnnotationPointsMaterial(cloudPointSize: number): THREE.PointsMaterial {
    return new THREE.PointsMaterial({
      size: this.overlayMarkerPointSize(cloudPointSize),
      vertexColors: true,
      color: 0xffffff,
      sizeAttenuation: true,
    })
  }

  private resolveDisplayCloudPointSize(bounds: E57ParseResult['bounds']): number {
    const rawCloudCount = this.getTotalCloudPointCount()
    const cloudN = rawCloudCount > 0 ? rawCloudCount : 120_000
    return this.computeCloudPointSize(bounds, cloudN)
  }

  private getTotalCloudPointCount(): number {
    let n = 0
    for (const chunk of this.pointChunks) {
      const attr = chunk.geometry.getAttribute('position') as THREE.BufferAttribute | undefined
      if (attr) n += attr.count
    }
    return n
  }

  private boundsFromPositions(positions: Float32Array): E57ParseResult['bounds'] {
    if (positions.length < 3) {
      return { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }
    }
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i]
      const y = positions[i + 1]
      const z = positions[i + 2]
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      minZ = Math.min(minZ, z)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      maxZ = Math.max(maxZ, z)
    }
    if (!Number.isFinite(minX) || minX === maxX) {
      const pad = 1
      return {
        minX: minX - pad,
        minY: minY - pad,
        minZ: minZ - pad,
        maxX: maxX + pad,
        maxY: maxY + pad,
        maxZ: maxZ + pad,
      }
    }
    return { minX, minY, minZ, maxX, maxY, maxZ }
  }

  private removePanoCameraOverlay(): void {
    if (this.panoCameraOverlay) {
      this.scene.remove(this.panoCameraOverlay)
      this.panoCameraOverlay.geometry.dispose()
      this.panoCameraOverlay.material.dispose()
      this.panoCameraOverlay = null
    }
    if (this.panoCameraOrientationOverlay) {
      this.scene.remove(this.panoCameraOrientationOverlay)
      this.panoCameraOrientationOverlay.geometry.dispose()
      this.panoCameraOrientationOverlay.material.dispose()
      this.panoCameraOrientationOverlay = null
    }
  }

  private removeAnnotationOverlay(): void {
    if (!this.annotationOverlay) return
    this.scene.remove(this.annotationOverlay)
    this.annotationOverlay.geometry.dispose()
    this.annotationOverlay.material.dispose()
    this.annotationOverlay = null
  }

  private removeFloorPlanOverlays(): void {
    if (!this.floorPlanGroup) return
    this.scene.remove(this.floorPlanGroup)
    this.floorPlanGroup.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        const mat = obj.material
        if (mat instanceof THREE.MeshBasicMaterial) {
          mat.map?.dispose()
          mat.dispose()
        }
      }
    })
    this.floorPlanGroup = null
  }

  /**
   * Affiche les images de plan d'étage dans le repère du nuage (affine `worldToPixel` + altitude).
   * Textures chargées en différé ; les chargements obsolètes sont ignorés si la génération change.
   */
  /**
   * @param applyDevAxesXzy si vrai, même chaîne source→viewer que pour les poses pano en mode XZY
   * (les coins GeoTIFF sont traités comme des points source).
   */
  setFloorPlanOverlays(assets: FloorMapAsset[], applyDevAxesXzy = false): void {
    this.removeFloorPlanOverlays()
    const valid = assets.filter(a => a.worldToPixel && String(a.imageUrl ?? '').trim())
    if (valid.length === 0) return

    const gen = (this.floorPlanLoadGeneration += 1)
    const group = new THREE.Group()
    group.name = 'etl360-floor-plans'
    this.floorPlanGroup = group
    this.scene.add(group)

    const loader = new THREE.TextureLoader()
    const boundsAlt = this.lastCloudBounds

    for (let i = 0; i < valid.length; i += 1) {
      const asset = valid[i]
      const wp = asset.worldToPixel!
      const zAlt =
        asset.floorAltitude !== undefined && Number.isFinite(asset.floorAltitude)
          ? Number(asset.floorAltitude)
          : asset.sliceMinZ !== undefined && asset.sliceMaxZ !== undefined
            ? (Number(asset.sliceMinZ) + Number(asset.sliceMaxZ)) / 2
            : boundsAlt
              ? (boundsAlt.minY + boundsAlt.maxY) / 2
              : 0

      const corners = floorImageCornersWorldXYZ(wp, zAlt)
      if (!corners || corners.length !== 4) continue

      const url = String(asset.imageUrl).trim()
      loader.load(
        url,
        texture => {
          if (gen !== this.floorPlanLoadGeneration) {
            texture.dispose()
            return
          }
          texture.colorSpace = THREE.SRGBColorSpace
          texture.wrapS = THREE.ClampToEdgeWrapping
          texture.wrapT = THREE.ClampToEdgeWrapping
          texture.flipY = false

          const [p00, p10, p11, p01] = corners.map(c => {
            const v = sourceWorldToViewerPosition(c)
            if (!applyDevAxesXzy) return v
            const d = { x: v.x, y: v.z, z: v.y }
            return sourceWorldToViewerPosition(viewerWorldToSourcePosition(d))
          })
          const positions = new Float32Array([
            p00.x,
            p00.y,
            p00.z,
            p10.x,
            p10.y,
            p10.z,
            p11.x,
            p11.y,
            p11.z,
            p01.x,
            p01.y,
            p01.z,
          ])
          const uvs = new Float32Array([
            0, 1, 1, 1, 1, 0, 0, 0,
          ])
          const geom = new THREE.BufferGeometry()
          geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
          geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
          geom.setIndex([0, 1, 2, 0, 2, 3])
          geom.computeVertexNormals()

          const mat = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0.82,
            depthWrite: false,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
          })
          const mesh = new THREE.Mesh(geom, mat)
          mesh.renderOrder = -3 + i * 0.01
          mesh.userData.floorLabel = asset.floorLabel
          group.add(mesh)
        },
        undefined,
        () => {
          /* texture introuvable ou CORS : ignorer ce plan */
        }
      )
    }
  }

  /**
   * Affiche les positions des panoramas importées depuis le ZIP NavVis (CSV pano/pose).
   * Utilise les mêmes unités que le nuage E57 lorsque celui-ci est déjà chargé.
   */
  setPanoCameraOverlay(panos: PanoRecord[]): void {
    this.removePanoCameraOverlay()
    const withColors = ensurePanoViewerColors(panos)
    const coords: number[] = []
    const colorBytes: number[] = []
    const orientationCoords: number[] = []
    const orientationColors: number[] = []
    for (const p of withColors) {
      const w = sourceWorldToViewerPosition(p.position)
      const { x, y, z } = w
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        coords.push(x, y, z)
        const hex = tryParseAnnotationColorHex(p.viewerColor) ?? '#f97316'
        const c = new THREE.Color(hex)
        colorBytes.push(c.r, c.g, c.b)
        const q = new THREE.Quaternion(p.orientation.x, p.orientation.y, p.orientation.z, p.orientation.w)
        if (
          Number.isFinite(q.x) &&
          Number.isFinite(q.y) &&
          Number.isFinite(q.z) &&
          Number.isFinite(q.w) &&
          q.lengthSq() >= 1e-12
        ) {
          q.normalize()
          const fwdSource = viewerWorldDeltaToSource(0, 0, 1)
          const dirSource = new THREE.Vector3(fwdSource.x, fwdSource.y, fwdSource.z).applyQuaternion(q)
          const dirViewer = sourceWorldDeltaToViewer(dirSource.x, dirSource.y, dirSource.z)
          const dir = new THREE.Vector3(dirViewer.x, dirViewer.y, dirViewer.z)
          if (dir.lengthSq() >= 1e-12) {
            dir.normalize()
            const dirDisp = { x: dir.x, y: dir.y, z: dir.z }
            orientationCoords.push(x, y, z, x + dirDisp.x, y + dirDisp.y, z + dirDisp.z)
            orientationColors.push(c.r, c.g, c.b, c.r, c.g, c.b)
          }
        }
      }
    }
    if (coords.length === 0) return

    const positions = new Float32Array(coords)
    const bounds = this.lastCloudBounds ?? this.boundsFromPositions(positions)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colorBytes), 3))
    geometry.computeBoundingSphere()
    const cloudPointSize = this.resolveDisplayCloudPointSize(bounds)
    const material = this.buildPanoCameraVertexColorMaterial(cloudPointSize)
    const overlay = new THREE.Points(geometry, material)
    overlay.renderOrder = 1
    this.panoCameraOverlay = overlay
    this.scene.add(overlay)

    if (orientationCoords.length >= 6) {
      const orientationLength = this.overlayOrientationLength(bounds)
      for (let i = 0; i + 5 < orientationCoords.length; i += 6) {
        const sx = orientationCoords[i]
        const sy = orientationCoords[i + 1]
        const sz = orientationCoords[i + 2]
        const ex = orientationCoords[i + 3]
        const ey = orientationCoords[i + 4]
        const ez = orientationCoords[i + 5]
        const dx = ex - sx
        const dy = ey - sy
        const dz = ez - sz
        orientationCoords[i + 3] = sx + dx * orientationLength
        orientationCoords[i + 4] = sy + dy * orientationLength
        orientationCoords[i + 5] = sz + dz * orientationLength
      }
      const orientationGeometry = new THREE.BufferGeometry()
      orientationGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(orientationCoords), 3)
      )
      orientationGeometry.setAttribute(
        'color',
        new THREE.BufferAttribute(new Float32Array(orientationColors), 3)
      )
      const orientationMaterial = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.92,
        depthTest: true,
        depthWrite: false,
      })
      const orientationOverlay = new THREE.LineSegments(orientationGeometry, orientationMaterial)
      orientationOverlay.renderOrder = 1.5
      this.panoCameraOrientationOverlay = orientationOverlay
      this.scene.add(orientationOverlay)
    }
  }

  setAnnotationOverlay(annotations: AnnotationRecord[], userTemplates?: UserAnnotationTemplate[]): void {
    this.removeAnnotationOverlay()
    const coords: number[] = []
    const colorList: AnnotationRecord[] = []
    for (const annotation of annotations) {
      const target = annotation.pointCloudTarget
      if (target && Number.isFinite(target.x) && Number.isFinite(target.y) && Number.isFinite(target.z)) {
        coords.push(target.x, target.y, target.z)
        colorList.push(annotation)
      }
    }
    if (coords.length === 0) return

    const positions = new Float32Array(coords)
    const bounds = this.lastCloudBounds ?? this.boundsFromPositions(positions)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const colors = new Float32Array(coords.length)
    for (let i = 0; i < colorList.length; i += 1) {
      const hex = annotationRecordColor(colorList[i], userTemplates)
      const col = new THREE.Color(tryParseAnnotationColorHex(hex) ?? ETL360_DEFAULT_ANNOTATION_COLOR)
      const o = i * 3
      colors[o] = col.r
      colors[o + 1] = col.g
      colors[o + 2] = col.b
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.computeBoundingSphere()
    const cloudPointSize = this.resolveDisplayCloudPointSize(bounds)
    const material = this.buildAnnotationPointsMaterial(cloudPointSize)
    const overlay = new THREE.Points(geometry, material)
    overlay.renderOrder = 2
    this.annotationOverlay = overlay
    this.scene.add(overlay)
  }

  /**
   * Un rayon depuis la position pano ; retourne le point du nuage le plus proche sur ce rayon (ou null).
   */
  private raycastPanoYawPitchToPointHit(pano: PanoRecord, yawPitch: YawPitch): THREE.Vector3 | null {
    if (this.pointChunks.length === 0) return null
    const panoOrigin = sourceWorldToViewerPosition(pano.position)
    const origin = new THREE.Vector3(panoOrigin.x, panoOrigin.y, panoOrigin.z)
    if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y) || !Number.isFinite(origin.z)) return null

    const direction = new THREE.Vector3(
      Math.sin(yawPitch.yaw) * Math.cos(yawPitch.pitch),
      Math.sin(yawPitch.pitch),
      Math.cos(yawPitch.yaw) * Math.cos(yawPitch.pitch)
    ).normalize()
    const quaternion = new THREE.Quaternion(
      pano.orientation.x,
      pano.orientation.y,
      pano.orientation.z,
      pano.orientation.w
    )
    if (
      Number.isFinite(quaternion.x) &&
      Number.isFinite(quaternion.y) &&
      Number.isFinite(quaternion.z) &&
    Number.isFinite(quaternion.w) &&
    quaternion.lengthSq() >= 1e-12
    ) {
    quaternion.normalize()
      const srcDir = viewerWorldDeltaToSource(direction.x, direction.y, direction.z)
      direction.set(srcDir.x, srcDir.y, srcDir.z)
      direction.applyQuaternion(quaternion).normalize()
      const viewerDir = sourceWorldDeltaToViewer(direction.x, direction.y, direction.z)
      direction.set(viewerDir.x, viewerDir.y, viewerDir.z).normalize()
    }

    const bounds = this.lastCloudBounds
    const diag =
      bounds ? Math.max(Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ), 1e-6) : 1
    const nPts = Math.max(this.getTotalCloudPointCount(), 1)
    const scarcityBoost = THREE.MathUtils.clamp(95_000 / nPts, 1, 5)
    const baseThresh = (diag / 220) * scarcityBoost
    const raycaster = new THREE.Raycaster(origin, direction, 0.001, diag * 2.5)
    raycaster.params.Points = { threshold: THREE.MathUtils.clamp(baseThresh, 0.07, 6) }
    this.scene.updateMatrixWorld(true)

    let bestPoint: THREE.Vector3 | null = null
    let bestDistance = Infinity
    for (const chunk of this.pointChunks) {
      const hits = raycaster.intersectObject(chunk, false)
      for (const hit of hits) {
        if (!hit.point) continue
        if (hit.distance < bestDistance) {
          bestDistance = hit.distance
          bestPoint = hit.point.clone()
        }
      }
    }

    return bestPoint
  }

  projectPanoramaRayToPointCloud(pano: PanoRecord, yawPitch: YawPitch): Vec3 | null {
    const p = this.raycastPanoYawPitchToPointHit(pano, yawPitch)
    return p ? { x: p.x, y: p.y, z: p.z } : null
  }

  /**
   * Plusieurs directions (ex. coins d une zone + centre) : moyenne des impacts pour rester sur la paroi
   * même si le centre du rectangle vise le ciel ou un trou du nuage voxelisé.
   */
  projectPanoramaSamplesToPointCloud(pano: PanoRecord, samples: YawPitch[]): Vec3 | null {
    if (samples.length === 0) return null
    let sx = 0
    let sy = 0
    let sz = 0
    let n = 0
    for (const yp of samples) {
      const p = this.raycastPanoYawPitchToPointHit(pano, yp)
      if (p) {
        sx += p.x
        sy += p.y
        sz += p.z
        n += 1
      }
    }
    if (n === 0) return null
    return { x: sx / n, y: sy / n, z: sz / n }
  }

  appendPointCloudChunk(
    positions: Float32Array,
    bounds: E57ParseResult['bounds'],
    colors?: Float32Array | null
  ): void {
    if (positions.length === 0) return
    const n = Math.floor(positions.length / 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const hasColors = !!colors && colors.length === positions.length
    if (hasColors && colors) {
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    }
    geometry.computeBoundingSphere()
    const material = hasColors
      ? this.buildVertexColorPointMaterial(bounds, n)
      : this.buildPointMaterial(bounds, n)
    const chunk = new THREE.Points(geometry, material)
    chunk.renderOrder = 0
    this.pointChunks.push(chunk)
    this.scene.add(chunk)
  }

  /**
   * Recentre la caméra sur le nuage (obligatoire après plusieurs `appendPointCloudChunk` :
   * sans cela la caméra reste sur l origine et un nuage en coordonnées projetées est invisible).
   */
  fitCameraToBounds(bounds: E57ParseResult['bounds']): void {
    const dx = bounds.maxX - bounds.minX
    const dy = bounds.maxY - bounds.minY
    const dz = bounds.maxZ - bounds.minZ
    const diag = Math.max(Math.hypot(dx, dy, dz), 1e-6)

    this.lastCloudBounds = {
      minX: bounds.minX,
      minY: bounds.minY,
      minZ: bounds.minZ,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
      maxZ: bounds.maxZ,
    }

    this.target.set(
      (bounds.minX + bounds.maxX) * 0.5,
      (bounds.minY + bounds.maxY) * 0.5,
      (bounds.minZ + bounds.maxZ) * 0.5
    )
    this.distance = THREE.MathUtils.clamp(diag * 1.25, 0.2, 5_000_000)
    this.yaw = 0
    this.pitch = 0.35
  }

  /**
   * Centre la caméra orbitale sur un point monde (ex. cible d annotation projetée sur le nuage).
   * Conserve le yaw / pitch courants ; ajuste la distance d après l envergure du nuage pour un cadrage lisible.
   */
  focusOnWorldPoint(x: number, y: number, z: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return
    this.target.set(x, y, z)
    const bounds = this.lastCloudBounds
    if (bounds) {
      const dx = bounds.maxX - bounds.minX
      const dy = bounds.maxY - bounds.minY
      const dz = bounds.maxZ - bounds.minZ
      const diag = Math.max(Math.hypot(dx, dy, dz), 1e-6)
      this.distance = THREE.MathUtils.clamp(diag * 0.42, 0.12, 5_000_000)
    } else {
      this.distance = THREE.MathUtils.clamp(this.distance, 0.12, 5_000_000)
    }
  }

  setPointCloud(
    positions: Float32Array,
    bounds: E57ParseResult['bounds'],
    colors?: Float32Array | null
  ): void {
    this.clearPointCloudChunksOnly()
    this.appendPointCloudChunk(positions, bounds, colors ?? undefined)
    this.fitCameraToBounds(bounds)
  }

  /** Retire uniquement les chunks du nuage (pas les overlays pano / annotations). */
  private clearPointCloudChunksOnly(): void {
    for (const chunk of this.pointChunks) {
      this.scene.remove(chunk)
      chunk.geometry.dispose()
      chunk.material.dispose()
    }
    this.pointChunks = []
  }

  clear(): void {
    this.removePanoCameraOverlay()
    this.removeAnnotationOverlay()
    this.removeFloorPlanOverlays()
    this.floorPlanLoadGeneration += 1
    this.clearPointCloudChunksOnly()
    this.lastCloudBounds = null
  }

  private animate = (): void => {
    this.animationFrame = window.requestAnimationFrame(this.animate)
    const cp = Math.cos(this.pitch)
    const camX = this.target.x + this.distance * cp * Math.sin(this.yaw)
    const camY = this.target.y + this.distance * Math.sin(this.pitch)
    const camZ = this.target.z + this.distance * cp * Math.cos(this.yaw)
    this.camera.position.set(camX, camY, camZ)
    this.camera.lookAt(this.target)
    this.renderer.render(this.scene, this.camera)
  }

  /** Couleur de fond de la scène (hex CSS, ex. #e2e8f0). */
  setBackgroundColorHex(hex: string): void {
    const c = new THREE.Color()
    try {
      c.setStyle(hex)
    } catch {
      c.setHex(0xe2e8f0)
    }
    this.scene.background = c
  }

  dispose(): void {
    window.cancelAnimationFrame(this.animationFrame)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.container.removeEventListener('pointerdown', this.onPointerDown)
    this.container.removeEventListener('pointermove', this.onPointerMove)
    this.container.removeEventListener('pointerup', this.onPointerUp)
    this.container.removeEventListener('pointerleave', this.onPointerLeave)
    this.container.removeEventListener('pointercancel', this.onPointerUp)
    this.container.removeEventListener('auxclick', this.onMiddleAuxClick)
    this.container.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('resize', this.onResize)
    this.clear()
    this.renderer.dispose()
    this.container.innerHTML = ''
  }
}

export type ETL360ViewerCallbacks = {
  onMarkerSelect: (annotation: AnnotationRecord) => void
  onMarkerClick: (annotation: AnnotationRecord) => void
  onMarkerDoubleClick: (annotation: AnnotationRecord) => void
  onPanoTeleport: (panoId: string) => void
  onPointChange: (annotationId: string, yawPitch: YawPitch) => void
  onZoneChange: (annotationId: string, patch: Pick<AnnotationRecord, 'yawPitch' | 'zone' | 'kind'>) => void
  onRightClick: (yawPitch: YawPitch) => void
  onLeftSphereClick: (yawPitch: YawPitch) => void
  onZoneDrawComplete: (zone: { center: YawPitch; zone: AnnotationZone } | null) => void
  /** Debug : mouvement sur le canvas WebGL (hors marqueurs HTML). `null` = sortie du canvas. */
  onPanoPointerMoveDebug?: (yawPitch: YawPitch | null) => void
  /** Debug : survol d une annotation (null = fin de survol). */
  onAnnotationHoverDebug?: (annotation: AnnotationRecord | null) => void
  /** Debug : survol d un triangle de panorama voisin. */
  onNeighborPanoHoverDebug?: (neighbor: PanoRecord | null) => void
  /** Vue courante (yaw / pitch radians), émis lorsque l orientation change dans le viewer. */
  onPanoViewChange?: (yawPitch: YawPitch) => void
  /** Zoom (FOV vertical °) après la molette — pour synchroniser deux vues (avant / après). */
  onPanoFovChange?: (fovDeg: number) => void
  /** Clic gauche en mode mesure (premier ou second point). */
  onMeasureClick?: (yawPitch: YawPitch) => void
}

/** Au-delà de ce déplacement (px), on considère un glissement : sinon on laisse le navigateur émettre click / dblclick. */
export const ETL360_MARKER_DRAG_THRESHOLD_PX = 6

/** Superposition 3D dans le viewer sphérique : nuage ramené au repère du pano + sprites des voisins. */
export type PanoSphereWorldOverlayConfig = {
  pano: PanoRecord
  worldPositions: Float32Array
  worldColors: Float32Array | null
  maxPoints: number
  maxDistanceM: number
  /** 1 m monde → unités Three.js (la sphère équirectangulaire a un rayon interne ~500). */
  metersToSceneUnit: number
  pointOpacity: number
  pointSizePx: number
  showPoints: boolean
  showNeighborSprites: boolean
  maxNeighborSprites: number
}

export type ETL360MarkerInteraction = 'full' | 'select'

export class EmbeddedSphereViewer {
  private container: HTMLDivElement
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private sphereMesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  private markerLayer: HTMLDivElement
  private markers: AnnotationRecord[] = []
  /** `select` : clic / sélection uniquement (pas de déplacement ni double-clic édition). */
  private markerInteraction: ETL360MarkerInteraction = 'full'
  private currentPano: PanoRecord | null = null
  private neighborPanos: PanoRecord[] = []
  private showNeighborMarkers = true
  private showNeighborQuaternionDebugVisuals = false
  private selectedAnnotationId: string | null = null
  private userTemplates: UserAnnotationTemplate[] = []
  private zonePreviewEl: HTMLDivElement
  private hoverTooltipEl: HTMLDivElement
  private hoveredTooltipAnchor: HTMLElement | null = null
  private zonePlacementStart: YawPitch | null = null
  private zoneDraftCurrent: YawPitch | null = null
  private isZoneDrawing = false
  private activeZoneTransform:
    | {
        annotationId: string
        mode: ZoneHandleMode
        startYawPitch: YawPitch
        initialBounds: ZoneBounds
        currentBounds: ZoneBounds
        /** Redimensionnement coin : coin sphérique fixe (diagonale du coin sous la poignée). */
        cornerResizeAnchor?: YawPitch
        /** Redimensionnement arête yaw : quelle limite yaw suit le curseur (l’autre reste figée à l’initial). */
        yawResizeMoving: 'leftYaw' | 'rightYaw' | null
        /** Redimensionnement arête pitch : quelle limite pitch suit le curseur. */
        pitchResizeMoving: 'topPitch' | 'bottomPitch' | null
      }
    | null = null
  private activePointTransform:
    | {
        annotationId: string
        currentYawPitch: YawPitch
      }
    | null = null
  private radius = 500
  private lon = 0
  private lat = 0
  /** Inversions d’axes pano (correction d’encodage) : appliquées aux conversions écran ↔ yaw/pitch. */
  private panoViewFlipX = false
  private panoViewFlipY = false
  private isPointerDown = false
  private pointerStart = { x: 0, y: 0, lon: 0, lat: 0 }
  private animationFrame = 0
  private callbacksRef: MutableRefObject<ETL360ViewerCallbacks>
  private textureLoader = new THREE.TextureLoader()
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  /** Multiplicateur linéaire sur la texture du panorama (couleur du MeshBasicMaterial). */
  private panoramaExposure = 1
  private resizeObserver: ResizeObserver | null = null
  /**
   * ResizeObserver peut se déclencher en rafale (ex. split avant/après) : on regroupe en un rAF
   * et on redessine tout de suite après setSize pour éviter un frame noir (WebGL efface le buffer).
   */
  private canvasResizeRaf = 0
  private lastCanvasW = 0
  private lastCanvasH = 0
  /** Après un déplacement / redimensionnement réel, ignorer le click synthétique (évite un recentrage caméra intempestif). */
  private suppressNextMarkerClick = false
  private pendingPointGesture: {
    pointerId: number
    onMove: (e: PointerEvent) => void
    onUp: (e: PointerEvent) => void
  } | null = null
  private pendingZoneGesture: {
    pointerId: number
    onMove: (e: PointerEvent) => void
    onUp: (e: PointerEvent) => void
  } | null = null
  private debugPointerMoveRaf = 0
  /** Dernière orientation notifiée via `onPanoViewChange` (deg, même convention que lon/lat). */
  private lastEmittedViewLon: number | null = null
  private lastEmittedViewLat: number | null = null
  /** Nuage + sprites voisins dans le repère du panorama courant. */
  private panoWorldOverlayRoot: THREE.Group | null = null
  private panoWorldOverlayGen = 0
  private readonly _panoOvLocal = new THREE.Vector3()
  private readonly _panoOvQuat = new THREE.Quaternion()

  constructor(container: HTMLDivElement, callbacksRef: MutableRefObject<ETL360ViewerCallbacks>) {
    this.container = container
    this.callbacksRef = callbacksRef
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(75, 1, 1, 2000)
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    {
      const iw = Math.max(2, Math.floor(this.container.clientWidth))
      const ih = Math.max(2, Math.floor(this.container.clientHeight))
      this.renderer.setSize(iw, ih)
      this.lastCanvasW = iw
      this.lastCanvasH = ih
    }
    this.renderer.domElement.style.display = 'block'
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.container.appendChild(this.renderer.domElement)

    this.markerLayer = document.createElement('div')
    this.markerLayer.className = 'absolute inset-0 pointer-events-none'
    // Évite le débordement des pastilles (ex. `left: projected.x - 10` négatif) au bord d’un demi-écran
    // avant / après : la colonne de droite est peinte au-dessus et les marqueurs « sortaient » visuellement sur l’avant.
    this.markerLayer.style.overflow = 'hidden'
    this.container.appendChild(this.markerLayer)
    this.zonePreviewEl = document.createElement('div')
    this.zonePreviewEl.className = 'absolute pointer-events-none hidden border-2 border-dashed border-amber-300 bg-amber-300/20'
    this.markerLayer.appendChild(this.zonePreviewEl)
    this.hoverTooltipEl = document.createElement('div')
    this.hoverTooltipEl.className = 'pointer-events-none absolute hidden max-w-[min(26rem,calc(100%-1rem))] rounded-xl px-3 py-2 text-[11px] leading-relaxed shadow-xl backdrop-blur-md whitespace-pre-wrap break-words z-[40]'
    this.hoverTooltipEl.style.transform = 'translate(-50%, calc(-100% - 12px))'
    this.hoverTooltipEl.style.boxShadow = '0 10px 30px rgba(0,0,0,0.22)'
    this.applyHoverTooltipTheme()
    this.markerLayer.appendChild(this.hoverTooltipEl)

    const geometry = new THREE.SphereGeometry(this.radius, 96, 64)
    geometry.scale(-1, 1, 1)
    const material = new THREE.MeshBasicMaterial({ color: 0x202020, toneMapped: false })
    this.sphereMesh = new THREE.Mesh(geometry, material)
    this.scene.add(this.sphereMesh)

    this.bindEvents()
    this.resizeObserver = new ResizeObserver(() => {
      this.schedulePanoCanvasResize()
    })
    this.resizeObserver.observe(this.container)
    this.applyPanoramaExposure()
    this.animate()
  }

  private applyPanoramaExposure(): void {
    const mat = this.sphereMesh.material
    const e = this.panoramaExposure
    if (mat.map) {
      mat.color.setRGB(e, e, e)
    } else {
      const base = 32 / 255
      mat.color.setRGB(base * e, base * e, base * e)
    }
    mat.needsUpdate = true
  }

  /**
   * Thème réel de l’app (ThemeContext / `index.html`), pas seul `prefers-color-scheme` :
   * sinon en mode sombre appliqué alors que l’OS est en clair, l’infobulle prenait un fond clair
   * tandis que `html.dark-theme #root` impose encore `-webkit-text-fill-color` clair → texte illisible.
   */
  private appChromeIsDarkTheme(): boolean {
    if (typeof document === 'undefined') return true
    const root = document.documentElement
    if (root.classList.contains('light-theme')) return false
    if (root.classList.contains('dark-theme')) return true
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return true
  }

  private applyHoverTooltipTheme(): void {
    const dark = this.appChromeIsDarkTheme()
    const el = this.hoverTooltipEl
    if (dark) {
      const ink = 'rgba(248, 250, 252, 0.97)'
      const surface = 'rgba(3, 7, 18, 0.96)'
      const border = '1px solid rgba(148, 163, 184, 0.35)'
      el.style.setProperty('color', ink, 'important')
      el.style.setProperty('-webkit-text-fill-color', ink, 'important')
      el.style.setProperty('background', surface, 'important')
      el.style.setProperty('border', border, 'important')
    } else {
      const ink = 'rgba(15, 23, 42, 0.96)'
      const surface = 'rgba(255, 255, 255, 0.96)'
      const border = '1px solid rgba(148, 163, 184, 0.42)'
      el.style.setProperty('color', ink, 'important')
      el.style.setProperty('-webkit-text-fill-color', ink, 'important')
      el.style.setProperty('background', surface, 'important')
      el.style.setProperty('border', border, 'important')
    }
  }

  private showHoverTooltip(anchor: HTMLElement, text: string): void {
    const value = String(text || '').trim()
    if (!value) return
    this.applyHoverTooltipTheme()
    this.hoveredTooltipAnchor = anchor
    this.hoverTooltipEl.textContent = value
    this.hoverTooltipEl.classList.remove('hidden')
    this.updateHoverTooltipPosition()
  }

  private hideHoverTooltip(anchor?: HTMLElement | null): void {
    if (anchor && this.hoveredTooltipAnchor !== anchor) return
    this.hoveredTooltipAnchor = null
    this.hoverTooltipEl.classList.add('hidden')
    this.hoverTooltipEl.textContent = ''
  }

  private updateHoverTooltipPosition(): void {
    const anchor = this.hoveredTooltipAnchor
    if (!anchor || this.hoverTooltipEl.classList.contains('hidden')) return
    if (!anchor.isConnected) {
      this.hideHoverTooltip(anchor)
      return
    }
    const anchorRect = anchor.getBoundingClientRect()
    const containerRect = this.container.getBoundingClientRect()
    if (
      anchorRect.width <= 0 ||
      anchorRect.height <= 0 ||
      anchorRect.right < containerRect.left ||
      anchorRect.left > containerRect.right ||
      anchorRect.bottom < containerRect.top ||
      anchorRect.top > containerRect.bottom
    ) {
      this.hideHoverTooltip(anchor)
      return
    }
    const x = anchorRect.left - containerRect.left + anchorRect.width / 2
    const y = anchorRect.top - containerRect.top
    this.hoverTooltipEl.style.left = `${Math.max(8, Math.min(containerRect.width - 8, x))}px`
    this.hoverTooltipEl.style.top = `${Math.max(8, y)}px`
  }

  /**
   * Règle la luminosité du panorama (multiplicateur sur l’échantillonnage de la texture).
   * Plage recommandée ~0,2–2,5 ; 1 = rendu par défaut.
   */
  setPanoramaExposure(value: number): void {
    this.panoramaExposure = THREE.MathUtils.clamp(value, 0.15, 3)
    this.applyPanoramaExposure()
  }

  /**
   * Inversions du repère panorama pour ce pano (correction nord/sud, est/ouest mal encodés).
   * Flip X (est/ouest) : yaw → −yaw ; flip Y (nord/sud) : yaw → π − yaw.
   */
  setPanoViewAxisFlips(flipX: boolean, flipY: boolean): void {
    this.panoViewFlipX = Boolean(flipX)
    this.panoViewFlipY = Boolean(flipY)
    this.lastEmittedViewLon = null
    this.lastEmittedViewLat = null
  }

  /**
   * Désactive les interactions sur la vue (ex. panneau comparaison passif) : pas de rotation / clic.
   */
  setViewInteractionEnabled(enabled: boolean): void {
    const pe = enabled ? 'auto' : 'none'
    this.container.style.pointerEvents = pe
    this.renderer.domElement.style.pointerEvents = pe
  }

  /** Applique les flips d’axes en conservant un mapping involutif et cohérent (écran ↔ annotations ↔ callbacks). */
  private applyPanoViewAxisFlips(yaw: number, pitch: number): YawPitch {
    let yw = yaw
    if (this.panoViewFlipX) yw = normalizeYawRad(-yw)
    if (this.panoViewFlipY) yw = normalizeYawRad(Math.PI - yw)
    return { yaw: yw, pitch }
  }

  private bindEvents(): void {
    this.container.addEventListener('pointerdown', this.onPointerDown)
    this.container.addEventListener('pointermove', this.onPointerMove)
    this.container.addEventListener('pointerup', this.onPointerUp)
    this.container.addEventListener('pointerleave', this.onPointerUp)
    this.container.addEventListener('wheel', this.onWheel, { passive: false })
    this.renderer.domElement.addEventListener('contextmenu', this.onContextMenu)
    this.renderer.domElement.addEventListener('pointermove', this.onCanvasPointerMoveDebug)
    this.renderer.domElement.addEventListener('pointerleave', this.onCanvasPointerLeaveDebug)
    window.addEventListener('resize', this.onResize)
  }

  private schedulePanoCanvasResize = (): void => {
    if (this.canvasResizeRaf) return
    this.canvasResizeRaf = window.requestAnimationFrame(() => {
      this.canvasResizeRaf = 0
      this.applyPanoCanvasSize()
    })
  }

  private applyPanoCanvasSize = (): void => {
    const width = Math.max(2, Math.floor(this.container.clientWidth))
    const height = Math.max(2, Math.floor(this.container.clientHeight))
    if (width === this.lastCanvasW && height === this.lastCanvasH) return
    this.lastCanvasW = width
    this.lastCanvasH = height
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
    this.renderer.render(this.scene, this.camera)
  }

  private onCanvasPointerMoveDebug = (event: PointerEvent): void => {
    const cb = this.callbacksRef.current.onPanoPointerMoveDebug
    if (!cb) return
    const yp = this.screenToYawPitch(event)
    if (this.debugPointerMoveRaf) cancelAnimationFrame(this.debugPointerMoveRaf)
    this.debugPointerMoveRaf = window.requestAnimationFrame(() => {
      this.debugPointerMoveRaf = 0
      cb(yp)
    })
  }

  private onCanvasPointerLeaveDebug = (): void => {
    const cb = this.callbacksRef.current.onPanoPointerMoveDebug
    if (!cb) return
    if (this.debugPointerMoveRaf) {
      cancelAnimationFrame(this.debugPointerMoveRaf)
      this.debugPointerMoveRaf = 0
    }
    cb(null)
  }

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
    const pos = this.screenToYawPitch(event)
    if (pos) this.callbacksRef.current.onRightClick(pos)
  }

  private screenToYawPitch(event: { clientX: number; clientY: number }): YawPitch | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const intersects = this.raycaster.intersectObject(this.sphereMesh, false)
    if (!intersects.length) return null
    const point = intersects[0].point.clone().normalize()
    const yaw = Math.atan2(point.x, point.z)
    const pitch = Math.asin(THREE.MathUtils.clamp(point.y, -1, 1))
    return this.applyPanoViewAxisFlips(yaw, pitch)
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    if (event.target !== this.renderer.domElement) return
    if (this.zonePlacementStart) {
      const pos = this.screenToYawPitch(event)
      if (!pos) return
      this.isZoneDrawing = true
      this.zoneDraftCurrent = pos
      this.updateZonePreview()
      return
    }
    this.isPointerDown = true
    this.pointerStart = { x: event.clientX, y: event.clientY, lon: this.lon, lat: this.lat }
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (this.zonePlacementStart && this.isZoneDrawing) {
      const pos = this.screenToYawPitch(event)
      if (pos) {
        this.zoneDraftCurrent = pos
        this.updateZonePreview()
      }
      return
    }
    if (this.activePointTransform) {
      const pos = this.screenToYawPitch(event)
      if (pos) {
        this.activePointTransform.currentYawPitch = pos
        this.updateMarkerPositions()
      }
      return
    }
    if (this.activeZoneTransform) {
      const pos = this.screenToYawPitch(event)
      if (pos) {
        this.updateActiveZoneTransform(pos)
      }
      return
    }
    if (!this.isPointerDown || event.buttons !== 1) return
    const deltaX = event.clientX - this.pointerStart.x
    const deltaY = event.clientY - this.pointerStart.y
    this.lon = this.pointerStart.lon - deltaX * 0.1
    this.lat = THREE.MathUtils.clamp(this.pointerStart.lat + deltaY * 0.1, -85, 85)
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (event.button !== 0) return
    if (this.zonePlacementStart && this.isZoneDrawing) {
      const pos = this.screenToYawPitch(event)
      if (pos) this.zoneDraftCurrent = pos
      const start = this.zonePlacementStart
      const end = this.zoneDraftCurrent
      this.isZoneDrawing = false
      this.zonePlacementStart = null
      this.zoneDraftCurrent = null
      this.updateZonePreview()
      if (!start || !end) {
        this.callbacksRef.current.onZoneDrawComplete(null)
        return
      }
      const rawYawSpan = Math.abs(shortestYawDelta(start.yaw, end.yaw))
      const rawPitchSpan = Math.abs(end.pitch - start.pitch)
      if (
        rawYawSpan < THREE.MathUtils.degToRad(0.7) &&
        rawPitchSpan < THREE.MathUtils.degToRad(0.7)
      ) {
        this.callbacksRef.current.onZoneDrawComplete(null)
        return
      }
      const built = buildZoneFromCorners(start, end)
      this.callbacksRef.current.onZoneDrawComplete(built)
      return
    }
    if (this.activePointTransform) {
      this.suppressNextMarkerClick = true
      this.callbacksRef.current.onPointChange(
        this.activePointTransform.annotationId,
        this.activePointTransform.currentYawPitch
      )
      this.activePointTransform = null
      this.updateMarkerPositions()
      return
    }
    if (this.activeZoneTransform) {
      this.suppressNextMarkerClick = true
      this.callbacksRef.current.onZoneChange(
        this.activeZoneTransform.annotationId,
        zoneBoundsToAnnotationPatch(this.activeZoneTransform.currentBounds)
      )
      this.activeZoneTransform = null
      this.updateMarkerPositions()
      return
    }
    const wasDragging =
      Math.abs(event.clientX - this.pointerStart.x) > 4 || Math.abs(event.clientY - this.pointerStart.y) > 4
    this.isPointerDown = false
    if (event.target !== this.renderer.domElement) return
    if (!wasDragging) {
      const pos = this.screenToYawPitch(event)
      if (pos) this.callbacksRef.current.onLeftSphereClick(pos)
    }
  }

  private onWheel = (event: WheelEvent): void => {
    if (this.activePointTransform || this.activeZoneTransform || this.zonePlacementStart) return
    event.preventDefault()
    this.camera.fov = THREE.MathUtils.clamp(this.camera.fov + event.deltaY * 0.03, 35, 100)
    this.camera.updateProjectionMatrix()
    this.callbacksRef.current.onPanoFovChange?.(this.camera.fov)
  }

  private onResize = (): void => {
    this.schedulePanoCanvasResize()
  }

  async loadPanorama(imageUrl: string): Promise<void> {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Image panorama illisible'))
      img.src = imageUrl
    })
    const maxTextureSize = Math.max(2048, this.renderer.capabilities.maxTextureSize || 4096)
    const srcW = Math.max(image.naturalWidth || image.width, 1)
    const srcH = Math.max(image.naturalHeight || image.height, 1)
    let texture: THREE.Texture
    if (srcW > maxTextureSize || srcH > maxTextureSize) {
      const scale = Math.min(1, maxTextureSize / Math.max(srcW, srcH))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(2, Math.floor(srcW * scale))
      canvas.height = Math.max(2, Math.floor(srcH * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas panorama indisponible')
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      texture = new THREE.CanvasTexture(canvas)
    } else {
      texture = new THREE.Texture(image)
      texture.needsUpdate = true
    }
    texture.colorSpace = THREE.SRGBColorSpace
    texture.generateMipmaps = true
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.RepeatWrapping
    texture.offset.x = PANO_TEXTURE_U_OFFSET
    const mat = this.sphereMesh.material
    mat.map?.dispose()
    mat.map = texture
    mat.toneMapped = false
    mat.needsUpdate = true
    this.applyPanoramaExposure()
    this.lon = 0
    this.lat = 0
    this.lastEmittedViewLon = null
    this.lastEmittedViewLat = null
    this.renderer.render(this.scene, this.camera)
  }

  private clearPendingPointGesture(): void {
    const p = this.pendingPointGesture
    if (!p) return
    window.removeEventListener('pointermove', p.onMove)
    window.removeEventListener('pointerup', p.onUp)
    this.pendingPointGesture = null
  }

  private clearPendingZoneGesture(): void {
    const p = this.pendingZoneGesture
    if (!p) return
    window.removeEventListener('pointermove', p.onMove)
    window.removeEventListener('pointerup', p.onUp)
    this.pendingZoneGesture = null
  }

  private clearAllPendingMarkerGestures(): void {
    this.clearPendingPointGesture()
    this.clearPendingZoneGesture()
  }

  setMarkers(
    annotations: AnnotationRecord[],
    selectedAnnotationId: string | null = null,
    userTemplates: UserAnnotationTemplate[] = [],
    options?: { interaction?: ETL360MarkerInteraction }
  ): void {
    this.clearAllPendingMarkerGestures()
    this.markers = annotations
    this.selectedAnnotationId = selectedAnnotationId
    this.userTemplates = userTemplates
    if (options?.interaction) {
      this.markerInteraction = options.interaction
    }
    this.hideHoverTooltip()
    this.markerLayer.innerHTML = ''
    this.markerLayer.appendChild(this.zonePreviewEl)
    this.markerLayer.appendChild(this.hoverTooltipEl)
    for (const annotation of annotations) {
      const annKind = annotationKind(annotation)
      const annOrigin = annotationOrigin(annotation)
      const node = document.createElement(annKind === 'point' ? 'button' : 'div')
      node.dataset.role = 'annotation-marker'
      if (node instanceof HTMLButtonElement) {
        node.type = 'button'
        node.className = `absolute pointer-events-auto select-none text-white text-[10px] w-5 h-5 border-2 border-white/75 shadow-md z-[1] ${
          annOrigin === 'terrain_observation' ? 'rounded-[4px]' : 'rounded-full'
        }`
        node.textContent = '•'
        if (annotationPositionLocked(annotation)) {
          node.style.cursor = 'not-allowed'
          node.style.opacity = '0.88'
        }
        if (this.markerInteraction === 'full') {
          node.addEventListener('pointerdown', event => {
            event.stopPropagation()
            if (annotationPositionLocked(annotation)) return
            const pos0 = this.screenToYawPitch(event)
            if (!pos0) return
            const { pointerId, clientX, clientY } = event
            const sx = clientX
            const sy = clientY
            this.clearPendingPointGesture()
            this.clearPendingZoneGesture()
            const onMove = (e: PointerEvent) => {
              if (e.pointerId !== pointerId) return
              if (Math.hypot(e.clientX - sx, e.clientY - sy) <= ETL360_MARKER_DRAG_THRESHOLD_PX) return
              this.clearPendingPointGesture()
              const cur = this.screenToYawPitch(e)
              if (cur) this.beginPointTransform(annotation, cur)
            }
            const onUp = (e: PointerEvent) => {
              if (e.pointerId !== pointerId) return
              this.clearPendingPointGesture()
            }
            this.pendingPointGesture = { pointerId, onMove, onUp }
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
          })
        }
      } else {
        const zoneSelected = annotation.id === this.selectedAnnotationId
        const isText = annKind === 'text'
        node.className = zoneSelected
          ? `absolute pointer-events-auto select-none rounded-sm border-2 border-white/80 ${
              isText ? 'bg-transparent' : 'bg-white/10'
            } shadow-md z-[1] min-w-[10px] min-h-[10px]`
          : `absolute pointer-events-auto select-none rounded-sm ${
              isText ? 'bg-transparent border-0' : 'border border-white/20 bg-black/0'
            } shadow-none z-[1] min-w-[10px] min-h-[10px]`
        node.style.opacity = ''
        if (annotationPositionLocked(annotation)) {
          node.style.cursor = zoneSelected ? 'not-allowed' : 'pointer'
          node.style.opacity = zoneSelected ? '0.92' : '0.78'
        } else if (!zoneSelected) {
          node.style.cursor = 'pointer'
        }
      }
      const zBase =
        annKind === 'zone' ? annotationZoneFillOpacityForRender(annotation) : ETL360_DEFAULT_ZONE_OVERLAY_FILL_OPACITY
      const zFill =
        annotation.id === this.selectedAnnotationId ? Math.min(0.55, zBase + 0.18) : zBase
      const zoneHexAlpha = annotationZoneFillOpacityToHexByte(zFill)
      const markerTexture = annotationOriginMarkerTextureCss(annotationOrigin(annotation))
      ;(node as HTMLElement).style.backgroundColor =
        annKind !== 'point' && annKind !== 'text'
          ? `${annotationRecordColor(annotation, this.userTemplates)}${zoneHexAlpha}`
          : annKind === 'point'
            ? annotationRecordColor(annotation, this.userTemplates)
            : 'transparent'
      ;(node as HTMLElement).style.backgroundImage = markerTexture
      ;(node as HTMLElement).style.backgroundBlendMode = 'normal'
      const hoverTitle = annotationHoverTitle(annotation, this.userTemplates)
      const hoverTooltipText = annotationHoverTooltipText(annotation, this.userTemplates)
      node.setAttribute('aria-label', hoverTitle)
      node.addEventListener('pointerenter', () => this.showHoverTooltip(node as HTMLElement, hoverTooltipText))
      node.addEventListener('pointerleave', () => this.hideHoverTooltip(node as HTMLElement))
      const annHoverDbg = this.callbacksRef.current.onAnnotationHoverDebug
      if (annHoverDbg) {
        node.addEventListener('pointerenter', () => annHoverDbg(annotation))
        node.addEventListener('pointerleave', () => annHoverDbg(null))
      }
      if (annKind === 'text') {
        const textNode = document.createElement('div')
        textNode.className =
          'absolute inset-[2px] pointer-events-none flex items-center justify-center px-1 text-center leading-tight font-semibold'
        textNode.dataset.role = 'annotation-text-content'
        textNode.style.userSelect = 'none'
        node.appendChild(textNode)
      }
      if (
        this.markerInteraction === 'full' &&
        !(node instanceof HTMLButtonElement) &&
        annotation.zone &&
        annotation.id === this.selectedAnnotationId
      ) {
        const handles: Array<{ mode: ZoneHandleMode; className: string; label: string }> = [
          { mode: 'move', className: 'absolute inset-0 cursor-move', label: 'Deplacer la zone' },
          { mode: 'left', className: 'absolute left-[-6px] top-[8px] bottom-[8px] w-3 cursor-ew-resize', label: 'Redimensionner largeur gauche' },
          { mode: 'right', className: 'absolute right-[-6px] top-[8px] bottom-[8px] w-3 cursor-ew-resize', label: 'Redimensionner largeur droite' },
          { mode: 'top', className: 'absolute top-[-6px] left-[8px] right-[8px] h-3 cursor-ns-resize', label: 'Redimensionner hauteur haut' },
          { mode: 'bottom', className: 'absolute bottom-[-6px] left-[8px] right-[8px] h-3 cursor-ns-resize', label: 'Redimensionner hauteur bas' },
          { mode: 'top-left', className: 'absolute left-[-6px] top-[-6px] h-3 w-3 cursor-nwse-resize bg-white/70 rounded-full border border-slate-900/40', label: 'Redimensionner coin haut gauche' },
          { mode: 'top-right', className: 'absolute right-[-6px] top-[-6px] h-3 w-3 cursor-nesw-resize bg-white/70 rounded-full border border-slate-900/40', label: 'Redimensionner coin haut droit' },
          { mode: 'bottom-left', className: 'absolute left-[-6px] bottom-[-6px] h-3 w-3 cursor-nesw-resize bg-white/70 rounded-full border border-slate-900/40', label: 'Redimensionner coin bas gauche' },
          { mode: 'bottom-right', className: 'absolute right-[-6px] bottom-[-6px] h-3 w-3 cursor-nwse-resize bg-white/70 rounded-full border border-slate-900/40', label: 'Redimensionner coin bas droit' },
        ]
        handles.forEach(handle => {
          const el = document.createElement('div')
          el.className = handle.className
          el.title = `${hoverTitle} — ${handle.label}`
          if (annotationPositionLocked(annotation)) {
            el.style.cursor = 'not-allowed'
          }
          el.addEventListener('pointerdown', event => {
            event.stopPropagation()
            if (annotationPositionLocked(annotation)) return
            const pos0 = this.screenToYawPitch(event)
            if (!pos0) return
            const { pointerId, clientX, clientY } = event
            const sx = clientX
            const sy = clientY
            this.clearPendingPointGesture()
            this.clearPendingZoneGesture()
            const onMove = (e: PointerEvent) => {
              if (e.pointerId !== pointerId) return
              if (Math.hypot(e.clientX - sx, e.clientY - sy) <= ETL360_MARKER_DRAG_THRESHOLD_PX) return
              this.clearPendingZoneGesture()
              const cur = this.screenToYawPitch(e)
              if (cur) this.beginZoneTransform(annotation, handle.mode, cur)
            }
            const onUp = (e: PointerEvent) => {
              if (e.pointerId !== pointerId) return
              this.clearPendingZoneGesture()
            }
            this.pendingZoneGesture = { pointerId, onMove, onUp }
            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
          })
          node.appendChild(el)
        })
      }
      node.addEventListener('click', event => {
        event.stopPropagation()
        if (this.suppressNextMarkerClick) {
          this.suppressNextMarkerClick = false
          return
        }
        this.callbacksRef.current.onMarkerClick(annotation)
      })
      if (this.markerInteraction === 'full') {
        node.addEventListener('dblclick', event => {
          event.stopPropagation()
          event.preventDefault()
          this.callbacksRef.current.onMarkerDoubleClick(annotation)
        })
      }
      this.markerLayer.appendChild(node)
    }
    const currentFloorOrder = Number(this.currentPano?.floorOrder)
    const currentAlt = Number(this.currentPano?.position.z)
    const resolveNeighborMarkerVisual = (
      pano: PanoRecord
    ): { glyph: string; titlePrefix: string } => {
      const targetFloorOrder = Number(pano.floorOrder)
      if (Number.isFinite(currentFloorOrder) && Number.isFinite(targetFloorOrder)) {
        if (targetFloorOrder < currentFloorOrder) return { glyph: '▼', titlePrefix: 'Etage inferieur' }
        if (targetFloorOrder > currentFloorOrder) return { glyph: '▲', titlePrefix: 'Etage superieur' }
        return { glyph: '●', titlePrefix: 'Meme etage' }
      }
      const targetAlt = Number(pano.position.z)
      if (Number.isFinite(currentAlt) && Number.isFinite(targetAlt)) {
        const dz = targetAlt - currentAlt
        if (dz < -0.25) return { glyph: '▼', titlePrefix: 'Plus bas' }
        if (dz > 0.25) return { glyph: '▲', titlePrefix: 'Plus haut' }
      }
      return { glyph: '●', titlePrefix: 'Meme niveau' }
    }
    for (const pano of this.neighborPanos) {
      const visual = resolveNeighborMarkerVisual(pano)
      const node = document.createElement('button')
      node.type = 'button'
      node.dataset.role = 'neighbor-pano-marker'
      node.dataset.panoId = pano.id
      node.className =
        'absolute pointer-events-auto select-none z-[1] grid place-items-center min-w-[1.15rem] h-[1.15rem] px-0.5 text-[12px] leading-none font-bold drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)] transition-transform duration-150 hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/80'
      node.textContent = visual.glyph
      node.style.color = '#f59e0b'
      node.style.background = 'transparent'
      node.style.border = '0'
      node.style.borderRadius = '999px'
      node.style.cursor = 'pointer'
      const neighborAriaLabel = `${visual.titlePrefix} · Aller vers ${pano.displayLabel?.trim() || pano.filename || pano.id}`
      node.setAttribute('aria-label', neighborAriaLabel)
      node.addEventListener('pointerenter', () =>
        this.showHoverTooltip(node, neighborPanoHoverTooltipText(visual.titlePrefix, pano))
      )
      node.addEventListener('pointerleave', () => this.hideHoverTooltip(node))
      const neighHoverDbg = this.callbacksRef.current.onNeighborPanoHoverDebug
      if (neighHoverDbg) {
        node.addEventListener('pointerenter', () => neighHoverDbg(pano))
        node.addEventListener('pointerleave', () => neighHoverDbg(null))
      }
      node.addEventListener('click', event => {
        event.stopPropagation()
        this.callbacksRef.current.onPanoTeleport(pano.id)
      })
      this.markerLayer.appendChild(node)

      const ghostA = document.createElement('div')
      ghostA.dataset.role = 'neighbor-pano-marker-ghost'
      ghostA.dataset.mode = 'A'
      ghostA.dataset.panoId = pano.id
      ghostA.className =
        'absolute pointer-events-none select-none z-[2] text-[10px] leading-none font-semibold drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]'
      ghostA.textContent = 'A'
      ghostA.style.color = '#22d3ee'
      ghostA.style.background = 'rgba(7, 16, 26, 0.5)'
      ghostA.style.border = '1px solid rgba(34,211,238,0.7)'
      ghostA.style.borderRadius = '999px'
      ghostA.style.padding = '1px 4px'
      ghostA.style.transform = 'translate(-50%, -50%)'
      ghostA.title = 'Mode A (q.invert())'
      this.markerLayer.appendChild(ghostA)

      const ghostB = document.createElement('div')
      ghostB.dataset.role = 'neighbor-pano-marker-ghost'
      ghostB.dataset.mode = 'B'
      ghostB.dataset.panoId = pano.id
      ghostB.className =
        'absolute pointer-events-auto select-none z-[2] text-[10px] leading-none font-semibold drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]'
      ghostB.textContent = 'B'
      ghostB.style.color = '#f472b6'
      ghostB.style.background = 'rgba(28, 10, 22, 0.5)'
      ghostB.style.border = '1px solid rgba(244,114,182,0.7)'
      ghostB.style.borderRadius = '999px'
      ghostB.style.padding = '1px 4px'
      ghostB.style.transform = 'translate(-50%, -50%)'
      ghostB.style.cursor = 'pointer'
      ghostB.title = 'Mode B (q direct)'
      if (neighHoverDbg) {
        ghostB.addEventListener('pointerenter', () => neighHoverDbg(pano))
        ghostB.addEventListener('pointerleave', () => neighHoverDbg(null))
      }
      ghostB.addEventListener('click', event => {
        event.stopPropagation()
        this.callbacksRef.current.onPanoTeleport(pano.id)
      })
      this.markerLayer.appendChild(ghostB)
    }
    this.updateMarkerPositions()
  }

  setPanoramaContext(currentPano: PanoRecord | null, allPanos: PanoRecord[], maxDistanceM = Number.POSITIVE_INFINITY): void {
    const prevId = this.currentPano?.id ?? null
    this.currentPano = currentPano
    const currentId = currentPano?.id ?? null
    if (currentId !== prevId) {
      this.lastEmittedViewLon = null
      this.lastEmittedViewLat = null
    }
    const maxDist = Number.isFinite(maxDistanceM) ? Math.max(0, maxDistanceM) : Number.POSITIVE_INFINITY
    this.neighborPanos = allPanos.filter(
      p =>
        p.id !== currentId &&
        Number.isFinite(p.position.x) &&
        Number.isFinite(p.position.y) &&
        Number.isFinite(p.position.z) &&
        (!currentPano ||
          Math.hypot(
            p.position.x - currentPano.position.x,
            p.position.y - currentPano.position.y,
            p.position.z - currentPano.position.z
          ) <= maxDist)
    )
    this.setMarkers(this.markers, this.selectedAnnotationId, this.userTemplates)
  }

  setNeighborPanoMarkersVisible(visible: boolean): void {
    this.showNeighborMarkers = visible
    this.updateMarkerPositions()
  }

  /** Affiche les marqueurs fantômes A/B (q^-1 vs q) pour les voisins. */
  setNeighborQuaternionDebugVisible(visible: boolean): void {
    this.showNeighborQuaternionDebugVisuals = visible
    this.updateMarkerPositions()
  }

  private clearPanoWorldOverlayMeshes(): void {
    if (this.panoWorldOverlayRoot) {
      this.scene.remove(this.panoWorldOverlayRoot)
      this.panoWorldOverlayRoot.traverse(obj => {
        if (obj instanceof THREE.Points) {
          obj.geometry.dispose()
          ;(obj.material as THREE.Material).dispose()
        }
        if (obj instanceof THREE.Sprite) {
          const sm = obj.material as THREE.SpriteMaterial
          sm.map?.dispose()
          sm.dispose()
        }
      })
    }
    this.panoWorldOverlayRoot = null
    this.panoWorldOverlayGen++
  }

  /**
   * Superpose dans la scène sphérique un aperçu du nuage (points projetés dans le repère du pano courant)
   * et/ou des sprites texturés pour les panoramas voisins (même rayon que les marqueurs ▲).
   */
  setPanoWorldOverlay(config: PanoSphereWorldOverlayConfig | null): void {
    this.clearPanoWorldOverlayMeshes()

    const show =
      Boolean(config) &&
      Boolean(config!.pano) &&
      config!.worldPositions.length >= 3 &&
      (config!.showPoints || config!.showNeighborSprites)

    if (!show) {
      return
    }

    const c = config!
    const { x: ox, y: oy, z: oz } = sourceWorldToViewerPosition(c.pano.position)
    if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(oz)) {
      return
    }

    const root = new THREE.Group()
    root.name = 'panoWorldOverlay'
    this.panoWorldOverlayRoot = root
    this.scene.add(root)

    if (c.showPoints) {
      const n = Math.floor(c.worldPositions.length / 3)
      const stride = Math.max(1, Math.ceil(n / Math.max(1, c.maxPoints)))
      const colorsOk = c.worldColors !== null && c.worldColors!.length === c.worldPositions.length
      const positions: number[] = []
      const colors: number[] = []
      for (let i = 0; i < n; i += stride) {
        const p = i * 3
        const wx = c.worldPositions[p]
        const wy = c.worldPositions[p + 1]
        const wz = c.worldPositions[p + 2]
        if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz)) continue
        if (!worldDeltaToPanoLocalMut(this._panoOvLocal, wx - ox, wy - oy, wz - oz, c.pano, this._panoOvQuat)) {
          continue
        }
        const dist = this._panoOvLocal.length()
        if (!Number.isFinite(dist) || dist < 0.03 || dist > c.maxDistanceM) continue
        const r = Math.min(dist * c.metersToSceneUnit, this.radius * 0.97)
        if (r < 0.8) continue
        const inv = r / dist
        positions.push(this._panoOvLocal.x * inv, this._panoOvLocal.y * inv, this._panoOvLocal.z * inv)
        // Intensité liée à la distance caméra (origine) → point : plus proche = plus vif, plus loin = plus terne.
        const rNear = 0.8
        const rFar = this.radius * 0.97
        const span = rFar - rNear
        const t = span > 1e-6 ? THREE.MathUtils.clamp((r - rNear) / span, 0, 1) : 0
        const intensity = THREE.MathUtils.lerp(1.12, 0.2, Math.pow(t, 0.82))
        const clamp01 = (x: number) => THREE.MathUtils.clamp(x, 0, 1)
        if (colorsOk) {
          colors.push(
            clamp01(c.worldColors![p] * intensity),
            clamp01(c.worldColors![p + 1] * intensity),
            clamp01(c.worldColors![p + 2] * intensity)
          )
        } else {
          colors.push(
            clamp01(0.52 * intensity),
            clamp01(0.78 * intensity),
            clamp01(0.96 * intensity)
          )
        }
      }
      if (positions.length >= 3) {
        const geom = new THREE.BufferGeometry()
        geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3))
        geom.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(colors), 3))
        const mat = new THREE.PointsMaterial({
          size: c.pointSizePx,
          vertexColors: true,
          transparent: true,
          opacity: c.pointOpacity,
          depthTest: true,
          depthWrite: false,
          sizeAttenuation: true,
        })
        const pts = new THREE.Points(geom, mat)
        pts.renderOrder = 2
        root.add(pts)
      }
    }

    const gen = this.panoWorldOverlayGen
    if (c.showNeighborSprites) {
      void this.appendNeighborSpritesForOverlay(gen, root, c.pano, c.metersToSceneUnit, c.maxDistanceM, c.maxNeighborSprites)
    }
  }

  private async appendNeighborSpritesForOverlay(
    generation: number,
    root: THREE.Group,
    pano: PanoRecord,
    metersToScene: number,
    maxDist: number,
    maxCount: number
  ): Promise<void> {
    const panoViewerPos = sourceWorldToViewerPosition(pano.position)
    const ox = panoViewerPos.x
    const oy = panoViewerPos.y
    const oz = panoViewerPos.z
    const sorted = [...this.neighborPanos].filter(p => p.imageExists && p.imageUrl)
    sorted.sort((a, b) => {
      const av = sourceWorldToViewerPosition(a.position)
      const bv = sourceWorldToViewerPosition(b.position)
      const da = Math.hypot(av.x - ox, av.y - oy, av.z - oz)
      const db = Math.hypot(bv.x - ox, bv.y - oy, bv.z - oz)
      return da - db
    })
    const pick = sorted.slice(0, Math.max(0, maxCount))
    for (const np of pick) {
      if (generation !== this.panoWorldOverlayGen) return
      const npViewerPos = sourceWorldToViewerPosition(np.position)
      const dx = npViewerPos.x - ox
      const dy = npViewerPos.y - oy
      const dz = npViewerPos.z - oz
      if (!worldDeltaToPanoLocalMut(this._panoOvLocal, dx, dy, dz, pano, this._panoOvQuat)) continue
      const dist = this._panoOvLocal.length()
      if (!Number.isFinite(dist) || dist < 0.05 || dist > maxDist) continue
      const r = Math.min(dist * metersToScene, this.radius * 0.96)
      const inv = r / dist
      const px = this._panoOvLocal.x * inv
      const py = this._panoOvLocal.y * inv
      const pz = this._panoOvLocal.z * inv
      try {
        const texture = await this.textureLoader.loadAsync(np.imageUrl!)
        if (generation !== this.panoWorldOverlayGen) {
          texture.dispose()
          return
        }
        texture.colorSpace = THREE.SRGBColorSpace
        const mat = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          opacity: 0.92,
          depthTest: true,
          depthWrite: false,
        })
        const sprite = new THREE.Sprite(mat)
        sprite.position.set(px, py, pz)
        const baseSize = Math.max(32, Math.min(100, r * 0.2))
        sprite.scale.set(baseSize, baseSize * 0.65, 1)
        sprite.renderOrder = 3
        root.add(sprite)
      } catch {
        /* texture introuvable ou CORS */
      }
    }
  }

  focusYawPitch(yaw: number, pitch: number): void {
    const { yaw: yw, pitch: pi } = this.applyPanoViewAxisFlips(yaw, pitch)
    this.lon = THREE.MathUtils.radToDeg(yw)
    this.lat = THREE.MathUtils.radToDeg(pi)
  }

  projectYawPitchPublic(yaw: number, pitch: number): { x: number; y: number; visible: boolean } {
    return this.projectYawPitch(yaw, pitch)
  }

  /** FOV vertical courant du viewer (référence pour aligner les rendus externes, ex. export PDF). */
  getCameraFovDeg(): number {
    return Number.isFinite(this.camera.fov) ? this.camera.fov : 75
  }

  /** Ajuste le FOV (zoom) sans émettre `onPanoFovChange` — utiliser pour la synchro entre deux vues. */
  setCameraFovDeg(deg: number): void {
    if (!Number.isFinite(deg)) return
    this.camera.fov = THREE.MathUtils.clamp(deg, 35, 100)
    this.camera.updateProjectionMatrix()
  }

  screenToYawPitchPublic(clientX: number, clientY: number): YawPitch | null {
    return this.screenToYawPitch({ clientX, clientY })
  }

  startZonePlacement(start: YawPitch): void {
    this.zonePlacementStart = start
    this.zoneDraftCurrent = start
    this.isZoneDrawing = false
    this.updateZonePreview()
  }

  cancelZonePlacement(): void {
    this.zonePlacementStart = null
    this.zoneDraftCurrent = null
    this.isZoneDrawing = false
    this.updateZonePreview()
  }

  private zoneCornersScreen(
    bounds: ZoneBounds
  ): Array<{ id: ZoneCornerIndex; x: number; y: number; visible: boolean }> {
    const ids: ZoneCornerIndex[] = [0, 1, 2, 3]
    return ids.map(id => {
      const yp = zoneCornerYawPitch(bounds, id)
      const p = this.projectYawPitch(yp.yaw, yp.pitch)
      return { id, x: p.x, y: p.y, visible: p.visible }
    })
  }

  /** Coin sphérique opposé au coin écran le plus proche de la poignée (TL/TR/BL/BR du AABB). */
  private resolveCornerResizeAnchor(bounds: ZoneBounds, mode: ZoneHandleMode): YawPitch | null {
    if (mode !== 'top-left' && mode !== 'top-right' && mode !== 'bottom-left' && mode !== 'bottom-right') {
      return null
    }
    const pts = this.zoneCornersScreen(bounds)
    if (!pts.every(p => p.visible)) return null
    const xs = pts.map(p => p.x)
    const ys = pts.map(p => p.y)
    const boxLeft = Math.max(0, Math.min(...xs))
    const boxTop = Math.max(0, Math.min(...ys))
    const boxRight = Math.min(this.container.clientWidth, Math.max(...xs))
    const boxBottom = Math.min(this.container.clientHeight, Math.max(...ys))
    const targets: Record<string, { x: number; y: number }> = {
      'top-left': { x: boxLeft, y: boxTop },
      'top-right': { x: boxRight, y: boxTop },
      'bottom-left': { x: boxLeft, y: boxBottom },
      'bottom-right': { x: boxRight, y: boxBottom },
    }
    const t = targets[mode]
    if (!t) return null
    let best: ZoneCornerIndex = 0
    let bestD = Infinity
    for (const p of pts) {
      if (!p.visible) continue
      const d = Math.hypot(p.x - t.x, p.y - t.y)
      if (d < bestD) {
        bestD = d
        best = p.id
      }
    }
    return zoneCornerYawPitch(bounds, zoneDiagonalCornerIndex(best))
  }

  /** Quelle limite yaw est sur le bord gauche / droit du rectangle écran (AABB). */
  private resolveYawResizeMoving(bounds: ZoneBounds, handle: 'left' | 'right'): 'leftYaw' | 'rightYaw' {
    const pts = this.zoneCornersScreen(bounds)
    if (!pts.every(p => p.visible)) return handle === 'left' ? 'leftYaw' : 'rightYaw'
    const xs = pts.map(p => p.x)
    const eps = Math.max(2, this.container.clientWidth * 0.004)
    const targetX = handle === 'left' ? Math.min(...xs) : Math.max(...xs)
    const sideIds = new Set(
      pts.filter(p => Math.abs(p.x - targetX) <= eps).map(p => p.id)
    ) as Set<ZoneCornerIndex>
    const hasL = sideIds.has(0) && sideIds.has(3)
    const hasR = sideIds.has(1) && sideIds.has(2)
    if (handle === 'left') {
      if (hasL && !hasR) return 'leftYaw'
      if (hasR && !hasL) return 'rightYaw'
    } else {
      if (hasR && !hasL) return 'rightYaw'
      if (hasL && !hasR) return 'leftYaw'
    }
    const one = [...sideIds][0]
    if (one === 0 || one === 3) return 'leftYaw'
    if (one === 1 || one === 2) return 'rightYaw'
    return handle === 'left' ? 'leftYaw' : 'rightYaw'
  }

  /** Quelle limite pitch est sur le bord haut / bas du AABB (y écran croissant vers le bas). */
  private resolvePitchResizeMoving(bounds: ZoneBounds, handle: 'top' | 'bottom'): 'topPitch' | 'bottomPitch' {
    const pts = this.zoneCornersScreen(bounds)
    if (!pts.every(p => p.visible)) return handle === 'top' ? 'topPitch' : 'bottomPitch'
    const ys = pts.map(p => p.y)
    const eps = Math.max(2, this.container.clientHeight * 0.004)
    if (handle === 'top') {
      const minY = Math.min(...ys)
      const sideIds = new Set(
        pts.filter(p => Math.abs(p.y - minY) <= eps).map(p => p.id)
      ) as Set<ZoneCornerIndex>
      const hasTop = sideIds.has(0) && sideIds.has(1)
      const hasBot = sideIds.has(2) && sideIds.has(3)
      if (hasTop && !hasBot) return 'topPitch'
      if (hasBot && !hasTop) return 'bottomPitch'
      const one = [...sideIds][0]
      if (one === 0 || one === 1) return 'topPitch'
      if (one === 2 || one === 3) return 'bottomPitch'
      return 'topPitch'
    }
    const maxY = Math.max(...ys)
    const sideIds = new Set(
      pts.filter(p => Math.abs(p.y - maxY) <= eps).map(p => p.id)
    ) as Set<ZoneCornerIndex>
    const hasTop = sideIds.has(0) && sideIds.has(1)
    const hasBot = sideIds.has(2) && sideIds.has(3)
    if (hasBot && !hasTop) return 'bottomPitch'
    if (hasTop && !hasBot) return 'topPitch'
    const one = [...sideIds][0]
    if (one === 2 || one === 3) return 'bottomPitch'
    if (one === 0 || one === 1) return 'topPitch'
    return 'bottomPitch'
  }

  private beginZoneTransform(annotation: AnnotationRecord, mode: ZoneHandleMode, start: YawPitch): void {
    if (this.markerInteraction === 'select') return
    if (annotationPositionLocked(annotation)) return
    const bounds = annotationZoneBounds(annotation)
    if (!bounds) return
    this.callbacksRef.current.onMarkerSelect(annotation)
    const cornerAnchor = this.resolveCornerResizeAnchor(bounds, mode)
    let yawResizeMoving: 'leftYaw' | 'rightYaw' | null = null
    let pitchResizeMoving: 'topPitch' | 'bottomPitch' | null = null
    if (mode === 'left' || mode === 'right') {
      yawResizeMoving = this.resolveYawResizeMoving(bounds, mode)
    } else if (mode === 'top' || mode === 'bottom') {
      pitchResizeMoving = this.resolvePitchResizeMoving(bounds, mode)
    } else if (
      !cornerAnchor &&
      (mode === 'top-left' ||
        mode === 'top-right' ||
        mode === 'bottom-left' ||
        mode === 'bottom-right')
    ) {
      yawResizeMoving = this.resolveYawResizeMoving(bounds, mode.includes('left') ? 'left' : 'right')
      pitchResizeMoving = this.resolvePitchResizeMoving(bounds, mode.startsWith('top') ? 'top' : 'bottom')
    }
    this.activeZoneTransform = {
      annotationId: annotation.id,
      mode,
      startYawPitch: start,
      initialBounds: bounds,
      currentBounds: bounds,
      cornerResizeAnchor: cornerAnchor ?? undefined,
      yawResizeMoving,
      pitchResizeMoving,
    }
    this.updateMarkerPositions()
  }

  private beginPointTransform(annotation: AnnotationRecord, start: YawPitch): void {
    if (this.markerInteraction === 'select') return
    if (annotationPositionLocked(annotation)) return
    this.callbacksRef.current.onMarkerSelect(annotation)
    this.activePointTransform = {
      annotationId: annotation.id,
      currentYawPitch: start,
    }
    this.updateMarkerPositions()
  }

  private updateActiveZoneTransform(current: YawPitch): void {
    const active = this.activeZoneTransform
    if (!active) return
    const minYawSpan = THREE.MathUtils.degToRad(1.2)
    const minPitchSpan = THREE.MathUtils.degToRad(1.2)
    const next: ZoneBounds = { ...active.initialBounds }
    if (active.mode === 'move') {
      const dyaw = shortestYawDelta(active.startYawPitch.yaw, current.yaw)
      const dpitch = current.pitch - active.startYawPitch.pitch
      next.leftYaw += dyaw
      next.rightYaw += dyaw
      next.topPitch += dpitch
      next.bottomPitch += dpitch
      active.currentBounds = clampMovedZoneBoundsPitch(next)
      this.updateMarkerPositions()
      return
    }
    if (active.cornerResizeAnchor) {
      const built = buildZoneFromCorners(active.cornerResizeAnchor, current)
      active.currentBounds = clampMovedZoneBoundsPitch(zoneBoundsFromCenterAndZone(built.center, built.zone))
      this.updateMarkerPositions()
      return
    }
    const currentLeft = unwrapYawNear(active.initialBounds.leftYaw, current.yaw)
    const currentRight = unwrapYawNear(active.initialBounds.rightYaw, current.yaw)
    const clampedPitch = THREE.MathUtils.clamp(current.pitch, -Math.PI / 2, Math.PI / 2)
    const mode = active.mode
    const touchesLeftYaw =
      mode === 'left' || mode === 'top-left' || mode === 'bottom-left'
    const touchesRightYaw =
      mode === 'right' || mode === 'top-right' || mode === 'bottom-right'
    const touchesTopPitch = mode === 'top' || mode === 'top-left' || mode === 'top-right'
    const touchesBottomPitch = mode === 'bottom' || mode === 'bottom-left' || mode === 'bottom-right'

    if (touchesLeftYaw || touchesRightYaw) {
      const moveLeft = active.yawResizeMoving === 'leftYaw'
      const moveRight = active.yawResizeMoving === 'rightYaw'
      if (touchesLeftYaw && moveLeft) {
        next.leftYaw = Math.min(currentLeft, next.rightYaw - minYawSpan)
      } else if (touchesLeftYaw && moveRight) {
        next.rightYaw = Math.max(currentRight, next.leftYaw + minYawSpan)
      }
      if (touchesRightYaw && moveRight) {
        next.rightYaw = Math.max(currentRight, next.leftYaw + minYawSpan)
      } else if (touchesRightYaw && moveLeft) {
        next.leftYaw = Math.min(currentLeft, next.rightYaw - minYawSpan)
      }
    }
    if (touchesTopPitch || touchesBottomPitch) {
      const moveTop = active.pitchResizeMoving === 'topPitch'
      const moveBottom = active.pitchResizeMoving === 'bottomPitch'
      if (touchesTopPitch && moveTop) {
        next.topPitch = Math.max(clampedPitch, next.bottomPitch + minPitchSpan)
        next.topPitch = Math.min(next.topPitch, Math.PI / 2)
      } else if (touchesTopPitch && moveBottom) {
        next.bottomPitch = Math.min(clampedPitch, next.topPitch - minPitchSpan)
        next.bottomPitch = Math.max(next.bottomPitch, -Math.PI / 2)
      }
      if (touchesBottomPitch && moveBottom) {
        next.bottomPitch = Math.min(clampedPitch, next.topPitch - minPitchSpan)
        next.bottomPitch = Math.max(next.bottomPitch, -Math.PI / 2)
      } else if (touchesBottomPitch && moveTop) {
        next.topPitch = Math.max(clampedPitch, next.bottomPitch + minPitchSpan)
        next.topPitch = Math.min(next.topPitch, Math.PI / 2)
      }
    }
    active.currentBounds = next
    this.updateMarkerPositions()
  }

  private projectYawPitch(yaw: number, pitch: number): { x: number; y: number; visible: boolean } {
    const { yaw: yw, pitch: pi } = this.applyPanoViewAxisFlips(yaw, pitch)
    const vector = new THREE.Vector3(
      Math.sin(yw) * Math.cos(pi),
      Math.sin(pi),
      Math.cos(yw) * Math.cos(pi)
    ).multiplyScalar(this.radius)

    vector.project(this.camera)
    const visible = vector.z < 1
    const x = (vector.x * 0.5 + 0.5) * this.container.clientWidth
    const y = (-vector.y * 0.5 + 0.5) * this.container.clientHeight
    return { x, y, visible }
  }

  private projectZoneBounds(center: YawPitch, zone: AnnotationZone): {
    left: number
    top: number
    width: number
    height: number
    visible: boolean
  } {
    const halfYaw = zone.yawSpan / 2
    const halfPitch = zone.pitchSpan / 2
    const corners = [
      this.projectYawPitch(normalizeYawRad(center.yaw - halfYaw), center.pitch + halfPitch),
      this.projectYawPitch(normalizeYawRad(center.yaw + halfYaw), center.pitch + halfPitch),
      this.projectYawPitch(normalizeYawRad(center.yaw + halfYaw), center.pitch - halfPitch),
      this.projectYawPitch(normalizeYawRad(center.yaw - halfYaw), center.pitch - halfPitch),
    ]
    if (!corners.every(c => c.visible)) {
      return { left: 0, top: 0, width: 0, height: 0, visible: false }
    }
    const xs = corners.map(c => c.x)
    const ys = corners.map(c => c.y)
    const left = Math.max(0, Math.min(...xs))
    const top = Math.max(0, Math.min(...ys))
    const right = Math.min(this.container.clientWidth, Math.max(...xs))
    const bottom = Math.min(this.container.clientHeight, Math.max(...ys))
    return {
      left,
      top,
      width: Math.max(right - left, 8),
      height: Math.max(bottom - top, 8),
      visible: true,
    }
  }

  private updateZonePreview(): void {
    if (!this.zonePlacementStart || !this.zoneDraftCurrent) {
      this.zonePreviewEl.style.display = 'none'
      return
    }
    const zone = buildZoneFromCorners(this.zonePlacementStart, this.zoneDraftCurrent)
    const bounds = this.projectZoneBounds(zone.center, zone.zone)
    if (!bounds.visible) {
      this.zonePreviewEl.style.display = 'none'
      return
    }
    this.zonePreviewEl.style.display = 'block'
    this.zonePreviewEl.style.left = `${bounds.left}px`
    this.zonePreviewEl.style.top = `${bounds.top}px`
    this.zonePreviewEl.style.width = `${bounds.width}px`
    this.zonePreviewEl.style.height = `${bounds.height}px`
    this.zonePreviewEl.style.zIndex = '3'
  }

  private updateMarkerPositions(): void {
    const nodes = Array.from(this.markerLayer.querySelectorAll('[data-role="annotation-marker"]')) as HTMLElement[]
    nodes.forEach((node, index) => {
      const ann = this.markers[index]
      if (!ann) {
        node.style.display = 'none'
        return
      }
      const zoneBounds =
        this.activeZoneTransform && this.activeZoneTransform.annotationId === ann.id
          ? this.activeZoneTransform.currentBounds
          : null
      const pointYawPitch =
        this.activePointTransform && this.activePointTransform.annotationId === ann.id
          ? this.activePointTransform.currentYawPitch
          : ann.yawPitch
      const selected = ann.id === this.selectedAnnotationId
      const annKind = annotationKind(ann)
      if (annKind !== 'point' && ann.zone) {
        const bounds = zoneBounds
          ? this.projectZoneBounds(zoneBoundsToAnnotationPatch(zoneBounds).yawPitch, zoneBoundsToAnnotationPatch(zoneBounds).zone)
          : this.projectZoneBounds(ann.yawPitch, ann.zone)
        if (!bounds.visible) {
          node.style.display = 'none'
          return
        }
        node.style.display = 'block'
        node.style.left = `${bounds.left}px`
        node.style.top = `${bounds.top}px`
        node.style.width = `${bounds.width}px`
        node.style.height = `${bounds.height}px`
        node.style.boxShadow = selected ? '0 0 0 3px rgba(52, 211, 153, 0.95)' : 'none'
        node.style.zIndex = selected ? '2' : '1'
        const textNode = node.querySelector('[data-role="annotation-text-content"]') as HTMLDivElement | null
        if (textNode) {
          const txt = (ann.textContent || ann.description || ann.identifier || ann.label || '').trim()
          textNode.textContent = txt
          textNode.style.fontSize = `${annotationTextSizePx(ann)}px`
          textNode.style.color = annotationTextColorCss(ann)
          textNode.style.display = txt ? 'flex' : 'none'
        }
        return
      }
      const projected = this.projectYawPitch(pointYawPitch.yaw, pointYawPitch.pitch)
      if (!projected.visible) {
        node.style.display = 'none'
        return
      }
      node.style.display = 'grid'
      node.style.placeItems = 'center'
      node.style.width = '20px'
      node.style.height = '20px'
      node.style.left = `${projected.x - 10}px`
      node.style.top = `${projected.y - 10}px`
      node.style.boxShadow = selected ? '0 0 0 3px rgba(52, 211, 153, 0.95)' : 'none'
      node.style.zIndex = selected ? '2' : '1'
    })
    const neighborNodes = Array.from(
      this.markerLayer.querySelectorAll('[data-role="neighbor-pano-marker"]')
    ) as HTMLElement[]
    const neighborGhostNodes = Array.from(
      this.markerLayer.querySelectorAll('[data-role="neighbor-pano-marker-ghost"]')
    ) as HTMLElement[]
    const current = this.currentPano
    neighborNodes.forEach(node => {
      if (!this.showNeighborMarkers) {
        node.style.display = 'none'
        return
      }
      const panoId = String(node.dataset.panoId || '')
      const target = this.neighborPanos.find(p => p.id === panoId)
      if (!current || !target) {
        node.style.display = 'none'
        return
      }
      const currentViewerPos = sourceWorldToViewerPosition(current.position)
      const targetViewerPos = sourceWorldToViewerPosition(target.position)
      const yp = worldOffsetToPanoMarkerYawPitch(
        targetViewerPos.x - currentViewerPos.x,
        targetViewerPos.y - currentViewerPos.y,
        targetViewerPos.z - currentViewerPos.z,
        current
      )
      if (!yp) {
        node.style.display = 'none'
        return
      }
      const projected = this.projectYawPitch(yp.yaw, yp.pitch)
      if (!projected.visible) {
        node.style.display = 'none'
        return
      }
      node.style.display = 'block'
      node.style.left = `${projected.x}px`
      node.style.top = `${projected.y}px`
      node.style.transform = 'translate(-50%, -50%)'
      node.style.zIndex = '1'
    })
    neighborGhostNodes.forEach(node => {
      if (!this.showNeighborMarkers || !this.showNeighborQuaternionDebugVisuals) {
        node.style.display = 'none'
        return
      }
      const panoId = String(node.dataset.panoId || '')
      const mode = String(node.dataset.mode || 'A')
      const target = this.neighborPanos.find(p => p.id === panoId)
      if (!current || !target) {
        node.style.display = 'none'
        return
      }
      const currentViewerPos = sourceWorldToViewerPosition(current.position)
      const targetViewerPos = sourceWorldToViewerPosition(target.position)
      const yp = worldOffsetToPanoYawPitchWithQuaternionMode(
        targetViewerPos.x - currentViewerPos.x,
        targetViewerPos.y - currentViewerPos.y,
        targetViewerPos.z - currentViewerPos.z,
        current,
        mode === 'B' ? 'direct' : 'inverse'
      )
      if (!yp) {
        node.style.display = 'none'
        return
      }
      const projected = this.projectYawPitch(yp.yaw, yp.pitch)
      if (!projected.visible) {
        node.style.display = 'none'
        return
      }
      node.style.display = 'block'
      node.style.left = `${projected.x}px`
      node.style.top = `${projected.y}px`
      node.style.zIndex = '2'
    })
    this.updateZonePreview()
  }

  private animate = (): void => {
    this.animationFrame = window.requestAnimationFrame(this.animate)
    const phi = THREE.MathUtils.degToRad(90 - this.lat)
    const theta = THREE.MathUtils.degToRad(this.lon)
    const target = new THREE.Vector3(
      this.radius * Math.sin(phi) * Math.sin(theta),
      this.radius * Math.cos(phi),
      this.radius * Math.sin(phi) * Math.cos(theta)
    )
    this.camera.lookAt(target)
    this.renderer.render(this.scene, this.camera)
    this.updateMarkerPositions()
    this.updateHoverTooltipPosition()
    this.emitPanoViewIfChanged(target)
  }

  private emitPanoViewIfChanged(viewDir: THREE.Vector3): void {
    const cb = this.callbacksRef.current.onPanoViewChange
    if (!cb) return
    const eps = 0.035
    if (
      this.lastEmittedViewLon !== null &&
      this.lastEmittedViewLat !== null &&
      Math.abs(this.lon - this.lastEmittedViewLon) < eps &&
      Math.abs(this.lat - this.lastEmittedViewLat) < eps
    ) {
      return
    }
    this.lastEmittedViewLon = this.lon
    this.lastEmittedViewLat = this.lat
    const d = viewDir.clone().normalize()
    const yaw = Math.atan2(d.x, d.z)
    const pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1))
    const { yaw: yy, pitch: pp } = this.applyPanoViewAxisFlips(yaw, pitch)
    cb({ yaw: yy, pitch: pp })
  }

  dispose(): void {
    this.clearAllPendingMarkerGestures()
    this.clearPanoWorldOverlayMeshes()
    if (this.debugPointerMoveRaf) {
      cancelAnimationFrame(this.debugPointerMoveRaf)
      this.debugPointerMoveRaf = 0
    }
    if (this.canvasResizeRaf) {
      cancelAnimationFrame(this.canvasResizeRaf)
      this.canvasResizeRaf = 0
    }
    window.cancelAnimationFrame(this.animationFrame)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.container.removeEventListener('pointerdown', this.onPointerDown)
    this.container.removeEventListener('pointermove', this.onPointerMove)
    this.container.removeEventListener('pointerup', this.onPointerUp)
    this.container.removeEventListener('pointerleave', this.onPointerUp)
    this.container.removeEventListener('wheel', this.onWheel)
    this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu)
    this.renderer.domElement.removeEventListener('pointermove', this.onCanvasPointerMoveDebug)
    this.renderer.domElement.removeEventListener('pointerleave', this.onCanvasPointerLeaveDebug)
    window.removeEventListener('resize', this.onResize)
    this.renderer.dispose()
    this.sphereMesh.geometry.dispose()
    this.sphereMesh.material.dispose()
    this.container.innerHTML = ''
  }
}

export function isLocalHostHostname(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1'
}

export function getDomFullscreenElement(): Element | null {
  const d = document as Document & { webkitFullscreenElement?: Element | null }
  return document.fullscreenElement ?? d.webkitFullscreenElement ?? null
}

export async function enterDomFullscreen(el: HTMLElement): Promise<void> {
  const anyEl = el as HTMLElement & {
    requestFullscreen?: () => Promise<void>
    webkitRequestFullscreen?: () => Promise<void>
  }
  if (typeof anyEl.requestFullscreen === 'function') {
    await anyEl.requestFullscreen()
    return
  }
  if (typeof anyEl.webkitRequestFullscreen === 'function') {
    await Promise.resolve(anyEl.webkitRequestFullscreen())
    return
  }
  throw new Error('Fullscreen non supporte par ce navigateur.')
}

export async function exitDomFullscreen(): Promise<void> {
  const d = document as Document & { webkitExitFullscreen?: () => Promise<void> }
  if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
    await document.exitFullscreen()
    return
  }
  if (typeof d.webkitExitFullscreen === 'function') {
    await d.webkitExitFullscreen()
    return
  }
}
