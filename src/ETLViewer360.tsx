/**
 * etlViewer360/ETLViewer360.tsx
 *
 * Route React : état UI, formulaires, modales, orchestration ZIP / rapport HTML / localStorage.
 * Toute la logique non-UI vit dans etlViewer360Core.ts.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useUser } from '@shared/core/contexts/UserContext'
import { canAccessETL, isDynamicsEtlProjectCode, isLocalhostEtlTestProjectCode } from '@shared/core/lib/etlChantierAccess'
import { isEtlViewer360LocalDevEnabled } from '@shared/core/lib/etlLocalDev'
import { useToast } from '@shared/core/components/Toast'
import {
  getEtlViewerIndex,
  getEtlViewerIndexList,
  rebuildEtlViewerIndexOnBlob,
  getEtlViewerProjectState,
  putEtlViewerProjectState,
  downloadEtlViewerFileAsText,
  downloadEtlViewerFileAsBlob,
  getEtlPointCloudPipelineInfo,
  getEtlSourceZipFilenameCollision,
  uploadE57PointCloudViaBackendProxy,
  startEtlExpandZipJob,
  getEtlExpandZipJobStatus,
  type EtlProjectScopeInput,
  type EtlViewerIndex,
  type EtlViewerIndexDiagnostics,
  type EtlViewerIndexListItem,
} from '@shared/core/services/etlPointCloudBlobApi'
import * as pdfjsLib from 'pdfjs-dist'
import ETLFloorMap from '@shared/core/components/ETLFloorMap'
import type { ETLFloorAnnotationMarker } from '@shared/core/components/ETLFloorMap'
import {
  buildSpatialDatasetWithManualFloors,
  computeBounds,
  getImageNaturalSizeFromDataUrl,
  pixelToWorldXY,
  worldToPixelRescaledToImageSize,
  worldToPixelRescaledWithContentInset,
  worldXYToFloorMapPercentFromDataset,
} from '@shared/core/lib/etlSpatial'
import type { FloorMapAsset, SpatialDataset } from '@shared/core/types/etlSpatial'
import {
  ETL360_E57_RESERVOIR_CAP,
  Vec3,
  Quaternion,
  YawPitch,
  AnnotationKind,
  AnnotationTextTone,
  AnnotationTemplateId,
  AnnotationZone,
  ZoneHandleMode,
  ZoneBounds,
  PanoRecord,
  PanoComparePair,
  AnnotationRecord,
  type AnnotationClientRemarkStatus,
  parseAnnotationClientRemarkStatus,
  AnnotationSpecFieldKey,
  ANNOTATION_SPEC_FIELD_ORDER,
  ANNOTATION_SPEC_FIELD_LABELS,
  ANNOTATION_SPEC_FIELD_BY_KEY,
  ETL360_SELECT_BASE,
  AnnotationTemplateDef,
  AnnotationOrigin,
  ANNOTATION_TEMPLATE_LIST,
  UserAnnotationTemplateCharacteristic,
  UserAnnotationTemplate,
  ETL360_USER_TEMPLATES_SCHEMA,
  userTemplatesStorageKey,
  recentTemplateChoicesStorageKey,
  parseRecentTemplateChoicesJson,
  bumpRecentTemplateChoices,
  templatePickerKeyFromParts,
  parseCustomTemplateValues,
  buildCharacteristicsWithKeys,
  buildCharacteristicsFromEditorRows,
  compactStringRecord,
  userTemplateDefaultsRecord,
  parseBuiltinSpecKeysFromRaw,
  parseBuiltinSpecDefaultsFromRaw,
  parseUserTemplatesFromStorage,
  resolvedTemplateLabel,
  parseAnnotationTemplateId,
  effectiveIntegratedTemplateDef,
  integratedTemplateOverride,
  isIntegratedTemplateOverrideId,
  INTEGRATED_SURFACE_AUTRE_VALUE,
  matiereWidgetProfileFor,
  integratedSurfaceMatiereTemplateId,
  defaultIntegratedSurfaceMatiereCustom,
  parseSolTemplateCheckboxStored,
  ETL360_DEFAULT_ZONE_OVERLAY_FILL_OPACITY,
  clampZoneFillOpacity,
  annotationHasSpecValue,
  annotationSpecSlotsFromRecord,
  E57ParseResult,
  E57ViewerStats,
  ETL360_DEFAULT_ANNOTATION_COLOR,
  tryParseAnnotationColorHex,
  annotationRecordColor,
  annotationOrigin,
  annotationUsesSourceWorldHorizontalXY,
  annotationOriginMarkerTextureCss,
  annotationKind,
  annotationPositionLocked,
  normalizeYawRad,
  shortestYawDelta,
  buildZoneFromCorners,
  annotationFocusYawPitch,
  annotationZoneBounds,
  zoneBoundsToAnnotationPatch,
  unwrapYawNear,
  ZoneCornerIndex,
  zoneCornerYawPitch,
  zoneDiagonalCornerIndex,
  zoneBoundsFromCenterAndZone,
  clampMovedZoneBoundsPitch,
  annotationHexToRgb255,
  textGrayForAnnotationBackground,
  renderAnnotationViewThumbnail,
  annotationColorForRecord,
  resolveAnnotationCreationColor,
  parseAnnotationTextTone,
  parseAnnotationTextSizePx,
  ExtractedDataset,
  normalizePath,
  toFiniteNumber,
  parseOptionalTrimmedString,
  mergeSpecSlotsForEditor,
  AnnCreationSpecForm,
  emptyAnnCreationSpecForm,
  annCreationSpecFormFromBuiltinDefaults,
  creationSpecFormFromPartialDefaults,
  annotationToCreationSpecForm,
  buildAnnotationSpecPatchFromCreationForm,
  parseCsvRows,
  getRowValue,
  basename,
  findBestImageEntry,
  parsePanosFromJsonFile,
  parsePanosFromCsvFile,
  normalizeImportedAnnotation,
  parseAnnotationsFromRows,
  parseAnnotationsFromJson,
  sanitizePanoIdForFilename,
  inferFloorLabelFromPath,
  GeoTiffSpatialMeta,
  parseGeoTiffSpatialMeta,
  assignPanosToFloorsAutomatically,
  assignNearestFloorAndPositionsFromCloudPoint,
  panoSourcePositionForE57DevAxesXzy,
  panoRawSourcePositionFromE57DevAdjustedPosition,
  filterFloorAssignmentsToKnownPlans,
  buildFloorOrderByAltitude,
  extensionFromFilename,
  etageDisplayNumberByFloorLabel,
  applyZipImportAutoPanoNames,
  convertTiffBlobToJpegBlob,
  buildAnnotationsDocument,
  newAnnotationId,
  formatAnnotationSpecsLine,
  annotationHoverTitle,
  localStorageKeyForPano,
  localStorageKeyForPanoExposure,
  buildLowCostPlaceholderFloorMapAssets,
  buildFloorMapAssetsFromBlobEntries,
  buildAltitudeHistogram,
  buildSideProfileDataUrl,
  buildSlicePreviewDataUrl,
  buildFloorMapAssetsFromPointCloudSlices,
  ETL360_E57_LARGE_FILE_BYTES,
  formatE57LoadError,
  ensurePanoViewerColors,
  EmbeddedE57PointCloudViewer,
  ETL360ViewerCallbacks,
  ETL360_MARKER_DRAG_THRESHOLD_PX,
  EmbeddedSphereViewer,
  getDomFullscreenElement,
  enterDomFullscreen,
  exitDomFullscreen,
  worldOffsetToPanoMarkerYawPitch,
  sourceWorldToViewerPosition,
  viewerWorldToSourcePosition,
  viewerWorldDeltaToSource,
  panoViewerYawPitchToSourceGroundDir,
  etl360PostDebugIngest,
  resetImportedAngleNormalizationDebugStats,
  readImportedAngleNormalizationDebugStats,
  panoViewAxisFlipsStorageKey,
  parsePanoViewAxisFlipsFromStorage,
  serializePanoViewAxisFlipsToStorage,
  FloorPlanReplacementMode,
  FloorPlanReplacementAnchorPair,
  FloorPlanReplacementRecord,
  floorPlanReplacementsStorageKey,
  parseFloorPlanReplacementsFromStorage,
  serializeFloorPlanReplacementsToStorage,
  LowCostProjectState,
  LowCostPanoEntry,
  LowCostFloorVisualMode,
  loadLowCostModeFromStorage,
  saveLowCostModeToStorage,
  lowCostProjectStorageKey,
  parseLowCostProjectFromStorage,
  serializeLowCostProjectToStorage,
  lowCostPanoToRecord,
  parsePanosFromCsvTextLazy,
  floorPlanImportControlMetrics,
  floorPlanImportMissingLayers,
  type FloorPlanImportControlMetrics,
} from './etlViewer360Core'
import {
  createEmptyEtlViewerProjectStateV1,
  parseEtlViewerProjectStateV1,
  type EtlViewerProjectStateV1,
} from './etlViewerProjectState'
import {
  buildAltitudeColors,
  buildE57PackagePipelineResult,
  buildPanosWithFloorContext,
  buildRenderedPointCloudBuffers,
  buildUnifiedZipPipelineResult,
  computeE57DisplayVoxelMax,
  importDirectE57InWorker,
  importE57FromArrayBufferInWorker,
  loadPointCloudFromBlobPaths,
  projectAnnotationsToPointCloudViaViewer,
  remapViewer360FloorGrouping,
} from './viewer360Pipeline'
import { Etl360TemplateChoice } from './Etl360TemplateChoice'

function formatYawPitchDebugLine(yp: YawPitch | null): string {
  if (!yp) return 'Yaw / pitch : —'
  const yawDeg = (yp.yaw * 180) / Math.PI
  const pitchDeg = (yp.pitch * 180) / Math.PI
  return `Yaw ${yawDeg.toFixed(2)}° · pitch ${pitchDeg.toFixed(2)}°`
}

function formatXyzCloudDebugLine(v: Vec3 | null): string {
  if (!v || !Number.isFinite(v.x)) {
    return 'XYZ nuage : pas d\u2019impact (nuage absent ou rayon sans hit)'
  }
  return `XYZ nuage : ${v.x.toFixed(3)} · ${v.y.toFixed(3)} · ${v.z.toFixed(3)}`
}

function clamp01(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  return x
}

function normalizeVec3(v: Vec3): Vec3 | null {
  const n = Math.hypot(v.x, v.y, v.z)
  if (!Number.isFinite(n) || n < 1e-9) return null
  return { x: v.x / n, y: v.y / n, z: v.z / n }
}

function applyQuatToVec(v: Vec3, q: Quaternion): Vec3 {
  const vx = v.x
  const vy = v.y
  const vz = v.z
  const qx = q.x
  const qy = q.y
  const qz = q.z
  const qw = q.w
  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)
  return {
    x: vx + qw * tx + (qy * tz - qz * ty),
    y: vy + qw * ty + (qz * tx - qx * tz),
    z: vz + qw * tz + (qx * ty - qy * tx),
  }
}

function normalizeQuat(q: Quaternion): Quaternion | null {
  const n = Math.hypot(q.x, q.y, q.z, q.w)
  if (!Number.isFinite(n) || n < 1e-12) return null
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n }
}

function invertQuat(q: Quaternion): Quaternion {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w }
}

function yawPitchToDir(yp: YawPitch): Vec3 {
  const cp = Math.cos(yp.pitch)
  return { x: Math.sin(yp.yaw) * cp, y: Math.sin(yp.pitch), z: Math.cos(yp.yaw) * cp }
}

function dirToYawPitch(dir: Vec3): YawPitch {
  return {
    yaw: Math.atan2(dir.x, dir.z),
    pitch: Math.asin(Math.max(-1, Math.min(1, dir.y))),
  }
}

function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const dot = clamp01((a.x * b.x + a.y * b.y + a.z * b.z + 1) / 2) * 2 - 1
  return (Math.acos(dot) * 180) / Math.PI
}

function formatVec3Line(prefix: string, v: Vec3): string {
  return `${prefix} ${v.x.toFixed(3)} · ${v.y.toFixed(3)} · ${v.z.toFixed(3)}`
}

/** Copie superficielle des poses (référence pour revenir au mode « plan TIFF / CSV »). */
function clonePanosForDevFloorBaseline(panos: PanoRecord[]): PanoRecord[] {
  return panos.map(p => ({ ...p, position: { ...p.position } }))
}

function buildNeighborQuaternionDebugLines(pano: PanoRecord, neighbor: PanoRecord): string[] {
  const cur = sourceWorldToViewerPosition(pano.position)
  const tar = sourceWorldToViewerPosition(neighbor.position)
  const deltaViewer = { x: tar.x - cur.x, y: tar.y - cur.y, z: tar.z - cur.z }
  const dist = Math.hypot(deltaViewer.x, deltaViewer.y, deltaViewer.z)
  const deltaSource = viewerWorldDeltaToSource(deltaViewer.x, deltaViewer.y, deltaViewer.z)
  const worldDirSource = normalizeVec3(deltaSource)
  if (!worldDirSource) return ['Diag quat: delta voisin nul ou invalide']

  const qRaw: Quaternion = {
    x: pano.orientation.x,
    y: pano.orientation.y,
    z: pano.orientation.z,
    w: pano.orientation.w,
  }
  const q = normalizeQuat(qRaw)
  if (!q) return ['Diag quat: quaternion panorama invalide']
  const qInv = invertQuat(q)

  const localInvSrc = normalizeVec3(applyQuatToVec(worldDirSource, qInv))
  const localDirSrc = normalizeVec3(applyQuatToVec(worldDirSource, q))
  if (!localInvSrc || !localDirSrc) return ['Diag quat: direction locale invalide']

  const localInv = { x: localInvSrc.x, y: localInvSrc.z, z: localInvSrc.y }
  const localDir = { x: localDirSrc.x, y: localDirSrc.z, z: localDirSrc.y }
  const ypInv = dirToYawPitch(localInv)
  const ypDir = dirToYawPitch(localDir)

  const altDelta = deltaViewer.y
  const expectedPitchSign = altDelta > 0.05 ? '+' : altDelta < -0.05 ? '−' : '≈0'
  const pitchSignA = ypInv.pitch > 0.01 ? '+' : ypInv.pitch < -0.01 ? '−' : '≈0'
  const pitchSignB = ypDir.pitch > 0.01 ? '+' : ypDir.pitch < -0.01 ? '−' : '≈0'
  const pitchMatchA = expectedPitchSign === pitchSignA ? '✓' : '✗'
  const pitchMatchB = expectedPitchSign === pitchSignB ? '✓' : '✗'

  return [
    formatVec3Line('Δviewer', deltaViewer),
    `|Δ| ${dist.toFixed(3)} m`,
    `Mode A q⁻¹ -> ${formatYawPitchDebugLine(ypInv)}`,
    `Mode B q -> ${formatYawPitchDebugLine(ypDir)}`,
    `Δalt ${altDelta >= 0 ? '+' : ''}${altDelta.toFixed(3)} m · pitch attendu: ${expectedPitchSign}`,
    `Pitch A: ${pitchSignA} ${pitchMatchA} · Pitch B: ${pitchSignB} ${pitchMatchB}`,
    `q: [${q.x.toFixed(4)}, ${q.y.toFixed(4)}, ${q.z.toFixed(4)}, ${q.w.toFixed(4)}]`,
  ]
}

function debugAnnotationToCloudXyz(
  ann: AnnotationRecord,
  pano: PanoRecord,
  viewer: EmbeddedE57PointCloudViewer | null
): Vec3 | null {
  if (!viewer) return null
  const t = ann.pointCloudTarget
  if (t && Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z)) {
    return t
  }
  const zb = annotationZoneBounds(ann)
  const samples: YawPitch[] = zb
    ? [
        zoneCornerYawPitch(zb, 0),
        zoneCornerYawPitch(zb, 1),
        zoneCornerYawPitch(zb, 2),
        zoneCornerYawPitch(zb, 3),
        ann.yawPitch,
      ]
    : [ann.yawPitch]
  return viewer.projectPanoramaSamplesToPointCloud(pano, samples)
}

function loadImageElementForPdf(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function loadImageElement(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

async function fileToFloorPlanImageDataUrl(file: File): Promise<string | null> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      const page = await pdf.getPage(1)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(2, Math.round(viewport.width))
      canvas.height = Math.max(2, Math.round(viewport.height))
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      await page.render({ canvasContext: ctx, viewport, canvas }).promise
      return canvas.toDataURL('image/png')
    } catch {
      return null
    }
  }
  return await new Promise<string | null>(resolve => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

/** Miniature plan d'étage (TIFF affiché en navigateur) avec marqueur à la position projetée. */
function rasterizeFloorPlanWithMarker(
  img: HTMLImageElement,
  xPct: number,
  yPct: number,
  markerRgb: [number, number, number],
  canvasSize = 260,
  jpegQuality = 0.9
): string | null {
  try {
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (w < 2 || h < 2) return null
    const cw = canvasSize
    const ch = Math.round(canvasSize * (h / w))
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, cw, ch)
    const px = (xPct / 100) * cw
    const py = (yPct / 100) * ch
    const r = Math.max(2.5, Math.min(cw, ch) * 0.012)
    ctx.beginPath()
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.fillStyle = `rgb(${markerRgb[0]},${markerRgb[1]},${markerRgb[2]})`
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.92)'
    ctx.lineWidth = Math.max(1, r * 0.22)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'
    ctx.lineWidth = Math.max(0.75, r * 0.12)
    ctx.stroke()
    return canvas.toDataURL('image/jpeg', jpegQuality)
  } catch {
    return null
  }
}

type FloorPlanMarker = {
  panoId: string
  panoLabel: string
  xPct: number
  yPct: number
  rgb: [number, number, number]
  isCurrent?: boolean
}

type FloorPlanAnnotationMarker = {
  annotationId: string
  annotationLabel: string
  panoId: string
  xPct: number
  yPct: number
  colorHex: string
  markerTextureCss?: string
  markerOrigin?: AnnotationOrigin
  isSelected?: boolean
}

type DrawGuideObject = { _etlDrawGuide?: boolean }

type PanoMinimapWindowState = {
  x: number
  y: number
  width: number
}

const PANO_MINIMAP_MIN_WIDTH = 170
const PANO_MINIMAP_MAX_WIDTH = 620
const PANO_MINIMAP_HEADER_HEIGHT = 28
/** Bande latérale « étages » intégrée à la carte du mini-plan (même cadre que le plan). */
const PANO_MINIMAP_FLOOR_RAIL_PX = 44
const PANO_MINIMAP_MARGIN = 8
/** Zoom / pan du plan dans le mini-plan panorama (aligné sur ETLFloorMap). */
const PANO_MINIMAP_VIEW_MIN_SCALE = 1
const PANO_MINIMAP_VIEW_MAX_SCALE = 6

/** Panneau liste annotations (vue panorama) : position + taille réglables. */
type PanoAnnotationPanelState = {
  x: number
  y: number
  width: number
  height: number
}

const PANO_ANN_PANEL_MIN_W = 148
const PANO_ANN_PANEL_MAX_W = 560
const PANO_ANN_PANEL_MIN_H = 100
const PANO_ANN_PANEL_HEADER_H = 28
const PANO_ANN_PANEL_MARGIN = 8

function clampPanoMinimapWindow(
  input: PanoMinimapWindowState,
  viewportW: number,
  viewportH: number,
  aspect: number
): PanoMinimapWindowState {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))
  const safeAspect = Number.isFinite(aspect) && aspect > 0.05 ? aspect : 0.7
  const maxByWidth = Math.max(PANO_MINIMAP_MIN_WIDTH, viewportW - PANO_MINIMAP_MARGIN * 2)
  const maxByHeight = Math.max(
    PANO_MINIMAP_MIN_WIDTH,
    (viewportH - PANO_MINIMAP_MARGIN * 2 - PANO_MINIMAP_HEADER_HEIGHT) / safeAspect
  )
  const wMax = Math.max(PANO_MINIMAP_MIN_WIDTH, Math.min(PANO_MINIMAP_MAX_WIDTH, maxByWidth, maxByHeight))
  const width = clamp(input.width, PANO_MINIMAP_MIN_WIDTH, wMax)
  const panelHeight = PANO_MINIMAP_HEADER_HEIGHT + width * safeAspect
  const xMax = Math.max(PANO_MINIMAP_MARGIN, viewportW - width - PANO_MINIMAP_MARGIN)
  const yMax = Math.max(PANO_MINIMAP_MARGIN, viewportH - panelHeight - PANO_MINIMAP_MARGIN)
  return {
    x: clamp(input.x, PANO_MINIMAP_MARGIN, xMax),
    y: clamp(input.y, PANO_MINIMAP_MARGIN, yMax),
    width,
  }
}

function clampPanoAnnotationPanel(
  input: PanoAnnotationPanelState,
  viewportW: number,
  viewportH: number
): PanoAnnotationPanelState {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))
  const m = PANO_ANN_PANEL_MARGIN
  const wMax = Math.max(PANO_ANN_PANEL_MIN_W, viewportW - m * 2)
  const hMax = Math.max(PANO_ANN_PANEL_MIN_H, viewportH - m * 2)
  const width = clamp(input.width, PANO_ANN_PANEL_MIN_W, Math.min(PANO_ANN_PANEL_MAX_W, wMax))
  const height = clamp(input.height, PANO_ANN_PANEL_MIN_H, hMax)
  const xMax = Math.max(m, viewportW - width - m)
  const yMax = Math.max(m, viewportH - height - m)
  return {
    x: clamp(input.x, m, xMax),
    y: clamp(input.y, m, yMax),
    width,
    height,
  }
}

/** Miniature plan d'étage avec plusieurs pastilles de panoramas. */
function rasterizeFloorPlanWithPanoMarkers(
  img: HTMLImageElement,
  markers: FloorPlanMarker[],
  canvasSize = 300,
  jpegQuality = 0.9
): string | null {
  try {
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (w < 2 || h < 2) return null
    const cw = canvasSize
    const ch = Math.round(canvasSize * (h / w))
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, cw, ch)
    const baseR = Math.max(3, Math.min(cw, ch) * 0.017)
    for (const m of markers) {
      const px = (m.xPct / 100) * cw
      const py = (m.yPct / 100) * ch
      const r = m.isCurrent ? baseR * 1.55 : baseR
      ctx.beginPath()
      ctx.arc(px, py, r, 0, Math.PI * 2)
      ctx.fillStyle = `rgb(${m.rgb[0]},${m.rgb[1]},${m.rgb[2]})`
      ctx.fill()
      ctx.strokeStyle = m.isCurrent ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.8)'
      ctx.lineWidth = m.isCurrent ? 2.2 : 1.2
      ctx.stroke()
      if (m.isCurrent) {
        ctx.beginPath()
        ctx.arc(px, py, r + 2.6, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(15,23,42,0.9)'
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }
    return canvas.toDataURL('image/jpeg', jpegQuality)
  } catch {
    return null
  }
}

/** Réduction du plan sans marqueur (ex. projection XY indisponible). */
function rasterizeFloorPlanImageOnly(img: HTMLImageElement, canvasSize = 220, jpegQuality = 0.88): string | null {
  try {
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (w < 2 || h < 2) return null
    const cw = canvasSize
    const ch = Math.round(canvasSize * (h / w))
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, cw, ch)
    return canvas.toDataURL('image/jpeg', jpegQuality)
  } catch {
    return null
  }
}

/**
 * Inverse de la position % sur plan (ETLFloorMap) vers XY monde.
 * Si le plan est géoréférencé (worldToPixel), utilise l'affine inverse; sinon fallback sur les bornes XY.
 */
function floorMapPercentToWorldXYFromDataset(
  xPct: number,
  yPct: number,
  floorLabel: string,
  dataset: SpatialDataset
): { x: number; y: number } | null {
  const lab = floorLabel.trim()
  if (!lab || lab === 'Non assigne') return null
  if (!Number.isFinite(xPct) || !Number.isFinite(yPct)) return null
  const px = Math.max(0, Math.min(100, xPct))
  const py = Math.max(0, Math.min(100, yPct))

  const asset = dataset.floorMapAssets.find(a => a.floorLabel === lab)
  const geo = asset?.worldToPixel
  if (geo && Number.isFinite(geo.width) && Number.isFinite(geo.height) && geo.width > 1 && geo.height > 1) {
    const u = (px / 100) * (geo.width - 1)
    const v = (py / 100) * (geo.height - 1)
    const xy = pixelToWorldXY(geo, u, v)
    if (xy) return xy
  }

  const globalB =
    dataset.points.length > 0
      ? computeBounds(dataset.points.map(p => ({ x: p.x, y: p.y })))
      : { minX: 0, maxX: 1, minY: 0, maxY: 1 }
  const b = dataset.boundsByFloor[lab] ?? globalB
  return {
    x: b.minX + (px / 100) * (b.maxX - b.minX),
    y: b.minY + (py / 100) * (b.maxY - b.minY),
  }
}

/**
 * Rotation (deg) pour orienter un cône pointant vers +x écran sur le mini-plan.
 * Utilise le repère source (X,Y au sol) comme `worldXYToFloorMapPercentFromDataset`,
 * après rotation par le quaternion du pano (aligné sur `worldOffsetToPanoYawPitch`).
 */
function panoHorizViewToMinimapConeRotationDeg(
  yawRad: number,
  pitchRad: number,
  floorLabel: string,
  dataset: SpatialDataset,
  pano: PanoRecord | null
): number | null {
  const lab = floorLabel.trim()
  if (!lab || lab === 'Non assigne') return null
  // Utilise la direction réelle de la caméra (yaw+pitch) pour éviter les biais
  // inter-panoramas quand les quaternions ont des composantes de roll.
  const ground = panoViewerYawPitchToSourceGroundDir(yawRad, pitchRad, pano)
  if (!ground) return null
  const { dx: dWx, dy: dWy } = ground

  const asset = dataset.floorMapAssets.find(a => a.floorLabel === lab)
  const geo = asset?.worldToPixel
  if (
    geo &&
    Number.isFinite(geo.width) &&
    Number.isFinite(geo.height) &&
    geo.width > 1 &&
    geo.height > 1 &&
    Number.isFinite(geo.m00) &&
    Number.isFinite(geo.m01) &&
    Number.isFinite(geo.m10) &&
    Number.isFinite(geo.m11)
  ) {
    const du = geo.m00 * dWx + geo.m01 * dWy
    const dv = geo.m10 * dWx + geo.m11 * dWy
    const len = Math.hypot(du, dv)
    if (len < 1e-12) return null
    return (Math.atan2(dv, du) * 180) / Math.PI
  }

  const globalB =
    dataset.points.length > 0
      ? computeBounds(dataset.points.map(p => ({ x: p.x, y: p.y })))
      : { minX: 0, maxX: 1, minY: 0, maxY: 1 }
  const bounds = dataset.boundsByFloor[lab] ?? globalB
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-9)
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-9)
  const dPctX = (dWx / spanX) * 100
  const dPctY = (dWy / spanY) * 100
  if (Math.hypot(dPctX, dPctY) < 1e-12) return null
  return (Math.atan2(dPctY, dPctX) * 180) / Math.PI
}

const ETL360_DEVELOPER_MODE_STORAGE_KEY = 'etl360-developer-mode'
/** Permutation d’affichage XZY (Y↔Z) du nuage 3D en mode développeur. */
const ETL360_DEVELOPER_E57_AXES_XZY_STORAGE_KEY = 'etl360-developer-e57-axes-xzy'
const ETL360_CLIENT_MODE_STORAGE_KEY = 'etl360-client-mode'

/** Valeur du filtre « liste des panoramas » à l'étape low-cost pastilles : tous les étages. */
const LOW_COST_PINNING_LIST_ALL = '__all__'

type FloorPlanImportInteractionMode = 'adjust' | 'crop'

/** Même logique que `fabric/src/util/misc/resolveOrigin` (origine peut être un nombre). */
function resolveFabricOrigin(originValue: unknown): number {
  const m: Record<string, number> = { left: -0.5, top: -0.5, center: 0, bottom: 0.5, right: 0.5 }
  if (typeof originValue === 'string' && originValue in m) return m[originValue]!
  if (typeof originValue === 'number' && Number.isFinite(originValue)) return originValue - 0.5
  return 0
}

/** Équivalent `controlsUtils.isTransformCentered` (non exporté sur le namespace `controlsUtils` du bundle Fabric). */
function isTransformCenteredForFloorPlanCrop(transform: Record<string, unknown>): boolean {
  return (
    resolveFabricOrigin(transform.originX) === resolveFabricOrigin('center') &&
    resolveFabricOrigin(transform.originY) === resolveFabricOrigin('center')
  )
}

/**
 * Cohérence `FabricImage` après rognage : `width`/`height` (fenêtre visuelle) + `cropX`/`cropY` (décalage source),
 * plafonnés sur les dimensions naturelles du bitmap.
 */
function clampFloorPlanImportFabricImageCrop(target: Record<string, unknown>): void {
  const t = target as {
    cropX?: number
    cropY?: number
    width?: number
    height?: number
    set?: (p: unknown) => void
    _element?: { naturalWidth: number; naturalHeight: number; width: number; height: number }
  }
  const el = t._element
  if (!el) return
  const nw = Math.max(0, (el as HTMLImageElement).naturalWidth || el.width)
  const nh = Math.max(0, (el as HTMLImageElement).naturalHeight || el.height)
  if (nw < 1 && nh < 1) return
  let cropX = Math.max(0, Number(t.cropX) || 0)
  let cropY = Math.max(0, Number(t.cropY) || 0)
  let w = Math.max(1, Number(t.width) || 1)
  let h = Math.max(1, Number(t.height) || 1)
  if (nw >= 1) {
    cropX = Math.min(cropX, Math.max(0, nw - 1))
    w = Math.min(w, Math.max(1, nw - cropX))
  }
  if (nh >= 1) {
    cropY = Math.min(cropY, Math.max(0, nh - 1))
    h = Math.min(h, Math.max(1, nh - cropY))
  }
  t.set?.({ cropX, cropY, width: w, height: h })
}

/** Au-delà de ce côté max, beaucoup de navigateurs rendent le canvas vide / noir ; on réduit en gardant le ratio. */
const FLOOR_PLAN_IMPORT_FABRIC_MAX_SIDE_PX = 8000

function capFloorPlanImportFabricCanvasSize(nw: number, nh: number): { w: number; h: number } {
  const w0 = Math.max(200, nw)
  const h0 = Math.max(200, nh)
  const m = Math.max(w0, h0)
  if (m <= FLOOR_PLAN_IMPORT_FABRIC_MAX_SIDE_PX) return { w: w0, h: h0 }
  const s = FLOOR_PLAN_IMPORT_FABRIC_MAX_SIDE_PX / m
  return { w: Math.max(200, Math.floor(w0 * s)), h: Math.max(200, Math.floor(h0 * s)) }
}

/** Métriques de secours si la ref n’est pas encore renseignée (useLayoutEffect avant init). */
const FLOOR_PLAN_IMPORT_CONTROL_FALLBACK = floorPlanImportControlMetrics({
  importSrcW: 2000,
  importSrcH: 2000,
  canvasCssScale: 0.2,
})

function createFloorPlanImportThickBarRenderer(strokePx: number) {
  return function floorPlanImportThickBarRender(this: unknown, ...args: unknown[]): void {
    const ctx = args[0] as CanvasRenderingContext2D | undefined
    const left = Number(args[1])
    const top = Number(args[2])
    if (!ctx || !Number.isFinite(left) || !Number.isFinite(top)) return
    const ctrl = this as { sizeX?: number; sizeY?: number }
    const w = Math.max(14, Math.round(Number(ctrl.sizeX) || 28))
    const h = Math.max(14, Math.round(Number(ctrl.sizeY) || 56))
    const lw = Math.max(1.5, strokePx)
    const x0 = left - w / 2
    const y0 = top - h / 2
    ctx.save()
    ctx.fillStyle = 'rgba(255,255,255,0.94)'
    ctx.strokeStyle = '#0d47a1'
    ctx.lineWidth = lw
    ctx.lineJoin = 'round'
    ctx.fillRect(x0, y0, w, h)
    ctx.strokeRect(x0, y0, w, h)
    ctx.restore()
  }
}

function createFloorPlanImportThickRotRenderer(radius: number, strokePx: number) {
  const r = Math.max(8, Math.round(radius))
  return function floorPlanImportThickRotRender(this: unknown, ...args: unknown[]): void {
    const ctx = args[0] as CanvasRenderingContext2D | undefined
    const left = Number(args[1])
    const top = Number(args[2])
    if (!ctx || !Number.isFinite(left) || !Number.isFinite(top)) return
    const lw = Math.max(1.5, strokePx)
    ctx.save()
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.strokeStyle = '#1565c0'
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.arc(left, top, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
}

/** Contrôles Fabric de l'image importée : ajuster (rotation / scale) ou rogner (bords = cropX/Y/width/height). */
function applyFloorPlanImportImageFabricControls(
  mode: FloorPlanImportInteractionMode,
  FM: Record<string, unknown>,
  fi: Record<string, unknown>,
  metrics?: FloorPlanImportControlMetrics | null
): void {
  const FabricControl = FM.Control as new (opts: Record<string, unknown>) => unknown
  const controlsUtils = FM.controlsUtils as Record<string, unknown> | undefined
  if (!FabricControl || !controlsUtils) return

  const m = metrics ?? FLOOR_PLAN_IMPORT_CONTROL_FALLBACK
  const barR = createFloorPlanImportThickBarRenderer(m.strokePx)
  const rotR = createFloorPlanImportThickRotRenderer(m.rotRadius, m.strokePx)

  if (mode === 'crop') {
    if (!controlsUtils.getLocalPoint || !controlsUtils.wrapWithFireEvent || !controlsUtils.wrapWithFixedAnchor) return
    ;(fi.set as ((p: unknown) => void) | undefined)?.({
      lockRotation: true,
      hasRotatingPoint: false,
      cornerSize: m.cornerSize,
      touchCornerSize: m.touchCornerSize,
      transparentCorners: false,
    })
    const getLocalPoint = controlsUtils.getLocalPoint as (
      t: unknown,
      ox: unknown,
      oy: unknown,
      x: number,
      y: number
    ) => { x: number; y: number }
    const wrapWithFireEvent = controlsUtils.wrapWithFireEvent as (name: string, h: unknown) => unknown
    const wrapWithFixedAnchor = controlsUtils.wrapWithFixedAnchor as (h: unknown) => unknown

    /**
     * Rognage (modèle cohérent `FabricImage._renderFill`) : `width`/`height` = fenêtre source, `cropX`/`cropY` = offset.
     * Même gating que `changeObjectWidth` / miroir sur Y ; pour `ml`/`mt` l’ancre Fabric est droite / bas
     * (`_getOriginFromCorner`) : on **compense** le décalage de fenêtre (sinon bord haut / gauche inversés
     * ou sans effet par rapport à la source).
     */
    const changeObjectCropWidth = (eventData: unknown, transform: Record<string, unknown>, x: number, y: number) => {
      const localPoint = getLocalPoint(transform, transform.originX, transform.originY, x, y)
      if (
        resolveFabricOrigin(transform.originX) === resolveFabricOrigin('center') ||
        (resolveFabricOrigin(transform.originX) === resolveFabricOrigin('right') && localPoint.x < 0) ||
        (resolveFabricOrigin(transform.originX) === resolveFabricOrigin('left') && localPoint.x > 0)
      ) {
        const target = transform.target as Record<string, unknown> & {
          strokeWidth: number
          strokeUniform: boolean
          width: number
          scaleX: number
          cropX?: number
          set: (k: string, v: unknown) => void
        }
        const strokePadding = target.strokeWidth / (target.strokeUniform ? target.scaleX : 1)
        const multiplier = isTransformCenteredForFloorPlanCrop(transform) ? 2 : 1
        const oldWidth = target.width
        const newWidth = Math.abs((localPoint.x * multiplier) / target.scaleX) - strokePadding
        target.set('width', Math.max(newWidth, 1))
        if (oldWidth !== target.width) {
          const wNow = target.width
          const dW = oldWidth - wNow
          const c0 = Number(target.cropX) || 0
          if (isTransformCenteredForFloorPlanCrop(transform)) {
            target.set('cropX', c0 + dW / 2)
          } else if (String(transform.corner) === 'ml') {
            target.set('cropX', c0 + dW)
          }
          clampFloorPlanImportFabricImageCrop(target as Record<string, unknown>)
        }
        return oldWidth !== target.width
      }
      return false
    }
    const changeObjectCropHeight = (eventData: unknown, transform: Record<string, unknown>, x: number, y: number) => {
      const localPoint = getLocalPoint(transform, transform.originX, transform.originY, x, y)
      if (
        resolveFabricOrigin(transform.originY) === resolveFabricOrigin('center') ||
        (resolveFabricOrigin(transform.originY) === resolveFabricOrigin('bottom') && localPoint.y < 0) ||
        (resolveFabricOrigin(transform.originY) === resolveFabricOrigin('top') && localPoint.y > 0)
      ) {
        const target = transform.target as Record<string, unknown> & {
          strokeWidth: number
          strokeUniform: boolean
          height: number
          scaleY: number
          cropY?: number
          set: (k: string, v: unknown) => void
        }
        const strokePadding = target.strokeWidth / (target.strokeUniform ? target.scaleY : 1)
        const multiplier = isTransformCenteredForFloorPlanCrop(transform) ? 2 : 1
        const oldHeight = target.height
        const newHeight = Math.abs((localPoint.y * multiplier) / target.scaleY) - strokePadding
        target.set('height', Math.max(newHeight, 1))
        if (oldHeight !== target.height) {
          const hNow = target.height
          const dH = oldHeight - hNow
          const c0 = Number(target.cropY) || 0
          if (isTransformCenteredForFloorPlanCrop(transform)) {
            target.set('cropY', c0 + dH / 2)
          } else if (String(transform.corner) === 'mt') {
            target.set('cropY', c0 + dH)
          }
          clampFloorPlanImportFabricImageCrop(target as Record<string, unknown>)
        }
        return oldHeight !== target.height
      }
      return false
    }

    const changeCropX = wrapWithFireEvent('resizing', wrapWithFixedAnchor((e, t, px, py) => changeObjectCropWidth(e, t as Record<string, unknown>, px, py))) as unknown
    const changeCropY = wrapWithFireEvent('resizing', wrapWithFixedAnchor((e, t, px, py) => changeObjectCropHeight(e, t as Record<string, unknown>, px, py))) as unknown
    const cursorEw = (() => 'ew-resize') as () => string
    const cursorNs = (() => 'ns-resize') as () => string
    const mk = (x: number, y: number, h: unknown, sizeX: number, sizeY: number, c: () => string) =>
      new FabricControl({
        x,
        y,
        sizeX,
        sizeY,
        actionHandler: h,
        cursorStyleHandler: c,
        actionName: 'resizing',
        render: barR,
      })
    fi.controls = {
      ml: mk(-0.5, 0, changeCropX, m.edgeBar, m.depthBar, cursorEw),
      mr: mk(0.5, 0, changeCropX, m.edgeBar, m.depthBar, cursorEw),
      mt: mk(0, -0.5, changeCropY, m.depthBar, m.edgeBar, cursorNs),
      mb: mk(0, 0.5, changeCropY, m.depthBar, m.edgeBar, cursorNs),
    }
    return
  }

  if (!controlsUtils.rotationWithSnapping) return
  ;(fi.set as ((p: unknown) => void) | undefined)?.({
    lockRotation: false,
    cornerSize: m.cornerSize,
    touchCornerSize: m.touchCornerSize,
    transparentCorners: false,
  })
  const makeRotCtrl = (x: number, y: number) =>
    new FabricControl({
      x,
      y,
      actionHandler: controlsUtils.rotationWithSnapping,
      actionName: 'rotate',
      cursorStyleHandler: (controlsUtils.rotationStyleHandler ?? (() => 'crosshair')) as () => string,
      render: rotR,
    })
  const existingControls = (fi.controls as Record<string, unknown>) ?? {}
  const scaleXHandler = controlsUtils.scalingX ?? controlsUtils.scalingXOrSkewingY
  const scaleYHandler = controlsUtils.scalingY ?? controlsUtils.scalingYOrSkewingX
  const makeScaleXCtrl = (x: number, y: number) =>
    new FabricControl({
      x,
      y,
      sizeX: m.edgeBar,
      sizeY: m.depthBar,
      actionHandler: scaleXHandler,
      actionName: 'scaleX',
      cursorStyleHandler: (controlsUtils.scaleSkewCursorStyleHandler ?? (() => 'ew-resize')) as () => string,
      render: barR,
    })
  const makeScaleYCtrl = (x: number, y: number) =>
    new FabricControl({
      x,
      y,
      sizeX: m.depthBar,
      sizeY: m.edgeBar,
      actionHandler: scaleYHandler,
      actionName: 'scaleY',
      cursorStyleHandler: (controlsUtils.scaleSkewCursorStyleHandler ?? (() => 'ns-resize')) as () => string,
      render: barR,
    })
  fi.controls = {
    ...existingControls,
    tl: makeRotCtrl(-0.5, -0.5),
    tr: makeRotCtrl(0.5, -0.5),
    bl: makeRotCtrl(-0.5, 0.5),
    br: makeRotCtrl(0.5, 0.5),
    ml: makeScaleXCtrl(-0.5, 0),
    mr: makeScaleXCtrl(0.5, 0),
    mt: makeScaleYCtrl(0, -0.5),
    mb: makeScaleYCtrl(0, 0.5),
    mtr: new FabricControl({ ...(existingControls.mtr as Record<string, unknown> | undefined), visible: false }),
  }
}

/** Taille de rendu des miniatures panoramiques pour le rapport HTML (synthèse, une section par observation). */
const REPORT_EXPORT_THUMB_PX = 880
const PDF_EXPORT_PLAN_CANVAS = 580
const PDF_EXPORT_THUMB_JPEG_Q = 0.88
const PDF_EXPORT_PLAN_JPEG_Q = 0.86

function escapeHtmlEtlReport(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Si l’annotation est liée à un pano faisant partie d’une paire avant/après (`comparePair`),
 * retourne les deux ids (gauche = avant / principal, droite = autre prise) et les légendes.
 */
function resolvePanoCompareExportPair(
  annPanoId: string,
  panoById: Map<string, PanoRecord>
): { leftId: string; rightId: string; capLeft: string; capRight: string } | null {
  const p = panoById.get(annPanoId)
  if (!p) return null
  const oid = p.comparePair?.otherPanoId
  if (oid && oid !== p.id && panoById.has(oid)) {
    return {
      leftId: p.id,
      rightId: oid,
      capLeft: (p.comparePair?.labelBefore?.trim() || 'Avant').trim() || 'Avant',
      capRight: (p.comparePair?.labelAfter?.trim() || 'Après').trim() || 'Après',
    }
  }
  for (const q of panoById.values()) {
    const o = q.comparePair?.otherPanoId
    if (o === annPanoId && q.id !== annPanoId) {
      return {
        leftId: q.id,
        rightId: annPanoId,
        capLeft: (q.comparePair?.labelBefore?.trim() || 'Avant').trim() || 'Avant',
        capRight: (q.comparePair?.labelAfter?.trim() || 'Après').trim() || 'Après',
      }
    }
  }
  return null
}

function buildEtl360AnnotationsReportHtmlDocument(params: {
  docRef: string
  projectLabel: string
  emittedAtLabel: string
  rowCount: number
  uniquePanoCount: number
  items: Array<{
    n: string
    total: string
    floor: string
    pano: string
    ident: string
    descHtml: string
    colorHex: string
    panoDataUrl: string | null
    /** Deuxième miniature (après) : même observation, autre prise de vue. */
    panoCompareDataUrl?: string | null
    panoCompareCaptionLeft?: string
    panoCompareCaptionRight?: string
    planDataUrl: string | null
  }>
}): string {
  const { docRef, projectLabel, emittedAtLabel, rowCount, uniquePanoCount, items } = params
  const blocks = items
    .map(
      it => `
    <article class="obs" style="--ann-color:${escapeHtmlEtlReport(it.colorHex)}">
      <div class="obs__bar" aria-hidden="true"></div>
      <h2 class="obs__title">Observation ${escapeHtmlEtlReport(it.n)} <span class="obs__of">/ ${escapeHtmlEtlReport(it.total)}</span></h2>
      <dl class="obs__meta">
        <div class="obs__row"><dt>Étage</dt><dd>${escapeHtmlEtlReport(it.floor)}</dd></div>
        <div class="obs__row"><dt>Panorama</dt><dd>${escapeHtmlEtlReport(it.pano)}</dd></div>
        <div class="obs__row"><dt>Identifiant</dt><dd>${escapeHtmlEtlReport(it.ident)}</dd></div>
        <div class="obs__row obs__row--block"><dt>Note et caractéristiques</dt><dd class="obs__desc">${it.descHtml}</dd></div>
      </dl>
      <div class="obs__media">
        ${
          it.panoDataUrl && it.panoCompareDataUrl
            ? `<div class="fig fig--pano-row" role="group" aria-label="Comparaison deux vues panoramiques">
                <figure class="fig fig--pano-half">
                  <figcaption>${escapeHtmlEtlReport(it.panoCompareCaptionLeft || 'Avant')}</figcaption>
                  <img class="fig__pano" src="${it.panoDataUrl}" alt="" loading="lazy" />
                </figure>
                <figure class="fig fig--pano-half">
                  <figcaption>${escapeHtmlEtlReport(it.panoCompareCaptionRight || 'Après')}</figcaption>
                  <img class="fig__pano" src="${it.panoCompareDataUrl}" alt="" loading="lazy" />
                </figure>
              </div>`
            : it.panoDataUrl
              ? `<figure class="fig"><figcaption>Vue panoramique (générée à l&rsquo;export)</figcaption><img class="fig__pano" src="${it.panoDataUrl}" alt="" loading="lazy" /></figure>`
              : '<p class="fig-missing">Vue panorama non disponible.</p>'
        }
        ${
          it.planDataUrl
            ? `<figure class="fig"><figcaption>Plan d&rsquo;étage (aperçu avec repère)</figcaption><img src="${it.planDataUrl}" alt="" loading="lazy" /></figure>`
            : '<p class="fig-missing fig-missing--subtle">Plan d&rsquo;étage : non disponible (étage non assigné, plan absent ou position non projetée).</p>'
        }
      </div>
    </article>`
    )
    .join('\n')

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Rapport annotations — ${escapeHtmlEtlReport(docRef)}</title>
  <style>
    :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --bg:#f8fafc; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: system-ui, "Segoe UI", Roboto, sans-serif; font-size: 1.05rem; line-height: 1.6; color: var(--ink); background: var(--bg); }
    .wrap { max-width: 52rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
    .cover { background: linear-gradient(180deg, #0f172a 0%, #1e3a5f 100%); color: #f8fafc; padding: 2rem 1.75rem; border-radius: 0.75rem; margin-bottom: 2.25rem; box-shadow: 0 4px 24px rgba(15,23,42,0.15); }
    .cover h1 { margin: 0 0 0.35rem; font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; }
    .cover p.lead { margin: 0; opacity: 0.92; font-size: 0.95rem; }
    .meta { width: 100%; border-collapse: collapse; margin-top: 1.25rem; font-size: 0.95rem; }
    .meta th, .meta td { text-align: left; padding: 0.55rem 0.75rem; border: 1px solid rgba(255,255,255,0.2); vertical-align: top; }
    .meta th { width: 11.5rem; background: rgba(255,255,255,0.1); font-weight: 600; }
    .hint { font-size: 0.88rem; color: var(--muted); margin: 1.5rem 0 0.25rem; }
    .obs { position: relative; background: #fff; border: 1px solid var(--line); border-radius: 0.75rem; padding: 1.35rem 1.35rem 1.5rem 1.5rem; margin: 0 0 1.75rem; box-shadow: 0 2px 8px rgba(15,23,42,0.06); }
    .obs__bar { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; border-radius: 0.75rem 0 0 0.75rem; background: var(--ann-color, #334155); }
    .obs__title { margin: 0 0 1rem; font-size: 1.2rem; color: #1e3a5f; padding-left: 0.5rem; }
    .obs__of { font-weight: 500; color: #64748b; font-size: 1rem; }
    .obs__meta { margin: 0; }
    .obs__row { display: grid; grid-template-columns: minmax(0, 11rem) 1fr; gap: 0.5rem 1rem; margin-bottom: 0.65rem; align-items: baseline; }
    .obs__row dt { margin: 0; font-weight: 600; color: #475569; font-size: 0.9rem; }
    .obs__row dd { margin: 0; }
    .obs__row--block { grid-template-columns: 1fr; }
    .obs__row--block dt { margin-bottom: 0.25rem; }
    .obs__desc { white-space: pre-wrap; word-break: break-word; font-size: 1.02rem; line-height: 1.55; }
    .obs__media { display: flex; flex-wrap: wrap; gap: 1.25rem; margin-top: 1.25rem; justify-content: center; }
    .fig { margin: 0; text-align: center; max-width: 100%; }
    .fig figcaption { font-size: 0.82rem; color: var(--muted); margin-bottom: 0.4rem; }
    .fig img { max-width: min(100%, 36rem); height: auto; border: 1px solid var(--line); border-radius: 0.35rem; }
    .fig__pano { max-width: min(100%, 28rem) !important; }
    .fig--pano-row { display: flex; flex-wrap: wrap; gap: 0.85rem 1rem; align-items: flex-start; justify-content: center; width: 100%; max-width: 100%; }
    .fig--pano-half { flex: 1 1 11rem; max-width: min(100%, 24rem); min-width: 0; }
    .fig-missing { margin: 0.5rem 0; text-align: center; color: #94a3b8; font-size: 0.9rem; }
    .fig-missing--subtle { color: #a8b4c4; }
    footer { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid var(--line); font-size: 0.88rem; color: var(--muted); text-align: center; }
    @media print { body { background: #fff; } .cover { break-inside: avoid; } .obs { break-inside: avoid; } }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="cover">
      <h1>Rapport &mdash; Synthèse des annotations (visite 360°)</h1>
      <p class="lead">Document de synthèse généré depuis l&rsquo;ETL Viewer 360.</p>
      <table class="meta">
        <tbody>
          <tr><th>Référence document</th><td>${escapeHtmlEtlReport(docRef)}</td></tr>
          <tr><th>Projet / chantier</th><td>${escapeHtmlEtlReport(projectLabel)}</td></tr>
          <tr><th>Objet</th><td>Synthèse des observations relevées sur panoramas (localisation, modèles d&rsquo;enregistrement, vues).</td></tr>
          <tr><th>Date d&rsquo;émission</th><td>${escapeHtmlEtlReport(emittedAtLabel)}</td></tr>
          <tr><th>Nombre d&rsquo;observations</th><td>${escapeHtmlEtlReport(String(rowCount))}</td></tr>
          <tr><th>Panoramas concernés</th><td>${escapeHtmlEtlReport(String(uniquePanoCount))}</td></tr>
        </tbody>
      </table>
    </header>
    <p class="hint">Chaque section correspond à une observation. Les vues ci-dessous sont recalculées au moment de l&rsquo;export. Vous pouvez <strong>imprimer</strong> ou enregistrer en PDF via le menu du navigateur (Fichier &rarr; Imprimer) si besoin.</p>
    ${blocks}
    <footer>
      <p>RAPPORTOA &mdash; Viewer 360 ETL &middot; ${escapeHtmlEtlReport(docRef)}</p>
    </footer>
  </div>
</body>
</html>`
}

function loadStoredDeveloperMode(): boolean {
  try {
    return localStorage.getItem(ETL360_DEVELOPER_MODE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function loadStoredE57DevAxesXzy(): boolean {
  try {
    return localStorage.getItem(ETL360_DEVELOPER_E57_AXES_XZY_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function loadStoredClientMode(): boolean {
  try {
    return localStorage.getItem(ETL360_CLIENT_MODE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * L’ouverture / fermeture d’un `<details>` modifie souvent le scroll de la fenêtre
 * (ancrage, focus sur le summary). On remet la position de scroll vue avant le toggle.
 */
function restorePageScrollAfterDetailsToggle(): void {
  const x = window.scrollX
  const y = window.scrollY
  const apply = () => {
    window.scrollTo(x, y)
  }
  queueMicrotask(apply)
  requestAnimationFrame(() => {
    requestAnimationFrame(apply)
  })
}

/** Menu discret d’orientation pano (axes X/Y) pour le plein écran : évite de démarrer le drag du mini-plan. */
function PanoOrientationFullscreenMenu({
  flipX,
  flipY,
  onFlipX,
  onFlipY,
  onSave,
  menuAlign,
}: {
  flipX: boolean
  flipY: boolean
  onFlipX: (next: boolean) => void
  onFlipY: (next: boolean) => void
  onSave: () => void
  /** Mini-plan à droite : panneau aligné à droite ; secours haut-gauche : aligné à gauche. */
  menuAlign: 'left' | 'right'
}) {
  return (
    <span
      className="pointer-events-auto shrink-0"
      onPointerDown={e => e.stopPropagation()}
    >
      <details
        className="group relative z-30 text-[10px] text-gray-200 [overflow-anchor:none]"
        onToggle={restorePageScrollAfterDetailsToggle}
      >
        <summary
          className="list-none cursor-pointer select-none rounded border border-white/15 bg-black/40 px-1.5 py-0.5 font-normal text-cyan-100/90 hover:bg-white/10 [&::-webkit-details-marker]:hidden"
          title="Si le nord ou l'est semble inversé sur ce panorama : corrections d'encodage."
        >
          Orient.
        </summary>
        <div
          className={`absolute top-[calc(100%+3px)] z-50 w-[13.5rem] rounded-md border border-white/20 bg-black/92 p-2 shadow-xl backdrop-blur-sm ${
            menuAlign === 'right' ? 'right-0' : 'left-0'
          }`}
          onPointerDown={e => e.stopPropagation()}
        >
          <p className="mb-1.5 text-[9px] leading-snug text-gray-500">
            Nord ou est inversé sur ce panorama : cochez puis enregistrez (mémorisé par projet).
          </p>
          <label className="mb-1 flex cursor-pointer items-center gap-1.5 select-none">
            <input
              type="checkbox"
              className="h-3 w-3 shrink-0 rounded border border-white/25 bg-white/5 accent-slate-400"
              checked={flipX}
              onChange={e => onFlipX(e.target.checked)}
            />
            <span>Inverser axe X (E / O)</span>
          </label>
          <label className="mb-1.5 flex cursor-pointer items-center gap-1.5 select-none">
            <input
              type="checkbox"
              className="h-3 w-3 shrink-0 rounded border border-white/25 bg-white/5 accent-slate-400"
              checked={flipY}
              onChange={e => onFlipY(e.target.checked)}
            />
            <span>Inverser axe Y (N / S)</span>
          </label>
          <button
            type="button"
            onClick={onSave}
            className="w-full rounded border border-white/15 bg-white/10 px-2 py-1 text-[10px] font-medium text-white/90 hover:bg-white/15"
          >
            Enregistrer
          </button>
        </div>
      </details>
    </span>
  )
}

export default function ETLViewer360() {
  type E57ChunkMeta = { id: string; file: string; pointCount: number; byteLength: number }
  type E57ServerManifest = {
    version: number | string
    format: string
    jobId: string
    sourcePointCount: number
    displayedPointCount: number
    bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
    chunks: E57ChunkMeta[]
    pointStrideFloats?: number
    createdAt?: string
  }
  /** Délai max par téléchargement paresseux (Azure) — évite requêtes / jetons MSAL bloqués indéfiniment. */
  const BLOB_PANO_LOAD_TIMEOUT_MS = 120_000
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useUser()
  const { addToast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const projectCode = searchParams.get('code') || ''
  const projectName = searchParams.get('name') || ''
  const projectId = searchParams.get('projectId') || searchParams.get('pid') || ''
  const projectBlobPrefixParam = searchParams.get('projectBlobPrefix') || ''
  const projectCodeForStorage = projectCode.trim() || 'local'
  const etlBlobScope = useMemo<EtlProjectScopeInput>(
    () => ({
      projectId: projectId.trim() || undefined,
      projectCode: projectCode.trim() || undefined,
      projectBlobPrefix: projectBlobPrefixParam.trim() || undefined,
    }),
    [projectId, projectCode, projectBlobPrefixParam]
  )

  const [loading, setLoading] = useState(false)
  const [panos, setPanos] = useState<PanoRecord[]>([])
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([])
  const annotationsRef = useRef<AnnotationRecord[]>([])
  annotationsRef.current = annotations
  const [currentPanoId, setCurrentPanoId] = useState<string | null>(null)
  /** Incrémenté pour relancer le chargement paresseux Azure après échec (réessai). */
  const [panoImageBlobLoadRetryKey, setPanoImageBlobLoadRetryKey] = useState(0)
  const currentPanoIdRef = useRef<string | null>(null)
  currentPanoIdRef.current = currentPanoId
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const [objectUrls, setObjectUrls] = useState<string[]>([])
  const previousObjectUrlsRef = useRef<string[]>([])
  const [floorMapAssets, setFloorMapAssets] = useState<FloorMapAsset[]>([])
  const [floorPlanReplacements, setFloorPlanReplacements] = useState<Record<string, FloorPlanReplacementRecord>>({})
  /** Taille d’image pour les enregistrements sans `replacedPixelWidth/Height` (données locales anciennes). */
  const [floorPlanReplacementInferredSize, setFloorPlanReplacementInferredSize] = useState<
    Record<string, { w: number; h: number }>
  >({})
  const [floorPlanReplaceTargetLabel, setFloorPlanReplaceTargetLabel] = useState('')
  const [floorPlanReplaceMode, setFloorPlanReplaceMode] = useState<FloorPlanReplacementMode>('drawn')
  const [floorPlanDrawModalOpen, setFloorPlanDrawModalOpen] = useState(false)
  const [floorPlanImportModalOpen, setFloorPlanImportModalOpen] = useState(false)
  const [floorPlanImportedDataUrl, setFloorPlanImportedDataUrl] = useState<string | null>(null)
  const [floorPlanImportBaseOverlayOpacity, setFloorPlanImportBaseOverlayOpacity] = useState(35)
  const [floorPlanAlignedPreviewDataUrl, setFloorPlanAlignedPreviewDataUrl] = useState<string | null>(null)
  /** Taille CSS du canvas Fabric (après scale) pour positionner les overlays HTML par-dessus. */
  const [floorPlanImportCanvasDisplaySize, setFloorPlanImportCanvasDisplaySize] = useState<{ w: number; h: number } | null>(null)
  /** Import plan : ajuster (rotation / redimensionner) vs rogner (bords — double-clic sur l'image pour basculer). */
  const [floorPlanImportInteractionMode, setFloorPlanImportInteractionMode] = useState<FloorPlanImportInteractionMode>('adjust')
  const floorPlanImportInteractionModeRef = useRef<FloorPlanImportInteractionMode>('adjust')
  const [floorPlanDrawBaseOpacity, setFloorPlanDrawBaseOpacity] = useState(45)
  const [floorPlanDrawFinalPreview, setFloorPlanDrawFinalPreview] = useState(false)
  const [floorPlanDrawStrokeColor, setFloorPlanDrawStrokeColor] = useState('#808080')
  const [floorPlanDrawStrokeWidth, setFloorPlanDrawStrokeWidth] = useState(5)
  const floorPlanDrawContainerRef = useRef<HTMLDivElement | null>(null)
  const floorPlanDrawCanvasRef = useRef<unknown>(null)
  const floorPlanImportFabricContainerRef = useRef<HTMLDivElement | null>(null)
  const floorPlanImportFabricCanvasRef = useRef<unknown>(null)
  const floorPlanImportFabricImgObjRef = useRef<unknown>(null)
  /** Poignées Fabric dimensionnées selon le raster importé + scale CSS du wrapper. */
  const floorPlanImportControlMetricsRef = useRef<FloorPlanImportControlMetrics | null>(null)
  /** Coin haut-gauche de l’image du plan sur le canvas d’export (px) — pour translater m02/m12 si rognage gauche/haut. */
  const floorPlanImportLastExportInsetRef = useRef<{ left: number; top: number }>({ left: 0, top: 0 })
  const floorPlanImportFabricOverlayObjRef = useRef<unknown>(null)
  const floorPlanImportFabricDotsRef = useRef<unknown[]>([])
  const floorPlanImportBaseOverlayOpacityRef = useRef(35)
  /** Ref kept in sync with floorPlanImportTargetPanoDots (declared later) to avoid TDZ in effects. */
  const floorPlanImportTargetPanoDotsRef = useRef<Array<{ panoId: string; xPct: number; yPct: number; colorHex: string }>>([])
  /** Stable ref to exportFabricImportCanvas (declared later) to avoid TDZ in useCallbacks above it. */
  const exportFabricImportCanvasRef = useRef<() => string | null>(() => null)
  const floorPlanDrawGuideObjectsRef = useRef<DrawGuideObject[]>([])
  const floorPlanDrawSceneLoadedKeyRef = useRef<string | null>(null)
  const [floorPlanDrawCanvasReadyTick, setFloorPlanDrawCanvasReadyTick] = useState(0)
  const floorPlanFabricScriptLoadedRef = useRef(false)
  const [selectedFloor, setSelectedFloor] = useState('ALL')
  /** Libellé d'étage / plan (ex. N3) assigné manuellement par id de panorama. */
  const [panoFloorAssignments, setPanoFloorAssignments] = useState<Record<string, string>>({})
  const [developerMode, setDeveloperMode] = useState(loadStoredDeveloperMode)
  const [e57DevViewerAxesXzy, setE57DevViewerAxesXzy] = useState(loadStoredE57DevAxesXzy)
  const [clientMode, setClientMode] = useState(loadStoredClientMode)
  const [clientRemarkDraft, setClientRemarkDraft] = useState<{ text: string; status: AnnotationClientRemarkStatus }>({
    text: '',
    status: 'non-lu',
  })
  const [lowCostMode, setLowCostMode] = useState(() => loadLowCostModeFromStorage(projectCodeForStorage))
  const [lowCostStep, setLowCostStep] = useState<'floors' | 'panos' | 'cloud' | 'plans' | 'pinning' | 'ready'>('floors')
  const [lowCostFloorCount, setLowCostFloorCount] = useState(1)
  const [lowCostSliceCenters, setLowCostSliceCenters] = useState<number[]>([])
  const [lowCostPanos, setLowCostPanos] = useState<LowCostPanoEntry[]>([])
  const [lowCostPlacingPanoIdx, setLowCostPlacingPanoIdx] = useState<number | null>(null)
  /** Statut visuel par étage (clé = label N1, N2…). */
  const [lowCostFloorVisuals, setLowCostFloorVisuals] = useState<Record<string, LowCostFloorVisualMode>>({})
  /** Valeur du select « liste des panoramas » : tous les étages ou libellé d'étage (ex. N1). Jamais modifié par le choix d'un panorama. */
  const [lowCostPinningListFilter, setLowCostPinningListFilter] = useState<string>(LOW_COST_PINNING_LIST_ALL)
  /** Plan d'étage affiché pour le placement XY — uniquement mis à jour par le select dédié (ou init à l'entrée de l'étape). */
  const [lowCostPinningMapFloor, setLowCostPinningMapFloor] = useState<string>('')
  /** Outil de coupe interactif (uniquement actif quand un nuage est chargé). */
  const [lowCostAltHisto, setLowCostAltHisto] = useState<{ bins: Array<{ alt: number; count: number }>; minAlt: number; maxAlt: number } | null>(null)
  const [lowCostSideProfile, setLowCostSideProfile] = useState<{ dataUrl: string; minAlt: number; maxAlt: number } | null>(null)
  const [lowCostPlacingSliceIdx, setLowCostPlacingSliceIdx] = useState(0)
  const [lowCostHoverAlt, setLowCostHoverAlt] = useState<number | null>(null)
  const [lowCostSlicePreview, setLowCostSlicePreview] = useState<{ dataUrl: string; alt: number } | null>(null)
  const [lowCostSlicePreviewScale, setLowCostSlicePreviewScale] = useState<1 | 2 | 3>(1)
  const [floorGroupingToleranceM, setFloorGroupingToleranceM] = useState(0.15)
  const [floorSliceHeightM, setFloorSliceHeightM] = useState(0.45)
  const [neighborPanoRadiusM, setNeighborPanoRadiusM] = useState(5)
  const [showNeighborPanoTriangles, setShowNeighborPanoTriangles] = useState(true)
  /** Si vrai : étages + XYZ pano dérivés du nuage (plus proche en plan) vs bandes Z des GeoTIFF ; sinon CSV + assignation auto TIFF. */
  const [floormapDevAlignFromPointCloud, setFloormapDevAlignFromPointCloud] = useState(false)

  const [syntheticYawPitch, setSyntheticYawPitch] = useState<YawPitch>({ yaw: 0, pitch: 0 })
  const [manualIdentifier, setManualIdentifier] = useState('')
  const [manualDescription, setManualDescription] = useState('')
  const [manualColor, setManualColor] = useState(ETL360_DEFAULT_ANNOTATION_COLOR)
  const [manualTemplateId, setManualTemplateId] = useState<AnnotationTemplateId | ''>('')
  const [manualUserTemplateId, setManualUserTemplateId] = useState('')
  const [manualCreationSpec, setManualCreationSpec] = useState<AnnCreationSpecForm>(() => emptyAnnCreationSpecForm())
  const [manualCreationCustom, setManualCreationCustom] = useState<Record<string, string>>({})
  const [recentTemplateChoiceKeys, setRecentTemplateChoiceKeys] = useState<string[]>(() => {
    try {
      if (typeof localStorage === 'undefined') return []
      return parseRecentTemplateChoicesJson(
        localStorage.getItem(recentTemplateChoicesStorageKey(projectCodeForStorage))
      )
    } catch {
      return []
    }
  })
  const [userTemplates, setUserTemplates] = useState<UserAnnotationTemplate[]>([])
  const [newUserTplName, setNewUserTplName] = useState('')
  const [newUserTplColor, setNewUserTplColor] = useState(ETL360_DEFAULT_ANNOTATION_COLOR)
  const [newUserTplRows, setNewUserTplRows] = useState<
    Array<{ key?: string; label: string; defaultValue: string }>
  >([{ label: '', defaultValue: '' }])
  const [editingUserTemplateId, setEditingUserTemplateId] = useState<string | null>(null)
  const [newUserTplBuiltinRows, setNewUserTplBuiltinRows] = useState<
    Array<{ key: AnnotationSpecFieldKey; defaultValue: string }>
  >([])
  const [newUserTplLockPositionDefault, setNewUserTplLockPositionDefault] = useState(false)
  const [newUserTplBuiltinPickerOpen, setNewUserTplBuiltinPickerOpen] = useState(false)
  const newUserTplBuiltinPickerRef = useRef<HTMLDivElement | null>(null)

  const [quickOpen, setQuickOpen] = useState(false)
  const [pendingYawPitch, setPendingYawPitch] = useState<YawPitch | null>(null)
  const [qaKind, setQaKind] = useState<AnnotationKind>('point')
  const [qaIdentifier, setQaIdentifier] = useState('')
  const [qaDescription, setQaDescription] = useState('')
  const [qaColor, setQaColor] = useState(ETL360_DEFAULT_ANNOTATION_COLOR)
  const [qaTemplateId, setQaTemplateId] = useState<AnnotationTemplateId | ''>('')
  const [qaUserTemplateId, setQaUserTemplateId] = useState('')
  const [qaCreationSpec, setQaCreationSpec] = useState<AnnCreationSpecForm>(() => emptyAnnCreationSpecForm())
  const [qaCreationCustom, setQaCreationCustom] = useState<Record<string, string>>({})
  const [qaTextContent, setQaTextContent] = useState('')
  const [qaTextSizePx, setQaTextSizePx] = useState(20)
  const [qaTextTone, setQaTextTone] = useState<AnnotationTextTone>('black')
  const [qaZoneFillOpacity, setQaZoneFillOpacity] = useState(ETL360_DEFAULT_ZONE_OVERLAY_FILL_OPACITY)

  const [renameDraft, setRenameDraft] = useState('')
  const [floorRenameFrom, setFloorRenameFrom] = useState('')
  const [floorRenameTo, setFloorRenameTo] = useState('')

  const [editAnnotationOpen, setEditAnnotationOpen] = useState(false)
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null)
  const [editIdentifier, setEditIdentifier] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editKind, setEditKind] = useState<AnnotationKind>('point')
  const [editColor, setEditColor] = useState(ETL360_DEFAULT_ANNOTATION_COLOR)
  const [editTextContent, setEditTextContent] = useState('')
  const [editTextSizePx, setEditTextSizePx] = useState(20)
  const [editTextTone, setEditTextTone] = useState<AnnotationTextTone>('black')
  const [editZoneFillOpacity, setEditZoneFillOpacity] = useState(ETL360_DEFAULT_ZONE_OVERLAY_FILL_OPACITY)
  const [editPositionLocked, setEditPositionLocked] = useState(false)
  const [editSpecForm, setEditSpecForm] = useState<AnnCreationSpecForm>(() => emptyAnnCreationSpecForm())
  const [editTemplateId, setEditTemplateId] = useState<AnnotationTemplateId | ''>('')
  const [editUserTemplateId, setEditUserTemplateId] = useState('')
  const [editCustomTemplateValues, setEditCustomTemplateValues] = useState<Record<string, string>>({})
  const [editSpecSlots, setEditSpecSlots] = useState<AnnotationSpecFieldKey[]>([])
  const [editSpecPickerOpen, setEditSpecPickerOpen] = useState(false)
  const editSpecPickerRef = useRef<HTMLDivElement | null>(null)
  /** Comparaison avant / après : 2e panorama (édition pastille). */
  const [compareOtherPanoIdDraft, setCompareOtherPanoIdDraft] = useState('')
  const [compareLabelBeforeDraft, setCompareLabelBeforeDraft] = useState('')
  const [compareLabelAfterDraft, setCompareLabelAfterDraft] = useState('')

  const panoBeforeAfterStorageKey = `etl360.panoBeforeAfterUi.v1:${projectCodeForStorage}`
  const panoCompareSplitStorageKey = `etl360.panoCompareSplitPct.v1:${projectCodeForStorage}`
  const [panoBeforeAfterUiEnabled, setPanoBeforeAfterUiEnabled] = useState(false)
  const [panoCompareSplitPct, setPanoCompareSplitPct] = useState(50)
  const [e57Loading, setE57Loading] = useState(false)
  const [e57DisplayVoxelSize, setE57DisplayVoxelSize] = useState(0)

  // --- E57 affichage / inventaire Azure ---
  const [e57DisplayVoxelMax, setE57DisplayVoxelMax] = useState(1)
  /** Superposer les plans d'étage (géoréférencés) dans la scène 3D du nuage. */
  const [e57ShowFloorPlansInCloud, setE57ShowFloorPlansInCloud] = useState(true)
  /** Plein écran API navigateur (même principe que le panorama) — sync via `fullscreenchange`. */
  const [e57FsActive, setE57FsActive] = useState(false)
  /** Fond de la scène WebGL (nuage 3D). */
  const [e57ViewerBgHex, setE57ViewerBgHex] = useState('#e2e8f0')
  /** Colorisation altitude vs couleurs RGB du fichier, si le fichier en fournit. */
  const [e57UseSourcePointColors, setE57UseSourcePointColors] = useState(true)
  const [e57FileHasPointColors, setE57FileHasPointColors] = useState(false)

  /** Dernier chargement via index viewer (répertoire Azure `viewer/`) : permet d’enregistrer l’état sur le blob. */
  const [etlBlobProjectSaveEnabled, setEtlBlobProjectSaveEnabled] = useState(false)
  const [etlBlobProjectSaving, setEtlBlobProjectSaving] = useState(false)
  /** Après chargement projet : retarde l’autosauvegarde pour éviter un PUT reprenant l’état avant fusion locale. */
  const [etlBlobAutosaveArmed, setEtlBlobAutosaveArmed] = useState(false)
  const etlBlobAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Référence à {@link persistEtlBlobViewerProjectToAzure} pour les handlers définis plus haut dans le fichier. */
  const persistEtlBlobViewerProjectToAzureRef = useRef<
    ((opts?: { showToast?: boolean; annotationsOverride?: AnnotationRecord[] }) => Promise<void>) | undefined
  >(undefined)
  /** Index viewer (un seul manifeste par scope) pour la liste « projets ». */
  const [etlBlobViewerList, setEtlBlobViewerList] = useState<{
    index: EtlViewerIndex | null
    status: object | null
    diagnostics: EtlViewerIndexDiagnostics | null
  } | null>(null)
  const [etlBlobViewerListLoading, setEtlBlobViewerListLoading] = useState(true)
  const [etlBlobRebuildIndexLoading, setEtlBlobRebuildIndexLoading] = useState(false)
  const [etlBlobViewerIndexError, setEtlBlobViewerIndexError] = useState<string | null>(null)
  /** Chemin du ZIP en cours de préparation (expand-zip) depuis le panneau Azure. */
  const [etlPrepareZipBlobPath, setEtlPrepareZipBlobPath] = useState<string | null>(null)
  /** Tous les dépôts du compte avec manifeste viewer (liste multi-projets). */
  const [etlAllViewerIndexItems, setEtlAllViewerIndexItems] = useState<EtlViewerIndexListItem[]>([])
  const [etlAllViewerIndexLoading, setEtlAllViewerIndexLoading] = useState(false)
  const [etlAllViewerIndexError, setEtlAllViewerIndexError] = useState<string | null>(null)
  /** Dernière archive .zip envoyée sur le blob (relance manuelle de la préparation si besoin). */
  /** Après parse local : envoi vers un nouveau dossier `Geolux/ETL/etl_…/`, puis expand-zip serveur. */
  const [zipCloudPhase, setZipCloudPhase] = useState<null | 'upload' | 'expand'>(null)

  // -- Expand-zip job (Phase 2/3) --------------------------------------------

  useEffect(() => {
    if (!editSpecPickerOpen) return
    const onDown = (e: MouseEvent) => {
      const el = editSpecPickerRef.current
      if (el && !el.contains(e.target as Node)) setEditSpecPickerOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [editSpecPickerOpen])

  useEffect(() => {
    if (!newUserTplBuiltinPickerOpen) return
    const onDown = (e: MouseEvent) => {
      const el = newUserTplBuiltinPickerRef.current
      if (el && !el.contains(e.target as Node)) setNewUserTplBuiltinPickerOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [newUserTplBuiltinPickerOpen])

  useEffect(() => {
    try {
      localStorage.setItem(ETL360_DEVELOPER_MODE_STORAGE_KEY, developerMode ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [developerMode])

  useEffect(() => {
    try {
      localStorage.setItem(ETL360_DEVELOPER_E57_AXES_XZY_STORAGE_KEY, e57DevViewerAxesXzy ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [e57DevViewerAxesXzy])

  useEffect(() => {
    try {
      localStorage.setItem(ETL360_CLIENT_MODE_STORAGE_KEY, clientMode ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [clientMode])

  useEffect(() => {
    if (!clientMode) return
    setEditAnnotationOpen(false)
    setEditingAnnotationId(null)
    setQuickOpen(false)
    setPendingYawPitch(null)
    viewerRef.current?.cancelZonePlacement()
  }, [clientMode])

  const selectedAnnotationClientRemarkKey = useMemo(() => {
    const a = annotations.find(x => x.id === selectedAnnotationId)
    return a ? JSON.stringify(a.clientRemark ?? null) : ''
  }, [annotations, selectedAnnotationId])

  useEffect(() => {
    if (!clientMode || !selectedAnnotationId) {
      setClientRemarkDraft({ text: '', status: 'non-lu' })
      return
    }
    const ann = annotations.find(a => a.id === selectedAnnotationId)
    setClientRemarkDraft({
      text: ann?.clientRemark?.text ?? '',
      status: ann?.clientRemark?.status ?? 'non-lu',
    })
  }, [clientMode, selectedAnnotationId, selectedAnnotationClientRemarkKey])

  // Low-cost mode persistence
  useEffect(() => {
    saveLowCostModeToStorage(projectCodeForStorage, lowCostMode)
  }, [lowCostMode, projectCodeForStorage])

  // Restore low-cost project state from localStorage on project change
  useEffect(() => {
    if (!lowCostMode) return
    const saved = parseLowCostProjectFromStorage(projectCodeForStorage)
    if (saved) {
      setLowCostFloorCount(saved.floorCount)
      setLowCostSliceCenters(saved.sliceCenters)
      setLowCostPanos(saved.panos)
      if (saved.floorVisuals) setLowCostFloorVisuals(saved.floorVisuals)
      if (saved.sliceCenters.length > 0) {
        setLowCostStep(saved.panos.length > 0 ? 'pinning' : 'plans')
      }
    }
  }, [lowCostMode, projectCodeForStorage])

  // Recompute slice preview whenever the active slice or its altitude changes (cloud loaded only)
  useEffect(() => {
    if (!lowCostMode) return
    const center = lowCostSliceCenters[lowCostPlacingSliceIdx]
    if (center === undefined) { setLowCostSlicePreview(null); return }
    const pos = e57SourcePositionsRef.current
    if (!pos) { setLowCostSlicePreview(null); return }
    const preview = buildSlicePreviewDataUrl(pos, center, 0.30, 320, 240)
    setLowCostSlicePreview(preview ? { dataUrl: preview, alt: center } : null)
  }, [lowCostPlacingSliceIdx, lowCostSliceCenters, lowCostMode])

  useEffect(() => {
    if (qaKind === 'text') {
      setQaTemplateId('')
      setQaUserTemplateId('')
      setQaCreationCustom({})
      setQaCreationSpec(emptyAnnCreationSpecForm())
      return
    }
    const ut = qaUserTemplateId ? userTemplates.find(u => u.id === qaUserTemplateId) : null
    const tplEff = !ut && qaTemplateId ? effectiveIntegratedTemplateDef(qaTemplateId, userTemplates) : null
    const integOv = !ut && qaTemplateId ? integratedTemplateOverride(qaTemplateId, userTemplates) : undefined
    if (ut) {
      const custom: Record<string, string> = {}
      for (const c of ut.characteristics) custom[c.key] = c.defaultValue
      setQaCreationCustom(custom)
      setQaCreationSpec(annCreationSpecFormFromBuiltinDefaults(ut.builtinSpecKeys, ut.builtinSpecDefaults))
    } else if (tplEff) {
      const custom: Record<string, string> = {}
      if (integOv?.characteristics?.length) {
        for (const c of integOv.characteristics) custom[c.key] = c.defaultValue
      }
      const sm = integratedSurfaceMatiereTemplateId(tplEff.id)
      if (sm) Object.assign(custom, defaultIntegratedSurfaceMatiereCustom(sm))
      setQaCreationCustom(custom)
      setQaCreationSpec(
        annCreationSpecFormFromBuiltinDefaults(tplEff.specKeys, tplEff.builtinSpecDefaults)
      )
    } else {
      setQaCreationCustom({})
      setQaCreationSpec(emptyAnnCreationSpecForm())
    }
  }, [qaKind, qaUserTemplateId, qaTemplateId, userTemplates])

  useEffect(() => {
    const ut = manualUserTemplateId ? userTemplates.find(u => u.id === manualUserTemplateId) : null
    const tplEff = !ut && manualTemplateId ? effectiveIntegratedTemplateDef(manualTemplateId, userTemplates) : null
    const integOv = !ut && manualTemplateId ? integratedTemplateOverride(manualTemplateId, userTemplates) : undefined
    if (ut) {
      const custom: Record<string, string> = {}
      for (const c of ut.characteristics) custom[c.key] = c.defaultValue
      setManualCreationCustom(custom)
      setManualCreationSpec(annCreationSpecFormFromBuiltinDefaults(ut.builtinSpecKeys, ut.builtinSpecDefaults))
    } else if (tplEff) {
      const custom: Record<string, string> = {}
      if (integOv?.characteristics?.length) {
        for (const c of integOv.characteristics) custom[c.key] = c.defaultValue
      }
      const sm = integratedSurfaceMatiereTemplateId(tplEff.id)
      if (sm) Object.assign(custom, defaultIntegratedSurfaceMatiereCustom(sm))
      setManualCreationCustom(custom)
      setManualCreationSpec(
        annCreationSpecFormFromBuiltinDefaults(tplEff.specKeys, tplEff.builtinSpecDefaults)
      )
    } else {
      setManualCreationCustom({})
      setManualCreationSpec(emptyAnnCreationSpecForm())
    }
  }, [manualUserTemplateId, manualTemplateId, userTemplates])

  const [e57Stats, setE57Stats] = useState<E57ViewerStats | null>(null)
  const [panoViewerReadyToken, setPanoViewerReadyToken] = useState(0)

  const containerRef = useRef<HTMLDivElement | null>(null)
  /** Ligne flex contenant les deux vues + séparateur (largeur totale pour le glisser avant/après, ex. plein écran). */
  const panoCompareSplitRowRef = useRef<HTMLDivElement | null>(null)
  const compareContainerRef = useRef<HTMLDivElement | null>(null)
  const compareViewerRef = useRef<EmbeddedSphereViewer | null>(null)
  const compareViewerCallbacksRef = useRef<ETL360ViewerCallbacks>({
    onMarkerSelect: () => {},
    onMarkerClick: () => {},
    onMarkerDoubleClick: () => {},
    onPanoTeleport: () => {},
    onPointChange: () => {},
    onZoneChange: () => {},
    onRightClick: () => {},
    onLeftSphereClick: () => {},
    onZoneDrawComplete: () => {},
  })
  const panoCompareSplitDragRef = useRef<{
    startX: number
    startPct: number
    pointerId: number
    captureEl: Element | null
  } | null>(null)
  const panoCompareLayoutActiveRef = useRef(false)
  /** Throttle : sinon chaque pointermove = setState + 2× ResizeObserver → flash WebGL. */
  const panoCompareSplitMoveRafRef = useRef(0)
  const panoCompareSplitPendingPctRef = useRef<number | null>(null)
  const e57ContainerRef = useRef<HTMLDivElement | null>(null)
  const e57FsRootRef = useRef<HTMLDivElement | null>(null)
  const panoFsRootRef = useRef<HTMLDivElement | null>(null)
  const [panoFsActive, setPanoFsActive] = useState(false)
  /** Multiplicateur de luminosité du rendu panorama (1 = défaut). */
  const [panoExposure, setPanoExposure] = useState(1)
  /** Exposition mémorisée par panorama (clé: panoId). */
  const [panoExposureById, setPanoExposureById] = useState<Record<string, number>>({})
  /** Superposer dans le viewer 360 un aperçu du nuage (repère du pano) + sprites des prises voisines. */
  const [panoWorldOverlayEnabled, setPanoWorldOverlayEnabled] = useState(false)
  /** HUD debug : yaw/pitch curseur et XYZ projetés sur le nuage (annotations / triangles voisins). */
  const [panoDebugXyzEnabled, setPanoDebugXyzEnabled] = useState(false)
  const [panoDebugCursorYp, setPanoDebugCursorYp] = useState<YawPitch | null>(null)
  const [panoDebugHoverAnn, setPanoDebugHoverAnn] = useState<AnnotationRecord | null>(null)
  const [panoDebugHoverNeighbor, setPanoDebugHoverNeighbor] = useState<PanoRecord | null>(null)
  const [panoAnnotationListVisible, setPanoAnnotationListVisible] = useState(true)
  const [panoAnnotationPanel, setPanoAnnotationPanel] = useState<PanoAnnotationPanelState>({
    x: 12,
    y: 56,
    width: 300,
    height: 380,
  })
  const panoAnnotationListScrollRef = useRef<HTMLDivElement | null>(null)
  const panoAnnotationItemRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const panoAnnotationPanelRef = useRef<PanoAnnotationPanelState>(panoAnnotationPanel)
  const panoAnnotationPanelActionRef = useRef<
    | null
    | {
        mode: 'drag' | 'resize-e' | 'resize-s' | 'resize-se'
        startX: number
        startY: number
        start: PanoAnnotationPanelState
      }
  >(null)
  const panoDebugXyzEnabledRef = useRef(false)
  panoDebugXyzEnabledRef.current = panoDebugXyzEnabled
  /** Mini-plan d'étage dans la vue panorama : l'utilisateur peut forcer l'étage affiché (ref pour ne pas écraser au changement d'assignation). */
  const panoMinimapUserOverrideRef = useRef(false)
  const [panoMinimapFloorLabel, setPanoMinimapFloorLabel] = useState('')
  const [panoMinimapAspect, setPanoMinimapAspect] = useState(0.66)
  const [panoMinimapWindow, setPanoMinimapWindow] = useState<PanoMinimapWindowState>({ x: 0, y: 0, width: 240 })
  const panoMinimapWindowRef = useRef<PanoMinimapWindowState>({ x: 0, y: 0, width: 240 })
  const panoMinimapUserPlacedRef = useRef(false)
  const panoMinimapActionRef = useRef<
    | null
    | {
        mode: 'drag' | 'resize-se' | 'resize-e' | 'resize-s'
        startX: number
        startY: number
        start: PanoMinimapWindowState
      }
  >(null)
  const [panoMinimapDataUrl, setPanoMinimapDataUrl] = useState<string | null>(null)
  const [panoMinimapMarkers, setPanoMinimapMarkers] = useState<FloorPlanMarker[]>([])
  const [panoMinimapAnnotationMarkers, setPanoMinimapAnnotationMarkers] = useState<FloorPlanAnnotationMarker[]>([])
  const [panoMinimapLoadError, setPanoMinimapLoadError] = useState(false)
  const [panoMinimapViewScale, setPanoMinimapViewScale] = useState(1)
  const [panoMinimapViewOffset, setPanoMinimapViewOffset] = useState({ x: 0, y: 0 })
  const [panoMinimapAnnotationDrag, setPanoMinimapAnnotationDrag] = useState<{
    annotationId: string
    pointerId: number
    startClientX: number
    startClientY: number
    moved: boolean
    captured: boolean
    xPct: number
    yPct: number
  } | null>(null)
  const [panoMinimapPanoDrag, setPanoMinimapPanoDrag] = useState<{
    panoId: string
    pointerId: number
    startClientX: number
    startClientY: number
    moved: boolean
    captured: boolean
    xPct: number
    yPct: number
  } | null>(null)
  const panoMinimapSuppressAnnClickRef = useRef<string | null>(null)
  const panoMinimapSuppressPanoClickRef = useRef<string | null>(null)
  const [panoMinimapAnnContextMenu, setPanoMinimapAnnContextMenu] = useState<{
    annotationId: string
    x: number
    y: number
  } | null>(null)
  /** Orientation caméra panorama (radians), pour le cône sur le mini-plan. */
  const [panoViewYawPitch, setPanoViewYawPitch] = useState<YawPitch>({ yaw: 0, pitch: 0 })

  /** Outil de mesure */
  type MeasurePoint = { yaw: number; pitch: number; world: Vec3 }
  type MeasureRecord = {
    id: string
    panoId: string
    start: MeasurePoint
    end: MeasurePoint
    distanceCm: number
    color: string
  }
  const [measureModeActive, setMeasureModeActive] = useState(false)
  const [measureStart, setMeasureStart] = useState<MeasurePoint | null>(null)
  const [measureLines, setMeasureLines] = useState<MeasureRecord[]>([])
  const measureModeActiveRef = useRef(false)
  measureModeActiveRef.current = measureModeActive
  const [measureDrag, setMeasureDrag] = useState<{
    measureId: string
    endpoint: 'start' | 'end'
  } | null>(null)
  const measureDragRef = useRef<typeof measureDrag>(null)
  measureDragRef.current = measureDrag
  const panoMinimapViewportRef = useRef<HTMLDivElement | null>(null)
  const panoMinimapWheelUnlockTimerRef = useRef<number | null>(null)
  const panoMinimapWheelBodyOverflowRef = useRef<string | null>(null)
  const [panoMinimapViewDrag, setPanoMinimapViewDrag] = useState<{
    active: boolean
    x: number
    y: number
    baseX: number
    baseY: number
  }>({ active: false, x: 0, y: 0, baseX: 0, baseY: 0 })
  const [panoMinimapMiddleZoom, setPanoMinimapMiddleZoom] = useState<{
    active: boolean
    y: number
    baseScale: number
  }>({ active: false, y: 0, baseScale: 1 })
  /** Après clic sur une annotation du mini-plan : focus caméra une fois le panorama chargé. */
  const panoMinimapPendingFocusRef = useRef<{ panoId: string; annotationId: string } | null>(null)
  /** Dernier résumé des conversions deg→rad à la lecture des annotations (ZIP). */
  const [importAngleReadDebug, setImportAngleReadDebug] = useState<{
    source: 'zip'
    fileName?: string
    convertedAnnotations: number
    convertedFields: number
    loggedSamples: number
  } | null>(null)
  const viewerRef = useRef<EmbeddedSphereViewer | null>(null)
  const e57ViewerRef = useRef<EmbeddedE57PointCloudViewer | null>(null)
  const e57SourcePositionsRef = useRef<Float32Array | null>(null)
  /** Poses pano + métadonnées de référence avant alignement « nuage » (toggle développeur carte). */
  const devFloorPlanPanoBaselineRef = useRef<PanoRecord[] | null>(null)
  const e57SourceColorsRef = useRef<Float32Array | null>(null)
  const e57SourceBoundsRef = useRef<E57ParseResult['bounds'] | null>(null)
  const e57SourceMetaRef = useRef<{
    fileName: string
    sourcePointCount: number
    spatialReference?: string
  } | null>(null)
  useEffect(() => {
    etl360PostDebugIngest({
      sessionId: '546eb8',
      runId: 'mount-probe',
      hypothesisId: 'LOG',
      location: 'ETLViewer360.tsx:mount',
      message: 'viewer page mounted',
      data: {
        pagePort: typeof window !== 'undefined' ? window.location.port : '',
        href: typeof window !== 'undefined' ? window.location.href : '',
      },
      timestamp: Date.now(),
    })
  }, [])
  const viewerCallbacksRef = useRef<ETL360ViewerCallbacks>({
    onMarkerSelect: () => {},
    onMarkerClick: () => {},
    onMarkerDoubleClick: () => {},
    onPanoTeleport: () => {},
    onPointChange: () => {},
    onZoneChange: () => {},
    onRightClick: () => {},
    onLeftSphereClick: () => {},
    onZoneDrawComplete: () => {},
  })
  const saveLsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingZoneDraftRef = useRef<{
    panoId: string
    kind?: 'zone' | 'text'
    identifier: string
    description?: string
    color?: string
    textContent?: string
    textSizePx?: number
    textTone?: AnnotationTextTone
    templateId?: AnnotationTemplateId
    userTemplateId?: string
    customTemplateValues?: Record<string, string>
    positionLocked?: boolean
    creationBuiltinKeys?: AnnotationSpecFieldKey[]
    creationSpecForm?: AnnCreationSpecForm
    creationCustomValues?: Record<string, string>
    /** Opacité remplissage zone (0–1), transmise à l’annotation après tracé. */
    zoneFillOpacity?: number
  } | null>(null)

  const renderE57FromSource = useCallback((overrideVoxelSize?: number) => {
    const viewer = e57ViewerRef.current
    const sourcePositions = e57SourcePositionsRef.current
    const bounds = e57SourceBoundsRef.current
    const meta = e57SourceMetaRef.current
    if (!viewer || !sourcePositions || !bounds || !meta) return

    const voxelSize = overrideVoxelSize ?? e57DisplayVoxelSize
    const sourceColors = e57SourceColorsRef.current
    const hasFileColors = !!(
      sourceColors &&
      sourceColors.length > 0 &&
      sourceColors.length === sourcePositions.length
    )
    const colorBufferForRender =
      e57UseSourcePointColors && hasFileColors
        ? sourceColors
        : buildAltitudeColors(sourcePositions, bounds)

    const { positions: renderedPositions, colors: renderedColors } = buildRenderedPointCloudBuffers(
      sourcePositions,
      colorBufferForRender,
      voxelSize
    )
    viewer.setPointCloud(renderedPositions, bounds, renderedColors ?? undefined)
    const displayedPointCount = Math.floor(renderedPositions.length / 3)
    setE57Stats(prev =>
      prev &&
      prev.fileName === meta.fileName &&
      prev.sourcePointCount === meta.sourcePointCount &&
      prev.displayedPointCount === displayedPointCount &&
      prev.spatialReference === meta.spatialReference
        ? prev
        : {
            fileName: meta.fileName,
            sourcePointCount: meta.sourcePointCount,
            displayedPointCount,
            ...(meta.spatialReference ? { spatialReference: meta.spatialReference } : {}),
          }
    )
  }, [e57DisplayVoxelSize, e57UseSourcePointColors])

  const clearPointCloudSource = useCallback(() => {
    e57ViewerRef.current?.clear()
    e57SourcePositionsRef.current = null
    e57SourceColorsRef.current = null
    e57SourceBoundsRef.current = null
    e57SourceMetaRef.current = null
    setE57FileHasPointColors(false)
    setE57Stats(null)
  }, [])

  const applyPointCloudSource = useCallback((source: {
    positions: Float32Array
    colors: Float32Array | null
    bounds: E57ParseResult['bounds']
    meta: { fileName: string; sourcePointCount: number; spatialReference?: string }
    displayVoxelMax: number
  }) => {
    e57SourcePositionsRef.current = source.positions
    e57SourceColorsRef.current = source.colors
    e57SourceBoundsRef.current = source.bounds
    e57SourceMetaRef.current = source.meta
    const hasPointRgb =
      source.colors != null &&
      source.colors.length > 0 &&
      source.colors.length === source.positions.length
    setE57FileHasPointColors(hasPointRgb)
    setE57UseSourcePointColors(true)
    setE57DisplayVoxelMax(source.displayVoxelMax)
    setE57DisplayVoxelSize(0)
    if (e57ViewerRef.current) {
      renderE57FromSource(0)
    }
    if (lowCostMode && source.positions.length >= 3) {
      setLowCostAltHisto(buildAltitudeHistogram(source.positions, 120))
      setLowCostSideProfile(buildSideProfileDataUrl(source.positions))
      setLowCostSlicePreview(null)
    }
  }, [renderE57FromSource, lowCostMode])

  const panosWithViewerColors = useMemo(
    () =>
      ensurePanoViewerColors(panos).map(p => ({
        ...p,
        position: panoSourcePositionForE57DevAxesXzy(p.position, e57DevViewerAxesXzy),
      })),
    [panos, e57DevViewerAxesXzy]
  )
  const [panoViewAxisFlipsMap, setPanoViewAxisFlipsMap] = useState<
    Record<string, { flipX: boolean; flipY: boolean }>
  >(() =>
    typeof localStorage !== 'undefined'
      ? parsePanoViewAxisFlipsFromStorage(
          localStorage.getItem(panoViewAxisFlipsStorageKey(projectCodeForStorage))
        )
      : {}
  )
  const [panoOrientDraftFlipX, setPanoOrientDraftFlipX] = useState(false)
  const [panoOrientDraftFlipY, setPanoOrientDraftFlipY] = useState(false)

  useEffect(() => {
    try {
      setPanoViewAxisFlipsMap(
        parsePanoViewAxisFlipsFromStorage(
          typeof localStorage !== 'undefined'
            ? localStorage.getItem(panoViewAxisFlipsStorageKey(projectCodeForStorage))
            : null
        )
      )
    } catch {
      setPanoViewAxisFlipsMap({})
    }
  }, [projectCodeForStorage])

  useEffect(() => {
    try {
      setFloorPlanReplacements(
        parseFloorPlanReplacementsFromStorage(
          typeof localStorage !== 'undefined'
            ? localStorage.getItem(floorPlanReplacementsStorageKey(projectCodeForStorage))
            : null
        )
      )
    } catch {
      setFloorPlanReplacements({})
    }
  }, [projectCodeForStorage])

  const persistFloorPlanReplacements = useCallback(
    (next: Record<string, FloorPlanReplacementRecord>) => {
      setFloorPlanReplacements(next)
      try {
        localStorage.setItem(
          floorPlanReplacementsStorageKey(projectCodeForStorage),
          serializeFloorPlanReplacementsToStorage(next)
        )
      } catch {
        /* quota */
      }
    },
    [projectCodeForStorage]
  )

  /** Persist the current low-cost project state to localStorage. */
  const persistLowCostProject = useCallback(
    (state: LowCostProjectState) => {
      try {
        localStorage.setItem(lowCostProjectStorageKey(projectCodeForStorage), serializeLowCostProjectToStorage(state))
      } catch { /* quota */ }
    },
    [projectCodeForStorage]
  )

  /** Applique l’état low-cost au viewer.
   *  - rebuildFloors='blank-black' : régénère N plans placeholder noirs (nouveau flow par défaut).
   *  - rebuildFloors='grid' : ancien rendu sombre quadrillé.
   *  - rebuildFloors='cloud-slice' : génère les plans à partir du nuage chargé (nécessite e57SourcePositions).
   *  - rebuildFloors=false : conserve `floorMapAssets` actuels (utilisé après l'étape pinning).
   *  - suppressToast : n'affiche pas le toast de succès (auto-génération étape 5).
   */
  const applyLowCostToRuntime = useCallback(
    async (opts?: {
      rebuildFloors?: 'blank-black' | 'grid' | 'cloud-slice' | false
      suppressToast?: boolean
      /** Juste après un `setLowCostPanos` pas encore commité, évite d’appliquer l’ancien tableau. */
      panosOverride?: LowCostPanoEntry[]
    }) => {
      const rebuildMode = opts?.rebuildFloors ?? 'blank-black'
      const panoSource = opts?.panosOverride ?? lowCostPanos
      let sliceCentersForPersist = lowCostSliceCenters
      let nextFloorVisuals: Record<string, LowCostFloorVisualMode> = lowCostFloorVisuals

      if (rebuildMode === 'blank-black' || rebuildMode === 'grid') {
        const previousUrls = [...objectUrls]
        const newObjUrls: string[] = []
        const built = await buildLowCostPlaceholderFloorMapAssets({
          floorCount: lowCostFloorCount,
          objectUrlsSink: newObjUrls,
          variant: rebuildMode,
        })
        sliceCentersForPersist = built.sliceCenters
        setLowCostSliceCenters(built.sliceCenters)
        previousUrls.forEach(url => URL.revokeObjectURL(url))
        setObjectUrls(newObjUrls)
        setFloorMapAssets(built.floorMapAssets)
        nextFloorVisuals = {}
        for (const a of built.floorMapAssets) nextFloorVisuals[a.floorLabel] = 'blank'
        setLowCostFloorVisuals(nextFloorVisuals)
        if (built.warnings.length > 0) {
          addToast({ type: 'warning', title: 'Low-cost', message: built.warnings[0], duration: 4000 })
        }
      } else if (rebuildMode === 'cloud-slice') {
        const positions = e57SourcePositionsRef.current
        if (positions && positions.length >= 3 && lowCostSliceCenters.length > 0) {
          const previousUrls = [...objectUrls]
          const newObjUrls: string[] = []
          const plans = await buildFloorMapAssetsFromPointCloudSlices({
            positions,
            panos: [],
            objectUrlsSink: newObjUrls,
            sliceHeightMeters: 0.30,
            explicitSliceCenters: lowCostSliceCenters,
          })
          previousUrls.forEach(url => URL.revokeObjectURL(url))
          setObjectUrls(newObjUrls)
          setFloorMapAssets(plans.floorMapAssets)
          nextFloorVisuals = {}
          for (const a of plans.floorMapAssets) nextFloorVisuals[a.floorLabel] = 'cloud-slice'
          setLowCostFloorVisuals(nextFloorVisuals)
          if (plans.warnings.length > 0) {
            addToast({ type: 'warning', title: 'Low-cost', message: plans.warnings[0], duration: 4000 })
          }
        } else {
          addToast({ type: 'warning', title: 'Low-cost', message: 'Aucun nuage chargé ou coupes non définies.', duration: 3500 })
        }
      }

      const runtimePanos: PanoRecord[] = panoSource.map(lowCostPanoToRecord)
      setPanos(runtimePanos)

      const assignments: Record<string, string> = {}
      for (const lp of panoSource) {
        if (lp.assignedFloorLabel) assignments[lp.id] = lp.assignedFloorLabel
      }
      setPanoFloorAssignments(assignments)
      if (runtimePanos.length === 0) {
        setCurrentPanoId(null)
      } else if (!currentPanoId || !runtimePanos.some(p => p.id === currentPanoId)) {
        setCurrentPanoId(runtimePanos[0].id)
      }
      setSelectedFloor('ALL')
      devFloorPlanPanoBaselineRef.current =
        runtimePanos.length > 0 ? clonePanosForDevFloorBaseline(runtimePanos) : null
      setFloormapDevAlignFromPointCloud(false)

      persistLowCostProject({
        floorCount: lowCostFloorCount,
        sliceCenters: sliceCentersForPersist,
        panos: panoSource,
        floorVisuals: nextFloorVisuals,
        hasCloud: Boolean(e57SourcePositionsRef.current),
      })

      const nPlans = sliceCentersForPersist.length
      if (!opts?.suppressToast) {
        addToast({
          type: 'success',
          title: 'Low-cost',
          message: `${nPlans} plan(s), ${runtimePanos.length} panorama(s) appliqués.`,
          duration: 3200,
        })
      }
    },
    [lowCostSliceCenters, lowCostPanos, lowCostFloorCount, lowCostFloorVisuals, objectUrls, currentPanoId, addToast, persistLowCostProject]
  )

  /** Étape 5 : si aucun plan n'est en mémoire (saut d'étape, restauration partielle…), créer les placeholders noirs. */
  useEffect(() => {
    if (!lowCostMode || lowCostStep !== 'plans') return
    if (floorMapAssets.length > 0) return
    if (lowCostFloorCount < 1) return
    void applyLowCostToRuntime({ rebuildFloors: 'blank-black', suppressToast: true })
  }, [lowCostMode, lowCostStep, floorMapAssets.length, lowCostFloorCount, applyLowCostToRuntime])

  /** Taille de bitmap pour enregistrements sans champs stockés (migration / échec lecture à l’enregistrement). */
  useEffect(() => {
    let cancelled = false
    const labels = new Set(Object.keys(floorPlanReplacements))
    setFloorPlanReplacementInferredSize(prev => {
      const next: Record<string, { w: number; h: number }> = {}
      for (const k of Object.keys(prev)) {
        if (labels.has(k)) next[k] = prev[k]!
      }
      return next
    })
    for (const [fl, rec] of Object.entries(floorPlanReplacements)) {
      if (!rec?.imageDataUrl) continue
      const rw = rec.replacedPixelWidth
      const rh = rec.replacedPixelHeight
      if (Number.isFinite(rw) && Number.isFinite(rh) && (rw as number) >= 1 && (rh as number) >= 1) continue
      void getImageNaturalSizeFromDataUrl(rec.imageDataUrl).then(s => {
        if (cancelled || !s) return
        setFloorPlanReplacementInferredSize(p => (p[fl]?.w === s.w && p[fl]?.h === s.h ? p : { ...p, [fl]: s }))
      })
    }
    return () => {
      cancelled = true
    }
  }, [floorPlanReplacements])

  const floorMapAssetsEffective = useMemo(() => {
    if (!floorMapAssets.length) return floorMapAssets
    return floorMapAssets.map(asset => {
      const rep = floorPlanReplacements[asset.floorLabel]
      if (!rep?.imageDataUrl) return asset
      const wStored = rep.replacedPixelWidth
      const hStored = rep.replacedPixelHeight
      const inferred = floorPlanReplacementInferredSize[asset.floorLabel]
      const w =
        Number.isFinite(wStored) && (wStored as number) >= 1
          ? Math.floor(wStored as number)
          : inferred?.w
      const h =
        Number.isFinite(hStored) && (hStored as number) >= 1
          ? Math.floor(hStored as number)
          : inferred?.h
      let worldToPixel = asset.worldToPixel
      if (asset.worldToPixel && w && h && w > 1 && h > 1) {
        const il = rep.replacedContentInsetLeftPx
        const it = rep.replacedContentInsetTopPx
        if (
          Number.isFinite(il) &&
          Number.isFinite(it) &&
          (il !== 0 || it !== 0)
        ) {
          worldToPixel = worldToPixelRescaledWithContentInset(
            asset.worldToPixel,
            w,
            h,
            il,
            it
          )
        } else {
          worldToPixel = worldToPixelRescaledToImageSize(asset.worldToPixel, w, h)
        }
      }
      return {
        ...asset,
        imageUrl: rep.imageDataUrl,
        sourcePath: `${asset.sourcePath} (remplacé ${rep.mode === 'drawn' ? 'tracé' : 'import'})`,
        sourceType: 'user-replacement' as const,
        ...(worldToPixel ? { worldToPixel } : {}),
      }
    })
  }, [floorMapAssets, floorPlanReplacements, floorPlanReplacementInferredSize])

  /** Low-cost : refléter tout changement d'étage assigné sur le viewer (mini-carte, filtres) sans recliquer sur « Appliquer ». */
  useEffect(() => {
    if (!lowCostMode) return
    if (!panos.length || !lowCostPanos.length) return
    const runtimeIdSet = new Set(panos.map(p => p.id))
    if (!lowCostPanos.every(lp => runtimeIdSet.has(lp.id))) return
    setPanoFloorAssignments(prev => {
      const next = { ...prev }
      let changed = false
      for (const lp of lowCostPanos) {
        const fl = lp.assignedFloorLabel?.trim()
        if (!fl) continue
        if (next[lp.id] !== fl) {
          next[lp.id] = fl
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [lowCostMode, lowCostPanos, panos])

  /** Étapes 6 et 7 : même UI pastilles rééditable une fois « prêt ». */
  const lowCostPastillesEditableStep = lowCostStep === 'pinning' || lowCostStep === 'ready'

  /** À l'étape pastilles (ou visualisation finale) : garantir un plan affiché valide si les assets changent. */
  useEffect(() => {
    if (!lowCostPastillesEditableStep) return
    if (!floorMapAssetsEffective.length) return
    setLowCostPinningMapFloor(prev => {
      if (prev && floorMapAssetsEffective.some(a => a.floorLabel === prev)) return prev
      return floorMapAssetsEffective[0]!.floorLabel
    })
  }, [lowCostPastillesEditableStep, floorMapAssetsEffective])

  /** Si le filtre liste pointe vers un étage supprimé, repasser sur « tous les étages ». */
  useEffect(() => {
    if (!lowCostPastillesEditableStep) return
    if (lowCostPinningListFilter === LOW_COST_PINNING_LIST_ALL) return
    if (floorMapAssetsEffective.some(a => a.floorLabel === lowCostPinningListFilter)) return
    setLowCostPinningListFilter(LOW_COST_PINNING_LIST_ALL)
  }, [lowCostPastillesEditableStep, floorMapAssetsEffective, lowCostPinningListFilter])

  const lowCostPlansComplete = useMemo(
    () =>
      floorMapAssets.length > 0 &&
      floorMapAssets.every(a => Boolean(floorPlanReplacements[a.floorLabel]?.imageDataUrl?.trim())),
    [floorMapAssets, floorPlanReplacements]
  )

  const floorPlanTargetAsset = useMemo(
    () => floorMapAssets.find(a => a.floorLabel === floorPlanReplaceTargetLabel) ?? null,
    [floorMapAssets, floorPlanReplaceTargetLabel]
  )

  useEffect(() => {
    if (!floorMapAssets.length) {
      setFloorPlanReplaceTargetLabel('')
      return
    }
    if (floorPlanReplaceTargetLabel && floorMapAssets.some(a => a.floorLabel === floorPlanReplaceTargetLabel)) return
    setFloorPlanReplaceTargetLabel(floorMapAssets[0]?.floorLabel ?? '')
  }, [floorMapAssets, floorPlanReplaceTargetLabel])

  useEffect(() => {
    floorPlanImportInteractionModeRef.current = floorPlanImportInteractionMode
  }, [floorPlanImportInteractionMode])

  const clearFloorPlanImportDraft = useCallback(() => {
    setFloorPlanImportedDataUrl(null)
    setFloorPlanImportBaseOverlayOpacity(35)
    setFloorPlanAlignedPreviewDataUrl(null)
    setFloorPlanImportCanvasDisplaySize(null)
    setFloorPlanImportInteractionMode('adjust')
    floorPlanImportInteractionModeRef.current = 'adjust'
    const fc = floorPlanImportFabricCanvasRef.current as { dispose?: () => void } | null
    fc?.dispose?.()
    floorPlanImportFabricCanvasRef.current = null
    floorPlanImportFabricImgObjRef.current = null
    floorPlanImportControlMetricsRef.current = null
    floorPlanImportFabricOverlayObjRef.current = null
    floorPlanImportFabricDotsRef.current = []
    floorPlanImportLastExportInsetRef.current = { left: 0, top: 0 }
  }, [])

  const resetFloorPlanImportAlignment = useCallback(() => {
    const fc = floorPlanImportFabricCanvasRef.current as {
      width?: number
      height?: number
      setActiveObject?: (o: unknown) => void
      requestRenderAll?: () => void
    } | null
    const imgObj = floorPlanImportFabricImgObjRef.current as {
      width?: number
      height?: number
      set?: (opts: unknown) => void
      getOriginalSize?: () => { width: number; height: number }
    } | null
    if (!fc || !imgObj) {
      console.log('[FloorPlanImport] resetAlignment: canvas ou image introuvable')
      return
    }
    const W = fc.width ?? 800
    const H = fc.height ?? 600
    const orig =
      typeof imgObj.getOriginalSize === 'function'
        ? imgObj.getOriginalSize()
        : { width: Number(imgObj.width ?? 800), height: Number(imgObj.height ?? 600) }
    const nw = Math.max(1, orig.width || 1)
    const nh = Math.max(1, orig.height || 1)
    const fitScale = Math.min(W / nw, H / nh, 1)
    imgObj.set?.({
      cropX: 0,
      cropY: 0,
      width: nw,
      height: nh,
      left: W / 2,
      top: H / 2,
      originX: 'center',
      originY: 'center',
      scaleX: fitScale,
      scaleY: fitScale,
      angle: 0,
    })
    setFloorPlanImportInteractionMode('adjust')
    floorPlanImportInteractionModeRef.current = 'adjust'
    fc.setActiveObject?.(floorPlanImportFabricImgObjRef.current)
    fc.requestRenderAll?.()
    exportFabricImportCanvasRef.current()
    console.log('[FloorPlanImport] resetAlignment: position réinitialisée, scale=', fitScale)
  }, [])

  const applyFloorPlanReplacementForTarget = useCallback(
    async (
      mode: FloorPlanReplacementMode,
      imageDataUrl: string,
      anchorPairs?: FloorPlanReplacementAnchorPair[],
      drawMeta?: {
        drawSvgDataUrl?: string
        drawSceneJson?: string
        drawStrokeColor?: string
        drawStrokeWidth?: number
      }
    ) => {
      if (!floorPlanReplaceTargetLabel || !imageDataUrl) return
      const dims = await getImageNaturalSizeFromDataUrl(imageDataUrl)
      const next: Record<string, FloorPlanReplacementRecord> = {
        ...floorPlanReplacements,
        [floorPlanReplaceTargetLabel]: {
          floorLabel: floorPlanReplaceTargetLabel,
          mode,
          imageDataUrl,
          updatedAt: new Date().toISOString(),
          ...(dims && dims.w >= 1 && dims.h >= 1
            ? { replacedPixelWidth: dims.w, replacedPixelHeight: dims.h }
            : {}),
          ...(mode === 'imported'
            ? {
                replacedContentInsetLeftPx: floorPlanImportLastExportInsetRef.current.left,
                replacedContentInsetTopPx: floorPlanImportLastExportInsetRef.current.top,
              }
            : {}),
          ...(anchorPairs && anchorPairs.length > 0 ? { anchorPairs } : {}),
          ...(mode === 'drawn' && drawMeta?.drawSvgDataUrl ? { drawSvgDataUrl: drawMeta.drawSvgDataUrl } : {}),
          ...(mode === 'drawn' && drawMeta?.drawSceneJson ? { drawSceneJson: drawMeta.drawSceneJson } : {}),
          ...(mode === 'drawn' && drawMeta?.drawStrokeColor ? { drawStrokeColor: drawMeta.drawStrokeColor } : {}),
          ...(mode === 'drawn' && Number.isFinite(drawMeta?.drawStrokeWidth)
            ? { drawStrokeWidth: Math.max(1, Math.min(50, Number(drawMeta?.drawStrokeWidth))) }
            : {}),
        },
      }
      persistFloorPlanReplacements(next)
      if (lowCostMode) {
        setLowCostFloorVisuals(prev => ({
          ...prev,
          [floorPlanReplaceTargetLabel]: mode === 'drawn' ? 'drawn' : 'imported',
        }))
      }
      addToast({
        type: 'success',
        title: 'Plan remplacé',
        message: `Étage ${floorPlanReplaceTargetLabel} mis à jour.`,
        duration: 2600,
      })
    },
    [floorPlanReplaceTargetLabel, floorPlanReplacements, persistFloorPlanReplacements, addToast, lowCostMode]
  )

  const resetFloorPlanReplacementForTarget = useCallback(() => {
    if (!floorPlanReplaceTargetLabel || !floorPlanReplacements[floorPlanReplaceTargetLabel]) return
    const next = { ...floorPlanReplacements }
    delete next[floorPlanReplaceTargetLabel]
    persistFloorPlanReplacements(next)
    if (lowCostMode) {
      setLowCostFloorVisuals(prev => ({ ...prev, [floorPlanReplaceTargetLabel]: 'blank' }))
    }
    addToast({
      type: 'success',
      title: 'Plan restauré',
      message: `Retour au plan original pour ${floorPlanReplaceTargetLabel}.`,
      duration: 2400,
    })
  }, [floorPlanReplaceTargetLabel, floorPlanReplacements, persistFloorPlanReplacements, addToast, lowCostMode])

  /** Export the Fabric import canvas (transparent bg, only the imported plan) to floorPlanAlignedPreviewDataUrl. */
  const exportFabricImportCanvas = useCallback((): string | null => {
    const fc = floorPlanImportFabricCanvasRef.current as {
      backgroundColor?: string
      renderAll: () => void
      requestRenderAll?: () => void
      toDataURL: (opts: { format: string; quality: number; enableRetinaScaling: boolean }) => string
      getObjects: () => unknown[]
    } | null
    if (!fc) return null
    const prevBgColor = fc.backgroundColor
    fc.backgroundColor = 'rgba(0,0,0,0)'
    fc.renderAll()
    const dataUrl = fc.toDataURL({ format: 'png', quality: 1, enableRetinaScaling: false })
    fc.backgroundColor = prevBgColor
    fc.renderAll()
    const first = fc.getObjects()[0] as { getBoundingRect?: () => { left: number; top: number; width: number; height: number } } | undefined
    if (first?.getBoundingRect) {
      const br = first.getBoundingRect()
      floorPlanImportLastExportInsetRef.current = { left: Math.round(br.left), top: Math.round(br.top) }
    } else {
      floorPlanImportLastExportInsetRef.current = { left: 0, top: 0 }
    }
    console.log('[FloorPlanImport] export. Objets Fabric:', fc.getObjects().length, 'inset', floorPlanImportLastExportInsetRef.current)
    setFloorPlanAlignedPreviewDataUrl(dataUrl)
    return dataUrl
  }, [])

  // Sync stable ref so useCallbacks declared before this can call exportFabricImportCanvas without TDZ
  exportFabricImportCanvasRef.current = exportFabricImportCanvas

  /** Init / re-init Fabric canvas for import mode whenever modal or images change. */
  useEffect(() => {
    if (!floorPlanImportModalOpen || !floorPlanTargetAsset?.imageUrl) {
      const fc = floorPlanImportFabricCanvasRef.current as { dispose?: () => void } | null
      fc?.dispose?.()
      floorPlanImportFabricCanvasRef.current = null
      floorPlanImportFabricImgObjRef.current = null
      floorPlanImportControlMetricsRef.current = null
      floorPlanImportFabricDotsRef.current = []
      setFloorPlanAlignedPreviewDataUrl(null)
      return
    }
    const targetAsset = floorPlanTargetAsset
    const importedDataUrl = floorPlanImportedDataUrl
    let cancelled = false

    const init = async () => {
      const fabricModule = await import('fabric')
      const FM = fabricModule as Record<string, unknown>
      const FabricCanvas = FM.Canvas as new (el: HTMLCanvasElement, opts: unknown) => unknown
      const FabricImageCls = (FM.FabricImage ?? FM.Image) as {
        fromURL: (url: string, opts?: unknown) => Promise<unknown>
      }
      if (cancelled) return

      const container = floorPlanImportFabricContainerRef.current
      if (!container) return

      // Dispose previous canvas
      const prev = floorPlanImportFabricCanvasRef.current as { dispose?: () => void } | null
      prev?.dispose?.()
      floorPlanImportFabricCanvasRef.current = null
      floorPlanImportFabricImgObjRef.current = null
      floorPlanImportControlMetricsRef.current = null
      floorPlanImportFabricDotsRef.current = []

      // Load base plan to get dimensions
      const baseImg = await loadImageElement(targetAsset.imageUrl)
      if (cancelled || !baseImg) return

      const natW = baseImg.naturalWidth || 800
      const natH = baseImg.naturalHeight || 600
      const { w: W, h: H } = capFloorPlanImportFabricCanvasSize(natW, natH)

      // Create canvas element — use CSS scale to fit display area
      const canvasEl = document.createElement('canvas')
      container.innerHTML = ''
      // Wrap in a div so the Fabric canvas-container keeps its natural size
      // but we CSS-scale the whole thing down to fit the modal
      const wrapper = document.createElement('div')
      wrapper.style.display = 'inline-block'
      wrapper.style.transformOrigin = 'top left'
      const availW = Math.max(200, container.parentElement?.clientWidth ?? 900) - 16
      const cssScale = Math.min(1, availW / W)
      wrapper.style.transform = `scale(${cssScale})`
      wrapper.style.width = `${W}px`
      wrapper.style.height = `${H}px`
      wrapper.appendChild(canvasEl)
      // Shrink container to scaled size so it doesn't overflow
      container.style.width = `${Math.round(W * cssScale)}px`
      container.style.height = `${Math.round(H * cssScale)}px`
      container.style.overflow = 'hidden'
      container.appendChild(wrapper)

      // Fabric canvas: transparent bg, only the imported image (overlay + dots are HTML elements)
      const fc = new FabricCanvas(canvasEl, {
        width: W,
        height: H,
        backgroundColor: 'rgba(0,0,0,0)',
        selection: false,
      }) as Record<string, unknown>
      floorPlanImportFabricCanvasRef.current = fc

      const fcAny = fc as {
        add: (o: unknown) => void
        setActiveObject: (o: unknown) => void
        on: (ev: string, cb: () => void) => void
        getObjects: () => unknown[]
        requestRenderAll?: () => void
        renderAll: () => void
      }

      // Imported image — the only Fabric object; overlay and dots are HTML above the canvas
      if (importedDataUrl) {
        const fabImg = await FabricImageCls.fromURL(importedDataUrl)
        if (cancelled) return
        const fi = fabImg as Record<string, unknown>
        const srcW = (fi.width as number) || 800
        const srcH = (fi.height as number) || 600
        const controlMetrics = floorPlanImportControlMetrics({
          importSrcW: srcW,
          importSrcH: srcH,
          canvasCssScale: cssScale,
        })
        floorPlanImportControlMetricsRef.current = controlMetrics
        if (import.meta.env.DEV) {
          const miss = floorPlanImportMissingLayers({
            importedDataUrl,
            originalPlanImageUrl: targetAsset.imageUrl,
          })
          if (miss.length > 0) {
            console.warn('[FloorPlanImport] calques requis manquants:', miss)
          }
        }
        const fitScale = Math.min(W / srcW, H / srcH, 1)
        ;(fi.set as ((opts: unknown) => void) | undefined)?.({
          left: W / 2,
          top: H / 2,
          originX: 'center',
          originY: 'center',
          scaleX: fitScale,
          scaleY: fitScale,
          selectable: true,
          evented: true,
          hasControls: true,
          hasBorders: true,
          cropX: 0,
          cropY: 0,
        })

        applyFloorPlanImportImageFabricControls(
          floorPlanImportInteractionModeRef.current,
          FM as Record<string, unknown>,
          fi,
          controlMetrics
        )

        fcAny.add(fabImg)
        fcAny.setActiveObject(fabImg)
        floorPlanImportFabricImgObjRef.current = fabImg

        ;(fabImg as { on?: (ev: string, cb: (e: unknown) => void) => void }).on?.('mousedblclick', (opt: unknown) => {
          const o = opt as { e?: Event }
          o.e?.stopPropagation?.()
          o.e?.preventDefault?.()
          setFloorPlanImportInteractionMode(prev => {
            const next = prev === 'adjust' ? 'crop' : 'adjust'
            floorPlanImportInteractionModeRef.current = next
            return next
          })
        })

        const handleModified = () => {
          if (!cancelled) exportFabricImportCanvasRef.current()
        }
        fcAny.on('object:modified', handleModified)
        fcAny.on('object:rotating', handleModified)
        fcAny.on('object:scaling', handleModified)
        fcAny.on('object:resizing', handleModified)
        fcAny.on('object:moving', handleModified)

        exportFabricImportCanvasRef.current()
        console.log('[FloorPlanImport] canvas Fabric initialisé. W=', W, 'H=', H, 'cssScale=', cssScale)
      }

      // Expose display size so React can position HTML overlays correctly
      setFloorPlanImportCanvasDisplaySize({ w: Math.round(W * cssScale), h: Math.round(H * cssScale) })

      fcAny.requestRenderAll?.()
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [
    floorPlanImportModalOpen,
    floorPlanImportedDataUrl,
    floorPlanTargetAsset,
    // exportFabricImportCanvas accessed via exportFabricImportCanvasRef (declared after this effect, TDZ-safe)
    // floorPlanImportTargetPanoDots accessed via ref (declared after this effect)
    // opacity intentionally NOT in deps: synced by the separate opacity effect below
  ])

  /** Bascule ajuster / rogner sur l'image Fabric sans réinitialiser tout le canvas. */
  useLayoutEffect(() => {
    if (!floorPlanImportModalOpen || !floorPlanImportedDataUrl) return
    const img = floorPlanImportFabricImgObjRef.current as Record<string, unknown> | null
    const fc = floorPlanImportFabricCanvasRef.current as {
      setActiveObject?: (o: unknown) => void
      requestRenderAll?: () => void
      renderAll?: () => void
    } | null
    if (!img || !fc) return
    let cancelled = false
    void import('fabric').then(fabricMod => {
      if (cancelled) return
      applyFloorPlanImportImageFabricControls(
        floorPlanImportInteractionMode,
        fabricMod as Record<string, unknown>,
        img,
        floorPlanImportControlMetricsRef.current
      )
      ;(img as { setCoords?: () => void }).setCoords?.()
      fc.setActiveObject?.(img)
      fc.requestRenderAll?.()
      fc.renderAll?.()
      exportFabricImportCanvasRef.current()
    })
    return () => {
      cancelled = true
    }
  }, [
    floorPlanImportInteractionMode,
    floorPlanImportModalOpen,
    floorPlanImportedDataUrl,
    floorPlanImportCanvasDisplaySize,
  ])

  // Keep opacity ref in sync (used by init effect for initial value)
  useEffect(() => {
    floorPlanImportBaseOverlayOpacityRef.current = floorPlanImportBaseOverlayOpacity
  }, [floorPlanImportBaseOverlayOpacity])

  useEffect(() => {
    if (!floorPlanDrawModalOpen || !floorPlanTargetAsset?.imageUrl) return
    let cancelled = false
    let scriptEl: HTMLScriptElement | null = null
    const init = async () => {
      try {
        if (!(window as unknown as { fabric?: unknown }).fabric) {
          const fabricModule = await import('fabric')
          const M = fabricModule as Record<string, unknown>
          ;(window as unknown as { fabric: Record<string, unknown> }).fabric = {
            Canvas: M.Canvas,
            Image: M.Image ?? M.FabricImage,
            FabricImage: M.FabricImage ?? M.Image,
            Line: M.Line,
            Circle: M.Circle,
            Path: M.Path,
            Group: M.Group,
            Polygon: M.Polygon,
            Object: M.Object ?? M.FabricObject,
            IText: M.IText,
            ActiveSelection: M.ActiveSelection,
            PencilBrush: M.PencilBrush,
            Textbox: M.Textbox,
            Rect: M.Rect,
          }
        }
        if (!(window as unknown as { jspdf?: { jsPDF: unknown } }).jspdf) {
          const { jsPDF: JsPdfCtor } = await import('jspdf')
          ;(window as unknown as { jspdf: { jsPDF: unknown } }).jspdf = { jsPDF: JsPdfCtor }
        }
        if (!floorPlanFabricScriptLoadedRef.current) {
          await new Promise<void>((resolve, reject) => {
            scriptEl = document.createElement('script')
            scriptEl.src = '/scripts/fabricjs.js?v=6'
            scriptEl.onload = () => {
              floorPlanFabricScriptLoadedRef.current = true
              resolve()
            }
            scriptEl.onerror = () => reject(new Error('Échec chargement fabricjs.js'))
            document.head.appendChild(scriptEl)
          })
        }
        if (cancelled) return
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        if (cancelled) return
        const container = floorPlanDrawContainerRef.current
        const FabricDrawing = (
          window as unknown as {
            FabricDrawing?: {
              initCanvas: (container: string | HTMLElement, opts: { width: number; height: number }) => unknown
              bindToolbar?: (canvas: unknown) => void
              bindTwoPointMode?: (canvas: unknown) => void
              redrawGridIntensity?: (wrapper: HTMLElement, intensity: number) => void
            }
          }
        ).FabricDrawing
        if (!container || !FabricDrawing?.initCanvas) return
        const baseImg = await loadImageElement(floorPlanTargetAsset.imageUrl)
        if (!baseImg || cancelled) return
        const width = Math.max(500, Math.min(1800, baseImg.naturalWidth || 1200))
        const height = Math.max(360, Math.min(1200, baseImg.naturalHeight || 700))
        const canvas = FabricDrawing.initCanvas(container, { width, height }) as { dispose?: () => void }
        FabricDrawing.bindTwoPointMode?.(canvas)
        FabricDrawing.bindToolbar?.(canvas)
        const fabricCanvas = canvas as {
          backgroundColor?: string | null
          setBackgroundColor?: (color: string, cb?: () => void) => void
          requestRenderAll?: () => void
          renderAll?: () => void
        }
        // Force un fond transparent au niveau Fabric pour laisser voir le plan d'origine.
        try {
          if (typeof fabricCanvas.setBackgroundColor === 'function') {
            fabricCanvas.setBackgroundColor('rgba(0,0,0,0)', () => {
              fabricCanvas.requestRenderAll?.()
              fabricCanvas.renderAll?.()
            })
          } else {
            fabricCanvas.backgroundColor = 'rgba(0,0,0,0)'
            fabricCanvas.requestRenderAll?.()
            fabricCanvas.renderAll?.()
          }
        } catch {
          /* noop */
        }
        container.style.backgroundColor = 'transparent'
        const wrapper = container.querySelector('[data-fabric="wrapper"]') as
          | (HTMLElement & { _gridOpts?: { backgroundColor?: string; gridIntensity?: number }; _gridEl?: HTMLCanvasElement })
          | null
        if (wrapper?._gridOpts) {
          wrapper._gridOpts.backgroundColor = 'rgba(0,0,0,0)'
          const intensityEl = document.getElementById('gridIntensity') as HTMLInputElement | null
          const intensityRaw = Number(intensityEl?.value ?? 50)
          const intensity = Number.isFinite(intensityRaw) ? Math.max(0, Math.min(1, intensityRaw / 100)) : 0.5
          FabricDrawing.redrawGridIntensity?.(wrapper, intensity)
          if (wrapper._gridEl) {
            wrapper._gridEl.style.background = 'transparent'
            wrapper._gridEl.style.backgroundColor = 'transparent'
          }
        }
        const canvasNodes = container.querySelectorAll('canvas')
        canvasNodes.forEach(node => {
          const cv = node as HTMLCanvasElement
          cv.style.background = 'transparent'
          cv.style.backgroundColor = 'transparent'
        })
        floorPlanDrawCanvasRef.current = canvas
        floorPlanDrawGuideObjectsRef.current = []
        floorPlanDrawSceneLoadedKeyRef.current = null
        setFloorPlanDrawCanvasReadyTick(v => v + 1)
      } catch (err) {
        console.error('[ETL360] Fabric init error', err)
        addToast({ type: 'error', title: 'Plan tracé', message: 'Impossible d’initialiser l’outil de dessin.', duration: 3200 })
      }
    }
    void init()
    return () => {
      cancelled = true
      const canvas = floorPlanDrawCanvasRef.current as { dispose?: () => void } | null
      try {
        canvas?.dispose?.()
      } catch {
        /* noop */
      }
      floorPlanDrawCanvasRef.current = null
      floorPlanDrawGuideObjectsRef.current = []
      floorPlanDrawSceneLoadedKeyRef.current = null
      if (scriptEl && scriptEl.parentNode) scriptEl.parentNode.removeChild(scriptEl)
    }
  }, [floorPlanDrawModalOpen, floorPlanTargetAsset, addToast])

  useEffect(() => {
    if (!floorPlanDrawModalOpen || !floorPlanTargetAsset) return
    const replacement = floorPlanReplacements[floorPlanTargetAsset.floorLabel]
    const sceneJson = replacement?.mode === 'drawn' ? replacement.drawSceneJson : undefined
    if (!sceneJson) return
    const canvas = floorPlanDrawCanvasRef.current as
      | {
          loadFromJSON?: (...args: unknown[]) => unknown
          requestRenderAll?: () => void
          renderAll?: () => void
        }
      | null
    if (!canvas || typeof canvas.loadFromJSON !== 'function') return
    const sceneKey = `${floorPlanTargetAsset.floorLabel}:${replacement?.updatedAt || ''}`
    if (floorPlanDrawSceneLoadedKeyRef.current === sceneKey) return
    try {
      const parsed = JSON.parse(sceneJson) as unknown
      const payload = (parsed &&
        typeof parsed === 'object' &&
        'schema' in (parsed as Record<string, unknown>) &&
        (parsed as Record<string, unknown>).schema === 'etl360.drawScene.v1')
        ? (parsed as { fabricJson?: unknown; lineByPointsLast?: { x?: unknown; y?: unknown } | null })
        : null
      const fabricJson = payload?.fabricJson ?? parsed
      const lineByPointsLast =
        payload?.lineByPointsLast &&
        Number.isFinite(Number(payload.lineByPointsLast.x)) &&
        Number.isFinite(Number(payload.lineByPointsLast.y))
          ? { x: Number(payload.lineByPointsLast.x), y: Number(payload.lineByPointsLast.y) }
          : null
      const reviver = (obj: any, fabricObj: any) => {
        if (!obj || !fabricObj) return
        if (obj._isLineByPointsMarker) {
          fabricObj._isLineByPointsMarker = true
          fabricObj._lineByPointsMarkerLine = null
        }
        if (obj._isLineGroup || (obj.start_point && obj.end_point)) {
          fabricObj.start_point = obj.start_point
          fabricObj.end_point = obj.end_point
          fabricObj._lineOptions = obj._lineOptions || fabricObj._lineOptions
          fabricObj._isLineGroup = true
        }
      }
      const applyAfterLoad = () => {
        const FabricDrawing = (
          window as unknown as {
            FabricDrawing?: {
              repairAfterExternalLoad?: (
                canvas: unknown,
                opts?: { lineByPointsLast?: { x: number; y: number } | null }
              ) => void
            }
          }
        ).FabricDrawing
        FabricDrawing?.repairAfterExternalLoad?.(canvas, { lineByPointsLast })
        canvas.requestRenderAll?.()
        canvas.renderAll?.()
        floorPlanDrawSceneLoadedKeyRef.current = sceneKey
        setFloorPlanDrawCanvasReadyTick(v => v + 1)
      }
      const maybePromise = canvas.loadFromJSON(fabricJson, reviver) as unknown
      if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
        ;(maybePromise as Promise<void>).then(applyAfterLoad).catch(() => {
          floorPlanDrawSceneLoadedKeyRef.current = sceneKey
        })
      } else {
        applyAfterLoad()
      }
    } catch {
      floorPlanDrawSceneLoadedKeyRef.current = sceneKey
    }
  }, [floorPlanDrawModalOpen, floorPlanTargetAsset, floorPlanReplacements, floorPlanDrawCanvasReadyTick])

  /**
   * Fabric met en cache la position de l’élément canvas pour convertir clientX/clientY en coordonnées scène.
   * Après ouverture de la modale, défilement du panneau ou redimensionnement, ce cache peut rester obsolète :
   * le tracé et les points ne coïncident plus avec le clic (souvent pire après rechargement d’une scène).
   */
  useEffect(() => {
    if (!floorPlanDrawModalOpen) return
    const container = floorPlanDrawContainerRef.current
    const canvas = floorPlanDrawCanvasRef.current as { calcOffset?: () => void } | null
    if (!container || !canvas || typeof canvas.calcOffset !== 'function') return
    const sync = () => {
      canvas.calcOffset?.()
    }
    let rafInner: number | null = null
    const rafOuter = requestAnimationFrame(() => {
      rafInner = requestAnimationFrame(sync)
    })
    const onWinScroll = () => sync()
    const onWinResize = () => sync()
    const scrollableParents: HTMLElement[] = []
    let n: HTMLElement | null = container
    while (n && n !== document.documentElement) {
      const st = window.getComputedStyle(n)
      if (/(auto|scroll|overlay)/.test(st.overflowY) || /(auto|scroll|overlay)/.test(st.overflowX)) {
        scrollableParents.push(n)
      }
      n = n.parentElement
    }
    for (const el of scrollableParents) {
      el.addEventListener('scroll', sync, { passive: true, capture: true })
    }
    window.addEventListener('scroll', onWinScroll, { passive: true, capture: true })
    window.addEventListener('resize', onWinResize)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => sync()) : null
    if (ro) ro.observe(container)
    return () => {
      cancelAnimationFrame(rafOuter)
      if (rafInner != null) cancelAnimationFrame(rafInner)
      for (const el of scrollableParents) {
        el.removeEventListener('scroll', sync, { capture: true } as AddEventListenerOptions)
      }
      window.removeEventListener('scroll', onWinScroll, { capture: true } as AddEventListenerOptions)
      window.removeEventListener('resize', onWinResize)
      ro?.disconnect()
    }
  }, [floorPlanDrawModalOpen, floorPlanDrawCanvasReadyTick])

  const panosWithViewerContext = useMemo(() => {
    const base = buildPanosWithFloorContext(panosWithViewerColors, panoFloorAssignments, floorMapAssetsEffective)
    return base.map(p => ({
      ...p,
      viewFlipX: Boolean(panoViewAxisFlipsMap[p.id]?.flipX),
      viewFlipY: Boolean(panoViewAxisFlipsMap[p.id]?.flipY),
    }))
  }, [panosWithViewerColors, panoFloorAssignments, floorMapAssetsEffective, panoViewAxisFlipsMap])

  const panosWithViewerContextRef = useRef(panosWithViewerContext)
  panosWithViewerContextRef.current = panosWithViewerContext

  const projectAnnotationsToPointCloud = useCallback(
    (list: AnnotationRecord[]): AnnotationRecord[] => {
      return projectAnnotationsToPointCloudViaViewer({
        annotations: list,
        panos: panosWithViewerColors,
        viewer: e57ViewerRef.current,
        pointCloudBounds: e57SourceBoundsRef.current,
        hasPointCloud: Boolean(e57SourcePositionsRef.current),
      })
    },
    [panosWithViewerColors]
  )

  useEffect(() => {
    const sync = () => {
      setPanoFsActive(getDomFullscreenElement() === panoFsRootRef.current)
      setE57FsActive(getDomFullscreenElement() === e57FsRootRef.current)
    }
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync as EventListener)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync as EventListener)
    }
  }, [])

  useEffect(() => {
    if (!panoFsActive) return
    setMeasureModeActive(false)
    setMeasureStart(null)
    setMeasureDrag(null)
  }, [panoFsActive])

  const togglePanoFullscreen = useCallback(async () => {
    const el = panoFsRootRef.current
    if (!el) return
    try {
      if (getDomFullscreenElement() === el) {
        await exitDomFullscreen()
      } else {
        await enterDomFullscreen(el)
      }
    } catch {
      addToast({
        type: 'error',
        title: 'Plein ecran',
        message: 'Impossible d activer ou quitter le plein ecran (navigateur ou permissions).',
        duration: 4000,
      })
    }
  }, [addToast])

  const toggleE57Fullscreen = useCallback(async () => {
    const el = e57FsRootRef.current
    if (!el) return
    try {
      if (getDomFullscreenElement() === el) {
        await exitDomFullscreen()
      } else {
        await enterDomFullscreen(el)
      }
    } catch {
      addToast({
        type: 'error',
        title: 'Plein ecran',
        message: 'Impossible d activer ou quitter le plein ecran (navigateur ou permissions).',
        duration: 4000,
      })
    }
  }, [addToast])

  const panoModalMount = panoFsActive && panoFsRootRef.current ? panoFsRootRef.current : document.body
  const panoModalOverlayClass = panoFsActive && panoFsRootRef.current ? 'absolute inset-0' : 'fixed inset-0'

  const currentPano = useMemo(
    () => panosWithViewerContext.find(p => p.id === currentPanoId) ?? null,
    [panosWithViewerContext, currentPanoId]
  )

  const currentAnnotations = useMemo(
    () => annotations.filter(ann => ann.panoId === currentPanoId),
    [annotations, currentPanoId]
  )

  /** Paire avant/après : définie sur le `PanoRecord` courant (`comparePair`) + option UI activée. */
  const activePanoCompareForView = useMemo((): PanoComparePair | null => {
    if (!panoBeforeAfterUiEnabled || !currentPano) return null
    const cp = currentPano.comparePair
    if (!cp?.otherPanoId || cp.otherPanoId === currentPano.id) return null
    return cp
  }, [panoBeforeAfterUiEnabled, currentPano])

  const secondaryPanoForCompare = useMemo(() => {
    const id = activePanoCompareForView?.otherPanoId
    if (!id) return null
    return panosWithViewerContext.find(p => p.id === id) ?? null
  }, [activePanoCompareForView?.otherPanoId, panosWithViewerContext])

  const panoCompareLayoutActive = Boolean(
    activePanoCompareForView && secondaryPanoForCompare
  )

  /**
   * En mode avant / après, le pano secondaire (autre prise) reçoit les mêmes marqueurs que le
   * pano courant (yaw/pitch identiques) : une annotation n’est stockée qu’une fois (`panoId` = pano courant).
   */
  const compareViewerSelectedAnnotationId = useMemo(() => {
    if (!panoCompareLayoutActive || !selectedAnnotationId) return null
    return currentAnnotations.some(a => a.id === selectedAnnotationId) ? selectedAnnotationId : null
  }, [panoCompareLayoutActive, selectedAnnotationId, currentAnnotations])

  panoCompareLayoutActiveRef.current = panoCompareLayoutActive

  useEffect(() => {
    try {
      const a = localStorage.getItem(panoBeforeAfterStorageKey)
      if (a === '1' || a === 'true') setPanoBeforeAfterUiEnabled(true)
      const s = localStorage.getItem(panoCompareSplitStorageKey)
      const n = s != null ? Number(s) : Number.NaN
      if (Number.isFinite(n) && n >= 20 && n <= 80) setPanoCompareSplitPct(n)
    } catch {
      /* quota / private mode */
    }
  }, [panoBeforeAfterStorageKey, panoCompareSplitStorageKey])

  useEffect(() => {
    try {
      localStorage.setItem(panoBeforeAfterStorageKey, panoBeforeAfterUiEnabled ? '1' : '0')
    } catch {
      /* */
    }
  }, [panoBeforeAfterUiEnabled, panoBeforeAfterStorageKey])

  useEffect(() => {
    try {
      localStorage.setItem(panoCompareSplitStorageKey, String(panoCompareSplitPct))
    } catch {
      /* */
    }
  }, [panoCompareSplitPct, panoCompareSplitStorageKey])

  useEffect(() => {
    if (!panoBeforeAfterUiEnabled) return
    const id = activePanoCompareForView?.otherPanoId
    if (!id) return
    const p = panosWithViewerContext.find(x => x.id === id)
    if (!p || p.imageExists || !p.blobPath || p.imageBlobLoadFailed) return
    let cancelled = false
    const ac = new AbortController()
    const tid = window.setTimeout(() => ac.abort(), BLOB_PANO_LOAD_TIMEOUT_MS)
    void (async () => {
      try {
        const { blob } = await downloadEtlViewerFileAsBlob(
          p.blobPath,
          undefined,
          ac.signal,
          etlBlobScope
        )
        if (cancelled) return
        const imageUrl = URL.createObjectURL(blob)
        setPanos(prev => {
          const updated = prev.map(pr => (pr.id === id ? { ...pr, imageUrl, imageExists: true, imageBlobLoadFailed: false } : pr))
          setObjectUrls(prev2 => [...prev2, imageUrl])
          return updated
        })
      } catch {
        if (cancelled) return
        setPanos(prev => prev.map(pr => (pr.id === id ? { ...pr, imageBlobLoadFailed: true } : pr)))
      } finally {
        clearTimeout(tid)
      }
    })()
    return () => {
      cancelled = true
      clearTimeout(tid)
      ac.abort()
    }
  }, [panoBeforeAfterUiEnabled, activePanoCompareForView?.otherPanoId, panosWithViewerContext, etlBlobScope])

  useLayoutEffect(() => {
    if (!panoCompareLayoutActive || !compareContainerRef.current) {
      if (compareViewerRef.current) {
        compareViewerRef.current.dispose()
        compareViewerRef.current = null
      }
      return
    }
    const p = secondaryPanoForCompare
    if (!p?.imageExists || !p.imageUrl) return
    const el = compareContainerRef.current
    const v = new EmbeddedSphereViewer(el, compareViewerCallbacksRef)
    v.setViewInteractionEnabled(true)
    const fov0 = viewerRef.current?.getCameraFovDeg()
    if (fov0 != null) v.setCameraFovDeg(fov0)
    compareViewerRef.current = v
    return () => {
      v.dispose()
      if (compareViewerRef.current === v) compareViewerRef.current = null
    }
  }, [panoCompareLayoutActive, secondaryPanoForCompare?.id, secondaryPanoForCompare?.imageUrl])

  useEffect(() => {
    const v = compareViewerRef.current
    const p = secondaryPanoForCompare
    if (!v || !p?.imageUrl || !p.imageExists) return
    void v
      .loadPanorama(p.imageUrl)
      .then(() => {
        const pf = viewerRef.current?.getCameraFovDeg()
        if (pf != null) v.setCameraFovDeg(pf)
      })
      .catch(() => {
        addToast({
          type: 'error',
          title: 'Panorama comparaison',
          message: `Image indisponible : ${p.filename || p.id}`,
          duration: 3500,
        })
      })
  }, [secondaryPanoForCompare?.id, secondaryPanoForCompare?.imageUrl, addToast])

  useEffect(() => {
    const v = compareViewerRef.current
    const p = secondaryPanoForCompare
    if (!v || !p) return
    v.setPanoViewAxisFlips(Boolean(p.viewFlipX), Boolean(p.viewFlipY))
  }, [secondaryPanoForCompare?.id, secondaryPanoForCompare?.viewFlipX, secondaryPanoForCompare?.viewFlipY])

  useLayoutEffect(() => {
    const v = compareViewerRef.current
    if (!v) return
    v.focusYawPitch(panoViewYawPitch.yaw, panoViewYawPitch.pitch)
  }, [panoViewYawPitch, panoCompareLayoutActive, secondaryPanoForCompare?.id])

  useEffect(() => {
    if (!currentPano) {
      setPanoOrientDraftFlipX(false)
      setPanoOrientDraftFlipY(false)
      return
    }
    setPanoOrientDraftFlipX(Boolean(currentPano.viewFlipX))
    setPanoOrientDraftFlipY(Boolean(currentPano.viewFlipY))
  }, [currentPano?.id, currentPano?.viewFlipX, currentPano?.viewFlipY])

  const savePanoViewAxisFlips = useCallback(() => {
    if (!currentPanoId) return
    const row = { flipX: panoOrientDraftFlipX, flipY: panoOrientDraftFlipY }
    setPanoViewAxisFlipsMap(prev => {
      const next = { ...prev, [currentPanoId]: row }
      try {
        localStorage.setItem(
          panoViewAxisFlipsStorageKey(projectCodeForStorage),
          serializePanoViewAxisFlipsToStorage(next)
        )
      } catch {
        /* quota */
      }
      return next
    })
  }, [currentPanoId, panoOrientDraftFlipX, panoOrientDraftFlipY, projectCodeForStorage])

  const normalizeExposure = useCallback((value: unknown): number => {
    const n = Number(value)
    if (!Number.isFinite(n)) return 1
    return Math.max(0.2, Math.min(2.8, n))
  }, [])

  const readStoredExposureForPano = useCallback(
    (panoId: string): number => {
      try {
        const raw = localStorage.getItem(localStorageKeyForPanoExposure(projectCodeForStorage, panoId))
        if (raw === null) return 1
        return normalizeExposure(raw)
      } catch {
        return 1
      }
    },
    [normalizeExposure, projectCodeForStorage]
  )

  const exposureForPano = useCallback(
    (panoId: string): number => {
      const inMem = panoExposureById[panoId]
      if (Number.isFinite(inMem)) return normalizeExposure(inMem)
      return readStoredExposureForPano(panoId)
    },
    [normalizeExposure, panoExposureById, readStoredExposureForPano]
  )

  useEffect(() => {
    const v = compareViewerRef.current
    if (!v || !secondaryPanoForCompare) return
    v.setPanoramaExposure(exposureForPano(secondaryPanoForCompare.id))
  }, [secondaryPanoForCompare?.id, panoExposureById, exposureForPano])

  useEffect(() => {
    const v = compareViewerRef.current
    if (!v || !panoCompareLayoutActive || !secondaryPanoForCompare) return
    v.setMarkers(currentAnnotations, compareViewerSelectedAnnotationId, userTemplates, {
      interaction: clientMode ? 'select' : 'full',
    })
  }, [
    currentAnnotations,
    compareViewerSelectedAnnotationId,
    userTemplates,
    panoCompareLayoutActive,
    secondaryPanoForCompare?.id,
    panoDebugXyzEnabled,
    clientMode,
  ])

  useEffect(() => {
    const v = compareViewerRef.current
    if (!v || !secondaryPanoForCompare) return
    v.setPanoramaContext(secondaryPanoForCompare, panosWithViewerContext, neighborPanoRadiusM)
  }, [secondaryPanoForCompare, panosWithViewerContext, neighborPanoRadiusM, panoCompareLayoutActive])

  useEffect(() => {
    compareViewerRef.current?.setNeighborPanoMarkersVisible(showNeighborPanoTriangles)
  }, [showNeighborPanoTriangles, panoCompareLayoutActive, secondaryPanoForCompare?.id])

  useEffect(() => {
    compareViewerRef.current?.setNeighborQuaternionDebugVisible(panoDebugXyzEnabled)
  }, [panoDebugXyzEnabled, panoCompareLayoutActive, secondaryPanoForCompare?.id])

  const beginPanoCompareSplitDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      panoCompareSplitDragRef.current = {
        startX: e.clientX,
        startPct: panoCompareSplitPct,
        pointerId: e.pointerId,
        captureEl: e.currentTarget,
      }
      panoCompareSplitPendingPctRef.current = null
      const start = panoCompareSplitDragRef.current
      const onMove = (ev: PointerEvent) => {
        if (!start || ev.pointerId !== start.pointerId) return
        const host = panoCompareSplitRowRef.current
        const w = host?.getBoundingClientRect().width ?? window.innerWidth
        const dx = ev.clientX - start.startX
        const deltaPct = (dx / Math.max(200, w)) * 100
        const next = Math.min(80, Math.max(20, Math.round((start.startPct + deltaPct) * 10) / 10))
        panoCompareSplitPendingPctRef.current = next
        if (panoCompareSplitMoveRafRef.current) return
        panoCompareSplitMoveRafRef.current = window.requestAnimationFrame(() => {
          panoCompareSplitMoveRafRef.current = 0
          const p = panoCompareSplitPendingPctRef.current
          if (p != null) setPanoCompareSplitPct(p)
        })
      }
      const onUp = (ev: PointerEvent) => {
        if (!start || ev.pointerId !== start.pointerId) return
        const d = panoCompareSplitDragRef.current
        if (d?.captureEl && d.pointerId === ev.pointerId) {
          try {
            d.captureEl.releasePointerCapture(ev.pointerId)
          } catch {
            /* deja relache */
          }
        }
        if (panoCompareSplitMoveRafRef.current) {
          window.cancelAnimationFrame(panoCompareSplitMoveRafRef.current)
          panoCompareSplitMoveRafRef.current = 0
        }
        const p = panoCompareSplitPendingPctRef.current
        if (p != null) setPanoCompareSplitPct(p)
        panoCompareSplitPendingPctRef.current = null
        panoCompareSplitDragRef.current = null
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        document.removeEventListener('pointercancel', onUp)
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
      document.addEventListener('pointercancel', onUp)
    },
    [panoCompareSplitPct]
  )

  const filteredPanos = useMemo(() => {
    if (selectedFloor === 'ALL') return panosWithViewerContext
    return panosWithViewerContext.filter(
      pano => (panoFloorAssignments[pano.id] || '').trim() === selectedFloor
    )
  }, [panosWithViewerContext, panoFloorAssignments, selectedFloor])

  const spatialDataset = useMemo(
    () =>
      buildSpatialDatasetWithManualFloors(
        panosWithViewerColors.map(pano => ({
          id: pano.id,
          filename: pano.filename,
          displayLabel: pano.displayLabel,
          viewerColor: pano.viewerColor,
          position: pano.position,
        })),
        panoFloorAssignments,
        floorMapAssetsEffective
      ),
    [panosWithViewerColors, floorMapAssetsEffective, panoFloorAssignments]
  )

  useEffect(() => {
    if (!floorPlanDrawModalOpen || !floorPlanTargetAsset?.imageUrl) return
    const canvas = floorPlanDrawCanvasRef.current as
      | {
          width?: number
          height?: number
          backgroundImage?: unknown
          requestRenderAll?: () => void
          renderAll?: () => void
          add?: (obj: unknown) => void
          remove?: (obj: unknown) => void
        }
      | null
    if (!canvas) return
    let cancelled = false
    void (async () => {
      const img = await loadImageElement(floorPlanTargetAsset.imageUrl)
      if (cancelled || !img) return
      const fabricNs = (window as unknown as { fabric?: Record<string, unknown> }).fabric
      const FabricImageCtor = (fabricNs?.Image ?? fabricNs?.FabricImage) as
        | (new (el: HTMLImageElement, opts?: Record<string, unknown>) => DrawGuideObject)
        | undefined
      const CircleCtor = fabricNs?.Circle as
        | (new (opts?: Record<string, unknown>) => DrawGuideObject)
        | undefined
      if (!FabricImageCtor || !CircleCtor || !canvas.add || !canvas.remove) return

      for (const obj of floorPlanDrawGuideObjectsRef.current) {
        canvas.remove(obj)
      }
      floorPlanDrawGuideObjectsRef.current = []
      canvas.backgroundImage = undefined

      const floorLabel = floorPlanTargetAsset.floorLabel.trim()
      const nw = Math.max(1, img.naturalWidth || 1)
      const nh = Math.max(1, img.naturalHeight || 1)
      /** Même repère que l’init du canvas (capping 1800×1200) — pas les dimensions brutes de l’image. */
      const cw = Math.max(1, Number(canvas.width) || Math.max(500, Math.min(1800, nw)))
      const ch = Math.max(1, Number(canvas.height) || Math.max(360, Math.min(1200, nh)))
      if (!floorPlanDrawFinalPreview) {
        const bg = new FabricImageCtor(img, {
          left: 0,
          top: 0,
          originX: 'left',
          originY: 'top',
          selectable: false,
          evented: false,
          opacity: Math.max(0, Math.min(1, floorPlanDrawBaseOpacity / 100)),
          excludeFromExport: true,
          scaleX: cw / nw,
          scaleY: ch / nh,
        })
        canvas.backgroundImage = bg
        const panosOnFloor = panosWithViewerColors.filter(p => (panoFloorAssignments[p.id] || '').trim() === floorLabel)
        for (const pano of panosOnFloor) {
          const pct = worldXYToFloorMapPercentFromDataset(pano.position.x, pano.position.y, floorLabel, spatialDataset)
          if (!pct) continue
          const dot = new CircleCtor({
            left: (pct.xPct / 100) * (cw - 1),
            top: (pct.yPct / 100) * (ch - 1),
            radius: 5,
            originX: 'center',
            originY: 'center',
            fill: tryParseAnnotationColorHex(pano.viewerColor) ?? '#22d3ee',
            stroke: '#ffffff',
            strokeWidth: 1.4,
            selectable: false,
            evented: false,
            excludeFromExport: true,
          })
          ;(dot as DrawGuideObject)._etlDrawGuide = true
          canvas.add(dot)
          floorPlanDrawGuideObjectsRef.current.push(dot)
        }
      }
      canvas.requestRenderAll?.()
      canvas.renderAll?.()
    })()
    return () => {
      cancelled = true
    }
  }, [
    floorPlanDrawModalOpen,
    floorPlanTargetAsset,
    floorPlanDrawBaseOpacity,
    floorPlanDrawFinalPreview,
    floorPlanDrawCanvasReadyTick,
    panosWithViewerColors,
    panoFloorAssignments,
    spatialDataset,
  ])

  useEffect(() => {
    if (!floorPlanDrawModalOpen || floorPlanDrawFinalPreview) return
    const timer = window.setInterval(() => {
      const canvas = floorPlanDrawCanvasRef.current as { backgroundImage?: unknown } | null
      if (!canvas) return
      if (!canvas.backgroundImage) {
        setFloorPlanDrawCanvasReadyTick(v => v + 1)
      }
    }, 350)
    return () => window.clearInterval(timer)
  }, [floorPlanDrawModalOpen, floorPlanDrawFinalPreview])

  useEffect(() => {
    if (!floorPlanDrawModalOpen) return
    const container = floorPlanDrawContainerRef.current
    if (!container) return
    const wrapper = container.querySelector('[data-fabric="wrapper"]') as HTMLElement | null
    const FabricDrawing = (
      window as unknown as {
        FabricDrawing?: { redrawGridIntensity?: (wrapper: HTMLElement, intensity: number) => void }
      }
    ).FabricDrawing
    if (!wrapper || !FabricDrawing?.redrawGridIntensity) return
    const gridInput = document.getElementById('gridIntensity') as HTMLInputElement | null
    const raw = Number(gridInput?.value ?? 50)
    const base = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw / 100)) : 0.5
    FabricDrawing.redrawGridIntensity(wrapper, floorPlanDrawFinalPreview ? 0 : base)
  }, [floorPlanDrawModalOpen, floorPlanDrawFinalPreview, floorPlanDrawCanvasReadyTick])

  useEffect(() => {
    if (!floorPlanDrawModalOpen) return
    const colorEl = document.getElementById('lineStrokeColor') as HTMLInputElement | null
    const widthEl = document.getElementById('strokeWidth') as HTMLInputElement | null
    if (colorEl) {
      colorEl.value = floorPlanDrawStrokeColor
      colorEl.dispatchEvent(new Event('input', { bubbles: true }))
      colorEl.dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (widthEl) {
      widthEl.value = String(floorPlanDrawStrokeWidth)
      widthEl.dispatchEvent(new Event('input', { bubbles: true }))
      widthEl.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }, [floorPlanDrawModalOpen, floorPlanDrawCanvasReadyTick, floorPlanDrawStrokeColor, floorPlanDrawStrokeWidth])

  const floorAnnotationMarkers = useMemo<ETLFloorAnnotationMarker[]>(() => {
    const panoById = new Map(panosWithViewerColors.map(p => [p.id, p]))
    const out: ETLFloorAnnotationMarker[] = []
    for (const ann of annotations) {
      const pano = panoById.get(ann.panoId)
      if (!pano) continue
      const annFloor = (panoFloorAssignments[ann.panoId] || '').trim()
      if (!annFloor) continue
      if (selectedFloor !== 'ALL' && annFloor !== selectedFloor) continue
      const wx = ann.pointCloudTarget && Number.isFinite(ann.pointCloudTarget.x) ? ann.pointCloudTarget.x : pano.position.x
      const usesSourceXY = annotationUsesSourceWorldHorizontalXY(ann)
      const wy =
        ann.pointCloudTarget && Number.isFinite(usesSourceXY ? ann.pointCloudTarget.y : ann.pointCloudTarget.z)
          ? usesSourceXY
            ? ann.pointCloudTarget.y
            : ann.pointCloudTarget.z
          : pano.position.y
      if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue
      const pct = worldXYToFloorMapPercentFromDataset(wx, wy, annFloor, spatialDataset)
      if (!pct) continue
      out.push({
        id: ann.id,
        label: ann.identifier?.trim() || ann.label || ann.id,
        panoId: ann.panoId,
        floorLabel: annFloor,
        xPct: pct.xPct,
        yPct: pct.yPct,
        colorHex: annotationRecordColor(ann, userTemplates),
        markerTextureCss: annotationOriginMarkerTextureCss(annotationOrigin(ann)),
        markerOrigin: annotationOrigin(ann),
        isSelected: ann.id === selectedAnnotationId,
      })
    }
    return out
  }, [annotations, panosWithViewerColors, panoFloorAssignments, selectedFloor, spatialDataset, userTemplates, selectedAnnotationId])

  const floorPlanImportTargetPanoDots = useMemo(() => {
    const floorLabel = floorPlanTargetAsset?.floorLabel?.trim() || ''
    if (!floorLabel) return [] as Array<{ panoId: string; xPct: number; yPct: number; colorHex: string }>
    return panosWithViewerColors
      .filter(p => (panoFloorAssignments[p.id] || '').trim() === floorLabel)
      .map(p => {
        const pct = worldXYToFloorMapPercentFromDataset(p.position.x, p.position.y, floorLabel, spatialDataset)
        if (!pct) return null
        return {
          panoId: p.id,
          xPct: pct.xPct,
          yPct: pct.yPct,
          colorHex: tryParseAnnotationColorHex(p.viewerColor) ?? '#22d3ee',
        }
      })
      .filter((v): v is { panoId: string; xPct: number; yPct: number; colorHex: string } => !!v)
  }, [floorPlanTargetAsset, panosWithViewerColors, panoFloorAssignments, spatialDataset])

  // Keep ref in sync so the Fabric init effect (declared before this useMemo) can read the latest value
  floorPlanImportTargetPanoDotsRef.current = floorPlanImportTargetPanoDots

  const moveAnnotationFromFloorMap = useCallback(
    (annotationId: string, floorLabel: string, xPct: number, yPct: number) => {
      if (clientMode) return
      const world = floorMapPercentToWorldXYFromDataset(xPct, yPct, floorLabel, spatialDataset)
      if (!world) return
      const panoById = new Map(panosWithViewerColors.map(p => [p.id, p] as const))
      setAnnotations(prev =>
        prev.map(ann => {
          if (ann.id !== annotationId) return ann
          const pano = panoById.get(ann.panoId)
          if (!pano) return ann
          const base = ann.pointCloudTarget
          const usesSourceXY = annotationUsesSourceWorldHorizontalXY(ann)
          const rawPanoPos = panoRawSourcePositionFromE57DevAdjustedPosition(pano.position, e57DevViewerAxesXzy)
          const panoViewerAlt = sourceWorldToViewerPosition(rawPanoPos).y
          let nextTarget: { x: number; y: number; z: number }
          if (usesSourceXY) {
            const zEff =
              base && Number.isFinite(base.x) && Number.isFinite(base.y) && Number.isFinite(base.z)
                ? panoSourcePositionForE57DevAxesXzy(
                    { x: base.x, y: base.y, z: base.z },
                    e57DevViewerAxesXzy
                  ).z
                : base && Number.isFinite(base.z)
                  ? base.z
                  : pano.position.z
            const eff = { x: world.x, y: world.y, z: zEff }
            nextTarget = panoRawSourcePositionFromE57DevAdjustedPosition(eff, e57DevViewerAxesXzy)
          } else {
            const vy = base && Number.isFinite(base.y) ? base.y : panoViewerAlt
            const adjSource = viewerWorldToSourcePosition({ x: world.x, y: vy, z: world.y })
            const rawSource = panoRawSourcePositionFromE57DevAdjustedPosition(adjSource, e57DevViewerAxesXzy)
            nextTarget = sourceWorldToViewerPosition(rawSource)
          }
          return { ...ann, pointCloudTarget: nextTarget, pointCloudTargetLocked: true }
        })
      )
      setSelectedAnnotationId(annotationId)
    },
    [panosWithViewerColors, spatialDataset, clientMode, e57DevViewerAxesXzy]
  )

  const movePanoFromFloorMap = useCallback(
    (panoId: string, floorLabel: string, xPct: number, yPct: number) => {
      if (clientMode) return
      const world = floorMapPercentToWorldXYFromDataset(xPct, yPct, floorLabel, spatialDataset)
      if (!world) return
      const zEff = panosWithViewerColors.find(pp => pp.id === panoId)?.position.z
      setPanos(prev =>
        prev.map(p => {
          if (p.id !== panoId) return p
          const eff = { x: world.x, y: world.y, z: zEff ?? p.position.z }
          const rawPos = panoRawSourcePositionFromE57DevAdjustedPosition(eff, e57DevViewerAxesXzy)
          return { ...p, position: rawPos }
        })
      )
      if (lowCostMode) {
        setLowCostPanos(prev => {
          const idx = prev.findIndex(lp => lp.id === panoId)
          if (idx < 0) return prev
          const next = prev.map((lp, i) => {
            if (i !== idx) return lp
            const effZ = zEff ?? lp.positionWorld.z
            const rawWorld = panoRawSourcePositionFromE57DevAdjustedPosition(
              { x: world.x, y: world.y, z: effZ },
              e57DevViewerAxesXzy
            )
            return { ...lp, positionWorld: rawWorld }
          })
          persistLowCostProject({
            floorCount: lowCostFloorCount,
            sliceCenters: lowCostSliceCenters,
            panos: next,
            floorVisuals: lowCostFloorVisuals,
            hasCloud: Boolean(e57SourcePositionsRef.current),
          })
          return next
        })
      }
    },
    [
      spatialDataset,
      lowCostMode,
      lowCostFloorCount,
      lowCostSliceCenters,
      lowCostFloorVisuals,
      persistLowCostProject,
      e57SourcePositionsRef,
      clientMode,
      panosWithViewerColors,
      e57DevViewerAxesXzy,
    ]
  )

  const assignPanoFloorForCurrentPano = useCallback(
    (newFloor: string) => {
      if (!currentPanoId) return
      const fl = newFloor.trim()
      if (lowCostMode) {
        if (!fl) {
          addToast({ type: 'warning', title: 'Étage', message: 'Choisissez un étage pour ce panorama.', duration: 2400 })
          return
        }
        const fa = floorMapAssetsEffective.find(a => a.floorLabel === fl)
        const alt = fa?.floorAltitude ?? 0
        setLowCostPanos(prev => {
          const idx = prev.findIndex(p => p.id === currentPanoId)
          if (idx < 0) return prev
          const next = prev.map((p, i) =>
            i === idx ? { ...p, assignedFloorLabel: fl, positionWorld: { ...p.positionWorld, z: alt } } : p
          )
          persistLowCostProject({
            floorCount: lowCostFloorCount,
            sliceCenters: lowCostSliceCenters,
            panos: next,
            floorVisuals: lowCostFloorVisuals,
            hasCloud: Boolean(e57SourcePositionsRef.current),
          })
          return next
        })
        setPanoFloorAssignments(prev => ({ ...prev, [currentPanoId]: fl }))
        setPanos(prev => {
          const j = prev.findIndex(p => p.id === currentPanoId)
          if (j < 0) return prev
          return prev.map((p, k) => (k === j ? { ...p, position: { ...p.position, z: alt } } : p))
        })
        return
      }
      if (fl) {
        setPanoFloorAssignments(prev => ({ ...prev, [currentPanoId]: fl }))
      } else {
        setPanoFloorAssignments(prev => {
          const n = { ...prev }
          delete n[currentPanoId]
          return n
        })
      }
    },
    [
      currentPanoId,
      lowCostMode,
      floorMapAssetsEffective,
      lowCostFloorCount,
      lowCostSliceCenters,
      lowCostFloorVisuals,
      persistLowCostProject,
      e57SourcePositionsRef,
      addToast,
    ]
  )

  const resetAnnotationPositionFromFloorMap = useCallback((annotationId: string) => {
    if (clientMode) return
    setAnnotations(prev =>
      prev.map(ann =>
        ann.id === annotationId ? { ...ann, pointCloudTarget: undefined, pointCloudTargetLocked: undefined } : ann
      )
    )
    setSelectedAnnotationId(annotationId)
  }, [clientMode])

  const floorLabels = useMemo(() => {
    const fromPlans = floorMapAssets.map(a => a.floorLabel)
    const fromAssign = Object.values(panoFloorAssignments).map(s => s.trim()).filter(Boolean)
    const labels = Array.from(new Set([...fromPlans, ...fromAssign]))
    const rankByLabel = new Map<string, number>()
    floorMapAssets.forEach(asset => {
      if (!asset.floorLabel) return
      if (asset.floorOrder === undefined || asset.floorOrder === null) return
      const prev = rankByLabel.get(asset.floorLabel)
      if (prev === undefined || asset.floorOrder < prev) {
        rankByLabel.set(asset.floorLabel, asset.floorOrder)
      }
    })
    return labels.sort((a, b) => {
      const ra = rankByLabel.get(a)
      const rb = rankByLabel.get(b)
      if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb
      if (ra !== undefined && rb === undefined) return -1
      if (ra === undefined && rb !== undefined) return 1
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    })
  }, [floorMapAssets, panoFloorAssignments])
  const floorRenameCandidates = useMemo(
    () => floorLabels.filter(l => l.trim() && l.trim().toLowerCase() !== 'non assigne'),
    [floorLabels]
  )

  const panoramaAnnotationGroups = useMemo(() => {
    const panoById = new Map(panosWithViewerContext.map(p => [p.id, p]))
    const floorRank = new Map(floorLabels.map((label, i) => [label, i]))
    const rows = annotations
      .map(ann => {
        const pano = panoById.get(ann.panoId)
        const floorLabel = (panoFloorAssignments[ann.panoId] || pano?.floorLabel || '').trim() || 'Non assigne'
        const templateLabel =
          resolvedTemplateLabel(ann, userTemplates) ||
          (ann.userTemplateId ? 'Gabarit perso' : ann.templateId ? ann.templateId : 'Sans gabarit')
        const ident = (ann.identifier || ann.label || ann.id).trim()
        const panoLabel = pano?.displayLabel?.trim() || pano?.filename || ann.panoId
        const colorHex = annotationRecordColor(ann, userTemplates)
        return { ann, floorLabel, templateLabel, ident, panoLabel, colorHex }
      })
      .sort((a, b) => {
        const ra = floorRank.has(a.floorLabel) ? (floorRank.get(a.floorLabel) as number) : Number.MAX_SAFE_INTEGER
        const rb = floorRank.has(b.floorLabel) ? (floorRank.get(b.floorLabel) as number) : Number.MAX_SAFE_INTEGER
        if (ra !== rb) return ra - rb
        const tf = a.templateLabel.localeCompare(b.templateLabel, undefined, { sensitivity: 'base', numeric: true })
        if (tf !== 0) return tf
        return a.ident.localeCompare(b.ident, undefined, { sensitivity: 'base', numeric: true })
      })

    const floorGroups: Array<{
      floorLabel: string
      templates: Array<{
        templateLabel: string
        /** Couleur du gabarit (première annotation du groupe). */
        templateColorHex: string
        items: typeof rows
      }>
    }> = []

    for (const row of rows) {
      let floor = floorGroups[floorGroups.length - 1]
      if (!floor || floor.floorLabel !== row.floorLabel) {
        floor = { floorLabel: row.floorLabel, templates: [] }
        floorGroups.push(floor)
      }
      const tpl = floor.templates[floor.templates.length - 1]
      if (!tpl || tpl.templateLabel !== row.templateLabel) {
        floor.templates.push({
          templateLabel: row.templateLabel,
          templateColorHex: row.colorHex,
          items: [row],
        })
      } else {
        tpl.items.push(row)
      }
    }
    return floorGroups
  }, [annotations, panosWithViewerContext, panoFloorAssignments, floorLabels, userTemplates])

  const annPanelTypography = useMemo(() => {
    const apw = panoAnnotationPanel.width
    return {
      titleSz: apw < 168 ? 'text-[9px]' : apw < 220 ? 'text-[10px]' : 'text-[11px]',
      floorSz: apw < 168 ? 'text-[8px]' : apw < 220 ? 'text-[9px]' : 'text-[10px]',
      tplSz: apw < 168 ? 'text-[8px]' : apw < 220 ? 'text-[9px]' : 'text-[10px]',
      itemTitleSz: apw < 168 ? 'text-[8px]' : apw < 220 ? 'text-[9px]' : 'text-[10px]',
      itemSubSz: apw < 168 ? 'text-[7px]' : apw < 220 ? 'text-[8px]' : 'text-[9px]',
      padFloor: apw < 200 ? 'px-1 py-0.5' : 'px-2 py-1',
      padTpl: apw < 200 ? 'px-1 py-0.5' : 'px-1.5 py-1',
      padItem: apw < 200 ? 'px-1 py-0.5' : 'px-1.5 py-1',
      bodyPad: apw < 200 ? 4 : 8,
    }
  }, [panoAnnotationPanel.width])

  const panoMinimapPlanAreaHeightPx = useMemo(
    () =>
      Math.max(
        48,
        Math.round(
          panoMinimapWindow.width *
            (Number.isFinite(panoMinimapAspect) && panoMinimapAspect > 0.05 ? panoMinimapAspect : 0.7)
        )
      ),
    [panoMinimapWindow.width, panoMinimapAspect]
  )

  /** Cône d’orientation vue au centre du panorama, projeté sur le mini-plan (même étage que le panneau). */
  const panoMinimapViewOrientationOverlay = useMemo(() => {
    if (!panoMinimapDataUrl || !currentPano) return null
    const assign = (panoFloorAssignments[currentPano.id] || '').trim()
    if (assign !== panoMinimapFloorLabel.trim()) return null
    const m = panoMinimapMarkers.find(x => x.isCurrent)
    if (!m) return null
    const rot = panoHorizViewToMinimapConeRotationDeg(
      panoViewYawPitch.yaw,
      panoViewYawPitch.pitch,
      panoMinimapFloorLabel,
      spatialDataset,
      currentPano
    )
    if (rot === null) return null
    return { m, rot }
  }, [
    panoMinimapDataUrl,
    currentPano,
    panoFloorAssignments,
    panoMinimapFloorLabel,
    panoMinimapMarkers,
    panoViewYawPitch.yaw,
    panoViewYawPitch.pitch,
    spatialDataset,
  ])

  /** Plans issus de coupes E57 ; faux si les étages viennent des GeoTIFF du ZIP. */
  const floorPlansFromE57Slices = useMemo(
    () => floorMapAssets.length > 0 && floorMapAssets.every(a => a.sourceType === 'pointcloud-slice'),
    [floorMapAssets]
  )

  const canRemapFloors = !!e57Stats && panos.length > 0 && !loading && !e57Loading

  useEffect(() => {
    if (selectedFloor === 'ALL') return
    if (!floorLabels.includes(selectedFloor)) {
      setSelectedFloor('ALL')
    }
  }, [floorLabels, selectedFloor])

  /** Étages du haut vers le bas dans le sélecteur latéral (étages « supérieurs » en premier). */
  const panoMinimapFloorButtons = useMemo(() => [...floorLabels].reverse(), [floorLabels])

  useEffect(() => {
    panoMinimapWindowRef.current = panoMinimapWindow
  }, [panoMinimapWindow])

  useEffect(() => {
    panoAnnotationPanelRef.current = panoAnnotationPanel
  }, [panoAnnotationPanel])

  const clampAnnPanelFromViewport = useCallback((candidate: PanoAnnotationPanelState) => {
    const root = panoFsRootRef.current
    if (!root) return candidate
    return clampPanoAnnotationPanel(candidate, root.clientWidth, root.clientHeight)
  }, [])

  const startPanoAnnotationPanelDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    panoAnnotationPanelActionRef.current = {
      mode: 'drag',
      startX: e.clientX,
      startY: e.clientY,
      start: panoAnnotationPanelRef.current,
    }
  }, [])

  const startPanoAnnotationPanelResize = useCallback(
    (mode: 'resize-e' | 'resize-s' | 'resize-se') => (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      panoAnnotationPanelActionRef.current = {
        mode,
        startX: e.clientX,
        startY: e.clientY,
        start: panoAnnotationPanelRef.current,
      }
    },
    []
  )

  const clampMinimapFromViewport = useCallback(
    (candidate: PanoMinimapWindowState) => {
      const root = panoFsRootRef.current
      if (!root) return candidate
      return clampPanoMinimapWindow(candidate, root.clientWidth, root.clientHeight, panoMinimapAspect)
    },
    [panoMinimapAspect]
  )

  const startPanoMinimapDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    panoMinimapActionRef.current = {
      mode: 'drag',
      startX: e.clientX,
      startY: e.clientY,
      start: panoMinimapWindowRef.current,
    }
  }, [])

  const startPanoMinimapResize = useCallback((e: React.PointerEvent<HTMLDivElement>, mode: 'resize-se' | 'resize-e' | 'resize-s') => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    panoMinimapActionRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      start: panoMinimapWindowRef.current,
    }
  }, [])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const action = panoMinimapActionRef.current
      if (!action) return
      const dx = e.clientX - action.startX
      const dy = e.clientY - action.startY
      const asp = Number.isFinite(panoMinimapAspect) && panoMinimapAspect > 0.05 ? panoMinimapAspect : 0.7
      let raw: PanoMinimapWindowState
      if (action.mode === 'drag') {
        raw = { ...action.start, x: action.start.x + dx, y: action.start.y + dy }
      } else if (action.mode === 'resize-e') {
        raw = { ...action.start, width: action.start.width + dx }
      } else if (action.mode === 'resize-s') {
        raw = { ...action.start, width: action.start.width + dy / asp }
      } else {
        raw = { ...action.start, width: action.start.width + dx }
      }
      const clamped = clampMinimapFromViewport(raw)
      panoMinimapUserPlacedRef.current = true
      setPanoMinimapWindow(clamped)
    }
    const onUp = () => {
      panoMinimapActionRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [clampMinimapFromViewport, panoMinimapAspect])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const action = panoAnnotationPanelActionRef.current
      if (!action) return
      const dx = e.clientX - action.startX
      const dy = e.clientY - action.startY
      const s = action.start
      let raw: PanoAnnotationPanelState
      if (action.mode === 'drag') {
        raw = { ...s, x: s.x + dx, y: s.y + dy }
      } else if (action.mode === 'resize-e') {
        raw = { ...s, width: s.width + dx, height: s.height }
      } else if (action.mode === 'resize-s') {
        raw = { ...s, width: s.width, height: s.height + dy }
      } else {
        raw = { ...s, width: s.width + dx, height: s.height + dy }
      }
      setPanoAnnotationPanel(clampAnnPanelFromViewport(raw))
    }
    const onUp = () => {
      panoAnnotationPanelActionRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [clampAnnPanelFromViewport])

  useEffect(() => {
    const root = panoFsRootRef.current
    if (!root) return
    const update = () => {
      setPanoMinimapWindow(prev => {
        let next = clampPanoMinimapWindow(prev, root.clientWidth, root.clientHeight, panoMinimapAspect)
        if (!panoMinimapUserPlacedRef.current) {
          const panelH = PANO_MINIMAP_HEADER_HEIGHT + next.width * panoMinimapAspect
          next = clampPanoMinimapWindow(
            {
              ...next,
              x: root.clientWidth - next.width - 44,
              y: root.clientHeight - panelH - 12,
            },
            root.clientWidth,
            root.clientHeight,
            panoMinimapAspect
          )
        }
        return next
      })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(root)
    return () => ro.disconnect()
  }, [panoFsActive, panoMinimapAspect])

  useEffect(() => {
    const root = panoFsRootRef.current
    if (!root) return
    const update = () => {
      setPanoAnnotationPanel(prev => clampPanoAnnotationPanel(prev, root.clientWidth, root.clientHeight))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(root)
    return () => ro.disconnect()
  }, [panoFsActive])

  const unlockPanoMinimapPageScroll = useCallback(() => {
    if (panoMinimapWheelBodyOverflowRef.current === null) return
    document.body.style.overflow = panoMinimapWheelBodyOverflowRef.current
    panoMinimapWheelBodyOverflowRef.current = null
  }, [])

  const lockPanoMinimapPageScroll = useCallback(() => {
    if (panoMinimapWheelBodyOverflowRef.current !== null) return
    panoMinimapWheelBodyOverflowRef.current = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }, [])

  useEffect(() => {
    setPanoMinimapViewScale(1)
    setPanoMinimapViewOffset({ x: 0, y: 0 })
  }, [panoMinimapDataUrl, panoMinimapFloorLabel])

  const handlePanoMinimapViewportWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const factor = event.deltaY > 0 ? 0.9 : 1.1
      setPanoMinimapViewScale(prev =>
        Math.max(PANO_MINIMAP_VIEW_MIN_SCALE, Math.min(PANO_MINIMAP_VIEW_MAX_SCALE, prev * factor))
      )
      lockPanoMinimapPageScroll()
      if (panoMinimapWheelUnlockTimerRef.current !== null) window.clearTimeout(panoMinimapWheelUnlockTimerRef.current)
      panoMinimapWheelUnlockTimerRef.current = window.setTimeout(() => {
        unlockPanoMinimapPageScroll()
        panoMinimapWheelUnlockTimerRef.current = null
      }, 350)
    },
    [lockPanoMinimapPageScroll, unlockPanoMinimapPageScroll]
  )

  useEffect(() => {
    const el = panoMinimapViewportRef.current
    if (!el || !panoMinimapDataUrl) return
    const onWheel = (e: WheelEvent) => handlePanoMinimapViewportWheel(e)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [panoMinimapDataUrl, handlePanoMinimapViewportWheel])

  useEffect(() => {
    return () => {
      if (panoMinimapWheelUnlockTimerRef.current !== null) {
        window.clearTimeout(panoMinimapWheelUnlockTimerRef.current)
      }
      unlockPanoMinimapPageScroll()
    }
  }, [unlockPanoMinimapPageScroll])

  const resetPanoMinimapPlanView = useCallback(() => {
    setPanoMinimapViewScale(1)
    setPanoMinimapViewOffset({ x: 0, y: 0 })
  }, [])

  const panoMinimapPointerClientToPlanPct = useCallback(
    (clientX: number, clientY: number): { xPct: number; yPct: number } | null => {
      const el = panoMinimapViewportRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      if (rect.width <= 1 || rect.height <= 1) return null
      const lx = clientX - rect.left
      const ly = clientY - rect.top
      const cx = rect.width / 2
      const cy = rect.height / 2
      const baseX = cx + (lx - panoMinimapViewOffset.x - cx) / Math.max(panoMinimapViewScale, 1e-6)
      const baseY = cy + (ly - panoMinimapViewOffset.y - cy) / Math.max(panoMinimapViewScale, 1e-6)
      return {
        xPct: Math.max(0, Math.min(100, (baseX / rect.width) * 100)),
        yPct: Math.max(0, Math.min(100, (baseY / rect.height) * 100)),
      }
    },
    [panoMinimapViewOffset.x, panoMinimapViewOffset.y, panoMinimapViewScale]
  )

  const handlePanoMinimapViewPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const el = panoMinimapViewportRef.current
      if (!el) return
      if (panoMinimapAnnContextMenu) setPanoMinimapAnnContextMenu(null)
      const t = event.target as HTMLElement | null
      if (t?.closest('button')) return
      if (event.button === 1) {
        event.preventDefault()
        el.setPointerCapture(event.pointerId)
        setPanoMinimapMiddleZoom({ active: true, y: event.clientY, baseScale: panoMinimapViewScale })
        lockPanoMinimapPageScroll()
        return
      }
      if (event.button !== 0) return
      event.preventDefault()
      el.setPointerCapture(event.pointerId)
      setPanoMinimapViewDrag({
        active: true,
        x: event.clientX,
        y: event.clientY,
        baseX: panoMinimapViewOffset.x,
        baseY: panoMinimapViewOffset.y,
      })
    },
    [panoMinimapAnnContextMenu, panoMinimapViewOffset.x, panoMinimapViewOffset.y, panoMinimapViewScale, lockPanoMinimapPageScroll]
  )

  const handlePanoMinimapViewPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (panoMinimapPanoDrag && event.pointerId === panoMinimapPanoDrag.pointerId) {
        const dist = Math.hypot(
          event.clientX - panoMinimapPanoDrag.startClientX,
          event.clientY - panoMinimapPanoDrag.startClientY
        )
        const shouldMove = panoMinimapPanoDrag.moved || dist > 7
        if (!shouldMove) return
        event.preventDefault()
        const pct = panoMinimapPointerClientToPlanPct(event.clientX, event.clientY)
        if (!pct) return
        const el = panoMinimapViewportRef.current
        if (el && !panoMinimapPanoDrag.captured) {
          el.setPointerCapture(event.pointerId)
        }
        setPanoMinimapPanoDrag(prev =>
          prev && prev.pointerId === event.pointerId
            ? { ...prev, moved: true, captured: true, xPct: pct.xPct, yPct: pct.yPct }
            : prev
        )
        return
      }
      if (panoMinimapAnnotationDrag && event.pointerId === panoMinimapAnnotationDrag.pointerId) {
        const dist = Math.hypot(
          event.clientX - panoMinimapAnnotationDrag.startClientX,
          event.clientY - panoMinimapAnnotationDrag.startClientY
        )
        const shouldMove = panoMinimapAnnotationDrag.moved || dist > 7
        if (!shouldMove) return
        event.preventDefault()
        const pct = panoMinimapPointerClientToPlanPct(event.clientX, event.clientY)
        if (!pct) return
        const el = panoMinimapViewportRef.current
        if (el && !panoMinimapAnnotationDrag.captured) {
          el.setPointerCapture(event.pointerId)
        }
        setPanoMinimapAnnotationDrag(prev =>
          prev && prev.pointerId === event.pointerId
            ? { ...prev, moved: true, captured: true, xPct: pct.xPct, yPct: pct.yPct }
            : prev
        )
        return
      }
      if (panoMinimapMiddleZoom.active) {
        event.preventDefault()
        const dy = panoMinimapMiddleZoom.y - event.clientY
        const factor = 1 + dy * 0.008
        setPanoMinimapViewScale(
          Math.max(
            PANO_MINIMAP_VIEW_MIN_SCALE,
            Math.min(PANO_MINIMAP_VIEW_MAX_SCALE, panoMinimapMiddleZoom.baseScale * Math.max(factor, 0.05))
          )
        )
        return
      }
      if (!panoMinimapViewDrag.active) return
      const dx = event.clientX - panoMinimapViewDrag.x
      const dy = event.clientY - panoMinimapViewDrag.y
      setPanoMinimapViewOffset({ x: panoMinimapViewDrag.baseX + dx, y: panoMinimapViewDrag.baseY + dy })
    },
    [panoMinimapPanoDrag, panoMinimapAnnotationDrag, panoMinimapMiddleZoom, panoMinimapViewDrag, panoMinimapPointerClientToPlanPct]
  )

  const handlePanoMinimapViewPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const el = panoMinimapViewportRef.current
      if (el?.hasPointerCapture(event.pointerId)) {
        el.releasePointerCapture(event.pointerId)
      }
      if (panoMinimapPanoDrag && event.pointerId === panoMinimapPanoDrag.pointerId) {
        if (panoMinimapPanoDrag.moved) {
          movePanoFromFloorMap(
            panoMinimapPanoDrag.panoId,
            panoMinimapFloorLabel,
            panoMinimapPanoDrag.xPct,
            panoMinimapPanoDrag.yPct
          )
          panoMinimapSuppressPanoClickRef.current = panoMinimapPanoDrag.panoId
        }
        setPanoMinimapPanoDrag(null)
        return
      }
      if (panoMinimapAnnotationDrag && event.pointerId === panoMinimapAnnotationDrag.pointerId) {
        if (panoMinimapAnnotationDrag.moved) {
          moveAnnotationFromFloorMap(
            panoMinimapAnnotationDrag.annotationId,
            panoMinimapFloorLabel,
            panoMinimapAnnotationDrag.xPct,
            panoMinimapAnnotationDrag.yPct
          )
          panoMinimapSuppressAnnClickRef.current = panoMinimapAnnotationDrag.annotationId
        }
        setPanoMinimapAnnotationDrag(null)
        return
      }
      setPanoMinimapViewDrag(prev => ({ ...prev, active: false }))
      if (panoMinimapMiddleZoom.active) {
        setPanoMinimapMiddleZoom(prev => ({ ...prev, active: false }))
        unlockPanoMinimapPageScroll()
      }
    },
    [
      movePanoFromFloorMap,
      moveAnnotationFromFloorMap,
      panoMinimapPanoDrag,
      panoMinimapAnnotationDrag,
      panoMinimapFloorLabel,
      panoMinimapMiddleZoom.active,
      unlockPanoMinimapPageScroll,
    ]
  )

  useEffect(() => {
    if (!currentPanoId) return
    panoMinimapUserOverrideRef.current = false
    panoMinimapUserPlacedRef.current = false
  }, [currentPanoId])

  useEffect(() => {
    if (!currentPanoId || floorLabels.length === 0) return
    if (panoMinimapUserOverrideRef.current) return
    const fl = (panoFloorAssignments[currentPanoId] || '').trim()
    if (fl && floorLabels.includes(fl)) setPanoMinimapFloorLabel(fl)
    else setPanoMinimapFloorLabel(floorLabels[0])
  }, [currentPanoId, panoFloorAssignments, floorLabels])

  useEffect(() => {
    if (!currentPano || !panoMinimapFloorLabel || floorMapAssetsEffective.length === 0) {
      setPanoMinimapDataUrl(null)
      setPanoMinimapMarkers([])
      setPanoMinimapAnnotationMarkers([])
      setPanoMinimapLoadError(false)
      return
    }
    const asset = floorMapAssetsEffective.find(a => a.floorLabel === panoMinimapFloorLabel)
    if (!asset?.imageUrl) {
      setPanoMinimapDataUrl(null)
      setPanoMinimapMarkers([])
      setPanoMinimapAnnotationMarkers([])
      setPanoMinimapLoadError(true)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        setPanoMinimapLoadError(false)
        const img = await loadImageElementForPdf(asset.imageUrl)
        if (cancelled) return
        if (!img) {
          setPanoMinimapDataUrl(null)
          setPanoMinimapMarkers([])
          setPanoMinimapAnnotationMarkers([])
          setPanoMinimapLoadError(true)
          return
        }
        if (img.naturalWidth > 1 && img.naturalHeight > 1) {
          setPanoMinimapAspect(img.naturalHeight / img.naturalWidth)
        }
        const floorMarkers: FloorPlanMarker[] = panosWithViewerColors
          .filter(p => (panoFloorAssignments[p.id] || '').trim() === panoMinimapFloorLabel)
          .map(p => {
            const pct = worldXYToFloorMapPercentFromDataset(
              p.position.x,
              p.position.y,
              panoMinimapFloorLabel,
              spatialDataset
            )
            if (!pct) return null
            const cHex = tryParseAnnotationColorHex(p.viewerColor) ?? '#64748b'
            return {
              panoId: p.id,
              panoLabel: p.displayLabel?.trim() || p.filename || p.id,
              xPct: pct.xPct,
              yPct: pct.yPct,
              rgb: annotationHexToRgb255(cHex),
              isCurrent: p.id === currentPano.id,
            } as FloorPlanMarker
          })
          .filter((m): m is FloorPlanMarker => !!m)
        const dataUrl =
          floorMarkers.length > 0
            ? rasterizeFloorPlanWithPanoMarkers(img, floorMarkers, 360, 0.9)
            : rasterizeFloorPlanImageOnly(img, 360, 0.9)
        const panoById = new Map(panosWithViewerColors.map(p => [p.id, p]))
        const annMarkers: FloorPlanAnnotationMarker[] = annotations
          .filter(ann => (panoFloorAssignments[ann.panoId] || '').trim() === panoMinimapFloorLabel)
          .map(ann => {
            const pano = panoById.get(ann.panoId)
            if (!pano) return null
            const wx = ann.pointCloudTarget && Number.isFinite(ann.pointCloudTarget.x) ? ann.pointCloudTarget.x : pano.position.x
            const usesSourceXY = annotationUsesSourceWorldHorizontalXY(ann)
            const wy =
              ann.pointCloudTarget &&
              Number.isFinite(usesSourceXY ? ann.pointCloudTarget.y : ann.pointCloudTarget.z)
                ? usesSourceXY
                  ? ann.pointCloudTarget.y
                  : ann.pointCloudTarget.z
                : pano.position.y
            if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null
            const pct = worldXYToFloorMapPercentFromDataset(wx, wy, panoMinimapFloorLabel, spatialDataset)
            if (!pct) return null
            return {
              annotationId: ann.id,
              annotationLabel: ann.identifier?.trim() || ann.label || ann.id,
              panoId: ann.panoId,
              xPct: pct.xPct,
              yPct: pct.yPct,
              colorHex: annotationRecordColor(ann, userTemplates),
              markerTextureCss: annotationOriginMarkerTextureCss(annotationOrigin(ann)),
              markerOrigin: annotationOrigin(ann),
              isSelected: ann.id === selectedAnnotationId,
            } as FloorPlanAnnotationMarker
          })
          .filter((m): m is FloorPlanAnnotationMarker => !!m)
        setPanoMinimapDataUrl(dataUrl)
        setPanoMinimapMarkers(floorMarkers)
        setPanoMinimapAnnotationMarkers(annMarkers)
      } catch {
        if (!cancelled) {
          setPanoMinimapDataUrl(null)
          setPanoMinimapMarkers([])
          setPanoMinimapAnnotationMarkers([])
          setPanoMinimapLoadError(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    currentPano,
    panoMinimapFloorLabel,
    floorMapAssetsEffective,
    spatialDataset,
    panosWithViewerColors,
    panoFloorAssignments,
    annotations,
    userTemplates,
    selectedAnnotationId,
  ])

  // Synchroniser l'étage affiché uniquement quand le panorama actif change (pas quand l'utilisateur change le plan manuellement).
  useEffect(() => {
    if (!currentPanoId) return
    const fl = (panoFloorAssignments[currentPanoId] || '').trim()
    if (!fl) return
    setSelectedFloor(fl)
  }, [currentPanoId, panoFloorAssignments])

  const panoDisplay = (p: PanoRecord) => p.displayLabel?.trim() || p.filename

  useEffect(() => {
    if (!panoDebugXyzEnabled) {
      setPanoDebugCursorYp(null)
      setPanoDebugHoverAnn(null)
      setPanoDebugHoverNeighbor(null)
    }
  }, [panoDebugXyzEnabled])

  const panoDebugHudDisplay = useMemo(() => {
    if (!panoDebugXyzEnabled) return null
    const viewer = e57ViewerRef.current
    const pano = currentPano
    if (panoDebugHoverAnn && pano) {
      const yp = annotationFocusYawPitch(panoDebugHoverAnn)
      const xyz = debugAnnotationToCloudXyz(panoDebugHoverAnn, pano, viewer)
      return {
        heading: 'Annotation',
        sub: panoDebugHoverAnn.identifier || panoDebugHoverAnn.label || panoDebugHoverAnn.id,
        lines: [formatYawPitchDebugLine(yp), formatXyzCloudDebugLine(xyz)],
      }
    }
    if (panoDebugHoverNeighbor && pano) {
      const nb = panoDebugHoverNeighbor
      const panoViewerPos = sourceWorldToViewerPosition(pano.position)
      const neighborViewerPos = sourceWorldToViewerPosition(nb.position)
      const dx = neighborViewerPos.x - panoViewerPos.x
      const dy = neighborViewerPos.y - panoViewerPos.y
      const dz = neighborViewerPos.z - panoViewerPos.z
      const yp = worldOffsetToPanoMarkerYawPitch(
        dx,
        dy,
        dz,
        pano
      )
      const xyz = yp && viewer ? viewer.projectPanoramaRayToPointCloud(pano, yp) : null
      const quatLines = buildNeighborQuaternionDebugLines(pano, nb)
      return {
        heading: 'Pano voisin (triangle)',
        sub: panoDisplay(nb) || nb.id,
        lines: [formatYawPitchDebugLine(yp), formatXyzCloudDebugLine(xyz), ...quatLines],
      }
    }
    if (panoDebugCursorYp && pano) {
      const xyz = viewer ? viewer.projectPanoramaRayToPointCloud(pano, panoDebugCursorYp) : null
      return {
        heading: 'Curseur (vue 360)',
        sub: null,
        lines: [formatYawPitchDebugLine(panoDebugCursorYp), formatXyzCloudDebugLine(xyz)],
      }
    }
    return null
  }, [
    panoDebugXyzEnabled,
    panoDebugHoverAnn,
    panoDebugHoverNeighbor,
    panoDebugCursorYp,
    currentPano,
    e57Stats,
  ])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(userTemplatesStorageKey(projectCodeForStorage))
      if (!raw) {
        setUserTemplates([])
        return
      }
      setUserTemplates(parseUserTemplatesFromStorage(raw))
    } catch {
      setUserTemplates([])
    }
  }, [projectCodeForStorage])

  useEffect(() => {
    try {
      localStorage.setItem(
        userTemplatesStorageKey(projectCodeForStorage),
        JSON.stringify({ schema: ETL360_USER_TEMPLATES_SCHEMA, templates: userTemplates })
      )
    } catch {
      /* quota */
    }
  }, [projectCodeForStorage, userTemplates])

  useEffect(() => {
    try {
      setRecentTemplateChoiceKeys(
        parseRecentTemplateChoicesJson(
          typeof localStorage !== 'undefined'
            ? localStorage.getItem(recentTemplateChoicesStorageKey(projectCodeForStorage))
            : null
        )
      )
    } catch {
      setRecentTemplateChoiceKeys([])
    }
  }, [projectCodeForStorage])

  const bumpRecentTemplateChoice = useCallback(
    (pick: string) => {
      const p = pick.trim()
      if (!p) return
      setRecentTemplateChoiceKeys(prev => {
        const next = bumpRecentTemplateChoices(prev, p)
        try {
          localStorage.setItem(
            recentTemplateChoicesStorageKey(projectCodeForStorage),
            JSON.stringify(next)
          )
        } catch {
          /* quota */
        }
        return next
      })
    },
    [projectCodeForStorage]
  )

  const resetNewUserTplForm = () => {
    setEditingUserTemplateId(null)
    setNewUserTplName('')
    setNewUserTplColor(ETL360_DEFAULT_ANNOTATION_COLOR)
    setNewUserTplRows([{ label: '', defaultValue: '' }])
    setNewUserTplBuiltinRows([])
    setNewUserTplLockPositionDefault(false)
    setNewUserTplBuiltinPickerOpen(false)
  }

  const beginEditUserTemplate = (ut: UserAnnotationTemplate) => {
    setEditingUserTemplateId(ut.id)
    setNewUserTplName(ut.name)
    setNewUserTplColor(ut.color)
    setNewUserTplRows(
      ut.characteristics.length
        ? ut.characteristics.map(c => ({ key: c.key, label: c.label, defaultValue: c.defaultValue }))
        : [{ label: '', defaultValue: '' }]
    )
    setNewUserTplBuiltinRows(
      ANNOTATION_SPEC_FIELD_ORDER.filter(k => ut.builtinSpecKeys?.includes(k)).map(k => ({
        key: k,
        defaultValue: ut.builtinSpecDefaults?.[k] ?? '',
      }))
    )
    setNewUserTplLockPositionDefault(ut.positionLockedDefault === true)
    setNewUserTplBuiltinPickerOpen(false)
    requestAnimationFrame(() => {
      document.getElementById('etl360-gabarit-form')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
    addToast({
      type: 'info',
      title: 'Édition du gabarit',
      message: `Modifiez les champs puis « Mettre à jour ». (${ut.name})`,
      duration: 2800,
    })
  }

  const beginEditIntegratedTemplate = (def: AnnotationTemplateDef) => {
    const ov = integratedTemplateOverride(def.id, userTemplates)
    setEditingUserTemplateId(def.id)
    setNewUserTplName(ov?.name ?? def.label)
    setNewUserTplColor(tryParseAnnotationColorHex(ov?.color) ?? def.color)
    setNewUserTplRows(
      ov?.characteristics?.length
        ? ov.characteristics.map(c => ({ key: c.key, label: c.label, defaultValue: c.defaultValue }))
        : [{ label: '', defaultValue: '' }]
    )
    const keysSource = ov?.builtinSpecKeys?.length ? ov.builtinSpecKeys : def.specKeys
    setNewUserTplBuiltinRows(
      ANNOTATION_SPEC_FIELD_ORDER.filter(k => keysSource.includes(k)).map(k => ({
        key: k,
        defaultValue: ov?.builtinSpecDefaults?.[k] ?? '',
      }))
    )
    setNewUserTplLockPositionDefault(ov?.positionLockedDefault === true)
    setNewUserTplBuiltinPickerOpen(false)
    requestAnimationFrame(() => {
      document.getElementById('etl360-gabarit-form')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
    addToast({
      type: 'info',
      title: 'Édition du gabarit intégré',
      message: `Modifiez puis « Mettre à jour » — sauvegarde locale pour ce projet (${def.label}).`,
      duration: 3200,
    })
  }

  const saveNewUserTemplate = () => {
    const name = newUserTplName.trim()
    if (!name) {
      addToast({ type: 'warning', title: 'Nom du gabarit requis', duration: 2600 })
      return
    }
    const characteristics = buildCharacteristicsFromEditorRows(newUserTplRows)
    const orderedBuiltin = ANNOTATION_SPEC_FIELD_ORDER.filter(k => newUserTplBuiltinRows.some(r => r.key === k))
    if (characteristics.length === 0 && orderedBuiltin.length === 0) {
      addToast({
        type: 'warning',
        title: 'Caractéristiques',
        message:
          'Ajoutez au moins une caractéristique libre (libellé rempli) ou une caractéristique standard (durée de vie, matière, etc.).',
        duration: 3800,
      })
      return
    }
    const c = tryParseAnnotationColorHex(newUserTplColor) ?? ETL360_DEFAULT_ANNOTATION_COLOR
    const builtinSpecDefaults: Partial<Record<AnnotationSpecFieldKey, string>> = {}
    for (const row of newUserTplBuiltinRows) {
      const t0 = row.defaultValue.trim()
      if (t0) builtinSpecDefaults[row.key] = t0
    }
    const common: Omit<UserAnnotationTemplate, 'id'> = {
      name,
      color: c,
      characteristics,
      ...(orderedBuiltin.length ? { builtinSpecKeys: orderedBuiltin } : {}),
      ...(Object.keys(builtinSpecDefaults).length ? { builtinSpecDefaults } : {}),
      ...(newUserTplLockPositionDefault ? { positionLockedDefault: true } : {}),
    }
    if (editingUserTemplateId) {
      if (isIntegratedTemplateOverrideId(editingUserTemplateId)) {
        setUserTemplates(prev => {
          const without = prev.filter(x => x.id !== editingUserTemplateId)
          return [...without, { id: editingUserTemplateId, ...common }]
        })
        addToast({ type: 'success', title: 'Gabarit intégré mis à jour', duration: 2200 })
      } else {
        setUserTemplates(prev =>
          prev.map(x => (x.id === editingUserTemplateId ? { ...common, id: editingUserTemplateId } : x))
        )
        addToast({ type: 'success', title: 'Gabarit mis à jour', duration: 2200 })
      }
    } else {
      const t: UserAnnotationTemplate = {
        id:
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `ut-${Date.now()}`,
        ...common,
      }
      setUserTemplates(prev => [...prev, t])
      addToast({ type: 'success', title: 'Gabarit personnalisé enregistré', duration: 2200 })
    }
    resetNewUserTplForm()
  }

  const removeUserTemplateById = (id: string) => {
    setUserTemplates(prev => prev.filter(x => x.id !== id))
    if (isIntegratedTemplateOverrideId(id)) {
      addToast({
        type: 'info',
        title: 'Gabarit intégré réinitialisé',
        message: 'Les valeurs par défaut de l’application sont à nouveau utilisées.',
        duration: 2600,
      })
    } else {
      addToast({ type: 'info', title: 'Gabarit supprimé', duration: 2000 })
    }
  }

  useEffect(() => {
    if (!editingUserTemplateId) return
    if (isIntegratedTemplateOverrideId(editingUserTemplateId)) return
    if (!userTemplates.some(t => t.id === editingUserTemplateId)) {
      setEditingUserTemplateId(null)
      setNewUserTplName('')
      setNewUserTplColor(ETL360_DEFAULT_ANNOTATION_COLOR)
      setNewUserTplRows([{ label: '', defaultValue: '' }])
      setNewUserTplBuiltinRows([])
      setNewUserTplLockPositionDefault(false)
      setNewUserTplBuiltinPickerOpen(false)
    }
  }, [userTemplates, editingUserTemplateId])

  const openAnnotationEditor = useCallback(
    (annotation: AnnotationRecord) => {
      if (clientMode) return
      setSelectedAnnotationId(annotation.id)
      const focus = annotationFocusYawPitch(annotation)
      if (panoCompareLayoutActive && secondaryPanoForCompare?.id) {
        setPanoViewYawPitch(focus)
        viewerRef.current?.focusYawPitch(focus.yaw, focus.pitch)
        compareViewerRef.current?.focusYawPitch(focus.yaw, focus.pitch)
      } else {
        viewerRef.current?.focusYawPitch(focus.yaw, focus.pitch)
      }
      setEditingAnnotationId(annotation.id)
      setEditIdentifier(annotation.identifier || annotation.label || '')
      setEditDescription(annotation.description || '')
      const editAnnKind = annotationKind(annotation)
      setEditKind(editAnnKind)
      setEditZoneFillOpacity(
        clampZoneFillOpacity(
          annotation.zone && (editAnnKind === 'zone' || editAnnKind === 'text')
            ? annotation.zoneFillOpacity
            : ETL360_DEFAULT_ZONE_OVERLAY_FILL_OPACITY
        )
      )
      setEditColor(annotationRecordColor(annotation, userTemplates))
      setEditTextContent(annotation.textContent || '')
      setEditTextSizePx(parseAnnotationTextSizePx(annotation.textSizePx) ?? 20)
      setEditTextTone(parseAnnotationTextTone(annotation.textTone) ?? 'black')
      setEditPositionLocked(annotationPositionLocked(annotation))
      setEditSpecForm(annotationToCreationSpecForm(annotation))
      const utId = annotation.userTemplateId
      setEditUserTemplateId(utId ?? '')
      setEditTemplateId(utId ? '' : (annotation.templateId ?? ''))
      if (utId) {
        const ut = userTemplates.find(t => t.id === utId)
        const vals: Record<string, string> = {}
        if (ut) {
          for (const c of ut.characteristics) {
            vals[c.key] = annotation.customTemplateValues?.[c.key] ?? c.defaultValue
          }
        }
        setEditCustomTemplateValues(vals)
      } else if (annotation.templateId) {
        const iov = integratedTemplateOverride(annotation.templateId, userTemplates)
        const sm = integratedSurfaceMatiereTemplateId(annotation.templateId)
        const vals: Record<string, string> = {}
        if (iov?.characteristics?.length) {
          for (const c of iov.characteristics) {
            vals[c.key] = annotation.customTemplateValues?.[c.key] ?? c.defaultValue
          }
        }
        if (sm) {
          const def = defaultIntegratedSurfaceMatiereCustom(sm)
          const cv = annotation.customTemplateValues ?? {}
          for (const k of Object.keys(def)) {
            vals[k] = cv[k] ?? ''
          }
        }
        setEditCustomTemplateValues(vals)
      } else {
        setEditCustomTemplateValues({})
      }
      setEditSpecSlots(annotationSpecSlotsFromRecord(annotation, userTemplates))
      setEditSpecPickerOpen(false)
      setEditAnnotationOpen(true)
    },
    [userTemplates, panoCompareLayoutActive, secondaryPanoForCompare?.id, clientMode]
  )

  useLayoutEffect(() => {
    compareViewerCallbacksRef.current = {
      ...compareViewerCallbacksRef.current,
      onPanoViewChange: (yp: YawPitch) => {
        setPanoViewYawPitch(yp)
        viewerRef.current?.focusYawPitch(yp.yaw, yp.pitch)
      },
      onPanoFovChange: (fovDeg: number) => {
        viewerRef.current?.setCameraFovDeg(fovDeg)
      },
      onMarkerSelect: (a: AnnotationRecord) => {
        setSelectedAnnotationId(a.id)
      },
      onMarkerClick: (a: AnnotationRecord) => {
        setSelectedAnnotationId(a.id)
        const f = annotationFocusYawPitch(a)
        setPanoViewYawPitch(f)
        viewerRef.current?.focusYawPitch(f.yaw, f.pitch)
        compareViewerRef.current?.focusYawPitch(f.yaw, f.pitch)
      },
      onPointChange: (annotationId, yawPitch) => {
        setAnnotations(prev => prev.map(ann => (ann.id === annotationId ? { ...ann, yawPitch } : ann)))
      },
      onZoneChange: (annotationId, patch) => {
        setAnnotations(prev =>
          prev.map(a =>
            a.id === annotationId
              ? {
                  ...a,
                  ...patch,
                  ...(annotationKind(a) === 'text' ? { kind: 'text' as const } : {}),
                }
              : a
          )
        )
      },
      onMarkerDoubleClick: clientMode ? (_a: AnnotationRecord) => {} : openAnnotationEditor,
    }
  }, [openAnnotationEditor, clientMode])

  const focusCameraOnAnnotationRecord = useCallback((ann: AnnotationRecord) => {
    const f = annotationFocusYawPitch(ann)
    viewerRef.current?.focusYawPitch(f.yaw, f.pitch)
    const t = ann.pointCloudTarget
    if (t && Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z)) {
      e57ViewerRef.current?.focusOnWorldPoint(t.x, t.y, t.z)
    }
  }, [])

  const handlePanoMinimapAnnotationSelect = useCallback(
    (annotationId: string) => {
      const ann = annotations.find(a => a.id === annotationId)
      if (!ann) return
      setSelectedAnnotationId(ann.id)
      if (ann.panoId === currentPanoId) {
        queueMicrotask(() => focusCameraOnAnnotationRecord(ann))
        return
      }
      panoMinimapPendingFocusRef.current = { panoId: ann.panoId, annotationId: ann.id }
      setCurrentPanoId(ann.panoId)
    },
    [annotations, currentPanoId, focusCameraOnAnnotationRecord]
  )

  useLayoutEffect(() => {
    viewerCallbacksRef.current = {
      onMarkerSelect: annotation => {
        setSelectedAnnotationId(annotation.id)
      },
      onMarkerClick: annotation => {
        setSelectedAnnotationId(annotation.id)
        const focus = annotationFocusYawPitch(annotation)
        viewerRef.current?.focusYawPitch(focus.yaw, focus.pitch)
        if (panoCompareLayoutActiveRef.current) {
          setPanoViewYawPitch(focus)
          compareViewerRef.current?.focusYawPitch(focus.yaw, focus.pitch)
        }
      },
      onMarkerDoubleClick: clientMode ? (_a: AnnotationRecord) => {} : openAnnotationEditor,
      onPanoTeleport: panoId => {
        setCurrentPanoId(panoId)
      },
      onPointChange: (annotationId, yawPitch) => {
        setAnnotations(prev => prev.map(a => (a.id === annotationId ? { ...a, yawPitch } : a)))
      },
      onZoneChange: (annotationId, patch) => {
        setAnnotations(prev =>
          prev.map(a =>
            a.id === annotationId
              ? {
                  ...a,
                  ...patch,
                  ...(annotationKind(a) === 'text' ? { kind: 'text' as const } : {}),
                }
              : a
          )
        )
      },
      onRightClick: yp => {
        if (!currentPanoId) {
          addToast({
            type: 'warning',
            title: 'Panorama',
            message: 'Selectionnez un panorama avant d annoter.',
            duration: 2800,
          })
          return
        }
        setPendingYawPitch(yp)
        setQaKind('point')
        setQaIdentifier('')
        setQaDescription('')
        setQaColor(ETL360_DEFAULT_ANNOTATION_COLOR)
        setQaTemplateId('')
        setQaUserTemplateId('')
        setQaTextContent('')
        setQaTextSizePx(20)
        setQaTextTone('black')
        setQuickOpen(true)
      },
      onLeftSphereClick: yp => {
        if (measureModeActiveRef.current) {
          const pano = panos.find(p => p.id === currentPanoId)
          if (!pano) return
          const worldHit = e57ViewerRef.current?.projectPanoramaRayToPointCloud(pano, yp)
          if (!worldHit) {
            addToast({
              type: 'warning',
              title: 'Mesure',
              message: 'Aucun point du nuage touché. Visez une surface visible du nuage E57.',
              duration: 3000,
            })
            return
          }
          const pt: { yaw: number; pitch: number; world: Vec3 } = {
            yaw: yp.yaw,
            pitch: yp.pitch,
            world: worldHit,
          }
          setMeasureStart(prev => {
            if (!prev) return pt
            const dx = worldHit.x - prev.world.x
            const dy = worldHit.y - prev.world.y
            const dz = worldHit.z - prev.world.z
            const distM = Math.sqrt(dx * dx + dy * dy + dz * dz)
            const rec: MeasureRecord = {
              id: `meas-${Date.now()}`,
              panoId: currentPanoId!,
              start: prev,
              end: pt,
              distanceCm: Math.round(distM * 100 * 10) / 10,
              color: '#facc15',
            }
            setMeasureLines(ls => [...ls, rec])
            addToast({
              type: 'success',
              title: 'Mesure',
              message: `${rec.distanceCm} cm`,
              duration: 4000,
            })
            return null
          })
          return
        }
        setSelectedAnnotationId(null)
        setSyntheticYawPitch(yp)
      },
      onZoneDrawComplete: result => {
        const draft = pendingZoneDraftRef.current
        pendingZoneDraftRef.current = null
        if (!draft) return
        if (!result) {
          addToast({
            type: 'warning',
            title: 'Zone annulee',
            message: 'Tracez un rectangle plus large pour creer une annotation de zone.',
            duration: 3200,
          })
          return
        }
        const specKeysZ = draft.creationBuiltinKeys ?? []
        const specPatchZ = buildAnnotationSpecPatchFromCreationForm(
          specKeysZ,
          draft.creationSpecForm ?? emptyAnnCreationSpecForm()
        )
        const customZ = draft.creationCustomValues
          ? compactStringRecord(draft.creationCustomValues)
          : undefined
        const ann: AnnotationRecord = {
          id: newAnnotationId(),
          panoId: draft.panoId,
          label: draft.identifier,
          identifier: draft.identifier,
          description: draft.description,
          ...(draft.templateId ? { templateId: draft.templateId } : {}),
          ...(draft.userTemplateId ? { userTemplateId: draft.userTemplateId } : {}),
          ...(customZ ? { customTemplateValues: customZ } : {}),
          ...(draft.color ? { color: draft.color } : {}),
          ...(draft.positionLocked ? { positionLocked: true } : {}),
          ...specPatchZ,
          origin: clientMode ? 'client_remark' : 'added_annotation',
          kind: draft.kind === 'text' ? 'text' : 'zone',
          yawPitch: result.center,
          zone: result.zone,
          zoneFillOpacity: clampZoneFillOpacity(draft.zoneFillOpacity),
          ...(draft.kind === 'text'
            ? {
                textContent: (draft.textContent || '').trim(),
                textSizePx: draft.textSizePx ?? 20,
                textTone: draft.textTone ?? 'black',
              }
            : {}),
        }
        const rkZone = templatePickerKeyFromParts(draft.templateId, draft.userTemplateId)
        if (rkZone) bumpRecentTemplateChoice(rkZone)
        setAnnotations(prev => {
          const next = [...prev, ann]
          if (clientMode && etlBlobProjectSaveEnabled) {
            queueMicrotask(() => {
              void persistEtlBlobViewerProjectToAzureRef.current?.({
                showToast: false,
                annotationsOverride: next,
              })
            })
          }
          return next
        })
        addToast({ type: 'success', title: 'Zone annotee', duration: 2200 })
      },
      onPanoPointerMoveDebug: yp => {
        if (!panoDebugXyzEnabledRef.current) return
        setPanoDebugCursorYp(yp)
      },
      onAnnotationHoverDebug: ann => {
        if (!panoDebugXyzEnabledRef.current) return
        setPanoDebugHoverAnn(ann)
      },
      onNeighborPanoHoverDebug: neighbor => {
        if (!panoDebugXyzEnabledRef.current) return
        setPanoDebugHoverNeighbor(neighbor)
      },
      onPanoViewChange: setPanoViewYawPitch,
      onPanoFovChange: fovDeg => {
        if (panoCompareLayoutActiveRef.current) {
          compareViewerRef.current?.setCameraFovDeg(fovDeg)
        }
      },
    }
  }, [currentPanoId, addToast, openAnnotationEditor, bumpRecentTemplateChoice, clientMode, etlBlobProjectSaveEnabled])

  const hasAnyPanos = panos.length > 0
  useEffect(() => {
    if (!containerRef.current) return
    if (!hasAnyPanos) {
      if (viewerRef.current) {
        viewerRef.current.dispose()
        viewerRef.current = null
      }
      return
    }
    if (viewerRef.current) return
    const viewer = new EmbeddedSphereViewer(containerRef.current, viewerCallbacksRef)
    viewerRef.current = viewer
    setPanoViewerReadyToken(token => token + 1)
    return () => {
      viewer.dispose()
      viewerRef.current = null
    }
  }, [hasAnyPanos])

  useEffect(() => {
    if (!developerMode || !e57ContainerRef.current) return
    const viewer = new EmbeddedE57PointCloudViewer(e57ContainerRef.current)
    e57ViewerRef.current = viewer
    if (e57SourcePositionsRef.current && e57SourceBoundsRef.current && e57SourceMetaRef.current) {
      renderE57FromSource(0)
    }
    return () => {
      viewer.dispose()
      e57ViewerRef.current = null
    }
  }, [developerMode])

  useEffect(() => {
    if (!developerMode) return
    e57ViewerRef.current?.setBackgroundColorHex(e57ViewerBgHex)
  }, [e57ViewerBgHex, developerMode])

  useEffect(() => {
    if (!e57Stats) return
    renderE57FromSource()
  }, [e57DisplayVoxelSize, e57Stats, e57UseSourcePointColors, renderE57FromSource])

  useEffect(() => {
    e57ViewerRef.current?.setPanoCameraOverlay(panosWithViewerColors)
    e57ViewerRef.current?.setAnnotationOverlay(annotations, userTemplates)
  }, [annotations, e57DevViewerAxesXzy, e57DisplayVoxelSize, e57Stats, panosWithViewerColors, userTemplates])

  useEffect(() => {
    const v = e57ViewerRef.current
    if (!v) return
    if (!e57Stats || !e57ShowFloorPlansInCloud) {
      v.setFloorPlanOverlays([])
      return
    }
    v.setFloorPlanOverlays(floorMapAssetsEffective, e57DevViewerAxesXzy)
  }, [e57DevViewerAxesXzy, e57Stats, e57ShowFloorPlansInCloud, floorMapAssetsEffective])

  useEffect(() => {
    if (!e57Stats) return
    setAnnotations(prev => projectAnnotationsToPointCloud(prev))
  }, [annotations, e57Stats, projectAnnotationsToPointCloud])

  useEffect(() => {
    if (!currentPano) {
      setRenameDraft('')
      setFloorRenameFrom('')
      setFloorRenameTo('')
      return
    }
    pendingZoneDraftRef.current = null
    viewerRef.current?.cancelZonePlacement()
    setRenameDraft(currentPano.displayLabel?.trim() || currentPano.filename)
    const cp = currentPano.comparePair
    setCompareOtherPanoIdDraft(cp?.otherPanoId && cp.otherPanoId !== currentPano.id ? cp.otherPanoId : '')
    setCompareLabelBeforeDraft((cp?.labelBefore || '').trim())
    setCompareLabelAfterDraft((cp?.labelAfter || '').trim())
    const assignedFloor = (panoFloorAssignments[currentPano.id] || '').trim()
    setFloorRenameFrom(assignedFloor)
    setFloorRenameTo(assignedFloor)
  }, [currentPano, panoFloorAssignments])

  // ── Chargement paresseux des panos depuis le blob (Phase 3 — index viewer) ──
  // Déclenché quand currentPanoId change et que le pano actif (+ voisins) n'a pas encore d'imageUrl.
  // Limité à LAZY_PANO_PRELOAD_COUNT pour contrôler la consommation mémoire.
  const LAZY_PANO_PRELOAD_COUNT = 5

  const clearPanoImageBlobLoadFailed = useCallback((panoId: string) => {
    setPanos(prev => prev.map(pr => (pr.id === panoId ? { ...pr, imageBlobLoadFailed: false } : pr)))
    setPanoImageBlobLoadRetryKey(k => k + 1)
  }, [])

  const panoBlobLazyInFlightRef = useRef<AbortController | null>(null)
  useEffect(() => {
    const pwc = panosWithViewerContextRef.current
    const pano = pwc.find(p => p.id === currentPanoId)
    // Pano courant d’abord, puis un voisinage simple
    const needsLoad = [pano, ...(pano ? pwc.filter(p => p.id !== currentPanoId).slice(0, LAZY_PANO_PRELOAD_COUNT) : [])].filter(
      p => Boolean(p && !p.imageExists && p.blobPath && !p.imageBlobLoadFailed)
    ) as PanoRecord[]
    if (needsLoad.length === 0) return
    let cancelled = false
    void (async () => {
      for (const p of needsLoad) {
        if (cancelled || !p.blobPath) break
        const ac = new AbortController()
        panoBlobLazyInFlightRef.current = ac
        const tid = window.setTimeout(() => ac.abort(), BLOB_PANO_LOAD_TIMEOUT_MS)
        try {
          const { blob } = await downloadEtlViewerFileAsBlob(p.blobPath, undefined, ac.signal, etlBlobScope)
          clearTimeout(tid)
          if (cancelled) return
          const imageUrl = URL.createObjectURL(blob)
          setPanos(prev =>
            prev.map(pr =>
              pr.id === p.id ? { ...pr, imageUrl, imageExists: true, imageBlobLoadFailed: false } : pr
            )
          )
          setObjectUrls(prev2 => [...prev2, imageUrl])
        } catch {
          clearTimeout(tid)
          if (cancelled) return
          setPanos(prev => prev.map(pr => (pr.id === p.id ? { ...pr, imageBlobLoadFailed: true } : pr)))
        } finally {
          if (panoBlobLazyInFlightRef.current === ac) {
            panoBlobLazyInFlightRef.current = null
          }
        }
      }
    })()
    return () => {
      cancelled = true
      panoBlobLazyInFlightRef.current?.abort()
      panoBlobLazyInFlightRef.current = null
    }
  }, [currentPanoId, etlBlobScope, panoImageBlobLoadRetryKey])

  useEffect(() => {
    if (!currentPano || !viewerRef.current) return
    if (!currentPano.imageExists || !currentPano.imageUrl) {
      return
    }
    const pendingStale = panoMinimapPendingFocusRef.current
    if (pendingStale && pendingStale.panoId !== currentPano.id) {
      panoMinimapPendingFocusRef.current = null
    }
    const panoIdLoaded = currentPano.id
    const viewer = viewerRef.current
    viewer
      .loadPanorama(currentPano.imageUrl)
      .then(() => {
        if (currentPanoIdRef.current !== panoIdLoaded) return
        const pending = panoMinimapPendingFocusRef.current
        if (!pending || pending.panoId !== panoIdLoaded) return
        const ann = annotationsRef.current.find(a => a.id === pending.annotationId)
        if (!ann || ann.panoId !== panoIdLoaded) {
          panoMinimapPendingFocusRef.current = null
          return
        }
        const f = annotationFocusYawPitch(ann)
        viewerRef.current?.focusYawPitch(f.yaw, f.pitch)
        const t = ann.pointCloudTarget
        if (t && Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z)) {
          e57ViewerRef.current?.focusOnWorldPoint(t.x, t.y, t.z)
        }
        panoMinimapPendingFocusRef.current = null
      })
      .catch(() => {
        const pending = panoMinimapPendingFocusRef.current
        if (pending?.panoId === panoIdLoaded) {
          panoMinimapPendingFocusRef.current = null
        }
        addToast({
          type: 'error',
          title: 'Erreur image',
          message: `Impossible de charger le panorama ${currentPano.filename}.`,
          duration: 3500,
        })
      })
  }, [currentPano, addToast, panoViewerReadyToken])

  useEffect(() => {
    viewerRef.current?.setPanoramaContext(currentPano, panosWithViewerContext, neighborPanoRadiusM)
  }, [currentPano, panosWithViewerContext, neighborPanoRadiusM])

  useEffect(() => {
    viewerRef.current?.setNeighborPanoMarkersVisible(showNeighborPanoTriangles)
  }, [showNeighborPanoTriangles])

  useEffect(() => {
    viewerRef.current?.setNeighborQuaternionDebugVisible(panoDebugXyzEnabled)
  }, [panoDebugXyzEnabled])

  useEffect(() => {
    viewerRef.current?.setMarkers(currentAnnotations, selectedAnnotationId, userTemplates, {
      interaction: clientMode ? 'select' : 'full',
    })
  }, [currentAnnotations, selectedAnnotationId, userTemplates, panoDebugXyzEnabled, clientMode])

  useEffect(() => {
    viewerRef.current?.setPanoViewAxisFlips(
      Boolean(currentPano?.viewFlipX),
      Boolean(currentPano?.viewFlipY)
    )
  }, [currentPano?.id, currentPano?.viewFlipX, currentPano?.viewFlipY])

  useEffect(() => {
    if (!panoAnnotationListVisible || !selectedAnnotationId) return
    if (!panoAnnotationListScrollRef.current) return
    const el = panoAnnotationItemRefs.current[selectedAnnotationId]
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      el.focus({ preventScroll: true })
    })
  }, [selectedAnnotationId, panoAnnotationListVisible, panoramaAnnotationGroups, clientMode, currentAnnotations])

  useEffect(() => {
    if (!currentPanoId) {
      setPanoExposure(1)
      return
    }
    setPanoExposure(exposureForPano(currentPanoId))
  }, [currentPanoId, exposureForPano])

  useEffect(() => {
    viewerRef.current?.setPanoramaExposure(panoExposure)
  }, [panoExposure])

  // #region agent log
  useEffect(() => {
    etl360PostDebugIngest({
      sessionId: '546eb8',
      runId: 'state-snapshot',
      hypothesisId: 'H0',
      location: 'ETLViewer360.tsx:stateSnapshot',
      message: 'overlay related state snapshot',
      data: {
        pagePort: typeof window !== 'undefined' ? window.location.port : '',
        panosCount: panos.length,
        currentPanoId,
        selectedFloor,
        panoWorldOverlayEnabled,
        hasE57Stats: Boolean(e57Stats),
        e57FileName: e57Stats?.fileName ?? null,
      },
      timestamp: Date.now(),
    })
  }, [panos.length, currentPanoId, selectedFloor, panoWorldOverlayEnabled, e57Stats])
  // #endregion

  useEffect(() => {
    const v = viewerRef.current
    if (!v) return
    // #region agent log
    etl360PostDebugIngest({
      sessionId: '546eb8',
      runId: 'overlay-gate',
      hypothesisId: 'H0',
      location: 'ETLViewer360.tsx:panoOverlayEffect',
      message: 'overlay effect gate',
      data: {
        pagePort: typeof window !== 'undefined' ? window.location.port : '',
        panoWorldOverlayEnabled,
        hasCurrentPano: Boolean(currentPano),
        currentPanoId: currentPano?.id ?? null,
        hasE57Stats: Boolean(e57Stats),
        hasViewer: Boolean(v),
        hasPos: Boolean(e57SourcePositionsRef.current),
        posLength: e57SourcePositionsRef.current?.length ?? 0,
      },
      timestamp: Date.now(),
    })
    // #endregion
    if (!panoWorldOverlayEnabled || !currentPano || !e57Stats) {
      v.setPanoWorldOverlay(null)
      return
    }
    const pos = e57SourcePositionsRef.current
    if (!pos || pos.length < 3) {
      v.setPanoWorldOverlay(null)
      return
    }
    // #region agent log
    ;(() => {
      const np = Math.floor(pos.length / 3)
      const strideC = Math.max(1, Math.ceil(np / 8000))
      let sx = 0
      let sy = 0
      let sz = 0
      let cc = 0
      for (let i = 0; i < np; i += strideC) {
        const o = i * 3
        sx += pos[o]
        sy += pos[o + 1]
        sz += pos[o + 2]
        cc++
      }
      const cx = sx / cc
      const cy = sy / cc
      const cz = sz / cc
      const panoViewerPos = sourceWorldToViewerPosition(currentPano.position)
      const px = panoViewerPos.x
      const py = panoViewerPos.y
      const pz = panoViewerPos.z
      etl360PostDebugIngest({
        sessionId: '546eb8',
        runId: 'vite-ingest',
        hypothesisId: 'H2',
        location: 'ETLViewer360.tsx:panoOverlayEffect',
        message: 'subsampled cloud centroid vs pano position',
        data: {
          pagePort: typeof window !== 'undefined' ? window.location.port : '',
          panoId: currentPano.id,
          subsampleCount: cc,
          totalPoints: np,
          cloudCentroid: { cx, cy, cz },
          panoPos: { px, py, pz },
          vecPanoMinusCentroid: { x: px - cx, y: py - cy, z: pz - cz },
          distPanoCentroid: Math.hypot(px - cx, py - cy, pz - cz),
        },
        timestamp: Date.now(),
      })
    })()
    // #endregion
    v.setPanoWorldOverlay({
      pano: currentPano,
      worldPositions: pos,
      worldColors: e57SourceColorsRef.current,
      maxPoints: 14_000,
      maxDistanceM: 48,
      metersToSceneUnit: 40,
      pointOpacity: 0.72,
      pointSizePx: 2.4,
      showPoints: true,
      showNeighborSprites: true,
      maxNeighborSprites: 8,
    })
  }, [
    panoWorldOverlayEnabled,
    currentPano,
    e57Stats,
    neighborPanoRadiusM,
    panosWithViewerColors,
  ])

  const persistPanoToLocal = useCallback(
    (panoId: string, list: AnnotationRecord[]) => {
      const pano = panosWithViewerColors.find(p => p.id === panoId)
      if (!pano) return
      const assigned = (panoFloorAssignments[panoId] || '').trim()
      const doc = buildAnnotationsDocument(pano, list, projectCode, assigned)
      try {
        localStorage.setItem(localStorageKeyForPano(projectCodeForStorage, panoId), JSON.stringify(doc))
      } catch {
        /* quota */
      }
    },
    [panosWithViewerColors, projectCode, projectCodeForStorage, panoFloorAssignments]
  )

  useEffect(() => {
    if (!currentPanoId) return
    if (saveLsTimer.current) clearTimeout(saveLsTimer.current)
    saveLsTimer.current = setTimeout(() => {
      persistPanoToLocal(currentPanoId, annotations.filter(a => a.panoId === currentPanoId))
    }, 500)
    return () => {
      if (saveLsTimer.current) clearTimeout(saveLsTimer.current)
    }
  }, [annotations, currentPanoId, persistPanoToLocal, panoFloorAssignments])

  const applyRename = () => {
    if (!currentPanoId) return
    setPanos(prev =>
      prev.map(p => (p.id === currentPanoId ? { ...p, displayLabel: renameDraft.trim() || p.filename } : p))
    )
    addToast({ type: 'success', title: 'Nom du panorama mis a jour', duration: 2200 })
  }

  const applyPanoComparePairFromPanel = useCallback(() => {
    if (!currentPanoId) return
    const otherId = compareOtherPanoIdDraft.trim()
    if (otherId && otherId === currentPanoId) {
      addToast({
        type: 'warning',
        title: '2e panorama invalide',
        message: 'Choisissez un autre panorama que le panorama courant.',
        duration: 3500,
      })
      return
    }
    if (otherId && !panos.some(p => p.id === otherId)) {
      addToast({
        type: 'error',
        title: '2e panorama introuvable',
        message: 'Sélectionnez un id présent dans le projet.',
        duration: 4000,
      })
      return
    }
    const lb = compareLabelBeforeDraft.trim()
    const la = compareLabelAfterDraft.trim()
    setPanos(prev =>
      prev.map(p => {
        if (p.id !== currentPanoId) return p
        if (!otherId) {
          const { comparePair: _drop, ...rest } = p
          return rest as PanoRecord
        }
        const nextPair: PanoComparePair = { otherPanoId: otherId }
        if (lb) nextPair.labelBefore = lb
        if (la) nextPair.labelAfter = la
        return { ...p, comparePair: nextPair }
      })
    )
    addToast({ type: 'success', title: 'Paire avant / après enregistrée', duration: 2200 })
  }, [
    addToast,
    compareLabelAfterDraft,
    compareLabelBeforeDraft,
    compareOtherPanoIdDraft,
    currentPanoId,
    panos,
  ])

  /**
   * Import local d’une image 360 (ou image équirectangulaire) comme panorama « après »
   * : ajoute un PanoRecord et lie le panorama courant via `comparePair.otherPanoId`.
   */
  const importLocalAfterPanoForCompare = useCallback(
    async (file: File | null) => {
      if (!file || !currentPano || !currentPanoId) return
      const looksImage =
        (file.type && file.type.startsWith('image/')) || /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(file.name)
      if (!looksImage) {
        addToast({
          type: 'warning',
          title: 'Fichier non pris en charge',
          message: 'Choisissez une image (JPEG, PNG, WebP, etc.).',
          duration: 3500,
        })
        return
      }
      const imageUrl = URL.createObjectURL(file)
      const newId = `pano-local-apres-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const baseName = file.name.replace(/\.[^.]+$/i, '') || 'apres'
      const newPano: PanoRecord = {
        id: newId,
        filename: file.name,
        displayLabel: `${baseName} (après)`,
        imageUrl,
        imageExists: true,
        position: { ...currentPano.position },
        orientation: { ...currentPano.orientation },
        viewFlipX: currentPano.viewFlipX,
        viewFlipY: currentPano.viewFlipY,
        floorLabel: currentPano.floorLabel,
      }
      setObjectUrls(prev => [...prev, imageUrl])
      setPanos(prev => {
        const withNew = [...prev, newPano]
        return withNew.map(p =>
          p.id === currentPanoId
            ? {
                ...p,
                comparePair: {
                  otherPanoId: newId,
                  ...(p.comparePair?.labelBefore ? { labelBefore: p.comparePair.labelBefore } : {}),
                  ...(p.comparePair?.labelAfter ? { labelAfter: p.comparePair.labelAfter } : {}),
                },
              }
            : p
        )
      })
      setCompareOtherPanoIdDraft(newId)
      const floor = (panoFloorAssignments[currentPanoId] || '').trim()
      if (floor) {
        setPanoFloorAssignments(prev => ({ ...prev, [newId]: floor }))
      }
      addToast({
        type: 'success',
        title: 'Panorama « après » importé',
        message:
          'Le second prise de vue est lié à ce panorama. Activez « Avant / après » au-dessus de la vue 360 pour comparer.',
        duration: 5000,
      })
    },
    [addToast, currentPano, currentPanoId, panoFloorAssignments]
  )

  const applyFloorRename = useCallback(() => {
    const from = floorRenameFrom.trim()
    const to = floorRenameTo.trim()
    if (!from) {
      addToast({ type: 'warning', title: 'Renommer étage', message: 'Choisissez un étage source.', duration: 2600 })
      return
    }
    if (!to || to.toLowerCase() === 'non assigne') {
      addToast({ type: 'warning', title: 'Renommer étage', message: 'Nom de destination invalide.', duration: 2600 })
      return
    }
    if (from === to) return
    if (floorLabels.includes(to)) {
      addToast({
        type: 'warning',
        title: 'Renommer étage',
        message: `L'étage "${to}" existe déjà.`,
        duration: 2800,
      })
      return
    }

    setPanoFloorAssignments(prev => {
      const next: Record<string, string> = {}
      for (const [panoId, label] of Object.entries(prev)) {
        next[panoId] = label.trim() === from ? to : label
      }
      return next
    })
    setFloorMapAssets(prev => prev.map(asset => (asset.floorLabel === from ? { ...asset, floorLabel: to } : asset)))
    setSelectedFloor(prev => (prev === from ? to : prev))
    setPanoMinimapFloorLabel(prev => (prev === from ? to : prev))
    setFloorPlanReplaceTargetLabel(prev => (prev === from ? to : prev))
    if (floorPlanReplacements[from]) {
      const nextReplacements: Record<string, FloorPlanReplacementRecord> = { ...floorPlanReplacements }
      const renamed: FloorPlanReplacementRecord = { ...nextReplacements[from], floorLabel: to }
      delete nextReplacements[from]
      nextReplacements[to] = renamed
      persistFloorPlanReplacements(nextReplacements)
    }
    setFloorPlanReplacementInferredSize(prev => {
      if (!prev[from]) return prev
      const next = { ...prev, [to]: prev[from]! }
      delete next[from]
      return next
    })
    setFloorRenameFrom(to)
    setFloorRenameTo(to)
    addToast({
      type: 'success',
      title: 'Étage renommé',
      message: `"${from}" → "${to}"`,
      duration: 2600,
    })
  }, [
    floorRenameFrom,
    floorRenameTo,
    floorLabels,
    floorPlanReplacements,
    persistFloorPlanReplacements,
    addToast,
  ])

  const openFloorPlanDrawEditor = useCallback(() => {
    if (!floorPlanTargetAsset?.imageUrl) {
      addToast({ type: 'warning', title: 'Plan d’étage', message: 'Sélectionnez un étage avec plan avant de tracer.', duration: 2600 })
      return
    }
    const rep = floorPlanReplacements[floorPlanTargetAsset.floorLabel]
    setFloorPlanDrawStrokeColor(
      typeof rep?.drawStrokeColor === 'string' && rep.drawStrokeColor.trim() ? rep.drawStrokeColor : '#808080'
    )
    setFloorPlanDrawStrokeWidth(
      Number.isFinite(Number(rep?.drawStrokeWidth)) ? Math.max(1, Math.min(50, Number(rep?.drawStrokeWidth))) : 5
    )
    setFloorPlanDrawFinalPreview(false)
    setFloorPlanDrawModalOpen(true)
  }, [floorPlanTargetAsset, floorPlanReplacements, addToast])

  const openFloorPlanImportEditor = useCallback(() => {
    if (!floorPlanTargetAsset?.imageUrl) {
      addToast({ type: 'warning', title: 'Plan d’étage', message: 'Sélectionnez un étage avec plan avant import.', duration: 2600 })
      return
    }
    const label = floorPlanTargetAsset.floorLabel
    const rep = floorPlanReplacements[label]
    const initialPlanUrl =
      rep?.mode === 'imported' && typeof rep.imageDataUrl === 'string' && rep.imageDataUrl.trim()
        ? rep.imageDataUrl.trim()
        : floorPlanTargetAsset.imageUrl
    const fc = floorPlanImportFabricCanvasRef.current as { dispose?: () => void } | null
    fc?.dispose?.()
    floorPlanImportFabricCanvasRef.current = null
    floorPlanImportFabricImgObjRef.current = null
    floorPlanImportFabricOverlayObjRef.current = null
    floorPlanImportFabricDotsRef.current = []
    floorPlanImportLastExportInsetRef.current = { left: 0, top: 0 }
    setFloorPlanImportBaseOverlayOpacity(35)
    setFloorPlanAlignedPreviewDataUrl(null)
    setFloorPlanImportCanvasDisplaySize(null)
    setFloorPlanImportInteractionMode('adjust')
    floorPlanImportInteractionModeRef.current = 'adjust'
    setFloorPlanImportedDataUrl(initialPlanUrl)
    setFloorPlanImportModalOpen(true)
  }, [floorPlanTargetAsset, floorPlanReplacements, addToast])

  const handleFloorPlanImportFile = useCallback(
    async (file: File | null) => {
      if (!file) return
      const dataUrl = await fileToFloorPlanImageDataUrl(file)
      if (!dataUrl) {
        addToast({
          type: 'error',
          title: 'Remplacement de plan',
          message: 'Impossible de lire ce fichier (image/PDF).',
          duration: 3600,
        })
        return
      }
      setFloorPlanImportedDataUrl(dataUrl)
      setFloorPlanAlignedPreviewDataUrl(null)
      setFloorPlanImportInteractionMode('adjust')
      floorPlanImportInteractionModeRef.current = 'adjust'
      addToast({
        type: 'success',
        title: 'Plan importé',
        message: e57Stats
          ? 'Alignez le plan sur les pastilles panoramas dans le canvas interactif.'
          : 'Sans nuage de points : pas de calage sur le plan de fond. Double-clic sur l\u2019image pour le mode rogner (bords) ; sinon coins = rotation, bords = redimensionner.',
        duration: 4200,
      })
    },
    [addToast, e57Stats]
  )


  const applyImportedFloorPlanReplacement = useCallback(() => {
    const dataUrl = exportFabricImportCanvasRef.current()
    if (!dataUrl) {
      addToast({
        type: 'warning',
        title: e57Stats ? 'Calage' : 'Aperçu',
        message: e57Stats
          ? 'Importez un plan puis alignez-le avant application.'
          : 'Importez un plan et attendez l\u2019aperçu (ou double-clic pour rogner / ajuster) avant application.',
        duration: 3200,
      })
      return
    }
    void applyFloorPlanReplacementForTarget('imported', dataUrl)
    setFloorPlanImportModalOpen(false)
    clearFloorPlanImportDraft()
  }, [applyFloorPlanReplacementForTarget, clearFloorPlanImportDraft, addToast, e57Stats])

  const applyDrawnFloorPlanReplacement = useCallback(async () => {
    const canvas = floorPlanDrawCanvasRef.current
    const FabricDrawing = (
      window as unknown as {
        FabricDrawing?: { exportSVG?: (canvas: unknown, options?: Record<string, unknown>) => string }
      }
    ).FabricDrawing
    if (!canvas) {
      addToast({ type: 'error', title: 'Plan tracé', message: 'Outil de dessin non prêt.', duration: 2800 })
      return
    }
    const fabricCanvas = canvas as {
      backgroundImage?: unknown
      viewportTransform?: number[]
      setViewportTransform?: (m: number[]) => void
      getZoom?: () => number
      setZoom?: (z: number) => void
      requestRenderAll?: () => void
      renderAll?: () => void
      discardActiveObject?: () => void
      getObjects?: () => unknown[]
      add?: (o: unknown) => void
      remove?: (o: unknown) => void
      toDatalessJSON?: (props?: string[]) => unknown
    }
    const prevVpt = Array.isArray(fabricCanvas.viewportTransform) ? [...fabricCanvas.viewportTransform] : [1, 0, 0, 1, 0, 0]
    const prevBg = fabricCanvas.backgroundImage
    const guides = [...floorPlanDrawGuideObjectsRef.current]
    let prepared = false
    const prepareExportState = () => {
      try {
        fabricCanvas.discardActiveObject?.()
        if (typeof fabricCanvas.setViewportTransform === 'function') {
          fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0])
        } else {
          fabricCanvas.viewportTransform = [1, 0, 0, 1, 0, 0]
        }
        if (typeof fabricCanvas.setZoom === 'function') {
          fabricCanvas.setZoom(1)
        }
        fabricCanvas.backgroundImage = undefined
        if (typeof fabricCanvas.remove === 'function') {
          for (const g of guides) fabricCanvas.remove(g)
        }
        fabricCanvas.requestRenderAll?.()
        fabricCanvas.renderAll?.()
        prepared = true
      } catch {
        prepared = false
      }
    }
    const restoreExportState = () => {
      if (!prepared) return
      try {
        if (typeof fabricCanvas.setViewportTransform === 'function') {
          fabricCanvas.setViewportTransform(prevVpt)
        } else {
          fabricCanvas.viewportTransform = prevVpt
        }
        fabricCanvas.backgroundImage = prevBg
        if (typeof fabricCanvas.add === 'function' && typeof fabricCanvas.getObjects === 'function') {
          const existing = new Set(fabricCanvas.getObjects())
          for (const g of guides) {
            if (!existing.has(g)) fabricCanvas.add(g)
          }
        }
        fabricCanvas.requestRenderAll?.()
        fabricCanvas.renderAll?.()
      } catch {
        /* noop */
      }
    }
    prepareExportState()
    if (!prepared) {
      addToast({
        type: 'error',
        title: 'Plan tracé',
        message: 'Impossible de préparer un export à l’échelle. Réessayez.',
        duration: 3200,
      })
      return
    }
    try {
      const svg =
        typeof FabricDrawing?.exportSVG === 'function'
          ? FabricDrawing.exportSVG(canvas, { suppressPreamble: true })
          : ''
      if (!svg || !svg.trim()) throw new Error('SVG vide')
      const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      const sceneState =
        typeof fabricCanvas.toDatalessJSON === 'function'
          ? fabricCanvas.toDatalessJSON([
              '_isLineByPointsMarker',
              '_isLineGroup',
              'start_point',
              'end_point',
              '_lineOptions',
            ])
          : {}
      const lineByPointsLast = (() => {
        const v = (fabricCanvas as { _lineByPointsLast?: { x?: unknown; y?: unknown } | null })._lineByPointsLast
        if (!v) return null
        const x = Number(v.x)
        const y = Number(v.y)
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null
        return { x, y }
      })()
      const sceneJson = JSON.stringify({
        schema: 'etl360.drawScene.v1',
        fabricJson: sceneState,
        lineByPointsLast,
      })
      await applyFloorPlanReplacementForTarget('drawn', svgDataUrl, undefined, {
        drawSvgDataUrl: svgDataUrl,
        drawSceneJson: sceneJson,
        drawStrokeColor: floorPlanDrawStrokeColor,
        drawStrokeWidth: floorPlanDrawStrokeWidth,
      })
      setFloorPlanDrawModalOpen(false)
    } catch {
      addToast({ type: 'error', title: 'Plan tracé', message: 'Impossible de générer le rendu vectoriel.', duration: 3200 })
    } finally {
      restoreExportState()
    }
  }, [applyFloorPlanReplacementForTarget, addToast, floorPlanDrawStrokeColor, floorPlanDrawStrokeWidth])

  const handlePanoExposureChange = useCallback(
    (rawValue: number) => {
      const next = normalizeExposure(rawValue)
      setPanoExposure(next)
      if (!currentPanoId) return
      setPanoExposureById(prev => ({ ...prev, [currentPanoId]: next }))
      try {
        localStorage.setItem(localStorageKeyForPanoExposure(projectCodeForStorage, currentPanoId), String(next))
      } catch {
        /* ignore */
      }
    },
    [currentPanoId, normalizeExposure, projectCodeForStorage]
  )

  const exportAnnotationsReportHtml = async () => {
    if (annotations.length === 0) {
      addToast({
        type: 'warning',
        title: 'Rapport',
        message: 'Aucune annotation a exporter.',
        duration: 2600,
      })
      return
    }

    const panoById = new Map(panosWithViewerContext.map(p => [p.id, p] as const))
    const sorted = [...annotations].sort((a, b) => {
      const floorA = (panoFloorAssignments[a.panoId] || '').trim()
      const floorB = (panoFloorAssignments[b.panoId] || '').trim()
      const floorCmp = floorA.localeCompare(floorB, undefined, { numeric: true, sensitivity: 'base' })
      if (floorCmp !== 0) return floorCmp
      const panoA = panoById.get(a.panoId)?.displayLabel || panoById.get(a.panoId)?.filename || a.panoId
      const panoB = panoById.get(b.panoId)?.displayLabel || panoById.get(b.panoId)?.filename || b.panoId
      const panoCmp = panoA.localeCompare(panoB, undefined, { numeric: true, sensitivity: 'base' })
      if (panoCmp !== 0) return panoCmp
      return (a.identifier || a.label || a.id).localeCompare(b.identifier || b.label || b.id, undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    })

    const rows = sorted.map((ann, index) => {
      const pano = panoById.get(ann.panoId)
      const floor = (panoFloorAssignments[ann.panoId] || '').trim() || 'Non assigne'
      const tplPdf = resolvedTemplateLabel(ann, userTemplates)
      return {
        ann,
        n: String(index + 1),
        floor,
        pano: pano?.displayLabel?.trim() || pano?.filename || ann.panoId,
        ident: `${tplPdf ? `[${tplPdf}] ` : ''}${ann.identifier || ann.label || ann.id}`,
        desc: (() => {
          const parts: string[] = []
          const d = (ann.description || '').trim()
          if (d) parts.push(d)
          const specs = formatAnnotationSpecsLine(ann, userTemplates)
          if (specs) parts.push(specs)
          return parts.length ? parts.join('\n') : '-'
        })(),
        colorHex: annotationRecordColor(ann, userTemplates),
      }
    })

    // Ouvrir l’onglet dans le même « tick » que le clic (avant tout await) : sinon le navigateur
    // considère que le geste utilisateur a expiré → onglet vide ou window.open() === null.
    // Ne pas utiliser « noopener » ici : la spec renvoie alors null et document.write() est impossible.
    const reportWin = window.open('about:blank', '_blank')
    if (!reportWin) {
      addToast({
        type: 'error',
        title: 'Rapport HTML',
        message: 'Fenêtre bloquée. Autorisez les popups pour ce site puis réessayez.',
        duration: 5000,
      })
      return
    }
    try {
      reportWin.document.write(
        '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Préparation du rapport</title><style>body{font-family:system-ui,sans-serif;padding:2rem;max-width:40rem;margin:auto;color:#334155}</style></head><body><p><strong>Préparation du rapport…</strong></p><p>Les vues panoramiques et plans sont générées, veuillez patienter.</p></body></html>'
      )
      reportWin.document.close()
    } catch {
      /* ignore; le document final tentera un échappement (blob) plus bas */
    }
    try {
      reportWin.opener = null
    } catch {
      /* best-effort : le nouvel onglet ne garde pas de référence vers l’app */
    }

    addToast({
      type: 'info',
      title: 'Rapport HTML',
      message: 'Génération des vues et du document…',
      duration: 4000,
    })
    // Même FOV que la vue cliquée dans le panorama (sinon marqueurs décalés).
    const reportThumbFovDeg = viewerRef.current?.getCameraFovDeg() ?? 75

    // URLs utilisées uniquement pour l’export (p.ex. index Azure paresseux : pas encore d’object URL en mémoire).
    const reportPanoImageUrls = new Map<string, string>()
    const reportTempObjectUrls: string[] = []
    const panoIdsForReport = new Set<string>()
    for (const r of rows) {
      panoIdsForReport.add(r.ann.panoId)
      const pair = resolvePanoCompareExportPair(r.ann.panoId, panoById)
      if (pair) {
        panoIdsForReport.add(pair.leftId)
        panoIdsForReport.add(pair.rightId)
      }
    }
    for (const panoId of panoIdsForReport) {
      const p = panoById.get(panoId)
      if (!p) continue
      if (p.imageUrl && p.imageExists) {
        reportPanoImageUrls.set(panoId, p.imageUrl)
        continue
      }
      if (p.blobPath) {
        try {
          const { blob } = await downloadEtlViewerFileAsBlob(p.blobPath, undefined, undefined, etlBlobScope)
          const u = URL.createObjectURL(blob)
          reportTempObjectUrls.push(u)
          reportPanoImageUrls.set(panoId, u)
        } catch {
          /* image indisponible (réseau / droit / blob manquant) */
        }
      }
    }

    type ReportHtmlPanoThumbRow = {
      primary: string | null
      compare: string | null
      capLeft: string
      capRight: string
    }
    let thumbs: Array<ReportHtmlPanoThumbRow>
    let planThumbs: Array<string | null>
    try {
      thumbs = await Promise.all(
        rows.map(async r => {
          const pair = resolvePanoCompareExportPair(r.ann.panoId, panoById)
          const renderOne = (panoId: string) => {
            const pano = panoById.get(panoId)
            const imageUrl = reportPanoImageUrls.get(panoId)
            if (!pano || !imageUrl) return Promise.resolve<string | null>(null)
            return renderAnnotationViewThumbnail(
              imageUrl,
              r.ann,
              userTemplates,
              REPORT_EXPORT_THUMB_PX,
              reportThumbFovDeg,
              PDF_EXPORT_THUMB_JPEG_Q,
              exposureForPano(panoId),
              { flipX: Boolean(pano.viewFlipX), flipY: Boolean(pano.viewFlipY) }
            )
          }
          if (!pair) {
            const primary = await renderOne(r.ann.panoId)
            return { primary, compare: null, capLeft: '', capRight: '' }
          }
          const [left, right] = await Promise.all([renderOne(pair.leftId), renderOne(pair.rightId)])
          return {
            primary: left,
            compare: right,
            capLeft: pair.capLeft,
            capRight: pair.capRight,
          }
        })
      )

      const uniqueFloorsForPlans = new Set(
        rows.map(r => r.floor.trim()).filter(f => f && f !== 'Non assigne')
      )
      const floorImgByLabel = new Map<string, HTMLImageElement | null>()
      await Promise.all(
        [...uniqueFloorsForPlans].map(async fl => {
          const asset = floorMapAssetsEffective.find(a => a.floorLabel === fl)
          if (!asset?.imageUrl) {
            floorImgByLabel.set(fl, null)
            return
          }
          const el = await loadImageElementForPdf(asset.imageUrl)
          floorImgByLabel.set(fl, el)
        })
      )

      planThumbs = rows.map(r => {
        const fl = r.floor.trim()
        if (!fl || fl === 'Non assigne') return null
        const imgEl = floorImgByLabel.get(fl)
        if (!imgEl) return null
        const t = r.ann.pointCloudTarget
        const pano = panoById.get(r.ann.panoId)
        const wx = t && Number.isFinite(t.x) ? t.x : pano?.position.x
        const usesSourceXY = annotationUsesSourceWorldHorizontalXY(r.ann)
        // Repère plan (export) :
        // - origine terrain_observation -> X/Y
        // - sinon -> X/Z (viewer)
        const wy =
          t && Number.isFinite(usesSourceXY ? t.y : t.z)
            ? usesSourceXY
              ? t.y
              : t.z
            : pano?.position.y
        if (wx === undefined || wy === undefined || !Number.isFinite(wx) || !Number.isFinite(wy)) return null
        const pct = worldXYToFloorMapPercentFromDataset(wx, wy, fl, spatialDataset)
        if (!pct) return null
        const [br, bg, bb] = annotationHexToRgb255(r.colorHex)
        return rasterizeFloorPlanWithMarker(
          imgEl,
          pct.xPct,
          pct.yPct,
          [br, bg, bb],
          PDF_EXPORT_PLAN_CANVAS,
          PDF_EXPORT_PLAN_JPEG_Q
        )
      })

      const now = new Date()
      const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
      const safeProj = (projectCode || 'LOCAL').replace(/[^a-zA-Z0-9._-]+/g, '_')
      const docRef = `${safeProj}-ETL360-ASG-${ymd}-001`
      const projectLabel = projectCode
        ? `${projectCode}${projectName ? ` — ${projectName}` : ''}`
        : 'Projet non specifie'
      const uniquePanoCount = new Set(sorted.map(a => a.panoId)).size
      const emittedAtLabel = now.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' })

      const items = rows.map((row, ri) => {
        const descHtml =
          row.desc === '-'
            ? '—'
            : escapeHtmlEtlReport(row.desc).replace(/\n/g, '<br />\n')
        const tr = thumbs[ri]
        const dualPano = Boolean(tr?.primary && tr?.compare)
        const panoDataUrl = dualPano ? tr!.primary : tr?.primary ?? tr?.compare ?? null
        return {
          n: row.n,
          total: String(rows.length),
          floor: row.floor,
          pano: row.pano,
          ident: row.ident,
          descHtml,
          colorHex: row.colorHex,
          panoDataUrl,
          ...(dualPano
            ? {
                panoCompareDataUrl: tr!.compare,
                panoCompareCaptionLeft: tr!.capLeft,
                panoCompareCaptionRight: tr!.capRight,
              }
            : {}),
          planDataUrl: planThumbs[ri],
        }
      })

      const html = buildEtl360AnnotationsReportHtmlDocument({
        docRef,
        projectLabel,
        emittedAtLabel,
        rowCount: rows.length,
        uniquePanoCount,
        items,
      })

      try {
        reportWin.document.open()
        reportWin.document.write(html)
        reportWin.document.close()
      } catch (writeErr) {
        const url = URL.createObjectURL(
          new Blob([html], { type: 'text/html;charset=utf-8' })
        )
        try {
          reportWin.location.replace(url)
          setTimeout(() => {
            try {
              URL.revokeObjectURL(url)
            } catch {
              /* ignore */
            }
          }, 60_000)
        } catch {
          URL.revokeObjectURL(url)
          throw writeErr
        }
      }
      reportWin.focus()
      addToast({
        type: 'success',
        title: 'Rapport',
        message: `${rows.length} observation(s) — document ouvert dans un nouvel onglet.`,
        duration: 3200,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const htmlErr = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Erreur — rapport</title><style>body{font-family:system-ui,sans-serif;padding:2rem;max-width:40rem;margin:auto}</style></head><body><h1>Export impossible</h1><p>${escapeHtmlEtlReport(errMsg)}</p></body></html>`
      try {
        reportWin.document.open()
        reportWin.document.write(htmlErr)
        reportWin.document.close()
      } catch {
        const url = URL.createObjectURL(new Blob([htmlErr], { type: 'text/html;charset=utf-8' }))
        try {
          reportWin.location.replace(url)
          setTimeout(
            () => {
              try {
                URL.revokeObjectURL(url)
              } catch {
                /* ignore */
              }
            },
            30_000
          )
        } catch {
          URL.revokeObjectURL(url)
        }
      }
      addToast({
        type: 'error',
        title: 'Rapport HTML',
        message: `Échec : ${errMsg.length > 180 ? `${errMsg.slice(0, 180)}…` : errMsg}`,
        duration: 8000,
      })
    } finally {
      for (const u of reportTempObjectUrls) {
        try {
          URL.revokeObjectURL(u)
        } catch {
          /* ignore */
        }
      }
    }
  }

  const persistClientRemarkForSelectedAnnotation = useCallback(() => {
    if (!selectedAnnotationId) {
      addToast({ type: 'warning', title: 'Remarque client', message: 'Sélectionnez une annotation.', duration: 2400 })
      return
    }
    const status = parseAnnotationClientRemarkStatus(clientRemarkDraft.status)
    const text = clientRemarkDraft.text.trim()
    const updatedAt = new Date().toISOString()
    let nextList: AnnotationRecord[] | null = null
    setAnnotations(prev => {
      const next = prev.map(a =>
        a.id === selectedAnnotationId
          ? {
              ...a,
              clientRemark: {
                text,
                status,
                updatedAt,
              },
            }
          : a
      )
      nextList = next
      return next
    })
    if (etlBlobProjectSaveEnabled && nextList) {
      queueMicrotask(() => {
        void persistEtlBlobViewerProjectToAzureRef.current?.({
          showToast: false,
          annotationsOverride: nextList!,
        })
      })
    }
    addToast({
      type: 'success',
      title: 'Remarque enregistrée',
      message: `Statut : ${status === 'non-lu' ? 'non lu' : status === 'lu' ? 'lu' : 'confirmé'}.`,
      duration: 2600,
    })
  }, [addToast, clientRemarkDraft.status, clientRemarkDraft.text, etlBlobProjectSaveEnabled, selectedAnnotationId])

  const deleteAnnotation = (id: string) => {
    setAnnotations(prev => prev.filter(a => a.id !== id))
    if (selectedAnnotationId === id) setSelectedAnnotationId(null)
    if (editingAnnotationId === id) {
      setEditAnnotationOpen(false)
      setEditingAnnotationId(null)
    }
  }

  const submitEditAnnotation = () => {
    if (!editingAnnotationId) return
    const identifier = editIdentifier.trim()
    if (!identifier) {
      addToast({ type: 'warning', title: 'Identifiant requis', duration: 2500 })
      return
    }
    const desc = editDescription.trim()
    const isText = editKind === 'text'
    const textContent = (editTextContent || '').trim()
    if (isText && !textContent) {
      addToast({ type: 'warning', title: 'Texte requis', duration: 2500 })
      return
    }
    const col = annotationColorForRecord(editColor)
    const specPatch = !isText ? buildAnnotationSpecPatchFromCreationForm(editSpecSlots, editSpecForm) : {}
    const utEdit = !isText && editUserTemplateId ? userTemplates.find(t => t.id === editUserTemplateId) : undefined
    if (!isText && editUserTemplateId && !utEdit) {
      addToast({
        type: 'warning',
        title: 'Gabarit introuvable',
        message: 'Ce gabarit personnalisé a été supprimé. Choisissez un autre gabarit ou « Aucun » avant d’enregistrer.',
        duration: 4000,
      })
      return
    }
    const customSave = utEdit ? compactStringRecord(editCustomTemplateValues) : undefined
    const customForIntegratedNoUt =
      !isText && editTemplateId && !editUserTemplateId
        ? compactStringRecord(editCustomTemplateValues)
        : undefined
    setAnnotations(prev =>
      prev.map(a => {
        if (a.id !== editingAnnotationId) return a
        const {
          color: _dropColor,
          positionLocked: _dropLock,
          templateId: _templ,
          userTemplateId: _ut,
          customTemplateValues: _ctv,
          textContent: _txt,
          textSizePx: _txtSize,
          textTone: _txtTone,
          lifespan: _ls,
          electricConsumption: _ec,
          lightOutputLux: _lx,
          material: _mt,
          weightKg: _wk,
          purchasePrice: _pp,
          crackLengthCm: _cl,
          crackWidthCm: _cw,
          zoneFillOpacity: _zfo,
          // Ancien schéma : comparaison sur l’annotation — retiré au prochain enregistrement
          panoCompare: _legacyPanoCompare,
          ...rest
        } = a as typeof a & { panoCompare?: unknown }
        return {
          ...rest,
          identifier,
          label: identifier,
          description: desc || undefined,
          ...(isText ? { kind: 'text' as const } : {}),
          ...(isText ? { textContent } : {}),
          ...(isText ? { textSizePx: editTextSizePx } : {}),
          ...(isText ? { textTone: editTextTone } : {}),
          ...(col ? { color: col } : {}),
          ...(editPositionLocked ? { positionLocked: true } : {}),
          ...(editKind === 'zone' || isText
            ? { zoneFillOpacity: clampZoneFillOpacity(editZoneFillOpacity) }
            : {}),
          ...(!isText && editUserTemplateId && utEdit
            ? {
                userTemplateId: editUserTemplateId,
                ...(customSave ? { customTemplateValues: customSave } : {}),
              }
            : {}),
          ...(!isText && editTemplateId && !editUserTemplateId
            ? {
                templateId: editTemplateId,
                ...(customForIntegratedNoUt ? { customTemplateValues: customForIntegratedNoUt } : {}),
              }
            : {}),
          ...(!isText ? specPatch : {}),
        }
      })
    )
    if (!isText) {
      const rk = templatePickerKeyFromParts(editTemplateId, editUserTemplateId)
      if (rk) bumpRecentTemplateChoice(rk)
    }
    setEditSpecPickerOpen(false)
    setEditAnnotationOpen(false)
    setEditingAnnotationId(null)
    addToast({ type: 'success', title: 'Annotation mise a jour', duration: 2000 })
  }

  const submitQuickAnnotation = () => {
    if (!currentPanoId || !pendingYawPitch) return
    const identifier = qaIdentifier.trim()
    if (!identifier) {
      addToast({ type: 'warning', title: 'Identifiant requis', duration: 2500 })
      return
    }
    const isText = qaKind === 'text'
    const textContent = (qaTextContent || '').trim()
    if (isText && !textContent) {
      addToast({ type: 'warning', title: 'Texte requis', duration: 2500 })
      return
    }
    const utQ = !isText && qaUserTemplateId ? userTemplates.find(u => u.id === qaUserTemplateId) : null
    const tplEff = !isText && !utQ && qaTemplateId ? effectiveIntegratedTemplateDef(qaTemplateId, userTemplates) : null
    const integOvQ = !isText && !utQ && qaTemplateId ? integratedTemplateOverride(qaTemplateId, userTemplates) : undefined
    const resolvedColor = resolveAnnotationCreationColor({
      pickerHex: qaColor,
      templateBaseColor: utQ?.color ?? tplEff?.color,
    })
    const colorPatch =
      utQ || tplEff || resolvedColor !== ETL360_DEFAULT_ANNOTATION_COLOR ? { color: resolvedColor } : {}
    const specKeysQ = isText ? [] : utQ ? utQ.builtinSpecKeys ?? [] : tplEff ? tplEff.specKeys : []
    const specPatchQ = isText ? {} : buildAnnotationSpecPatchFromCreationForm(specKeysQ, qaCreationSpec)
    const customFromUtQ = isText ? undefined : utQ ? compactStringRecord(qaCreationCustom) : undefined
    const customFlatIntegratedQ =
      isText ? undefined : !utQ && tplEff ? compactStringRecord(qaCreationCustom) : undefined
    if (qaKind === 'zone' || qaKind === 'text') {
      pendingZoneDraftRef.current = {
        panoId: currentPanoId,
        ...(qaKind === 'text' ? { kind: 'text' as const } : { kind: 'zone' as const }),
        identifier,
        description: qaDescription.trim() || undefined,
        ...colorPatch,
        ...(qaKind === 'text' ? { textContent, textSizePx: qaTextSizePx, textTone: qaTextTone } : {}),
        ...(tplEff ? { templateId: tplEff.id } : {}),
        ...(utQ
          ? {
              userTemplateId: utQ.id,
              ...(utQ.positionLockedDefault ? { positionLocked: true } : {}),
              creationCustomValues: { ...qaCreationCustom },
            }
          : {}),
        ...(!utQ &&
        (integOvQ?.characteristics?.length || integratedSurfaceMatiereTemplateId(qaTemplateId))
          ? { creationCustomValues: { ...qaCreationCustom } }
          : {}),
        ...(!utQ && integOvQ?.positionLockedDefault ? { positionLocked: true } : {}),
        creationBuiltinKeys: specKeysQ,
        creationSpecForm: { ...qaCreationSpec },
        zoneFillOpacity: clampZoneFillOpacity(qaZoneFillOpacity),
      }
      viewerRef.current?.startZonePlacement(pendingYawPitch)
      setQuickOpen(false)
      setPendingYawPitch(null)
      setQaTemplateId('')
      setQaUserTemplateId('')
      setQaCreationSpec(emptyAnnCreationSpecForm())
      setQaCreationCustom({})
      setQaTextContent('')
      setQaTextSizePx(20)
      setQaTextTone('black')
      setQaZoneFillOpacity(ETL360_DEFAULT_ZONE_OVERLAY_FILL_OPACITY)
      addToast({
        type: 'info',
        title: qaKind === 'text' ? 'Dessiner la zone texte' : 'Dessiner la zone',
        message:
          qaKind === 'text'
            ? 'Maintenez le clic gauche sur le panorama pour tracer la zone qui contiendra le texte.'
            : 'Maintenez le clic gauche sur le panorama pour tracer le rectangle en surbrillance.',
        duration: 4200,
      })
      return
    }
    const ann: AnnotationRecord = {
      id: newAnnotationId(),
      panoId: currentPanoId,
      label: identifier,
      identifier,
      description: qaDescription.trim() || undefined,
      ...colorPatch,
      ...specPatchQ,
      ...(tplEff ? { templateId: tplEff.id } : {}),
      ...(utQ
        ? {
            userTemplateId: utQ.id,
            ...(customFromUtQ ? { customTemplateValues: customFromUtQ } : {}),
            ...(utQ.positionLockedDefault ? { positionLocked: true } : {}),
          }
        : {}),
      ...(!utQ && customFlatIntegratedQ ? { customTemplateValues: customFlatIntegratedQ } : {}),
      ...(!utQ && integOvQ?.positionLockedDefault ? { positionLocked: true } : {}),
      origin: clientMode ? 'client_remark' : 'added_annotation',
      kind: 'point',
      yawPitch: { yaw: pendingYawPitch.yaw, pitch: pendingYawPitch.pitch },
    }
    if (!isText) {
      const rk = templatePickerKeyFromParts(qaTemplateId, qaUserTemplateId)
      if (rk) bumpRecentTemplateChoice(rk)
    }
    setAnnotations(prev => {
      const next = [...prev, ann]
      if (clientMode && etlBlobProjectSaveEnabled) {
        queueMicrotask(() => {
          void persistEtlBlobViewerProjectToAzureRef.current?.({
            showToast: false,
            annotationsOverride: next,
          })
        })
      }
      return next
    })
    setQuickOpen(false)
    setPendingYawPitch(null)
    setQaTemplateId('')
    setQaUserTemplateId('')
    setQaCreationSpec(emptyAnnCreationSpecForm())
    setQaCreationCustom({})
    setQaTextContent('')
    setQaTextSizePx(20)
    setQaTextTone('black')
    setQaZoneFillOpacity(ETL360_DEFAULT_ZONE_OVERLAY_FILL_OPACITY)
    addToast({ type: 'success', title: 'Annotation creee', duration: 2000 })
  }

  const submitManualAnnotation = () => {
    if (!currentPano || !currentPanoId) return
    const identifier = manualIdentifier.trim()
    if (!identifier) {
      addToast({ type: 'warning', title: 'Identifiant requis', duration: 2500 })
      return
    }
    const utM = manualUserTemplateId ? userTemplates.find(u => u.id === manualUserTemplateId) : null
    const tplEffM = !utM && manualTemplateId ? effectiveIntegratedTemplateDef(manualTemplateId, userTemplates) : null
    const integOvM = !utM && manualTemplateId ? integratedTemplateOverride(manualTemplateId, userTemplates) : undefined
    const resolvedColor = resolveAnnotationCreationColor({
      pickerHex: manualColor,
      templateBaseColor: utM?.color ?? tplEffM?.color,
    })
    const colorPatch =
      utM || tplEffM || resolvedColor !== ETL360_DEFAULT_ANNOTATION_COLOR ? { color: resolvedColor } : {}
    const specKeysM = utM ? utM.builtinSpecKeys ?? [] : tplEffM ? tplEffM.specKeys : []
    const specPatchM = buildAnnotationSpecPatchFromCreationForm(specKeysM, manualCreationSpec)
    const customFromUtM = utM ? compactStringRecord(manualCreationCustom) : undefined
    const customFromIntegratedM = !utM && tplEffM ? compactStringRecord(manualCreationCustom) : undefined
    const ann: AnnotationRecord = {
      id: newAnnotationId(),
      panoId: currentPanoId,
      label: identifier,
      identifier,
      description: manualDescription.trim() || undefined,
      ...colorPatch,
      ...specPatchM,
      ...(tplEffM ? { templateId: tplEffM.id } : {}),
      ...(utM
        ? {
            userTemplateId: utM.id,
            ...(customFromUtM ? { customTemplateValues: customFromUtM } : {}),
            ...(utM.positionLockedDefault ? { positionLocked: true } : {}),
          }
        : {}),
      ...(!utM && customFromIntegratedM ? { customTemplateValues: customFromIntegratedM } : {}),
      ...(!utM && integOvM?.positionLockedDefault ? { positionLocked: true } : {}),
      origin: clientMode ? 'client_remark' : 'added_annotation',
      kind: 'point',
      yawPitch: { yaw: syntheticYawPitch.yaw, pitch: syntheticYawPitch.pitch },
    }
    const rkManual = templatePickerKeyFromParts(manualTemplateId, manualUserTemplateId)
    if (rkManual) bumpRecentTemplateChoice(rkManual)
    setAnnotations(prev => {
      const next = [...prev, ann]
      if (clientMode && etlBlobProjectSaveEnabled) {
        queueMicrotask(() => {
          void persistEtlBlobViewerProjectToAzureRef.current?.({
            showToast: false,
            annotationsOverride: next,
          })
        })
      }
      return next
    })
    setManualIdentifier('')
    setManualDescription('')
    setManualTemplateId('')
    setManualUserTemplateId('')
    setManualCreationSpec(emptyAnnCreationSpecForm())
    setManualCreationCustom({})
    addToast({ type: 'success', title: 'Annotation ajoutee', duration: 2000 })
  }

  useEffect(() => {
    const prev = previousObjectUrlsRef.current
    const nextSet = new Set(objectUrls)
    for (const url of prev) {
      if (!nextSet.has(url)) URL.revokeObjectURL(url)
    }
    previousObjectUrlsRef.current = objectUrls
  }, [objectUrls])

  useEffect(() => {
    return () => {
      previousObjectUrlsRef.current.forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  /** Manifeste `viewer/etl360-viewer-index.json` (liste « projet » côté UI). */
  const loadEtlBlobViewerListForPanel = useCallback(async () => {
    setEtlBlobViewerListLoading(true)
    setEtlBlobViewerIndexError(null)
    try {
      const { index, status, diagnostics } = await getEtlViewerIndex(etlBlobScope)
      setEtlBlobViewerList({ index, status, diagnostics })
    } catch (e) {
      setEtlBlobViewerList({ index: null, status: null, diagnostics: null })
      setEtlBlobViewerIndexError(e instanceof Error ? e.message : String(e))
    } finally {
      setEtlBlobViewerListLoading(false)
    }
  }, [etlBlobScope])

  const prepareEtlBlobZipExpandOnAzure = useCallback(
    async (zipBlobPath: string) => {
      const trimmed = zipBlobPath.trim()
      if (!trimmed) return
      setEtlPrepareZipBlobPath(trimmed)
      setZipCloudPhase('expand')
      try {
        const started = await startEtlExpandZipJob(trimmed, etlBlobScope)
        if (started.alreadyReady) {
          await loadEtlBlobViewerListForPanel()
          addToast({
            type: 'success',
            title: 'Manifeste viewer',
            message: 'Le dépôt était déjà préparé (expand-zip).',
            duration: 4500,
          })
          return
        }
        if (String(started.jobId || '').startsWith('ready-')) {
          await loadEtlBlobViewerListForPanel()
          return
        }
        const deadline = Date.now() + 25 * 60 * 1000
        while (Date.now() < deadline) {
          const st = await getEtlExpandZipJobStatus(started.jobId)
          if (st.status === 'ready') break
          if (st.status === 'error') {
            throw new Error(st.error || 'Préparation expand-zip en erreur.')
          }
          await new Promise(r => setTimeout(r, 700))
        }
        const last = await getEtlExpandZipJobStatus(started.jobId)
        if (last.status !== 'ready') {
          throw new Error(last.error || 'Délai dépassé pour la préparation du viewer sur Azure.')
        }
        await loadEtlBlobViewerListForPanel()
        addToast({
          type: 'success',
          title: 'Projet préparé sur le blob',
          message: 'Répertoire viewer/ et manifeste générés — ouvrez le projet ou rafraîchissez la liste.',
          duration: 7000,
        })
      } catch (e) {
        addToast({
          type: 'error',
          title: 'Préparation ZIP (Azure)',
          message: e instanceof Error ? e.message : String(e),
          duration: 12000,
        })
      } finally {
        setZipCloudPhase(null)
        setEtlPrepareZipBlobPath(null)
      }
    },
    [addToast, etlBlobScope, loadEtlBlobViewerListForPanel]
  )

  const loadEtlAllViewerIndexList = useCallback(async () => {
    setEtlAllViewerIndexLoading(true)
    setEtlAllViewerIndexError(null)
    try {
      const items = await getEtlViewerIndexList(50)
      setEtlAllViewerIndexItems(items)
    } catch (e) {
      setEtlAllViewerIndexItems([])
      setEtlAllViewerIndexError(e instanceof Error ? e.message : String(e))
    } finally {
      setEtlAllViewerIndexLoading(false)
    }
  }, [])

  const handleRebuildEtlViewerIndexFromBlob = useCallback(async () => {
    setEtlBlobRebuildIndexLoading(true)
    try {
      const { index } = await rebuildEtlViewerIndexOnBlob(etlBlobScope)
      await loadEtlBlobViewerListForPanel()
      await loadEtlAllViewerIndexList()
      const fp = index.floorPlans?.length ?? 0
      addToast({
        type: 'success',
        title: 'Manifeste régénéré (Azure)',
        message: `Scan de viewer/ terminé — ${index.panos?.length ?? 0} panorama(s), ${fp} plan(s), ${index.pointCloudChunkBlobPaths?.length ?? 0} fichier(s) nuage. Cliquez sur « Ouvrir le projet » pour recharger.`,
        duration: 8000,
      })
    } catch (e) {
      addToast({
        type: 'error',
        title: 'Régénération manifeste',
        message: e instanceof Error ? e.message : String(e),
        duration: 12000,
      })
    } finally {
      setEtlBlobRebuildIndexLoading(false)
    }
  }, [addToast, etlBlobScope, loadEtlAllViewerIndexList, loadEtlBlobViewerListForPanel])

  useEffect(() => {
    void loadEtlBlobViewerListForPanel()
  }, [loadEtlBlobViewerListForPanel])

  useEffect(() => {
    void loadEtlAllViewerIndexList()
  }, [loadEtlAllViewerIndexList])

  /** Préfixe blob actuel (URL explicite ou diagnostic serveur) pour comparaison avec la liste multi-dépôts. */
  const etlCurrentBlobPrefixForCompare = useMemo(
    () =>
      projectBlobPrefixParam.trim() || etlBlobViewerList?.diagnostics?.projectBlobPrefix?.trim() || '',
    [projectBlobPrefixParam, etlBlobViewerList?.diagnostics?.projectBlobPrefix]
  )

  /** Manifeste exploitable (schéma courant ou index partiel avec CSV + panos). */
  const etlViewerIndexReadyForPanel = Boolean(
    etlBlobViewerList?.index &&
      (etlBlobViewerList.index.status === 'ready' ||
        (Boolean(etlBlobViewerList.index.mainCsvBlobPath) &&
          (etlBlobViewerList.index.panos?.length ?? 0) > 0))
  )

  const applyEtlBlobViewerProjectState = useCallback(
    (raw: unknown, validPanoIds: Set<string>) => {
      const state = parseEtlViewerProjectStateV1(raw)
      if (!state) return
      const legacyCompareFromAnnotations: Record<string, PanoComparePair> = {}
      for (const ann of state.annotations ?? []) {
        if (!ann || typeof (ann as { panoId?: string }).panoId !== 'string') continue
        const pid = (ann as { panoId: string }).panoId
        if (!validPanoIds.has(pid)) continue
        const pc = (ann as { panoCompare?: { secondaryPanoId?: string; labelPrimary?: string; labelSecondary?: string } })
          .panoCompare
        if (!pc?.secondaryPanoId || pc.secondaryPanoId === pid) continue
        if (legacyCompareFromAnnotations[pid]) continue
        legacyCompareFromAnnotations[pid] = {
          otherPanoId: pc.secondaryPanoId,
          ...(pc.labelPrimary?.trim() ? { labelBefore: pc.labelPrimary.trim() } : {}),
          ...(pc.labelSecondary?.trim() ? { labelAfter: pc.labelSecondary.trim() } : {}),
        }
      }
      const filePairs =
        state.panoComparePairs && typeof state.panoComparePairs === 'object' && !Array.isArray(state.panoComparePairs)
          ? { ...state.panoComparePairs }
          : {}
      for (const [k, v] of Object.entries(legacyCompareFromAnnotations)) {
        if (!filePairs[k]?.otherPanoId) filePairs[k] = v
      }
      setAnnotations(
        (state.annotations ?? []).filter(
          a => a && typeof a.panoId === 'string' && validPanoIds.has(a.panoId)
        )
      )
      setPanoFloorAssignments(prev => {
        const next: Record<string, string> = {}
        for (const [k, v] of Object.entries(state.panoFloorAssignments ?? {})) {
          if (validPanoIds.has(k) && typeof v === 'string' && v.trim()) next[k] = v.trim()
        }
        return { ...prev, ...next }
      })
      setPanos(prev =>
        prev.map(p => {
          const label = state.panoDisplayLabels[p.id]
          let nextP = p
          if (typeof label === 'string' && label.trim()) {
            nextP = { ...nextP, displayLabel: label.trim() }
          }
          const pair = filePairs[p.id] as PanoComparePair | undefined
          if (pair?.otherPanoId && validPanoIds.has(pair.otherPanoId) && pair.otherPanoId !== p.id) {
            return { ...nextP, comparePair: pair }
          }
          if (nextP.comparePair) {
            const { comparePair: _drop, ...rest } = nextP
            return rest as PanoRecord
          }
          return nextP
        })
      )
      const fl = state.panoViewAxisFlips ?? {}
      setPanoViewAxisFlipsMap(prev => {
        const o = { ...prev }
        for (const [id, row] of Object.entries(fl)) {
          if (!validPanoIds.has(id) || !row || typeof row !== 'object') continue
          const flipX = Boolean((row as { flipX?: unknown }).flipX)
          const flipY = Boolean((row as { flipY?: unknown }).flipY)
          o[id] = { flipX, flipY }
        }
        return o
      })
      if (state.floorPlanReplacements && Object.keys(state.floorPlanReplacements).length > 0) {
        setFloorPlanReplacements(prev => {
          const merged: Record<string, FloorPlanReplacementRecord> = { ...prev, ...state.floorPlanReplacements }
          try {
            localStorage.setItem(
              floorPlanReplacementsStorageKey(projectCodeForStorage),
              serializeFloorPlanReplacementsToStorage(merged)
            )
          } catch {
            /* quota */
          }
          return merged
        })
      }
    },
    [projectCodeForStorage]
  )

  const etlBlobProjectPersistingRef = useRef(false)
  const persistEtlBlobViewerProjectToAzure = useCallback(
    async (opts?: { showToast?: boolean; annotationsOverride?: AnnotationRecord[] }) => {
      const showToast = opts?.showToast !== false
      const annotationsForBlob = opts?.annotationsOverride ?? annotations
      if (!etlBlobProjectSaveEnabled) return
      if (etlBlobProjectPersistingRef.current) {
        if (!opts?.annotationsOverride) return
        let waited = 0
        while (etlBlobProjectPersistingRef.current && waited < 8000) {
          await new Promise<void>(r => {
            window.setTimeout(r, 60)
          })
          waited += 60
        }
        if (etlBlobProjectPersistingRef.current) return
      }
      etlBlobProjectPersistingRef.current = true
      setEtlBlobProjectSaving(true)
      try {
        const panoDisplayLabels: Record<string, string> = {}
        const panoComparePairs: Record<string, PanoComparePair> = {}
        for (const p of panos) {
          const t = p.displayLabel?.trim()
          if (t) panoDisplayLabels[p.id] = t
          if (p.comparePair?.otherPanoId) {
            panoComparePairs[p.id] = p.comparePair
          }
        }
        const state: EtlViewerProjectStateV1 = {
          ...createEmptyEtlViewerProjectStateV1(),
          updatedAt: new Date().toISOString(),
          annotations: annotationsForBlob,
          panoDisplayLabels,
          panoComparePairs: Object.keys(panoComparePairs).length > 0 ? panoComparePairs : undefined,
          panoFloorAssignments: { ...panoFloorAssignments },
          panoViewAxisFlips: { ...panoViewAxisFlipsMap },
          floorPlanReplacements: { ...floorPlanReplacements },
        }
        const r = await putEtlViewerProjectState(
          { ...state, schema: state.schema, updatedAt: state.updatedAt } as unknown as Record<string, unknown>,
          etlBlobScope
        )
        if (showToast) {
          addToast({
            type: 'success',
            title: 'Projet enregistré',
            message: `État enregistré sur Azure (${(r.sizeBytes / 1024).toFixed(1)} ko).`,
            duration: 4200,
          })
        }
      } catch (e) {
        addToast({
          type: 'error',
          title: 'Enregistrement',
          message: e instanceof Error ? e.message : String(e),
          duration: 8000,
        })
      } finally {
        etlBlobProjectPersistingRef.current = false
        setEtlBlobProjectSaving(false)
      }
    },
    [
      etlBlobProjectSaveEnabled,
      panos,
      annotations,
      panoFloorAssignments,
      panoViewAxisFlipsMap,
      floorPlanReplacements,
      etlBlobScope,
      addToast,
    ]
  )

  persistEtlBlobViewerProjectToAzureRef.current = persistEtlBlobViewerProjectToAzure

  useEffect(() => {
    if (!etlBlobProjectSaveEnabled || !etlBlobAutosaveArmed) return
    if (etlBlobAutosaveTimerRef.current) clearTimeout(etlBlobAutosaveTimerRef.current)
    etlBlobAutosaveTimerRef.current = setTimeout(() => {
      void persistEtlBlobViewerProjectToAzure({ showToast: false })
    }, 500)
    return () => {
      if (etlBlobAutosaveTimerRef.current) clearTimeout(etlBlobAutosaveTimerRef.current)
    }
  }, [
    etlBlobProjectSaveEnabled,
    etlBlobAutosaveArmed,
    panos,
    annotations,
    panoFloorAssignments,
    panoViewAxisFlipsMap,
    floorPlanReplacements,
    persistEtlBlobViewerProjectToAzure,
  ])

  const saveEtlBlobViewerProjectToAzure = useCallback(() => {
    void persistEtlBlobViewerProjectToAzure({ showToast: true })
  }, [persistEtlBlobViewerProjectToAzure])

  if (!canAccessETL(user)) {
    return <Navigate to="/luxembourg/seco-geolux" replace />
  }
  /**
   * Projet Dynamics ETL requis (code contient « ETL ») : `isDynamicsEtlProjectCode` (etlChantierAccess.ts).
   * `VITE_ETL_VIEWER360_DEV=true` en `npm run dev` dispense pour tout code.
   * Sur localhost, les codes fictifs TEST-LOCAL / TEST-LOCAL-CSP / ETL-LOCAL restent autorisés (Dynamics souvent absent).
   */
  if (
    !isEtlViewer360LocalDevEnabled() &&
    !isDynamicsEtlProjectCode(projectCode) &&
    !isLocalhostEtlTestProjectCode(projectCode)
  ) {
    return <Navigate to="/luxembourg/seco-geolux/etat-des-lieux/project-info" replace />
  }

  const handleLoadUnifiedZipFile = async (
    file: File | null,
    zipOptions?: { skipAzureReupload?: boolean }
  ) => {
    if (!file) return
    // #region agent log
    etl360PostDebugIngest({
      sessionId: '546eb8',
      runId: 'load-unified-zip-start',
      hypothesisId: 'Hload',
      location: 'ETLViewer360.tsx:handleLoadUnifiedZipFile',
      message: 'unified zip load started',
      data: { fileName: file.name, size: file.size, pagePort: typeof window !== 'undefined' ? window.location.port : '' },
      timestamp: Date.now(),
    })
    // Phase 0 guardrail : avertissement taille ZIP local
    if (file.size > 400 * 1024 * 1024 && !zipOptions?.skipAzureReupload) {
      const sizeMo = (file.size / (1024 * 1024)).toFixed(0)
      const go = window.confirm(
        `Ce ZIP fait ${sizeMo} Mo.\n\nLa décompression JSZip peut échouer si la RAM est insuffisante.\nPour les très gros projets, déposez d’abord l’archive sur le stockage Azure (hors de cette application), puis ouvrez le projet depuis la section « Ouvrir un projet (Azure) ».\n\nContinuer ?`
      )
      if (!go) return
    }
    // #endregion
    setLoading(true)
    setEtlBlobProjectSaveEnabled(false)
    setEtlBlobAutosaveArmed(false)
    setE57Loading(true)
    setSelectedAnnotationId(null)
    setImportAngleReadDebug(null)
    resetImportedAngleNormalizationDebugStats()

    const previousUrls = [...objectUrls]
    try {
      const pipeline = await buildUnifiedZipPipelineResult({
        file,
        projectCode,
        floorGroupingToleranceM,
        floorSliceHeightM,
      })
      previousUrls.forEach(url => URL.revokeObjectURL(url))
      applyPointCloudSource(pipeline.pointCloud)
      setObjectUrls(pipeline.objectUrls)
      setPanos(pipeline.panos)
      setAnnotations(pipeline.annotations)
      setFloorMapAssets(pipeline.floorMapAssets)
      setPanoFloorAssignments(pipeline.panoFloorAssignments)
      setCurrentPanoId(pipeline.currentPanoId)
      setSelectedFloor('ALL')
      devFloorPlanPanoBaselineRef.current = clonePanosForDevFloorBaseline(pipeline.panos)
      setFloormapDevAlignFromPointCloud(false)
      // #region agent log
      etl360PostDebugIngest({
        sessionId: '546eb8',
        runId: 'load-unified-zip-success',
        hypothesisId: 'Hload',
        location: 'ETLViewer360.tsx:handleLoadUnifiedZipFile',
        message: 'unified zip load succeeded',
        data: {
          fileName: file.name,
          panosCount: pipeline.panos.length,
          firstPanoId: pipeline.panos[0]?.id ?? null,
          e57PointCount: Math.floor(pipeline.pointCloud.positions.length / 3),
          floorPlansCount: pipeline.floorMapAssets.length,
        },
        timestamp: Date.now(),
      })
      // #endregion
      addToast({
        type: 'success',
        title: 'Viewer 360',
        message: `${pipeline.panos.length} panorama(s) + nuage E57 ; ${
          pipeline.floorPlansFromE57Slices
            ? `plans générés depuis le nuage (coupes).`
            : `${pipeline.floorMapAssets.length} plan(s) GeoTIFF.`
        }`,
        duration: 3000,
      })
      const allWarnings = [...pipeline.warnings, ...pipeline.spatialWarnings]
      if (allWarnings.length > 0) {
        addToast({
          type: 'warning',
          title: 'Import partiel',
          message: allWarnings[0],
          duration: 4200,
        })
      }
      if (zipOptions?.skipAzureReupload) {
        addToast({
          type: 'success',
          title: 'Projet (ZIP)',
          message: 'Archive chargée depuis le stockage Azure — pas de renvoi nécessaire (déjà sur le blob).',
          duration: 4500,
        })
      } else {
        // Un ZIP = un nouveau dossier sous Geolux/ETL/etl_<uuid>/ (source/ + job expand-zip côté serveur).
        setZipCloudPhase('upload')
        try {
          const info = await getEtlPointCloudPipelineInfo()
          if (!info.zipUploadSupported || !info.expandZipSupported) {
            addToast({
              type: 'warning',
              title: 'Projet (Azure)',
              message:
                "Ce serveur n'indique pas la prise en charge complète (upload / expand ZIP). L'import local reste utilisable — synchronisation vers le blob non effectuée.",
              duration: 7000,
            })
          } else {
            const { collision, existingBlobPath } = await getEtlSourceZipFilenameCollision(file.name)
            if (collision) {
              addToast({
                type: 'error',
                title: 'Envoi sur le stockage annulé',
                message: `Un fichier ZIP portant le même nom (une fois normalisé) est déjà présent sur le stockage${
                  existingBlobPath ? ` : ${existingBlobPath}` : ''
                }. Renommez l’archive sur votre poste, ou supprimez l’exemplaire sur Azure.`,
                duration: 10000,
              })
            } else {
            const scopeBase: EtlProjectScopeInput = {
              projectId: projectId.trim() || undefined,
              projectCode: projectCode.trim() || undefined,
            }
            const uploadRes = await uploadE57PointCloudViaBackendProxy(
              file,
              undefined,
              undefined,
              scopeBase,
              { newEtl3dProject: true }
            )
            if (!uploadRes.projectBlobPrefix) {
              throw new Error('Réponse serveur incomplète (projectBlobPrefix manquant).')
            }
            const scopeWithPrefix: EtlProjectScopeInput = {
              ...scopeBase,
              projectBlobPrefix: uploadRes.projectBlobPrefix,
            }
            setZipCloudPhase('expand')
            const started = await startEtlExpandZipJob(uploadRes.blobPath, scopeWithPrefix)
            if (!started.alreadyReady) {
              const deadline = Date.now() + 20 * 60 * 1000
              while (Date.now() < deadline) {
                const st = await getEtlExpandZipJobStatus(started.jobId)
                if (st.status === 'ready') break
                if (st.status === 'error') {
                  throw new Error(st.error || 'Préparation du viewer sur le serveur en échec.')
                }
                await new Promise(r => setTimeout(r, 600))
              }
              if (Date.now() >= deadline) {
                throw new Error('Délai dépassé pour la préparation des fichiers (expand-zip).')
              }
            }
            const next = new URLSearchParams(searchParams)
            next.set('projectBlobPrefix', uploadRes.projectBlobPrefix)
            navigate(
              { pathname: location.pathname, search: `?${next.toString()}` },
              { replace: true }
            )
            setEtlBlobProjectSaveEnabled(true)
            setEtlBlobAutosaveArmed(false)
            window.setTimeout(() => {
              setEtlBlobAutosaveArmed(true)
            }, 1200)
            addToast({
              type: 'success',
              title: 'Projet (Azure)',
              message: `Nouveau dépôt : ${uploadRes.projectBlobPrefix} — ZIP en source/ et extraction serveur lancée (viewer/).`,
              duration: 6000,
            })
            }
          }
        } catch (cloudErr) {
          addToast({
            type: 'warning',
            title: 'Synchronisation Azure',
            message: cloudErr instanceof Error ? cloudErr.message : String(cloudErr),
            duration: 9000,
          })
        } finally {
          setZipCloudPhase(null)
        }
      }
      const importAngleStats = readImportedAngleNormalizationDebugStats()
      setImportAngleReadDebug({
        source: 'zip',
        fileName: file.name,
        convertedAnnotations: importAngleStats.convertedAnnotations,
        convertedFields: importAngleStats.convertedFields,
        loggedSamples: importAngleStats.loggedSamples,
      })
      etl360PostDebugIngest({
        sessionId: '546eb8',
        runId: 'import-angle-summary',
        hypothesisId: 'Hann',
        location: 'ETLViewer360.tsx:handleLoadUnifiedZipFile',
        message: 'annotation angle conversion summary after data read',
        data: {
          fileName: file.name,
          convertedAnnotations: importAngleStats.convertedAnnotations,
          convertedFields: importAngleStats.convertedFields,
          loggedSamples: importAngleStats.loggedSamples,
          pagePort: typeof window !== 'undefined' ? window.location.port : '',
        },
        timestamp: Date.now(),
      })
    } catch (error: any) {
      // #region agent log
      etl360PostDebugIngest({
        sessionId: '546eb8',
        runId: 'load-unified-zip-error',
        hypothesisId: 'Hload',
        location: 'ETLViewer360.tsx:handleLoadUnifiedZipFile',
        message: 'unified zip load failed',
        data: {
          fileName: file.name,
          error: error?.message ?? String(error),
        },
        timestamp: Date.now(),
      })
      // #endregion
      setEtlBlobProjectSaveEnabled(false)
      addToast({
        type: 'error',
        title: 'Chargement ZIP unique impossible',
        message: error?.message || 'Verifiez la structure du ZIP (images + CSV + manifest/chunks E57).',
        duration: 4500,
      })
      setImportAngleReadDebug(null)
      previousUrls.forEach(url => URL.revokeObjectURL(url))
      setObjectUrls([])
      setPanos([])
      setAnnotations([])
      setFloorMapAssets([])
      setPanoFloorAssignments({})
      setCurrentPanoId(null)
      setSelectedFloor('ALL')
      devFloorPlanPanoBaselineRef.current = null
      setFloormapDevAlignFromPointCloud(false)
      clearPointCloudSource()
    } finally {
      setLoading(false)
      setE57Loading(false)
      setZipCloudPhase(null)
    }
  }

  // ── Chargement depuis l'index viewer (Phase 3) ───────────────────────────────

  /**
   * Charge le **projet** ETL sur Azure : manifeste `viewer/etl360-viewer-index.json` (données souvent
   * produites depuis une archive `.zip` déposée sous `source/`, mais le modèle générique = répertoire `viewer/`).
   * Les panoramas sont créés sans image locale (téléchargement paresseux). État éditable : `viewer/etl360-project-state.json`.
   */
  const handleLoadFromViewerIndex = async (viewerIndex: EtlViewerIndex) => {
    if (!viewerIndex.mainCsvBlobPath) {
      addToast({ type: 'error', title: 'Projet (index)', message: 'Index incomplet : aucun CSV de poses panoramas.', duration: 6000 })
      return
    }
    setLoading(true)
    setEtlBlobProjectSaveEnabled(false)
    setEtlBlobAutosaveArmed(false)
    try {
      const csvText = await downloadEtlViewerFileAsText(viewerIndex.mainCsvBlobPath, etlBlobScope)
      const filenameToBlobPath = new Map<string, string>()
      for (const panoEntry of viewerIndex.panos) {
        const base = panoEntry.filename.toLowerCase().split('/').pop() ?? panoEntry.filename.toLowerCase()
        filenameToBlobPath.set(base, panoEntry.blobPath)
      }
      const { panos: parsedPanos, warnings } = parsePanosFromCsvTextLazy(csvText, filenameToBlobPath)
      if (parsedPanos.length === 0) {
        addToast({ type: 'error', title: 'Projet (index)', message: 'Aucun panorama trouvé dans le CSV de poses.', duration: 6000 })
        return
      }

      // Chargement des plans de sol et du nuage de points en parallèle depuis le blob
      const newObjectUrls: string[] = []
      const floorWarnings: string[] = []
      let loadedFloorMapAssets: import('@shared/core/types/etlSpatial').FloorMapAsset[] = []

      const downloadBlobFn = async (blobPath: string) => {
        const { blob } = await downloadEtlViewerFileAsBlob(blobPath, undefined, undefined, etlBlobScope)
        return blob
      }

      const [floorResult, cloudResult] = await Promise.allSettled([
        viewerIndex.floorPlans?.length > 0
          ? buildFloorMapAssetsFromBlobEntries(
              viewerIndex.floorPlans,
              downloadBlobFn,
              newObjectUrls,
              floorWarnings,
              { floorSliceHalfMeters: floorSliceHeightM / 2 },
            )
          : Promise.resolve([]),
        viewerIndex.pointCloudChunkBlobPaths?.length > 0
          ? loadPointCloudFromBlobPaths(
              viewerIndex.pointCloudManifestBlobPath ?? null,
              viewerIndex.pointCloudChunkBlobPaths,
              downloadBlobFn,
            )
          : Promise.resolve(null),
      ])

      if (floorResult.status === 'fulfilled') {
        loadedFloorMapAssets = floorResult.value
      } else {
        floorWarnings.push('Erreur lors du chargement des plans GeoTIFF depuis le blob.')
      }

      objectUrls.forEach(url => URL.revokeObjectURL(url))
      setPanos(parsedPanos)
      setAnnotations([])
      setFloorMapAssets(loadedFloorMapAssets)
      setPanoFloorAssignments(
        loadedFloorMapAssets.length > 0
          ? assignPanosToFloorsAutomatically(parsedPanos, loadedFloorMapAssets)
          : {}
      )
      setObjectUrls(newObjectUrls)
      setCurrentPanoId(parsedPanos[0]?.id ?? null)
      setSelectedFloor('ALL')

      // Appliquer ou effacer le nuage de points
      if (cloudResult.status === 'fulfilled' && cloudResult.value) {
        applyPointCloudSource(cloudResult.value)
      } else {
        clearPointCloudSource()
      }

      const validPanoIdSet = new Set(parsedPanos.map(p => p.id))
      try {
        const remote = await getEtlViewerProjectState(etlBlobScope)
        if (remote) applyEtlBlobViewerProjectState(remote, validPanoIdSet)
      } catch {
        /* pas d’état projet ou indisponible : défauts ci-dessus */
      }
      // L'état Azure peut contenir d'anciens libellés d'étage (ex. noms dérivés d'un ZIP) alors que
      // viewerIndex.floorPlans ne liste que les TIFF actuels — sans filtre, floorLabels mélange les deux
      // et un étage « fantôme » apparaît sans plan correspondant.
      if (loadedFloorMapAssets.length > 0) {
        const validFloorLabels = new Set(loadedFloorMapAssets.map(a => a.floorLabel.trim()).filter(Boolean))
        setPanoFloorAssignments(prev => {
          const filtered = filterFloorAssignmentsToKnownPlans(prev, loadedFloorMapAssets)
          const auto = assignPanosToFloorsAutomatically(parsedPanos, loadedFloorMapAssets)
          const out = { ...filtered }
          for (const p of parsedPanos) {
            const fl = (out[p.id] || '').trim()
            if (!fl || !validFloorLabels.has(fl)) {
              const a = auto[p.id]
              if (a) out[p.id] = a
            }
          }
          return out
        })
        setFloorPlanReplacements(prev => {
          const next: Record<string, FloorPlanReplacementRecord> = {}
          for (const [k, v] of Object.entries(prev)) {
            if (validFloorLabels.has(k.trim())) next[k] = v
          }
          return next
        })
      }
      devFloorPlanPanoBaselineRef.current = clonePanosForDevFloorBaseline(parsedPanos)
      setFloormapDevAlignFromPointCloud(false)
      setEtlBlobProjectSaveEnabled(true)
      setEtlBlobAutosaveArmed(false)
      window.setTimeout(() => {
        setEtlBlobAutosaveArmed(true)
      }, 1200)

      const cloudCount = cloudResult.status === 'fulfilled' && cloudResult.value
        ? Math.floor(cloudResult.value.positions.length / 3)
        : 0
      const allWarnings = [...warnings, ...floorWarnings]
      if (allWarnings.length > 0) {
        addToast({ type: 'warning', title: 'Projet (index)', message: allWarnings[0], duration: 5000 })
      }
      addToast({
        type: 'success',
        title: 'Projet chargé (Azure)',
        message: `${parsedPanos.length} panorama(s)${loadedFloorMapAssets.length > 0 ? ` + ${loadedFloorMapAssets.length} plan(s) d'étage` : ''}${cloudCount > 0 ? ` + ${cloudCount.toLocaleString()} points` : ''} — annotations / renommages rechargés si présents sur le blob.`,
        duration: 4000,
      })
    } catch (err) {
      setEtlBlobProjectSaveEnabled(false)
      setEtlBlobAutosaveArmed(false)
      addToast({ type: 'error', title: 'Projet (index)', message: err instanceof Error ? err.message : String(err), duration: 8000 })
    } finally {
      setLoading(false)
    }
  }

  const remapPanosByFloorSlices = async () => {
    const sourcePositions = e57SourcePositionsRef.current
    if (!sourcePositions || sourcePositions.length < 3 || !e57SourceBoundsRef.current) {
      addToast({
        type: 'warning',
        title: 'Remap etages',
        message: 'Chargez d abord un ZIP unique contenant le nuage E57.',
        duration: 3600,
      })
      return
    }
    if (panos.length === 0) {
      addToast({
        type: 'warning',
        title: 'Remap etages',
        message: 'Aucun panorama charge a remapper.',
        duration: 3200,
      })
      return
    }

    setLoading(true)
    try {
      const remapped = await remapViewer360FloorGrouping({
        panos,
        sourcePositions,
        floorMapAssets,
        floorPlansFromE57Slices,
        floorGroupingToleranceM,
        floorSliceHeightM,
      })

      if (floorPlansFromE57Slices) {
        remapped.replacedPlanUrls.forEach(url => URL.revokeObjectURL(url))
        setObjectUrls(prev => [...prev.filter(url => !remapped.replacedPlanUrls.includes(url)), ...remapped.newPlanUrls])
      }

      setFloorMapAssets(remapped.floorMapAssets)
      setPanoFloorAssignments(remapped.panoFloorAssignments)
      setPanos(remapped.panos)
      devFloorPlanPanoBaselineRef.current = clonePanosForDevFloorBaseline(remapped.panos)
      setFloormapDevAlignFromPointCloud(false)
      if (currentPanoId && !remapped.panos.some(p => p.id === currentPanoId)) {
        setCurrentPanoId(remapped.panos[0]?.id ?? null)
      }
      setSelectedFloor('ALL')

      addToast({
        type: 'success',
        title: 'Remap etages',
        message: `${Object.keys(remapped.panoFloorAssignments).length} panorama(s) reassignes automatiquement.`,
        duration: 3200,
      })
      if (remapped.warnings.length > 0 || remapped.spatialWarnings.length > 0) {
        addToast({
          type: 'warning',
          title: 'Remap partiel',
          message: [...remapped.warnings, ...remapped.spatialWarnings][0],
          duration: 4200,
        })
      }
    } catch (error: any) {
      addToast({
        type: 'error',
        title: 'Remap etages impossible',
        message: error?.message || 'Essayez d ajuster les parametres de regroupement et de coupe.',
        duration: 4300,
      })
    } finally {
      setLoading(false)
    }
  }

  const syncFloormapDevAlignFromToggle = useCallback(
    (useCloud: boolean) => {
      if (!useCloud) {
        setFloormapDevAlignFromPointCloud(false)
        const b = devFloorPlanPanoBaselineRef.current
        if (b?.length && floorMapAssets.length > 0) {
          setPanos(clonePanosForDevFloorBaseline(b))
          setPanoFloorAssignments(assignPanosToFloorsAutomatically(b, floorMapAssets))
        } else if (b?.length) {
          setPanos(clonePanosForDevFloorBaseline(b))
        }
        return
      }
      const pos = e57SourcePositionsRef.current
      if (!pos || pos.length < 3 || !e57Stats) {
        addToast({
          type: 'warning',
          title: 'Alignement nuage',
          message: 'Chargez un nuage de points (ZIP E57 ou nuage du projet Azure) pour aligner depuis le nuage.',
          duration: 4500,
        })
        return
      }
      if (floorMapAssets.length === 0 || panos.length === 0) {
        addToast({
          type: 'warning',
          title: 'Alignement nuage',
          message: 'Il faut des panoramas et des plans GeoTIFF.',
          duration: 3800,
        })
        return
      }
      const hasZBand = floorMapAssets.some(
        a =>
          (Number.isFinite(a.sliceMinZ) && Number.isFinite(a.sliceMaxZ)) || Number.isFinite(a.floorAltitude)
      )
      if (!hasZBand) {
        addToast({
          type: 'warning',
          title: 'Alignement nuage',
          message: 'Les plans n’ont pas d’altitude / bande Z exploitable (métadonnées GeoTIFF).',
          duration: 5000,
        })
        return
      }
      if (!devFloorPlanPanoBaselineRef.current) {
        devFloorPlanPanoBaselineRef.current = clonePanosForDevFloorBaseline(panos)
      }
      const base = devFloorPlanPanoBaselineRef.current
      try {
        const { panoFloorAssignments: nextA, panos: nextP, warnings } =
          assignNearestFloorAndPositionsFromCloudPoint(base, floorMapAssets, pos, {
            sliceHalfM: floorSliceHeightM / 2,
          })
        setPanoFloorAssignments(nextA)
        setPanos(nextP)
        setFloormapDevAlignFromPointCloud(true)
        setSelectedFloor('ALL')
        if (warnings.length > 0) {
          addToast({ type: 'warning', title: 'Alignement nuage', message: warnings[0], duration: 6000 })
        }
      } catch (e) {
        addToast({
          type: 'error',
          title: 'Alignement nuage',
          message: e instanceof Error ? e.message : String(e),
          duration: 5000,
        })
      }
    },
    [addToast, e57Stats, floorMapAssets, floorSliceHeightM, panos]
  )

  const handleLoadE57PackageZipFile = async (file: File | null) => {
    if (!file) return
    // #region agent log
    etl360PostDebugIngest({
      sessionId: '546eb8',
      runId: 'load-e57-zip-start',
      hypothesisId: 'Hload',
      location: 'ETLViewer360.tsx:handleLoadE57PackageZipFile',
      message: 'e57 package zip load started',
      data: { fileName: file.name, size: file.size },
      timestamp: Date.now(),
    })
    // #endregion
    setE57Loading(true)
    try {
      addToast({
        type: 'info',
        title: 'Package ZIP E57',
        message: 'Lecture du manifest et des chunks binaires contenus dans le ZIP…',
        duration: 4200,
      })

      const pointCloud = await buildE57PackagePipelineResult(file)
      applyPointCloudSource(pointCloud)
      addToast({
        type: 'success',
        title: 'ZIP E57 charge',
        message: `${Math.floor(pointCloud.positions.length / 3).toLocaleString()} / ${pointCloud.meta.sourcePointCount.toLocaleString()} points charges.`,
        duration: 4500,
      })
      // #region agent log
      etl360PostDebugIngest({
        sessionId: '546eb8',
        runId: 'load-e57-zip-success',
        hypothesisId: 'Hload',
        location: 'ETLViewer360.tsx:handleLoadE57PackageZipFile',
        message: 'e57 package zip load succeeded',
        data: {
          fileName: file.name,
          pointCount: Math.floor(pointCloud.positions.length / 3),
          manifestPointCount: pointCloud.meta.sourcePointCount,
        },
        timestamp: Date.now(),
      })
      // #endregion
    } catch (error: unknown) {
      // #region agent log
      etl360PostDebugIngest({
        sessionId: '546eb8',
        runId: 'load-e57-zip-error',
        hypothesisId: 'Hload',
        location: 'ETLViewer360.tsx:handleLoadE57PackageZipFile',
        message: 'e57 package zip load failed',
        data: {
          fileName: file.name,
          error: error instanceof Error ? error.message : String(error),
        },
        timestamp: Date.now(),
      })
      // #endregion
      clearPointCloudSource()
      addToast({
        type: 'error',
        title: 'Chargement ZIP E57 impossible',
        message: formatE57LoadError(error),
        duration: 8000,
      })
    } finally {
      setE57Loading(false)
    }
  }

  const handleLoadE57File = async (file: File | null) => {
    if (!file) return
    // #region agent log
    etl360PostDebugIngest({
      sessionId: '546eb8',
      runId: 'load-e57-file-start',
      hypothesisId: 'Hload',
      location: 'ETLViewer360.tsx:handleLoadE57File',
      message: 'direct e57 load started',
      data: { fileName: file.name, size: file.size },
      timestamp: Date.now(),
    })
    // #endregion
    setE57Loading(true)
    try {
      if (file.size > ETL360_E57_LARGE_FILE_BYTES) {
        addToast({
          type: 'warning',
          title: 'Fichier E57 volumineux',
          message:
            'Les gros E57 ne sont plus importes directement. Generez d abord un ZIP viewer via le script Python externe, puis chargez ce ZIP.',
          duration: 5500,
        })
      }
      addToast({
        type: 'info',
        title: 'E57: conversion webworker',
        message: 'Traitement local dans un worker pour éviter le blocage de l’interface…',
        duration: 3200,
      })
      try {
        const pointCloud = await importDirectE57InWorker(file)
        applyPointCloudSource(pointCloud)
        addToast({
          type: 'success',
          title: 'E57 charge (webworker)',
          message: `${pointCloud.displayedPointCount.toLocaleString()} / ${pointCloud.meta.sourcePointCount.toLocaleString()} points charges.`,
          duration: 4200,
        })
        // #region agent log
        etl360PostDebugIngest({
          sessionId: '546eb8',
          runId: 'load-e57-file-success',
          hypothesisId: 'Hload',
          location: 'ETLViewer360.tsx:handleLoadE57File',
          message: 'direct e57 load succeeded',
          data: {
            fileName: file.name,
            displayedPointCount: pointCloud.displayedPointCount,
            sourcePointCount: pointCloud.meta.sourcePointCount,
          },
          timestamp: Date.now(),
        })
        // #endregion
      } catch (_workerError) {
        addToast({
          type: 'warning',
          title: 'Webworker insuffisant',
          message: 'Le traitement local worker a echoue ; generez un package ZIP E57 via le script Python externe.',
          duration: 5200,
        })
        throw _workerError
      }
    } catch (error: unknown) {
      // #region agent log
      etl360PostDebugIngest({
        sessionId: '546eb8',
        runId: 'load-e57-file-error',
        hypothesisId: 'Hload',
        location: 'ETLViewer360.tsx:handleLoadE57File',
        message: 'direct e57 load failed',
        data: {
          fileName: file.name,
          error: error instanceof Error ? error.message : String(error),
        },
        timestamp: Date.now(),
      })
      // #endregion
      clearPointCloudSource()
      addToast({
        type: 'error',
        title: 'Chargement E57 impossible',
        message: formatE57LoadError(error),
        duration: 8000,
      })
    } finally {
      setE57Loading(false)
    }
  }

  const creationSpecInputCls =
    'mt-1 w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500 text-sm'

  const renderAnnCreationBuiltinBlock = (
    keys: AnnotationSpecFieldKey[],
    form: AnnCreationSpecForm,
    setForm: React.Dispatch<React.SetStateAction<AnnCreationSpecForm>>
  ) => {
    if (keys.length === 0) return null
    const p = (patch: Partial<AnnCreationSpecForm>) => setForm(prev => ({ ...prev, ...patch }))
    return (
      <div className="space-y-2 border-t border-white/10 pt-3 mt-1">
        <p className="text-xs font-medium text-gray-400">Caractéristiques du gabarit</p>
        {keys.map(k => {
          const meta = ANNOTATION_SPEC_FIELD_BY_KEY[k]
          return (
            <label key={k} className="block text-gray-300 text-sm">
              {meta.label}
              <input
                value={form[k]}
                onChange={e => p({ [k]: e.target.value } as Partial<AnnCreationSpecForm>)}
                placeholder={meta.placeholder}
                {...(meta.inputMode ? { inputMode: meta.inputMode as 'decimal' } : {})}
                className={creationSpecInputCls}
              />
            </label>
          )
        })}
      </div>
    )
  }

  const renderAnnCreationCustomBlock = (
    ut: UserAnnotationTemplate | undefined,
    custom: Record<string, string>,
    setCustom: React.Dispatch<React.SetStateAction<Record<string, string>>>
  ) => {
    if (!ut || ut.characteristics.length === 0) return null
    return (
      <div className="space-y-2 border-t border-white/10 pt-3">
        <p className="text-xs font-medium text-gray-400">Champs personnalisés du gabarit</p>
        {ut.characteristics.map(c => (
          <label key={c.key} className="block text-gray-300 text-sm">
            {c.label}
            <input
              value={custom[c.key] ?? ''}
              onChange={e => setCustom(prev => ({ ...prev, [c.key]: e.target.value }))}
              className={creationSpecInputCls}
              placeholder={c.defaultValue ? `défaut : ${c.defaultValue}` : undefined}
            />
          </label>
        ))}
      </div>
    )
  }

  const renderAnnCreationSurfaceMatiereBlock = (
    templateId: AnnotationTemplateId | '',
    custom: Record<string, string>,
    setCustom: React.Dispatch<React.SetStateAction<Record<string, string>>>
  ) => {
    const sm = integratedSurfaceMatiereTemplateId(templateId)
    const profile = sm ? matiereWidgetProfileFor(sm) : undefined
    if (!sm || !profile) return null
    const presetKey = profile.presetKey
    const autreKey = profile.autreKey
    const choices = profile.choices
    const preset = custom[presetKey] ?? ''
    const autre = custom[autreKey] ?? ''
    const isAutre = preset === INTEGRATED_SURFACE_AUTRE_VALUE
    const setPreset = (v: string) => {
      setCustom(prev => ({
        ...prev,
        [presetKey]: v,
        ...(v !== INTEGRATED_SURFACE_AUTRE_VALUE ? { [autreKey]: '' } : {}),
      }))
    }
    return (
      <div className="space-y-2 border-t border-white/10 pt-3 mt-1">
        <p className="text-xs font-medium text-gray-400">Matière (gabarit)</p>
        <label className="block text-gray-300 text-sm">
          Type de matière
          <select
            value={preset}
            onChange={e => setPreset(e.target.value)}
            className={`mt-1 w-full px-3 py-2 text-sm shrink-0 ${ETL360_SELECT_BASE}`}
          >
            <option value="">— Choisir —</option>
            {choices.map(c => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
            <option value={INTEGRATED_SURFACE_AUTRE_VALUE}>Autre…</option>
          </select>
        </label>
        {isAutre ? (
          <label className="block text-gray-300 text-sm">
            Autre…
            <input
              value={autre}
              onChange={e => setCustom(prev => ({ ...prev, [autreKey]: e.target.value }))}
              placeholder="Préciser la matière"
              className={creationSpecInputCls}
            />
          </label>
        ) : null}
        {profile.checkboxFields?.length ? (
          <details className="group mt-1.5 rounded-md border border-white/10 bg-white/[0.02] text-[10px] leading-snug open:border-white/15">
            <summary className="cursor-pointer select-none px-2 py-1.5 text-gray-500 hover:text-gray-400 list-none [&::-webkit-details-marker]:hidden flex items-center gap-1.5">
              <span className="inline-block text-gray-600 transition-transform group-open:rotate-90" aria-hidden>
                ›
              </span>
              {profile.checkboxBlockTitle ?? 'Signalement (cases, optionnel)'}
            </summary>
            <div className="border-t border-white/5 px-2 pb-2 pt-1 space-y-1">
              {profile.checkboxFields.map(({ key, label }) => (
                <label
                  key={key}
                  className="flex items-start gap-2 text-gray-400 hover:text-gray-300 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3 w-3 shrink-0 rounded border-white/20 bg-white/5 accent-stone-500"
                    checked={parseSolTemplateCheckboxStored(custom[key])}
                    onChange={e =>
                      setCustom(prev => ({ ...prev, [key]: e.target.checked ? '1' : '' }))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    )
  }

  const isEditingTextAnnotation = editKind === 'text'
  /** True while the low-cost wizard is active but not yet "ready" — masque l’import ZIP local (fichier) ; l’inventaire « Ouvrir » depuis le blob reste affiché. */
  const lowCostAuthoring = lowCostMode && lowCostStep !== 'ready'
  /** True quand on est en low-cost et qu'aucun panorama n'est encore importé : la vue panorama est masquée.
   *  Dès qu'au moins un panorama est présent, la vue panorama et toutes ses features sont actives. */
  const lowCostHidesViewer = lowCostMode && lowCostPanos.length === 0 && panos.length === 0

  /** Nuage chargé : afficher calage (fond + pastilles). Sinon import simplifié (rogner / ajuster uniquement). */
  const floorPlanImportCalageUi = Boolean(e57Stats)

  /** ZIP ETL importé (panoramas et/ou plans d’étage issus de l’archive). */
  const hasImportedZipData = panos.length > 0 || floorMapAssets.length > 0
  /** Mode standard : pas d’outils dev / pas de parcours low-cost / pas d’UI client simplifiée. */
  const isStandardMode = !developerMode && !lowCostMode && !clientMode
  /**
   * Bloc « Remplacement de plan d’étage » : en mode standard, affiché seulement après import du ZIP.
   * En dev ou low-cost, inchangé (dev peut voir le panneau avant ZIP ; low-cost suit la présence de données).
   */
  const showFloorPlanReplacementPanel =
    !clientMode &&
    !lowCostHidesViewer &&
    (isStandardMode ? hasImportedZipData : developerMode || hasImportedZipData)

  return (
    <div className="space-y-6 relative z-0">
      <div className="glass-panel p-6 rounded-2xl border border-white/10 relative z-20">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">
              {clientMode ? 'Viewer 360 — mode client' : 'Viewer 360 ETL (ZIP local)'}
            </h1>
            {isEtlViewer360LocalDevEnabled() && (
              <p className="text-xs text-amber-200/95 mt-2 rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-2">
                Mode dev local : garde Dynamics / code projet ETL desactive via{' '}
                <code className="text-amber-100">VITE_ETL_VIEWER360_DEV=true</code> (uniquement en{' '}
                <code className="text-amber-100">npm run dev</code>).
              </p>
            )}
            <p className="text-sm text-gray-300 mt-2">
              {clientMode
                ? 'Vue panorama uniquement et panneau de remarque client par annotation (statuts non lu, lu, confirmé). Désactivez le mode client pour importer un ZIP ou ouvrir un projet Azure.'
                : developerMode
                  ? 'Importez un ZIP unique (panoramas + CSV des prises de vues + chunks BIN E57) via la zone Importer ci-dessous, puis parcourez les panoramas et le nuage 3D sur cette page.'
                  : "Importez un ZIP unique via la zone Importer ci-dessous. La visite s'ouvrira directement sur la vue panorama, avec les annotations accessibles sans outils techniques."}
            </p>
            {projectCode && (
              <p className="text-xs text-blue-300 mt-2">
                Projet actif: {projectCode}{projectName ? ` - ${projectName}` : ''}
              </p>
            )}
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <label className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-gray-200 cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-white/20 bg-white/5 accent-cyan-400"
                checked={developerMode}
                onChange={e => {
                  const v = e.target.checked
                  if (v) {
                    setClientMode(false)
                    setLowCostMode(false)
                  }
                  setDeveloperMode(v)
                }}
              />
              <span>Mode développeur</span>
            </label>
            <label className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-900/10 px-3 py-2 text-xs text-amber-200 cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-amber-500/30 bg-white/5 accent-amber-400"
                checked={lowCostMode}
                onChange={e => {
                  const v = e.target.checked
                  if (v) {
                    setClientMode(false)
                    setDeveloperMode(false)
                  }
                  setLowCostMode(v)
                  setLowCostStep('floors')
                  setLowCostPinningListFilter(LOW_COST_PINNING_LIST_ALL)
                  setLowCostPinningMapFloor('')
                }}
              />
              <span>Mode low-cost</span>
            </label>
            <label className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/35 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-100/95 cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-emerald-500/35 bg-white/5 accent-emerald-400"
                checked={clientMode}
                onChange={e => {
                  const v = e.target.checked
                  if (v) {
                    setDeveloperMode(false)
                    setLowCostMode(false)
                  }
                  setClientMode(v)
                }}
              />
              <span>Mode client</span>
            </label>
            <button
              type="button"
              onClick={() => navigate('/luxembourg/seco-geolux/etat-des-lieux/project-info')}
              className="btn-secondary btn-sm"
            >
              Retour project-info
            </button>
          </div>
        </div>
      </div>

      {!clientMode && (
      <div className="glass-panel p-6 rounded-xl border border-white/10 relative z-20 space-y-5">
        <h2 className="text-lg font-semibold text-white">Importer</h2>
        <p className="text-[10px] text-gray-400 -mt-2">
          {lowCostMode
            ? 'Mode low-cost : nuage de points optionnel. Définissez les étages, importez vos panoramas, puis (au choix) un nuage pour générer les coupes ; sinon tracez/importez un plan par étage ou laissez-le vide.'
            : 'Chargez une archive ZIP unique. Le rapport HTML de synthèse et la suite de la page utilisent uniquement les donnees de ce ZIP.'}
        </p>
        {developerMode && importAngleReadDebug && (
          <div
            className={`rounded-lg border px-3 py-2 text-xs ${
              importAngleReadDebug.convertedAnnotations > 0
                ? 'border-amber-400/45 bg-amber-500/10 text-amber-100/95'
                : 'border-emerald-400/35 bg-emerald-500/10 text-emerald-100/90'
            }`}
            role="status"
            aria-live="polite"
          >
            <div className="font-semibold text-white/95">
              Lecture annotations — normalisation yaw/pitch (deg → rad)
            </div>
            <div className="mt-1 text-[11px] leading-relaxed opacity-95">
              Source : ZIP{importAngleReadDebug.fileName ? ` (${importAngleReadDebug.fileName})` : ''}
              <br />
              Annotations ayant subi au moins une conversion :{' '}
              <span className="font-mono tabular-nums">{importAngleReadDebug.convertedAnnotations}</span>
              <br />
              Champs convertis (yaw, pitch, spans) :{' '}
              <span className="font-mono tabular-nums">{importAngleReadDebug.convertedFields}</span>
              <br />
              Échantillons détaillés envoyés au log debug (plafonnés) :{' '}
              <span className="font-mono tabular-nums">{importAngleReadDebug.loggedSamples}</span>
            </div>
            {importAngleReadDebug.convertedAnnotations === 0 ? (
              <p className="mt-1.5 text-[10px] text-gray-400/95">
                Aucune valeur d’angle n’a été interprétée comme des degrés ; les données étaient déjà cohérentes en radians
                (ou sans angles exploitables).
              </p>
            ) : (
              <p className="mt-1.5 text-[10px] text-amber-200/80">
                Des angles ont été convertis depuis des degrés vers des radians à l’import. Vérifiez le cadrage des
                marqueurs sur le panorama si besoin.
              </p>
            )}
          </div>
        )}
        <div className="grid gap-6 md:grid-cols-1">
          {!lowCostAuthoring && <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-semibold text-cyan-200/95">ZIP unique ETL 360</h3>
            <p className="text-[10px] leading-relaxed text-gray-500/95">
              Chaque import crée un nouveau dossier projet sur le stockage Azure (<span className="font-mono text-gray-400">Geolux/ETL/etl_…/</span>
              : <span className="font-mono text-gray-400">source/</span> + <span className="font-mono text-gray-400">viewer/</span> après traitement).
            </p>
            {panos.length === 0 ? (
              <div className="rounded-lg border border-white/8 bg-black/10 px-3 py-2.5 text-[11px] text-gray-400">
                <p className="mb-1.5 text-gray-300">L&apos;archive ZIP doit contenir :</p>
                <ul className="list-disc space-y-1 pl-4 marker:text-gray-500">
                  <li>le dossier comprenant les panoramas (jpg) et leurs positions (csv)</li>
                  <li>le dossier reprenant le nuage de points réduit (fichiers bin + json)</li>
                  <li>le dossier contenant les plans d&apos;étages (tiff)</li>
                  <li>le document reprenant les positions des points d&apos;intérêts</li>
                </ul>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="etl-viewer-zip-input"
                type="file"
                accept=".zip,application/zip"
                onClick={() => {
                  // #region agent log
                  etl360PostDebugIngest({
                    sessionId: '546eb8',
                    runId: 'ui-zip-input-click',
                    hypothesisId: 'Hui',
                    location: 'ETLViewer360.tsx:zipInput',
                    message: 'zip input clicked',
                    data: {
                      pagePort: typeof window !== 'undefined' ? window.location.port : '',
                      panosCount: panos.length,
                      hasE57Stats: Boolean(e57Stats),
                    },
                    timestamp: Date.now(),
                  })
                  // #endregion
                }}
                onChange={event => {
                  // #region agent log
                  etl360PostDebugIngest({
                    sessionId: '546eb8',
                    runId: 'ui-zip-input-change',
                    hypothesisId: 'Hui',
                    location: 'ETLViewer360.tsx:zipInput',
                    message: 'zip input changed',
                    data: {
                      pagePort: typeof window !== 'undefined' ? window.location.port : '',
                      fileName: event.target.files?.[0]?.name ?? null,
                      fileCount: event.target.files?.length ?? 0,
                    },
                    timestamp: Date.now(),
                  })
                  // #endregion
                  void handleLoadUnifiedZipFile(event.target.files?.[0] ?? null)
                  event.currentTarget.value = ''
                }}
                className="hidden"
                disabled={loading}
              />
              <label
                htmlFor="etl-viewer-zip-input"
                className="btn-primary btn-sm cursor-pointer"
                onClick={() => {
                  // #region agent log
                  etl360PostDebugIngest({
                    sessionId: '546eb8',
                    runId: 'ui-zip-label-click',
                    hypothesisId: 'Hui',
                    location: 'ETLViewer360.tsx:zipLabel',
                    message: 'zip label clicked',
                    data: {
                      pagePort: typeof window !== 'undefined' ? window.location.port : '',
                      loading,
                    },
                    timestamp: Date.now(),
                  })
                  // #endregion
                }}
              >
                {loading
                  ? zipCloudPhase === 'upload'
                    ? 'Envoi sur Azure (nouveau projet)…'
                    : zipCloudPhase === 'expand'
                      ? 'Préparation des fichiers sur le serveur…'
                      : 'Chargement ZIP unique…'
                  : 'Charger ZIP unique'}
              </label>
            </div>
            {developerMode ? (
              <details className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3 [&_summary::-webkit-details-marker]:hidden">
              <summary className="cursor-pointer list-none select-none text-[11px] font-medium text-gray-200 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-500/50 rounded">
                Réglages regroupement automatique des panoramas sur les étages (repliés par défaut)
              </summary>
              <div className="mt-3 grid gap-2 border-t border-white/10 pt-3">
                <label className="text-[11px] text-gray-300">
                  Tolérance de regroupement des hauteurs ({Math.round(floorGroupingToleranceM * 100)} cm)
                  {floorMapAssets.length > 0 && !floorPlansFromE57Slices ? (
                    <span className="ml-1 text-gray-500">(GeoTIFF : sans effet)</span>
                  ) : null}
                  <input
                    type="range"
                    min={5}
                    max={35}
                    step={1}
                    value={Math.round(floorGroupingToleranceM * 100)}
                    onChange={e => setFloorGroupingToleranceM(Number(e.target.value) / 100)}
                    className="mt-1 w-full accent-cyan-400"
                    disabled={
                      loading || e57Loading || (floorMapAssets.length > 0 && !floorPlansFromE57Slices)
                    }
                  />
                </label>
                <label className="text-[11px] text-gray-300">
                  Épaisseur du plan de coupe ({Math.round(floorSliceHeightM * 100)} cm)
                  {floorMapAssets.length > 0 && !floorPlansFromE57Slices ? (
                    <span className="ml-1 text-gray-500">(bande Z autour de l altitude TIFF)</span>
                  ) : null}
                  <input
                    type="range"
                    min={20}
                    max={80}
                    step={1}
                    value={Math.round(floorSliceHeightM * 100)}
                    onChange={e => setFloorSliceHeightM(Number(e.target.value) / 100)}
                    className="mt-1 w-full accent-cyan-400"
                    disabled={loading || e57Loading}
                  />
                </label>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-gray-400">
                    {floorMapAssets.length > 0 && !floorPlansFromE57Slices
                      ? 'Plans GeoTIFF du ZIP : Remapper réapplique l assignation avec la bande Z (épaisseur) autour de chaque altitude de plan.'
                      : 'Modifiez les sliders puis relancez l assignation auto des panoramas sur les étages (coupes nuage).'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void remapPanosByFloorSlices()}
                    className="btn-secondary btn-sm"
                    disabled={!canRemapFloors}
                  >
                    Remapper panoramas / étages
                  </button>
                </div>
              </div>
              </details>
            ) : null}
            {developerMode ? (
              <label className="mt-3 block text-[11px] text-gray-300">
                Rayon d affichage des triangles de panoramas voisins ({neighborPanoRadiusM.toFixed(1)} m)
                <input
                  type="range"
                  min={1}
                  max={40}
                  step={0.5}
                  value={neighborPanoRadiusM}
                  onChange={e => setNeighborPanoRadiusM(Number(e.target.value))}
                  className="mt-1 w-full accent-cyan-400"
                />
              </label>
            ) : null}
          </div>}
          {lowCostAuthoring && (
            <div className="space-y-2 rounded-xl border border-amber-500/20 bg-amber-900/5 p-4">
              <h3 className="text-sm font-semibold text-amber-200/95">Mode low-cost — nuage optionnel</h3>
              <p className="text-[10px] text-gray-400 leading-relaxed">
                Le parcours se fait dans le panneau <span className="text-amber-200/90">« Mode low-cost — Construction du projet »</span>{' '}
                un peu plus bas, en 7 étapes : étages → panoramas → nuage (optionnel) → coupes (si nuage) → plan par étage (tracé / import / vide) → pastilles → visualisation. Aucun E57, aucun ZIP local et aucun nuage de points ne sont obligatoires ; un étage peut rester sur fond noir. Plus bas, la section{' '}
                <span className="text-cyan-200/85">Ouvrir un projet (Azure)</span> reste disponible pour charger le répertoire <code className="text-amber-100/80">viewer/</code> déjà sur le blob (même en cours de parcours).
              </p>
              {developerMode && (
                <p className="text-[10px] text-gray-500">
                  Mode développeur : une fois le flux low-cost terminé (« Appliquer au viewer ») ou après désactivation du mode low-cost, l’import ZIP local réapparaît en entier.
                </p>
              )}
            </div>
          )}

          <div className="rounded-xl border border-sky-500/20 bg-sky-900/5 p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-semibold text-sky-200/90">Ouvrir un projet (Azure)</h3>
                <p className="text-[10px] text-gray-400 leading-relaxed max-w-2xl">
                  Un <span className="text-sky-100/90">projet ETL 360</span> côté blob correspond au répertoire{' '}
                  <code className="text-sky-300/90 bg-sky-950/50 px-1 rounded">viewer/</code> (manifeste{' '}
                  <code className="text-sky-300/90 bg-sky-950/50 px-1 rounded">etl360-viewer-index.json</code>
                  ). Si seul un <span className="text-sky-100/90">.zip</span> a été déposé (ex. à la racine du dossier{' '}
                  <code className="text-sky-300/85">etl_…/</code> ou sous <code className="text-sky-300/85">source/</code>
                  ), l’app propose <span className="text-sky-100/90">Préparer le dépôt</span> pour lancer l’extraction serveur.
                  Le serveur résout le dossier via l’URL (<code className="text-sky-300/90">projectBlobPrefix=Geolux/ETL/…</code>
                  ) ou les métadonnées SQL du chantier. Après ouverture, les annotations sont enregistrées dans{' '}
                  <code className="text-sky-300/90 bg-sky-950/50 px-1 rounded">viewer/etl360-project-state.json</code>. L’extraction
                  côté serveur remplit <code className="text-sky-300/90 bg-sky-950/50 px-1 rounded">viewer/</code> — puis utilisez
                  <span className="text-sky-200/90"> Rafraîchir</span>. Si vous remplacez des fichiers directement sur le blob
                  (même arborescence sous <code className="text-sky-300/90">viewer/</code>, noms autorisés à changer),{' '}
                  <span className="text-sky-200/90">Régénérer manifeste (blob)</span> rescane le dossier et met à jour le JSON
                  d’index sans repasser par le ZIP.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void saveEtlBlobViewerProjectToAzure()}
                disabled={!etlBlobProjectSaveEnabled || etlBlobProjectSaving || loading}
                className="shrink-0 rounded-lg border border-emerald-500/45 bg-emerald-900/30 px-3 py-1.5 text-[10px] font-semibold text-emerald-100/95 hover:bg-emerald-800/40 disabled:opacity-40 disabled:pointer-events-none"
                title={
                  !etlBlobProjectSaveEnabled
                    ? 'Disponible après ouverture d’un projet chargé depuis Azure (répertoire viewer/).'
                    : 'Enregistrement immédiat : l’état se sauve déjà automatiquement ; ce bouton force une écriture tout de suite.'
                }
              >
                {etlBlobProjectSaving ? 'Enregistrement…' : 'Enregistrer maintenant'}
              </button>
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-[11px] font-semibold text-sky-100/90">Projets (viewer / Azure)</h4>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      void loadEtlBlobViewerListForPanel()
                      void loadEtlAllViewerIndexList()
                    }}
                    disabled={etlBlobViewerListLoading || etlAllViewerIndexLoading || etlBlobRebuildIndexLoading}
                    className="rounded-md border border-sky-500/40 bg-sky-900/40 px-2 py-0.5 text-[10px] font-medium text-sky-100 hover:bg-sky-800/50 disabled:opacity-40"
                  >
                    {etlBlobViewerListLoading || etlAllViewerIndexLoading ? 'Chargement…' : 'Rafraîchir'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRebuildEtlViewerIndexFromBlob()}
                    disabled={
                      etlBlobViewerListLoading ||
                      etlAllViewerIndexLoading ||
                      etlBlobRebuildIndexLoading ||
                      loading
                    }
                    className="rounded-md border border-amber-500/45 bg-amber-950/35 px-2 py-0.5 text-[10px] font-medium text-amber-100 hover:bg-amber-900/45 disabled:opacity-40"
                    title="Rescanne le dossier viewer/ sur Azure et réécrit etl360-viewer-index.json (fichiers ajoutés, renommés ou supprimés sur le blob)."
                  >
                    {etlBlobRebuildIndexLoading ? 'Régénération…' : 'Régénérer manifeste (blob)'}
                  </button>
                </div>
              </div>
              {etlAllViewerIndexError ? (
                <p className="text-[10px] text-amber-200/80 rounded border border-amber-500/25 bg-amber-950/20 px-2 py-1">
                  Liste des dépôts sur le compte : {etlAllViewerIndexError}
                </p>
              ) : null}
              {etlAllViewerIndexItems.length > 0 ? (
                <div className="rounded-md border border-indigo-500/25 bg-indigo-950/20 p-2 space-y-1.5">
                  <p className="text-[10px] text-indigo-100/90">
                    {etlAllViewerIndexItems.length > 1
                      ? `Dépôts ETL détectés sur le compte (${etlAllViewerIndexItems.length}) : choisir celui à lier à cette page, ou ajustez l’URL.`
                      : 'Dépôt ETL sur le compte (référence) :'}
                  </p>
                  <ul className="space-y-1 max-h-44 overflow-y-auto">
                    {etlAllViewerIndexItems.map(row => {
                      const isCurrent = etlCurrentBlobPrefixForCompare === row.projectBlobPrefix
                      const short = row.projectBlobPrefix.split('/').filter(Boolean).pop() || row.projectBlobPrefix
                      return (
                        <li
                          key={row.projectBlobPrefix}
                          className="flex flex-wrap items-center justify-between gap-1.5 text-[9px] text-gray-400"
                        >
                          <span className="min-w-0 break-words text-left">
                            {isCurrent ? <span className="text-cyan-300/95 mr-0.5">●</span> : null}
                            <code className="text-cyan-200/85" title={row.projectBlobPrefix}>
                              {short}
                            </code>
                            <span className="text-gray-500">
                              {' '}
                              — {row.panoCount} pano(s)
                              {row.status && row.status !== 'ready' ? ` · ${row.status}` : ''}
                            </span>
                          </span>
                          {!isCurrent ? (
                            <button
                              type="button"
                              className="shrink-0 text-[9px] rounded border border-sky-500/45 px-1.5 py-0.5 font-medium text-sky-100 hover:bg-sky-900/50"
                              onClick={() => {
                                const next = new URLSearchParams(searchParams)
                                next.set('projectBlobPrefix', row.projectBlobPrefix)
                                setSearchParams(next, { replace: true })
                              }}
                            >
                              Cibler ce dépôt
                            </button>
                          ) : (
                            <span className="shrink-0 text-[9px] text-cyan-400/90">Ciblé</span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ) : null}
              {etlBlobViewerListLoading ? (
                <p className="text-[10px] text-gray-500">Lecture du manifeste projet…</p>
              ) : null}
              {etlBlobViewerIndexError ? (
                <p className="text-[10px] text-amber-200/90 rounded-md border border-amber-500/30 bg-amber-950/30 px-2 py-1.5">
                  Impossible de lire le manifeste : {etlBlobViewerIndexError}
                </p>
              ) : null}
              {!etlBlobViewerListLoading && etlViewerIndexReadyForPanel ? (
                <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-3 space-y-2">
                  <p className="text-[10px] font-medium text-cyan-100/95">Projet viewer prêt</p>
                  <ul className="text-[9px] text-gray-400 space-y-0.5 list-disc pl-3">
                    <li>
                      Généré le{' '}
                      {etlBlobViewerList.index.generatedAt
                        ? new Date(etlBlobViewerList.index.generatedAt).toLocaleString('fr-FR')
                        : '—'}
                    </li>
                    <li>
                      {etlBlobViewerList.index.panos.length} panorama(s)
                      {etlBlobViewerList.index.floorPlans?.length
                        ? ` · ${etlBlobViewerList.index.floorPlans.length} plan(s) d’étage`
                        : ''}
                      {etlBlobViewerList.index.pointCloudChunkBlobPaths?.length
                        ? ' · nuage de points'
                        : ''}
                    </li>
                    {etlBlobViewerList.index.sourceZipBlobPath ? (
                      <li className="break-all">
                        Archive d’origine (référence) :{' '}
                        <code className="text-cyan-200/80">{etlBlobViewerList.index.sourceZipBlobPath.split('/').pop()}</code>
                      </li>
                    ) : null}
                  </ul>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => { void handleLoadFromViewerIndex(etlBlobViewerList.index as EtlViewerIndex) }}
                      className="rounded-md border border-cyan-500/50 bg-cyan-900/40 px-2.5 py-1 text-[10px] font-semibold text-cyan-50 hover:bg-cyan-800/50 disabled:opacity-40"
                    >
                      Ouvrir le projet
                    </button>
                    <button
                      type="button"
                      disabled={loading || etlBlobRebuildIndexLoading}
                      onClick={() => void handleRebuildEtlViewerIndexFromBlob()}
                      className="rounded-md border border-amber-500/50 bg-amber-950/40 px-2.5 py-1 text-[10px] font-semibold text-amber-50 hover:bg-amber-900/50 disabled:opacity-40"
                      title="Met à jour le manifeste depuis le contenu actuel de viewer/ sur le blob, puis rafraîchit la liste."
                    >
                      {etlBlobRebuildIndexLoading ? 'Régénération…' : 'Rescanner viewer/'}
                    </button>
                  </div>
                </div>
              ) : !etlBlobViewerListLoading && etlBlobViewerList && !etlBlobViewerIndexError ? (
                <div className="text-[10px] text-gray-500 space-y-1.5">
                  <p>
                    Aucun manifeste <code className="text-sky-400/90">etl360-viewer-index.json</code> prêt pour le préfixe projet
                    actuel. Vérifiez que l’URL contient le bon <code className="text-sky-400/90">projectBlobPrefix</code> (dossier
                    blob, ex. <code className="text-sky-400/90">Geolux/ETL/…</code> en phase avec le code + id chantier, ou le
                    dossier réel si vous avez un ancien dépôt <code className="text-sky-400/90">etl_…</code>
                  ) ou que le chantier a bien <code className="text-sky-400/90">etl360.blob.projectBlobPrefix</code> en base.
                  Après upload / expand-zip, cliquez sur <span className="text-sky-200/90">Rafraîchir</span>. Si vous modifiez
                  directement les fichiers sous <code className="text-sky-300/90">viewer/</code> sur le blob (plans TIFF,
                  images, CSV…), utilisez <span className="text-sky-200/90">Régénérer manifeste (blob)</span> puis ouvrez à
                  nouveau le projet — sans repasser par le ZIP importé.
                </p>
                  {Array.isArray(etlBlobViewerList.diagnostics?.sourceZipCandidates) &&
                  etlBlobViewerList.diagnostics.sourceZipCandidates.length > 0 ? (
                    <div className="rounded-md border border-amber-500/35 bg-amber-950/25 p-2.5 space-y-2">
                      <p className="text-[10px] font-medium text-amber-100/95">
                        Archive(s) ZIP détectée(s) sur le blob — extraction serveur (expand-zip) pour créer{' '}
                        <code className="text-amber-200/90">viewer/</code> et le manifeste ETL :
                      </p>
                      <ul className="space-y-1.5">
                        {etlBlobViewerList.diagnostics.sourceZipCandidates.map(z => {
                          const busy = etlPrepareZipBlobPath === z.blobPath || zipCloudPhase === 'expand'
                          const sizeMo = z.sizeBytes > 0 ? (z.sizeBytes / (1024 * 1024)).toFixed(1) : '?'
                          return (
                            <li
                              key={z.blobPath}
                              className="flex flex-wrap items-center gap-2 rounded border border-amber-500/20 bg-black/25 px-2 py-1.5"
                            >
                              <span className="min-w-0 flex-1 break-all text-left text-[9px] text-amber-100/90">
                                <code className="text-cyan-200/85">{z.blobPath.split('/').pop()}</code>
                                <span className="text-gray-500"> · {sizeMo} Mo</span>
                              </span>
                              <button
                                type="button"
                                disabled={busy || loading}
                                onClick={() => void prepareEtlBlobZipExpandOnAzure(z.blobPath)}
                                className="shrink-0 rounded border border-amber-400/50 bg-amber-900/40 px-2 py-0.5 text-[9px] font-semibold text-amber-50 hover:bg-amber-800/50 disabled:opacity-40"
                                title={z.blobPath}
                              >
                                {etlPrepareZipBlobPath === z.blobPath ? 'Préparation…' : 'Préparer le dépôt'}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                      <p className="text-[9px] leading-snug text-gray-500">
                        Les fichiers extraits sont écrits sous le préfixe projet courant (
                        <code className="break-all text-gray-400">{etlBlobViewerList.diagnostics.projectBlobPrefix}</code>
                        ). Préfixe dupliqué <code className="text-gray-400">Geolux/ETL/Geolux/ETL/</code> : le scan inclut aussi
                        la variante normalisée pour retrouver le ZIP.
                      </p>
                    </div>
                  ) : null}
                  {etlBlobViewerList.diagnostics && !etlBlobViewerList.diagnostics.indexFound ? (
                    <p className="text-[9px] text-gray-500 rounded-md border border-slate-600/40 bg-slate-900/30 px-2 py-1.5 break-words">
                      Côté serveur : préfixe résolu{' '}
                      <code className="text-cyan-200/85">{etlBlobViewerList.diagnostics.projectBlobPrefix}</code> — chemin
                      d’index attendu <code className="text-cyan-200/85">{etlBlobViewerList.diagnostics.indexBlobPathTried}</code>.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

        </div>
      </div>
      )}

      {!lowCostHidesViewer && <div className="space-y-4">
        {!clientMode && developerMode && spatialDataset.hasSpatialPoints ? (
          <div className="space-y-3">
            <div className="glass-panel p-4 rounded-xl border border-white/10">
              <h3 className="text-sm font-semibold text-white mb-1">Visualisation des plans d&apos;étages</h3>
              <p className="text-[11px] text-gray-400 leading-relaxed mb-3">
                Carte par étage en mode panorama. Par défaut, les poses viennent du CSV et l&apos;assignation d&apos;étage
                suit les <span className="text-cyan-200/90">bandes Z des GeoTIFF</span> (comme le remap automatique).
                Activez l&apos;option ci-dessous pour aligner sur le <span className="text-cyan-200/90">nuage</span> :
                pour chaque panorama, on prend les points du nuage à <strong>distance horizontale minimale</strong> de la
                pose CSV, on en déduit une altitude Z, on assigne l&apos;<strong>étage le plus proche</strong> (même
                logique de bandes TIFF), puis on replace la pose sur la <strong>moyenne X,Y,Z</strong> de ce sous-ensemble
                de points.
              </p>
              <div className="border-t border-white/10 pt-3">
                <label className="flex cursor-pointer items-start gap-2 text-[11px] text-gray-200">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-cyan-400 rounded border-white/20 shrink-0"
                    checked={floormapDevAlignFromPointCloud}
                    disabled={
                      loading ||
                      panos.length === 0 ||
                      floorMapAssets.length === 0 ||
                      !e57Stats ||
                      !e57SourcePositionsRef.current ||
                      e57SourcePositionsRef.current.length < 3
                    }
                    onChange={e => syncFloormapDevAlignFromToggle(e.target.checked)}
                    title={
                      !e57Stats || !e57SourcePositionsRef.current || e57SourcePositionsRef.current.length < 3
                        ? 'Chargez un nuage de points pour activer l’alignement sur le nuage.'
                        : 'Aligner les panoramas sur le nuage (sinon poses CSV / plan TIFF).'
                    }
                  />
                  <span>
                    Aligner les panoramas sur le <span className="text-cyan-200/90">nuage de points</span> (sinon{' '}
                    <span className="text-sky-200/90">poses CSV / plan TIFF</span>)
                  </span>
                </label>
              </div>
              <p className="text-[10px] text-gray-500 mt-2">
                Demi-tranche Z des plans : curseur « Épaisseur du plan de coupe » dans les réglages développeur (
                {Math.round(floorSliceHeightM * 100)} cm → ±{((floorSliceHeightM / 2) * 100).toFixed(0)} cm si seule
                l&apos;altitude TIFF est connue).
              </p>
            </div>
            <ETLFloorMap
              points={spatialDataset.points}
              selectedPanoId={currentPanoId}
              onSelectPano={panoId => setCurrentPanoId(panoId)}
              floorLabels={floorLabels}
              selectedFloor={selectedFloor}
              onSelectFloor={setSelectedFloor}
              floorMapAssets={spatialDataset.floorMapAssets}
              pointCloudSpatialReference={e57Stats?.spatialReference}
              mapViewportClassName="h-[min(620px,65vh)] min-h-[420px]"
              annotationMarkers={floorAnnotationMarkers}
              onSelectAnnotation={annotationId => {
                const ann = annotations.find(a => a.id === annotationId)
                if (!ann) return
                setSelectedAnnotationId(annotationId)
                setCurrentPanoId(ann.panoId)
              }}
              onOpenAnnotation={annotationId => {
                const ann = annotations.find(a => a.id === annotationId)
                if (!ann) return
                setCurrentPanoId(ann.panoId)
                openAnnotationEditor(ann)
              }}
              onMoveAnnotation={moveAnnotationFromFloorMap}
              onResetAnnotationPosition={resetAnnotationPositionFromFloorMap}
            />
          </div>
        ) : !clientMode && developerMode && panos.length > 0 ? (
          <div className="glass-panel p-4 rounded-xl border border-white/10 text-xs text-amber-300/90">
            Carte indisponible: il faut des coordonnees XY exploitables dans le fichier de poses pano.
          </div>
        ) : null}

        {!clientMode && developerMode ? (
          <div className="glass-panel p-4 rounded-xl border border-white/10">
          <h2 className="text-lg font-semibold text-white mb-1">
            Panoramas ({filteredPanos.length}
            {selectedFloor !== 'ALL' ? ` / ${panos.length}` : ''})
          </h2>
          <p className="text-[11px] text-gray-500 mb-2">
            Pastille : code couleur du panorama (marqueur de position dans le nuage 3D et sur la carte par étage).
          </p>
          <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
            {panos.length === 0 ? (
              <p className="text-sm text-gray-500">Aucun panorama charge.</p>
            ) : filteredPanos.length === 0 ? (
              <p className="text-sm text-gray-500">Aucun panorama sur l etage selectionne.</p>
            ) : (
              filteredPanos.map(pano => (
                <button
                  key={pano.id}
                  type="button"
                  onClick={() => {
                    // #region agent log
                    etl360PostDebugIngest({
                      sessionId: '546eb8',
                      runId: 'ui-click',
                      hypothesisId: 'H0',
                      location: 'ETLViewer360.tsx:panoButton',
                      message: 'panorama selected from list',
                      data: {
                        panoId: pano.id,
                        pagePort: typeof window !== 'undefined' ? window.location.port : '',
                      },
                      timestamp: Date.now(),
                    })
                    // #endregion
                    setCurrentPanoId(pano.id)
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                    pano.id === currentPanoId
                      ? 'bg-blue-500/20 border-blue-500/50 text-blue-100'
                      : 'bg-white/5 border-white/10 text-gray-200 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className="mt-1 shrink-0 w-3.5 h-3.5 rounded border border-white/30 shadow-sm"
                      style={{ backgroundColor: pano.viewerColor || '#6366f1' }}
                      title={`Code couleur : ${pano.viewerColor || 'defaut'}`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{panoDisplay(pano)}</div>
                      <div className="text-[11px] text-gray-400">{pano.id}</div>
                      <div className="text-[11px] text-gray-400">
                        Hauteur Y: {Number.isFinite(pano.position.y) ? `${pano.position.y.toFixed(3)} m` : 'n/a'}
                      </div>
                      {!pano.imageExists && (
                        <div className="text-[10px] text-amber-300/90">Image absente (mode carte uniquement)</div>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
          </div>
        ) : null}

        {panos.length > 0 ? (
          <div
            className={
              clientMode
                ? 'flex min-h-0 flex-col items-stretch gap-4 lg:flex-row lg:items-start'
                : undefined
            }
          >
            {/*
              En colonne (mobile / étroit), éviter flex-1 sur la colonne panorama : sinon elle mange toute la hauteur
              flex et le panneau « annotations client » passe hors viewport (liste invisible sans scroll interne).
              À partir de lg, flex-1 répartit l’espace horizontal comme avant.
            */}
            <div
              className={
                clientMode ? 'flex min-h-0 min-w-0 w-full flex-none flex-col lg:flex-1' : undefined
              }
            >
          <div className="glass-panel p-3 rounded-xl border border-white/10 min-h-[720px] flex flex-col relative z-0 overflow-visible">
          <div className="flex flex-wrap items-start justify-end gap-2 mb-2 px-1 gap-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 shrink-0 w-full sm:w-auto">
              <label className="flex items-center gap-1.5 text-[11px] text-gray-400 shrink-0 cursor-pointer select-none max-w-[min(100%,16rem)]">
                <input
                  type="checkbox"
                  className="accent-cyan-400 rounded border-white/20 shrink-0"
                  checked={panoBeforeAfterUiEnabled}
                  onChange={e => setPanoBeforeAfterUiEnabled(e.target.checked)}
                  disabled={!currentPano}
                  title="Affiche côte à côte ce panorama et le second prise de vue associé (panneau Renommer panorama / comparaison)."
                />
                <span className="whitespace-nowrap">Avant / après</span>
              </label>
              {panoBeforeAfterUiEnabled && currentPano && panoCompareLayoutActive ? (
                <div className="flex flex-col gap-0.5 min-w-0 max-w-[min(100%,18rem)]">
                  <label className="flex items-center gap-1.5 text-[10px] text-gray-400" title="Largeur du panneau « avant » (glisser le séparateur sur l’image ou utiliser le curseur)">
                    <span className="shrink-0 w-12">Partage</span>
                    <input
                      type="range"
                      min={20}
                      max={80}
                      step={0.5}
                      value={panoCompareSplitPct}
                      onChange={e => setPanoCompareSplitPct(Number(e.target.value))}
                      className="w-full min-w-0 h-1.5 accent-violet-400"
                    />
                    <span className="tabular-nums w-7 text-right text-gray-500 shrink-0">{panoCompareSplitPct.toFixed(0)}</span>
                  </label>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => void togglePanoFullscreen()}
                className="btn-secondary btn-sm shrink-0"
                disabled={!currentPano}
                title={panoFsActive ? 'Quitter le plein ecran (Echap)' : 'Afficher le panorama en plein ecran'}
              >
                {panoFsActive ? 'Quitter plein ecran' : 'Plein ecran'}
              </button>
              {developerMode ? (
                <label className="flex items-center gap-1.5 text-[11px] text-gray-400 shrink-0 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="accent-cyan-400 rounded border-white/20"
                  checked={panoWorldOverlayEnabled}
                  onChange={e => {
                    // #region agent log
                    etl360PostDebugIngest({
                      sessionId: '546eb8',
                      runId: 'ui-toggle',
                      hypothesisId: 'H0',
                      location: 'ETLViewer360.tsx:panoWorldOverlayCheckbox',
                      message: 'overlay checkbox toggled',
                      data: {
                        checked: e.target.checked,
                        currentPanoId,
                        hasE57Stats: Boolean(e57Stats),
                        pagePort: typeof window !== 'undefined' ? window.location.port : '',
                      },
                      timestamp: Date.now(),
                    })
                    // #endregion
                    setPanoWorldOverlayEnabled(e.target.checked)
                  }}
                  disabled={!currentPano || !e57Stats}
                  title={
                    !e57Stats
                      ? 'Chargez un nuage E57 (ZIP ou package) pour activer la superposition 3D.'
                      : 'Points du nuage + vignettes des prises de vue voisines dans le repère du panorama.'
                  }
                />
                Aperçu 3D nuage
                </label>
              ) : null}
              <label className="flex items-center gap-1.5 text-[11px] text-gray-400 shrink-0 cursor-pointer select-none">
              <input
                type="checkbox"
                className="accent-cyan-400 rounded border-white/20"
                checked={showNeighborPanoTriangles}
                onChange={e => setShowNeighborPanoTriangles(e.target.checked)}
                disabled={!currentPano}
                title="Afficher ou masquer les pièces à proximité."
              />
              Afficher pièces à proximité
              </label>
              {developerMode ? (
                <label className="flex items-center gap-1.5 text-[11px] text-gray-400 shrink-0 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="accent-cyan-400 rounded border-white/20"
                  checked={panoDebugXyzEnabled}
                  onChange={e => setPanoDebugXyzEnabled(e.target.checked)}
                />
                Debug XYZ
                </label>
              ) : null}
            </div>
          </div>
          <div
            ref={panoFsRootRef}
            className={`relative z-0 w-full overflow-hidden bg-black/50 border border-white/10 ${
              panoFsActive
                ? 'h-screen max-h-[100dvh] rounded-none border-0 bg-black'
                : 'h-[min(620px,65vh)] min-h-[420px] rounded-xl'
            }`}
          >
            {panoFsActive && (
              <button
                type="button"
                onClick={() => void togglePanoFullscreen()}
                className="absolute top-3 right-3 z-20 btn-secondary btn-sm shadow-lg"
                title="Quitter le plein ecran (Echap)"
              >
                Quitter plein ecran
              </button>
            )}
            {panoFsActive && (
              <div className="pointer-events-auto absolute bottom-3 left-1/2 z-30 flex w-[min(92vw,22rem)] -translate-x-1/2 flex-col gap-1 rounded-lg border border-white/20 bg-black/75 px-3 py-2 shadow-xl backdrop-blur-sm">
                <label htmlFor="etl-pano-exposure-fs" className="text-[11px] font-medium text-gray-200">
                  Exposition
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="etl-pano-exposure-fs"
                    type="range"
                    min={0.2}
                    max={2.8}
                    step={0.05}
                    value={panoExposure}
                    onChange={e => handlePanoExposureChange(Number(e.target.value))}
                    className="h-2 min-w-0 flex-1 accent-cyan-400"
                    disabled={!currentPano}
                    title="Luminosite du panorama (1 = neutre, plus haut = plus clair)"
                  />
                  <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-gray-300" aria-live="polite">
                    {panoExposure.toFixed(2)}×
                  </span>
                </div>
              </div>
            )}
            {currentPano ? (
              <button
                type="button"
                onClick={() => setPanoAnnotationListVisible(v => !v)}
                className="absolute top-3 left-3 z-20 btn-secondary btn-xs font-normal shadow-md"
                title={
                  clientMode
                    ? 'Afficher ou masquer la liste des annotations sur la vue panorama (y compris en plein écran).'
                    : 'Afficher/masquer la liste annotations dans la vue panorama.'
                }
              >
                {clientMode
                  ? panoAnnotationListVisible
                    ? 'Masquer liste'
                    : 'Liste annotations'
                  : panoAnnotationListVisible
                    ? 'Masquer annotations'
                    : 'Afficher annotations'}
              </button>
            ) : null}
            {panoFsActive &&
            currentPanoId &&
            !(floorMapAssetsEffective.length > 0 && panoMinimapFloorButtons.length > 0) ? (
              <div className="pointer-events-auto absolute top-12 left-3 z-20">
                <PanoOrientationFullscreenMenu
                  flipX={panoOrientDraftFlipX}
                  flipY={panoOrientDraftFlipY}
                  onFlipX={setPanoOrientDraftFlipX}
                  onFlipY={setPanoOrientDraftFlipY}
                  onSave={savePanoViewAxisFlips}
                  menuAlign="left"
                />
              </div>
            ) : null}
            {clientMode && currentPano && panoAnnotationListVisible ? (
              <div
                className="absolute z-20 flex flex-col overflow-hidden rounded-lg border border-emerald-500/40 bg-black/75 text-gray-100 shadow-xl backdrop-blur-sm select-none"
                style={{
                  left: panoAnnotationPanel.x,
                  top: panoAnnotationPanel.y,
                  width: panoAnnotationPanel.width,
                  height: panoAnnotationPanel.height,
                }}
                role="region"
                aria-label="Annotations du panorama courant"
              >
                <div
                  className={`flex shrink-0 cursor-move items-center justify-between gap-1 border-b border-emerald-500/35 bg-emerald-950/45 ${annPanelTypography.titleSz} font-semibold text-emerald-50/95`}
                  style={{
                    height: PANO_ANN_PANEL_HEADER_H,
                    minHeight: PANO_ANN_PANEL_HEADER_H,
                    paddingLeft: 8,
                    paddingRight: 6,
                  }}
                  onPointerDown={startPanoAnnotationPanelDrag}
                  title="Déplacer le panneau (glisser la barre de titre)"
                >
                  <span className="min-w-0 truncate leading-tight">Annotations (panorama client)</span>
                  <span className="shrink-0 text-[8px] font-normal text-emerald-200/70">⋮⋮</span>
                </div>
                <div
                  ref={panoAnnotationListScrollRef}
                  className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
                  style={{ padding: annPanelTypography.bodyPad }}
                >
                  {currentAnnotations.length === 0 ? (
                    <div className={`${annPanelTypography.floorSz} text-gray-400`}>
                      Aucune annotation sur ce panorama.
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {currentAnnotations.map(annotation => (
                        <button
                          key={annotation.id}
                          ref={el => {
                            panoAnnotationItemRefs.current[annotation.id] = el
                          }}
                          type="button"
                          onClick={() => {
                            setSelectedAnnotationId(annotation.id)
                            const focus = annotationFocusYawPitch(annotation)
                            viewerRef.current?.focusYawPitch(focus.yaw, focus.pitch)
                            const t = annotation.pointCloudTarget
                            if (t && Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z)) {
                              e57ViewerRef.current?.focusOnWorldPoint(t.x, t.y, t.z)
                            }
                          }}
                          className={`w-full rounded-lg border text-left transition-colors ${annPanelTypography.padItem} ${
                            annotation.id === selectedAnnotationId
                              ? 'border-emerald-400/60 bg-emerald-900/45 text-white ring-1 ring-emerald-400/25'
                              : 'border-white/10 bg-black/30 text-gray-200 hover:border-white/25'
                          }`}
                        >
                          <div
                            className={`flex min-w-0 items-center gap-1.5 ${annPanelTypography.itemTitleSz} font-medium leading-tight`}
                          >
                            <div className="min-w-0 flex-1 truncate break-words">
                              {annotation.identifier || annotation.label || annotation.id}
                            </div>
                            {annotationOrigin(annotation) === 'client_remark' ? (
                              <span
                                className={`shrink-0 rounded border border-emerald-400/35 bg-emerald-900/50 font-medium uppercase tracking-wide text-emerald-100/90 ${
                                  panoAnnotationPanel.width < 168 ? 'px-0.5 py-0.5 text-[7px]' : 'px-1 py-0.5 text-[8px]'
                                }`}
                                title="Annotation créée en mode client"
                              >
                                Client
                              </span>
                            ) : null}
                          </div>
                          {annotation.clientRemark ? (
                            <div
                              className={`${annPanelTypography.itemSubSz} mt-1 flex flex-wrap items-center gap-1 text-gray-400`}
                            >
                              <span
                                className={`shrink-0 rounded px-1 py-0.5 ${
                                  annotation.clientRemark.status === 'confirmé'
                                    ? 'bg-teal-600/45 text-teal-50'
                                    : annotation.clientRemark.status === 'lu'
                                      ? 'bg-sky-600/40 text-sky-50'
                                      : 'bg-slate-600/55 text-slate-100'
                                }`}
                              >
                                {annotation.clientRemark.status === 'confirmé'
                                  ? 'Confirmé'
                                  : annotation.clientRemark.status === 'lu'
                                    ? 'Lu'
                                    : 'Non lu'}
                              </span>
                              {annotation.clientRemark.text ? (
                                <span className="line-clamp-2 break-words">{annotation.clientRemark.text}</span>
                              ) : null}
                            </div>
                          ) : (
                            <div className={`${annPanelTypography.itemSubSz} mt-1 text-gray-500`}>Pas de remarque</div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div
                  className={`shrink-0 border-t border-white/10 px-2 py-1.5 ${annPanelTypography.itemSubSz} leading-snug text-gray-500`}
                >
                  Remarque et statut : panneau « Annotations (panorama courant) » sur la page (sous ou à côté de la vue
                  360).
                </div>
                <div
                  role="separator"
                  aria-label="Redimensionner la largeur"
                  className="absolute right-0 top-0 bottom-0 z-30 w-2 cursor-ew-resize bg-transparent hover:bg-white/5"
                  style={{ top: PANO_ANN_PANEL_HEADER_H }}
                  onPointerDown={startPanoAnnotationPanelResize('resize-e')}
                  title="Redimensionner la largeur"
                />
                <div
                  role="separator"
                  aria-label="Redimensionner la hauteur"
                  className="absolute bottom-0 left-0 z-30 h-2 cursor-ns-resize bg-transparent hover:bg-white/5"
                  style={{ right: 10 }}
                  onPointerDown={startPanoAnnotationPanelResize('resize-s')}
                  title="Redimensionner la hauteur"
                />
                <div
                  role="separator"
                  aria-label="Redimensionner largeur et hauteur"
                  className="absolute bottom-0 right-0 z-30 h-3 w-3 cursor-nwse-resize rounded-tl border border-white/20 bg-black/50 hover:bg-white/10"
                  onPointerDown={startPanoAnnotationPanelResize('resize-se')}
                  title="Redimensionner le panneau (coin)"
                />
              </div>
            ) : null}
            {!panoFsActive && developerMode ? (
              <button
                type="button"
                onClick={() => {
                  setMeasureModeActive(v => {
                    if (!v) setMeasureStart(null)
                    return !v
                  })
                }}
                className={`absolute top-3 z-20 btn-sm shadow-lg ${
                  measureModeActive
                    ? 'bg-yellow-500 text-black hover:bg-yellow-400 border border-yellow-300'
                    : 'btn-secondary'
                }`}
                style={{ left: panoAnnotationListVisible ? 186 : 166 }}
                disabled={!currentPano}
                title={measureModeActive ? 'Désactiver l\'outil de mesure' : 'Activer l\'outil de mesure (2 clics = 1 mesure)'}
              >
                {measureModeActive ? '📏 Mesure ON' : '📏 Mesure'}
              </button>
            ) : null}
            {!panoFsActive && developerMode && measureModeActive && measureStart ? (
              <div className="absolute top-12 z-20 bg-black/70 text-yellow-300 text-xs px-2 py-1 rounded shadow"
                style={{ left: panoAnnotationListVisible ? 186 : 166 }}>
                Premier point placé — cliquez le second point
              </div>
            ) : null}
            <div
              ref={panoCompareSplitRowRef}
              className="flex w-full h-full min-h-0 relative isolate"
            >
              <div
                className="relative z-0 min-w-0 min-h-0 h-full"
                style={panoCompareLayoutActive ? { width: `${panoCompareSplitPct}%` } : { width: '100%' }}
              >
                <div className="h-full min-h-0 relative">
                  <div className="h-full min-h-0 relative" ref={containerRef} />
                  {currentPano?.blobPath && !currentPano.imageExists && !currentPano.imageBlobLoadFailed ? (
                    <div
                      className="absolute inset-0 z-[3] flex flex-col items-center justify-center gap-2 bg-slate-900/88 px-4 text-center"
                      role="status"
                      aria-live="polite"
                    >
                      <span className="text-[13px] font-medium text-cyan-100/95">
                        Téléchargement des panoramas en cours…
                      </span>
                      <span className="text-[11px] text-slate-300/90 max-w-sm leading-snug">
                        Les images haute résolution sont récupérées depuis le stockage Azure. Délai max.{' '}
                        {Math.round(BLOB_PANO_LOAD_TIMEOUT_MS / 60000)} min par image, puis échec affiché.
                      </span>
                    </div>
                  ) : null}
                  {currentPano?.blobPath && !currentPano.imageExists && currentPano.imageBlobLoadFailed ? (
                    <div
                      className="absolute inset-0 z-[3] flex flex-col items-center justify-center gap-3 bg-slate-900/92 px-4 text-center"
                      role="alert"
                    >
                      <span className="text-[13px] font-medium text-amber-200/95">
                        Impossible de charger ce panorama (Azure ou session expirée).
                      </span>
                      <span className="text-[11px] text-slate-300/90 max-w-sm leading-snug">
                        Vérifiez la connexion, reconnectez-vous si besoin, puis réessayez.
                      </span>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => currentPano && clearPanoImageBlobLoadFailed(currentPano.id)}
                      >
                        Réessayer
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              {panoCompareLayoutActive && secondaryPanoForCompare ? (
                <>
                  <div
                    role="separator"
                    title="Glisser pour ajuster le partage gauche / droite"
                    className="relative z-50 w-2 shrink-0 cursor-col-resize select-none self-stretch touch-none border-0 bg-transparent"
                    onPointerDown={beginPanoCompareSplitDrag}
                  >
                    <span
                      className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-cyan-500/45 via-slate-400/30 to-violet-500/45 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
                      aria-hidden
                    />
                  </div>
                  <div
                    className="relative z-0 min-w-0 min-h-0 h-full"
                    style={{ width: `${100 - panoCompareSplitPct}%` }}
                  >
                    <div className="h-full min-h-0 relative" ref={compareContainerRef} />
                    {!secondaryPanoForCompare.imageExists && !secondaryPanoForCompare.imageBlobLoadFailed ? (
                      <div className="absolute inset-0 z-[3] flex items-center justify-center bg-black/50 text-[11px] text-amber-100/90 p-2 text-center">
                        Chargement du 2e panorama (blob)…
                      </div>
                    ) : null}
                    {panoCompareLayoutActive &&
                    secondaryPanoForCompare &&
                    !secondaryPanoForCompare.imageExists &&
                    secondaryPanoForCompare.imageBlobLoadFailed ? (
                      <div className="absolute inset-0 z-[3] flex flex-col items-center justify-center gap-2 bg-black/70 p-2 text-center text-[11px] text-amber-100/95">
                        <span>Échec chargement 2e panorama (blob).</span>
                        <button
                          type="button"
                          className="btn-secondary btn-xs"
                          onClick={() => clearPanoImageBlobLoadFailed(secondaryPanoForCompare.id)}
                        >
                          Réessayer
                        </button>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
            {/* Overlay SVG pour les lignes de mesure sur la vue panorama */}
            {developerMode &&
              currentPano &&
              !panoFsActive &&
              (measureLines.filter(m => m.panoId === currentPano.id).length > 0 || (measureModeActive && measureStart)) && (
              <svg
                className="absolute inset-0 z-10"
                style={{ width: '100%', height: '100%', pointerEvents: measureDrag ? 'auto' : 'none' }}
                onPointerMove={e => {
                  if (!measureDragRef.current) return
                  const viewer = viewerRef.current
                  if (!viewer) return
                  const yp = viewer.screenToYawPitchPublic(e.clientX, e.clientY)
                  if (!yp) return
                  const { measureId, endpoint } = measureDragRef.current
                  const pano = panos.find(p => p.id === currentPanoId)
                  if (!pano) return
                  const worldHit = e57ViewerRef.current?.projectPanoramaRayToPointCloud(pano, yp)
                  if (!worldHit) return
                  setMeasureLines(ls =>
                    ls.map(m => {
                      if (m.id !== measureId) return m
                      const newPt: MeasurePoint = { yaw: yp.yaw, pitch: yp.pitch, world: worldHit }
                      const newStart = endpoint === 'start' ? newPt : m.start
                      const newEnd = endpoint === 'end' ? newPt : m.end
                      const dx = newEnd.world.x - newStart.world.x
                      const dy = newEnd.world.y - newStart.world.y
                      const dz = newEnd.world.z - newStart.world.z
                      return {
                        ...m,
                        start: newStart,
                        end: newEnd,
                        distanceCm: Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz) * 100 * 10) / 10,
                      }
                    })
                  )
                }}
                onPointerUp={() => {
                  if (measureDragRef.current) setMeasureDrag(null)
                }}
              >
                {measureLines
                  .filter(m => m.panoId === currentPano.id)
                  .map(m => {
                    const viewer = viewerRef.current
                    if (!viewer) return null
                    const SUBDIV = 32
                    const yaw1 = m.start.yaw
                    const pitch1 = m.start.pitch
                    const yaw2 = m.end.yaw
                    const pitch2 = m.end.pitch
                    let dYaw = yaw2 - yaw1
                    if (dYaw > Math.PI) dYaw -= 2 * Math.PI
                    if (dYaw < -Math.PI) dYaw += 2 * Math.PI
                    const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
                    let prev = viewer.projectYawPitchPublic(yaw1, pitch1)
                    for (let i = 1; i <= SUBDIV; i++) {
                      const t = i / SUBDIV
                      const y = yaw1 + dYaw * t
                      const p = pitch1 + (pitch2 - pitch1) * t
                      const cur = viewer.projectYawPitchPublic(y, p)
                      if (prev.visible && cur.visible) {
                        const screenDist = Math.hypot(cur.x - prev.x, cur.y - prev.y)
                        const maxAllowed = Math.max(containerRef.current?.clientWidth ?? 800, containerRef.current?.clientHeight ?? 600) * 0.5
                        if (screenDist < maxAllowed) {
                          segments.push({ x1: prev.x, y1: prev.y, x2: cur.x, y2: cur.y })
                        }
                      }
                      prev = cur
                    }
                    if (segments.length === 0) return null
                    const p1 = viewer.projectYawPitchPublic(yaw1, pitch1)
                    const p2 = viewer.projectYawPitchPublic(yaw2, pitch2)
                    const labelSeg = segments[Math.floor(segments.length / 2)]
                    const lx = (labelSeg.x1 + labelSeg.x2) / 2
                    const ly = (labelSeg.y1 + labelSeg.y2) / 2
                    const textW = String(m.distanceCm).length * 7 + 24
                    return (
                      <g key={m.id}>
                        {segments.map((s, i) => (
                          <line
                            key={i}
                            x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
                            stroke={m.color} strokeWidth={2.5} strokeDasharray="6 3"
                          />
                        ))}
                        {p1.visible && (
                          <circle
                            cx={p1.x} cy={p1.y} r={measureModeActive ? 8 : 5}
                            fill={m.color} stroke="#000" strokeWidth={1}
                            style={{ pointerEvents: measureModeActive ? 'auto' : 'none', cursor: measureModeActive ? 'grab' : 'default' }}
                            onPointerDown={e => {
                              if (!measureModeActive) return
                              e.stopPropagation()
                              e.preventDefault()
                              setMeasureDrag({ measureId: m.id, endpoint: 'start' })
                            }}
                          />
                        )}
                        {p2.visible && (
                          <circle
                            cx={p2.x} cy={p2.y} r={measureModeActive ? 8 : 5}
                            fill={m.color} stroke="#000" strokeWidth={1}
                            style={{ pointerEvents: measureModeActive ? 'auto' : 'none', cursor: measureModeActive ? 'grab' : 'default' }}
                            onPointerDown={e => {
                              if (!measureModeActive) return
                              e.stopPropagation()
                              e.preventDefault()
                              setMeasureDrag({ measureId: m.id, endpoint: 'end' })
                            }}
                          />
                        )}
                        <rect
                          x={lx - textW / 2} y={ly - 10} width={textW} height={20} rx={4}
                          fill="rgba(0,0,0,0.75)"
                        />
                        <text
                          x={lx} y={ly + 4}
                          textAnchor="middle" fill={m.color} fontSize={12} fontWeight="bold"
                        >
                          {m.distanceCm} cm
                        </text>
                      </g>
                    )
                  })}
                {/* Point de départ en cours de placement */}
                {measureModeActive && measureStart && (() => {
                  const viewer = viewerRef.current
                  if (!viewer) return null
                  const p = viewer.projectYawPitchPublic(measureStart.yaw, measureStart.pitch)
                  if (!p.visible) return null
                  return (
                    <>
                      <circle cx={p.x} cy={p.y} r={6} fill="none" stroke="#facc15" strokeWidth={2.5} />
                      <circle cx={p.x} cy={p.y} r={2} fill="#facc15" />
                    </>
                  )
                })()}
              </svg>
            )}
            {panoAnnotationListVisible && currentPano && !clientMode ? (
              <div
                className="absolute z-20 flex flex-col overflow-hidden rounded-lg border border-white/20 bg-black/70 shadow-xl backdrop-blur-sm select-none"
                style={{
                  left: panoAnnotationPanel.x,
                  top: panoAnnotationPanel.y,
                  width: panoAnnotationPanel.width,
                  height: panoAnnotationPanel.height,
                }}
              >
                <div
                  className={`flex shrink-0 cursor-move items-center justify-between gap-1 border-b border-white/15 bg-black/55 ${annPanelTypography.titleSz} font-semibold text-white/95`}
                  style={{
                    height: PANO_ANN_PANEL_HEADER_H,
                    minHeight: PANO_ANN_PANEL_HEADER_H,
                    paddingLeft: 8,
                    paddingRight: 6,
                  }}
                  onPointerDown={startPanoAnnotationPanelDrag}
                  title="Déplacer le panneau (glisser la barre de titre)"
                >
                  <span className="min-w-0 truncate leading-tight">Annotations (étage → gabarit)</span>
                  <span className="shrink-0 text-[8px] font-normal text-gray-400/90">⋮⋮</span>
                </div>
                <div
                  ref={panoAnnotationListScrollRef}
                  className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
                  style={{ padding: annPanelTypography.bodyPad }}
                >
                  {panoramaAnnotationGroups.length === 0 ? (
                    <div className={`${annPanelTypography.floorSz} text-gray-400`}>Aucune annotation ajoutée.</div>
                  ) : (
                    <div className="space-y-1">
                      {panoramaAnnotationGroups.map(floor => (
                        <div key={floor.floorLabel} className="rounded-md border border-white/10 bg-black/25">
                          <div
                            className={`${annPanelTypography.floorSz} font-semibold text-cyan-200 border-b border-white/10 ${annPanelTypography.padFloor} leading-tight break-words`}
                          >
                            {floor.floorLabel}
                          </div>
                          <div className="space-y-0.5 p-1">
                            {floor.templates.map(tpl => (
                              <div
                                key={`${floor.floorLabel}::${tpl.templateLabel}`}
                                className="overflow-hidden rounded border border-white/10 bg-white/[0.03]"
                              >
                                <div
                                  className={`flex items-center gap-2 border-b border-white/10 ${annPanelTypography.padTpl}`}
                                >
                                  <span
                                    className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-black/40 shadow-sm"
                                    style={{ backgroundColor: tpl.templateColorHex }}
                                    title={`Couleur gabarit : ${tpl.templateColorHex}`}
                                    aria-hidden
                                  />
                                  <div
                                    className={`min-w-0 flex-1 ${annPanelTypography.tplSz} font-medium leading-tight break-words text-gray-200`}
                                  >
                                    {tpl.templateLabel}
                                  </div>
                                </div>
                                <div className="space-y-0.5 p-0.5">
                                  {tpl.items.map(({ ann, ident, panoLabel, colorHex }) => (
                                    <div
                                      key={ann.id}
                                      className={`flex w-full min-w-0 items-stretch gap-0.5 rounded border text-left transition-colors ${
                                        ann.id === selectedAnnotationId
                                          ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-50 ring-1 ring-emerald-400/25'
                                          : 'border-white/10 bg-black/20 text-gray-200 hover:border-white/20 hover:bg-white/[0.07]'
                                      }`}
                                    >
                                      <button
                                        ref={el => {
                                          panoAnnotationItemRefs.current[ann.id] = el
                                        }}
                                        type="button"
                                        onClick={() => handlePanoMinimapAnnotationSelect(ann.id)}
                                        onDoubleClick={e => {
                                          e.preventDefault()
                                          handlePanoMinimapAnnotationSelect(ann.id)
                                          openAnnotationEditor(ann)
                                        }}
                                        className={`flex min-w-0 flex-1 gap-2 rounded-l border-0 bg-transparent text-left ${annPanelTypography.padItem} leading-tight text-inherit hover:bg-white/[0.06]`}
                                        title={`${ident} · ${colorHex} — Double-clic : caractéristiques`}
                                      >
                                        <span
                                          className="w-1 shrink-0 self-stretch rounded-full opacity-95"
                                          style={{
                                            backgroundColor: colorHex,
                                            boxShadow: `0 0 0 1px rgba(0,0,0,0.35)`,
                                          }}
                                          aria-hidden
                                        />
                                        <div className="min-w-0 flex-1">
                                          <div
                                            className={`${annPanelTypography.itemTitleSz} font-medium break-words hyphens-auto`}
                                          >
                                            {ident}
                                          </div>
                                          <div
                                            className={`${annPanelTypography.itemSubSz} mt-0.5 break-words ${
                                              ann.id === selectedAnnotationId
                                                ? 'text-emerald-200/75'
                                                : 'text-gray-400'
                                            }`}
                                          >
                                            {panoLabel}
                                          </div>
                                        </div>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={e => {
                                          e.preventDefault()
                                          e.stopPropagation()
                                          deleteAnnotation(ann.id)
                                        }}
                                        className={`shrink-0 rounded-r border-l border-white/10 px-1.5 text-red-400/95 transition-colors hover:bg-red-500/20 hover:text-red-300 ${annPanelTypography.itemTitleSz}`}
                                        title="Supprimer cette annotation"
                                        aria-label={`Supprimer l’annotation ${ident}`}
                                      >
                                        ×
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div
                  role="separator"
                  aria-label="Redimensionner la largeur"
                  className="absolute right-0 top-0 bottom-0 z-30 w-2 cursor-ew-resize bg-transparent hover:bg-white/5"
                  style={{ top: PANO_ANN_PANEL_HEADER_H }}
                  onPointerDown={startPanoAnnotationPanelResize('resize-e')}
                  title="Redimensionner la largeur"
                />
                <div
                  role="separator"
                  aria-label="Redimensionner la hauteur"
                  className="absolute bottom-0 left-0 z-30 h-2 cursor-ns-resize bg-transparent hover:bg-white/5"
                  style={{ right: 10 }}
                  onPointerDown={startPanoAnnotationPanelResize('resize-s')}
                  title="Redimensionner la hauteur"
                />
                <div
                  role="separator"
                  aria-label="Redimensionner largeur et hauteur"
                  className="absolute bottom-0 right-0 z-30 h-3 w-3 cursor-nwse-resize rounded-tl border border-white/20 bg-black/50 hover:bg-white/10"
                  onPointerDown={startPanoAnnotationPanelResize('resize-se')}
                  title="Redimensionner le panneau (coin)"
                />
              </div>
            ) : null}
            {floorMapAssetsEffective.length > 0 && currentPano && panoMinimapFloorButtons.length > 0 ? (
                <div
                  className="absolute z-20 pointer-events-auto"
                  style={{
                    left: `${panoMinimapWindow.x}px`,
                    top: `${panoMinimapWindow.y}px`,
                    width: `${panoMinimapWindow.width}px`,
                  }}
                >
                  {panoMinimapDataUrl ? (
                    <div className="relative flex flex-col overflow-hidden rounded-lg border border-white/25 bg-black/50 shadow-xl">
                      <div
                        className="flex cursor-move items-center justify-between gap-1 border-b border-white/15 bg-black/65 px-1.5 select-none"
                        style={{ height: PANO_MINIMAP_HEADER_HEIGHT, minHeight: PANO_MINIMAP_HEADER_HEIGHT }}
                        onPointerDown={startPanoMinimapDrag}
                        title="Déplacer la fenêtre (barre de titre). Dans le plan : molette = zoom, glisser = déplacer."
                      >
                        <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-white/95">
                          Plan · {panoMinimapFloorLabel}
                        </span>
                        <div className="flex shrink-0 items-center gap-0.5">
                          {panoFsActive && currentPanoId ? (
                            <PanoOrientationFullscreenMenu
                              flipX={panoOrientDraftFlipX}
                              flipY={panoOrientDraftFlipY}
                              onFlipX={setPanoOrientDraftFlipX}
                              onFlipY={setPanoOrientDraftFlipY}
                              onSave={savePanoViewAxisFlips}
                              menuAlign="right"
                            />
                          ) : null}
                          <button
                            type="button"
                            className="rounded px-1 py-0 text-[9px] text-cyan-200/90 hover:bg-white/10 hover:text-white"
                            title="Réinitialiser zoom et position du plan"
                            onPointerDown={e => e.stopPropagation()}
                            onClick={e => {
                              e.stopPropagation()
                              resetPanoMinimapPlanView()
                            }}
                          >
                            Reset
                          </button>
                        </div>
                      </div>
                      <div className="flex min-h-0 flex-row items-stretch">
                        <nav
                          className="flex shrink-0 flex-col gap-0.5 overflow-y-auto overflow-x-hidden border-r border-white/15 bg-black/45 py-1 pl-1 pr-0.5"
                          style={{ width: PANO_MINIMAP_FLOOR_RAIL_PX }}
                          role="toolbar"
                          aria-label="Étages — plan affiché"
                        >
                          {panoMinimapFloorButtons.map(label => (
                            <button
                              key={label}
                              type="button"
                              title={`Afficher le plan ${label}`}
                              aria-pressed={panoMinimapFloorLabel === label}
                              onClick={() => {
                                panoMinimapUserOverrideRef.current = true
                                setPanoMinimapFloorLabel(label)
                              }}
                              className={`inline-flex min-h-7 w-full items-center justify-center break-words rounded border px-0.5 py-0.5 text-[9px] font-semibold leading-tight shadow-sm transition-colors ${
                                panoMinimapFloorLabel === label
                                  ? 'border-sky-500 bg-sky-600 text-white hover:bg-sky-500'
                                  : 'border-white/25 bg-zinc-900/90 text-white/95 hover:bg-zinc-800/95 hover:text-white hover:border-white/35'
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </nav>
                        <div className="relative min-h-0 min-w-0 flex-1">
                      <div
                        ref={panoMinimapViewportRef}
                        className={`relative w-full touch-none select-none overflow-hidden bg-black/35 ${
                          panoMinimapViewDrag.active ? 'cursor-grabbing' : 'cursor-grab'
                        }`}
                        style={{ height: panoMinimapPlanAreaHeightPx, userSelect: 'none' }}
                        onPointerDown={handlePanoMinimapViewPointerDown}
                        onPointerMove={handlePanoMinimapViewPointerMove}
                        onPointerUp={handlePanoMinimapViewPointerUp}
                        onPointerCancel={handlePanoMinimapViewPointerUp}
                        title="Molette : zoom. Glisser : déplacer le plan. Clic molette + glisser : zoom continu."
                      >
                        <div
                          className="absolute inset-0 select-none"
                          style={{
                            transform: `translate(${panoMinimapViewOffset.x}px, ${panoMinimapViewOffset.y}px) scale(${panoMinimapViewScale})`,
                            transformOrigin: 'center center',
                            transition:
                              panoMinimapViewDrag.active || panoMinimapMiddleZoom.active
                                ? 'none'
                                : 'transform 0.08s ease-out',
                            userSelect: 'none',
                          }}
                        >
                          <img
                            src={panoMinimapDataUrl}
                            alt={`Plan d'étage ${panoMinimapFloorLabel}`}
                            className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill"
                            draggable={false}
                            onDragStart={e => e.preventDefault()}
                            style={
                              {
                                WebkitUserDrag: 'none',
                                userSelect: 'none',
                              } as React.CSSProperties
                            }
                          />
                          <div className="absolute inset-0 select-none" style={{ userSelect: 'none' }}>
                            {panoMinimapMarkers.map(m => {
                              const panoDragPreview =
                                panoMinimapPanoDrag?.panoId === m.panoId ? panoMinimapPanoDrag : null
                              return (
                                <button
                                  key={m.panoId}
                                  type="button"
                                  title={
                                    clientMode
                                      ? `Aller au panorama ${m.panoLabel}`
                                      : `Aller au panorama ${m.panoLabel} (glisser pour déplacer sur le plan)`
                                  }
                                  aria-label={`Aller au panorama ${m.panoLabel}`}
                                  onPointerDown={e => {
                                    if (clientMode) return
                                    if (e.button !== 0) return
                                    e.stopPropagation()
                                    setPanoMinimapAnnContextMenu(null)
                                    setPanoMinimapPanoDrag({
                                      panoId: m.panoId,
                                      pointerId: e.pointerId,
                                      startClientX: e.clientX,
                                      startClientY: e.clientY,
                                      moved: false,
                                      captured: false,
                                      xPct: m.xPct,
                                      yPct: m.yPct,
                                    })
                                  }}
                                  onClick={() => {
                                    if (panoMinimapSuppressPanoClickRef.current === m.panoId) {
                                      panoMinimapSuppressPanoClickRef.current = null
                                      return
                                    }
                                    setCurrentPanoId(m.panoId)
                                  }}
                                  className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-black/60 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                                    m.isCurrent ? 'h-4 w-4 ring-2 ring-white/95' : 'h-3 w-3'
                                  }`}
                                  style={{
                                    left: `${panoDragPreview ? panoDragPreview.xPct : m.xPct}%`,
                                    top: `${panoDragPreview ? panoDragPreview.yPct : m.yPct}%`,
                                    backgroundColor: `rgb(${m.rgb[0]},${m.rgb[1]},${m.rgb[2]})`,
                                  }}
                                />
                              )
                            })}
                            {panoMinimapAnnotationMarkers.map(m => {
                              const dragPreview =
                                panoMinimapAnnotationDrag?.annotationId === m.annotationId ? panoMinimapAnnotationDrag : null
                              return (
                                <button
                                  key={m.annotationId}
                                  type="button"
                                  title={`Annotation: ${m.annotationLabel}`}
                                  aria-label={`Annotation: ${m.annotationLabel}`}
                                  onPointerDown={e => {
                                    if (clientMode) return
                                    if (e.button !== 0) return
                                    e.stopPropagation()
                                    setPanoMinimapAnnContextMenu(null)
                                    setPanoMinimapAnnotationDrag({
                                      annotationId: m.annotationId,
                                      pointerId: e.pointerId,
                                      startClientX: e.clientX,
                                      startClientY: e.clientY,
                                      moved: false,
                                      captured: false,
                                      xPct: m.xPct,
                                      yPct: m.yPct,
                                    })
                                  }}
                                  onContextMenu={e => {
                                    if (clientMode) return
                                    e.preventDefault()
                                    e.stopPropagation()
                                    const el = panoMinimapViewportRef.current
                                    if (!el) return
                                    const rect = el.getBoundingClientRect()
                                    const localX = Math.max(8, Math.min(rect.width - 190, e.clientX - rect.left))
                                    const localY = Math.max(8, Math.min(rect.height - 44, e.clientY - rect.top))
                                    setPanoMinimapAnnContextMenu({ annotationId: m.annotationId, x: localX, y: localY })
                                  }}
                                  onClick={() => {
                                    if (panoMinimapSuppressAnnClickRef.current === m.annotationId) {
                                      panoMinimapSuppressAnnClickRef.current = null
                                      return
                                    }
                                    handlePanoMinimapAnnotationSelect(m.annotationId)
                                  }}
                                  onDoubleClick={
                                    clientMode
                                      ? undefined
                                      : e => {
                                          e.stopPropagation()
                                          const ann = annotations.find(a => a.id === m.annotationId)
                                          if (!ann) return
                                          setCurrentPanoId(ann.panoId)
                                          openAnnotationEditor(ann)
                                        }
                                  }
                                  className={`absolute -translate-x-1/2 -translate-y-1/2 border border-white/90 shadow-sm transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                                    m.markerOrigin === 'terrain_observation' ? 'rounded-[3px]' : 'rotate-45 rounded-sm'
                                  } ${
                                    m.isSelected ? 'h-3.5 w-3.5 ring-2 ring-amber-300 ring-offset-1 ring-offset-black/40' : 'h-3 w-3'
                                  }`}
                                  style={{
                                    left: `${dragPreview ? dragPreview.xPct : m.xPct}%`,
                                    top: `${dragPreview ? dragPreview.yPct : m.yPct}%`,
                                    backgroundColor: m.colorHex,
                                    backgroundImage: m.markerTextureCss,
                                    backgroundBlendMode: 'normal',
                                  }}
                                />
                              )
                            })}
                            {!clientMode && panoMinimapAnnContextMenu ? (
                              <div
                                className="absolute z-[25] rounded-md border border-white/20 bg-slate-950/95 shadow-lg p-1"
                                style={{ left: panoMinimapAnnContextMenu.x, top: panoMinimapAnnContextMenu.y }}
                                onPointerDown={e => e.stopPropagation()}
                                onClick={e => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  className="px-3 py-1.5 text-[11px] text-gray-100 hover:bg-white/10 rounded whitespace-nowrap"
                                  onClick={e => {
                                    e.stopPropagation()
                                    resetAnnotationPositionFromFloorMap(panoMinimapAnnContextMenu.annotationId)
                                    setPanoMinimapAnnContextMenu(null)
                                  }}
                                >
                                  Replacer à la position initiale
                                </button>
                              </div>
                            ) : null}
                            {panoMinimapViewOrientationOverlay ? (
                              <div
                                className="pointer-events-none absolute z-[3] -translate-x-1/2 -translate-y-1/2"
                                style={{
                                  left: `${panoMinimapViewOrientationOverlay.m.xPct}%`,
                                  top: `${panoMinimapViewOrientationOverlay.m.yPct}%`,
                                }}
                                title="Orientation de la vue panorama"
                              >
                                <div
                                  className="relative flex flex-col items-center"
                                  style={{ transform: `rotate(${panoMinimapViewOrientationOverlay.rot}deg)` }}
                                >
                                  <svg
                                    width="52"
                                    height="52"
                                    viewBox="-26 -26 52 52"
                                    className="overflow-visible drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
                                    aria-hidden
                                  >
                                    <path
                                      d="M 0 0 L 24 -8.5 L 28 0 L 24 8.5 Z"
                                      fill="rgba(34,211,238,0.4)"
                                      stroke="rgba(255,255,255,0.9)"
                                      strokeWidth="1.2"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </div>
                              </div>
                            ) : null}
                            {/* Lignes de mesure sur le mini-plan */}
                            {measureLines
                              .filter(m => {
                                const fl = panoFloorAssignments[m.panoId]?.trim()
                                return fl && fl === panoMinimapFloorLabel
                              })
                              .map(m => {
                                const sxA = m.start.world.x
                                const syA = m.start.world.z
                                const sxB = m.end.world.x
                                const syB = m.end.world.z
                                const pA = worldXYToFloorMapPercentFromDataset(sxA, syA, panoMinimapFloorLabel, spatialDataset)
                                const pB = worldXYToFloorMapPercentFromDataset(sxB, syB, panoMinimapFloorLabel, spatialDataset)
                                if (!pA || !pB) return null
                                const inRange = (v: number) => v >= -20 && v <= 120
                                if (!inRange(pA.xPct) || !inRange(pA.yPct) || !inRange(pB.xPct) || !inRange(pB.yPct)) return null
                                return (
                                  <svg
                                    key={m.id}
                                    className="pointer-events-none absolute inset-0 z-[4] overflow-hidden"
                                    style={{ width: '100%', height: '100%' }}
                                    viewBox="0 0 100 100"
                                    preserveAspectRatio="none"
                                  >
                                    <line
                                      x1={pA.xPct} y1={pA.yPct}
                                      x2={pB.xPct} y2={pB.yPct}
                                      stroke={m.color} strokeWidth={0.6} strokeDasharray="1.2 0.6"
                                      vectorEffect="non-scaling-stroke"
                                    />
                                    <circle cx={pA.xPct} cy={pA.yPct} r={0.8} fill={m.color} stroke="#000" strokeWidth={0.15} />
                                    <circle cx={pB.xPct} cy={pB.yPct} r={0.8} fill={m.color} stroke="#000" strokeWidth={0.15} />
                                    <text
                                      x={(pA.xPct + pB.xPct) / 2}
                                      y={(pA.yPct + pB.yPct) / 2 - 1.5}
                                      textAnchor="middle"
                                      fill={m.color} fontSize={3} fontWeight="bold"
                                      stroke="#000" strokeWidth={0.08}
                                    >
                                      {m.distanceCm} cm
                                    </text>
                                  </svg>
                                )
                              })}
                          </div>
                        </div>
                      </div>
                      <div
                        role="separator"
                        aria-label="Redimensionner la largeur du plan"
                        className="absolute right-0 z-30 w-2 cursor-ew-resize bg-transparent hover:bg-white/10"
                        style={{ top: 2, bottom: 14 }}
                        onPointerDown={e => startPanoMinimapResize(e, 'resize-e')}
                        title="Redimensionner la largeur (bord droit)"
                      />
                      <div
                        role="separator"
                        aria-label="Redimensionner la hauteur du plan"
                        className="absolute bottom-0 left-0 z-30 h-2 cursor-ns-resize bg-transparent hover:bg-white/10"
                        style={{ right: 14 }}
                        onPointerDown={e => startPanoMinimapResize(e, 'resize-s')}
                        title="Redimensionner la hauteur (bord bas)"
                      />
                      <div
                        role="separator"
                        aria-label="Redimensionner largeur et hauteur du plan"
                        className="absolute bottom-0 right-0 z-30 flex h-4 w-4 cursor-nwse-resize items-end justify-end rounded-tl border border-white/25 bg-black/55 p-0.5 text-white/90 hover:bg-white/15"
                        onPointerDown={e => startPanoMinimapResize(e, 'resize-se')}
                        title="Redimensionner (coin)"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <polyline points="14 20 20 20 20 14" />
                          <line x1="20" y1="20" x2="11" y2="11" />
                        </svg>
                      </div>
                        </div>
                      </div>
                    </div>
                  ) : panoMinimapLoadError ? (
                    <div className="rounded-lg border border-amber-500/40 bg-black/65 px-2 py-1.5 text-[10px] text-amber-100 shadow-lg">
                      Plan indisponible
                    </div>
                  ) : (
                    <div className="rounded-lg border border-white/15 bg-black/50 px-2 py-1.5 text-[10px] text-gray-200 shadow-lg">
                      Chargement du plan…
                    </div>
                  )}
                </div>
            ) : null}
            {developerMode && panoDebugXyzEnabled && panoDebugHudDisplay && (
              <div className="absolute left-2 bottom-2 z-10 max-w-[min(100%,420px)] pointer-events-none rounded-lg border border-cyan-500/35 bg-black/80 px-2.5 py-2 text-[11px] leading-snug text-cyan-100/95 shadow-lg backdrop-blur-sm">
                <div className="font-semibold text-cyan-200/95">{panoDebugHudDisplay.heading}</div>
                {panoDebugHudDisplay.sub ? (
                  <div className="text-cyan-100/80 truncate" title={panoDebugHudDisplay.sub}>
                    {panoDebugHudDisplay.sub}
                  </div>
                ) : null}
                {panoDebugHudDisplay.lines.map((line, i) => (
                  <div key={i} className="font-mono text-[10px] text-gray-200/95 mt-0.5 tabular-nums">
                    {line}
                  </div>
                ))}
              </div>
            )}
            {/* Panneau des mesures */}
            {!panoFsActive && developerMode && measureModeActive && measureLines.length > 0 && currentPano && (
              <div
                className="absolute bottom-2 left-2 z-20 max-h-52 w-72 overflow-y-auto rounded-lg border border-yellow-500/40 bg-black/80 shadow-xl backdrop-blur-sm"
              >
                <div className="sticky top-0 z-10 flex items-center justify-between bg-black/90 px-2 py-1 border-b border-yellow-500/30">
                  <span className="text-xs font-semibold text-yellow-300">Mesures ({measureLines.filter(m => m.panoId === currentPano.id).length})</span>
                  <button
                    type="button"
                    className="text-[10px] text-red-400 hover:text-red-300"
                    onClick={() => setMeasureLines(ls => ls.filter(m => m.panoId !== currentPano.id))}
                    title="Supprimer toutes les mesures de ce panorama"
                  >
                    Tout effacer
                  </button>
                </div>
                <div className="space-y-0.5 p-1">
                  {measureLines
                    .filter(m => m.panoId === currentPano.id)
                    .map(m => (
                      <div
                        key={m.id}
                        className="flex items-center gap-1.5 rounded border border-white/10 bg-black/30 px-1.5 py-1 text-[11px]"
                      >
                        <input
                          type="color"
                          value={m.color}
                          onChange={e => {
                            const c = e.target.value
                            setMeasureLines(ls => ls.map(l => (l.id === m.id ? { ...l, color: c } : l)))
                          }}
                          className="h-5 w-5 shrink-0 cursor-pointer rounded border border-white/20 bg-transparent p-0"
                          title="Couleur de la mesure"
                        />
                        <span className="font-mono tabular-nums flex-1" style={{ color: m.color }}>{m.distanceCm} cm</span>
                        <div className="flex gap-1 shrink-0">
                          <button
                            type="button"
                            className="text-emerald-400 hover:text-emerald-300 text-[10px]"
                            title="Enregistrer comme annotation"
                            onClick={() => {
                              const midWorld: Vec3 = {
                                x: (m.start.world.x + m.end.world.x) / 2,
                                y: (m.start.world.y + m.end.world.y) / 2,
                                z: (m.start.world.z + m.end.world.z) / 2,
                              }
                              const midYaw = (m.start.yaw + m.end.yaw) / 2
                              const midPitch = (m.start.pitch + m.end.pitch) / 2
                              const newAnn: AnnotationRecord = {
                                id: `ann-meas-${Date.now()}`,
                                panoId: m.panoId,
                                yawPitch: { yaw: midYaw, pitch: midPitch },
                                origin: 'added_annotation',
                                kind: 'point',
                                label: `Mesure ${m.distanceCm} cm`,
                                identifier: `M-${m.distanceCm}cm`,
                                description: `Mesure : ${m.distanceCm} cm\nDe (${m.start.world.x.toFixed(3)}, ${m.start.world.y.toFixed(3)}, ${m.start.world.z.toFixed(3)}) à (${m.end.world.x.toFixed(3)}, ${m.end.world.y.toFixed(3)}, ${m.end.world.z.toFixed(3)})`,
                                color: m.color,
                                pointCloudTarget: midWorld,
                              }
                              setAnnotations(prev => [...prev, newAnn])
                              addToast({
                                type: 'success',
                                title: 'Annotation créée',
                                message: `Mesure ${m.distanceCm} cm enregistrée comme annotation.`,
                                duration: 3000,
                              })
                            }}
                          >
                            Annoter
                          </button>
                          <button
                            type="button"
                            className="text-red-400 hover:text-red-300 text-[10px]"
                            title="Supprimer cette mesure"
                            onClick={() => setMeasureLines(ls => ls.filter(l => l.id !== m.id))}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
            {!currentPano && (
              <div className="absolute inset-0 grid place-items-center text-gray-400 text-sm px-4 text-center pointer-events-none">
                Chargez un ZIP contenant des panoramas pour demarrer la visualisation.
              </div>
            )}
          </div>

          {!clientMode ? (
          <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1 mt-5">
            {currentAnnotations.map(annotation => (
              <div
                key={annotation.id}
                className={`flex gap-0 items-stretch rounded-lg border transition-colors overflow-hidden ${
                  annotation.id === selectedAnnotationId
                    ? 'bg-emerald-500/20 border-emerald-500/50'
                    : 'bg-white/5 border-white/10'
                }`}
              >
                <div
                  className="w-2 shrink-0 self-stretch min-h-[2.75rem]"
                  style={{ backgroundColor: annotationRecordColor(annotation, userTemplates) }}
                  title={`Couleur: ${annotationRecordColor(annotation, userTemplates)}`}
                  aria-hidden
                />
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAnnotationId(annotation.id)
                    const focus = annotationFocusYawPitch(annotation)
                    viewerRef.current?.focusYawPitch(focus.yaw, focus.pitch)
                    const t = annotation.pointCloudTarget
                    if (t && Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z)) {
                      e57ViewerRef.current?.focusOnWorldPoint(t.x, t.y, t.z)
                    }
                  }}
                  onDoubleClick={e => {
                    e.preventDefault()
                    openAnnotationEditor(annotation)
                  }}
                  title={annotationHoverTitle(annotation, userTemplates)}
                  className="flex-1 text-left px-2 py-2 text-gray-200 min-w-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${
                        annotationKind(annotation) === 'zone'
                          ? 'bg-amber-500/20 text-amber-200 border border-amber-400/40'
                          : annotationKind(annotation) === 'text'
                            ? 'bg-violet-500/20 text-violet-200 border border-violet-400/40'
                            : 'bg-blue-500/20 text-blue-200 border border-blue-400/40'
                      }`}
                    >
                      {annotationKind(annotation) === 'text' ? 'texte' : annotationKind(annotation)}
                    </span>
                    {resolvedTemplateLabel(annotation, userTemplates) ? (
                      <span
                        className="shrink-0 px-1.5 py-0.5 rounded text-[10px] border text-gray-100"
                        style={{
                          borderColor: annotationRecordColor(annotation, userTemplates),
                          backgroundColor: `${annotationRecordColor(annotation, userTemplates)}29`,
                        }}
                      >
                        {resolvedTemplateLabel(annotation, userTemplates)}
                      </span>
                    ) : null}
                    <div className="text-sm font-semibold truncate min-w-0">
                      {annotation.identifier || annotation.label || annotation.id}
                    </div>
                    {annotationPositionLocked(annotation) && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] border border-rose-400/40 bg-rose-500/15 text-rose-100">
                        verrouillee
                      </span>
                    )}
                  </div>
                  {annotation.description && (
                    <div className="text-[11px] text-gray-400 line-clamp-2">{annotation.description}</div>
                  )}
                  {annotationKind(annotation) === 'text' && annotation.textContent?.trim() ? (
                    <div className="text-[11px] text-violet-200/90 line-clamp-2">{annotation.textContent.trim()}</div>
                  ) : null}
                  {(() => {
                    if (annotationKind(annotation) === 'text') return null
                    const specs = formatAnnotationSpecsLine(annotation, userTemplates)
                    return specs ? (
                      <div className="text-[10px] text-gray-500 line-clamp-2 mt-0.5">{specs}</div>
                    ) : null
                  })()}
                </button>
                {!clientMode ? (
                <button
                  type="button"
                  onClick={() => deleteAnnotation(annotation.id)}
                  className="px-2 text-xs text-red-400 hover:bg-red-500/10 shrink-0"
                  title="Supprimer"
                >
                  x
                </button>
                ) : null}
              </div>
            ))}
          </div>
          ) : null}

          {developerMode ? (
            <div id="etl360-gabarit-form" className="mt-4 pt-4 border-t border-white/10 space-y-3 scroll-mt-4">
            <h4 className="text-sm font-semibold text-gray-300">Gabarits</h4>
            <p className="text-[11px] text-gray-500 leading-snug">
              Créez des gabarits perso ou modifiez n’importe quel gabarit (intégré ou perso) par double-clic dans la liste
              ci-dessous. Les changements sur les gabarits intégrés sont enregistrés localement pour le projet (bouton
              « Réinitialiser » pour retrouver les valeurs d’origine).
            </p>
            {editingUserTemplateId ? (
              <p
                className="text-[11px] rounded-lg border border-amber-400/40 bg-amber-500/15 px-2 py-1.5 text-amber-100"
                role="status"
              >
                <span className="font-semibold">Édition :</span> gabarit sélectionné — enregistrez pour appliquer ou
                annulez pour quitter sans modifier.
              </p>
            ) : null}
            <label className="block text-xs text-gray-300">
              Nom du gabarit
              <input
                type="text"
                value={newUserTplName}
                onChange={e => setNewUserTplName(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm"
                placeholder="ex. Porte coupe-feu"
              />
            </label>
            <label className="flex flex-wrap items-center gap-3 text-xs text-gray-300">
              <span>Couleur du marqueur</span>
              <input
                type="color"
                value={newUserTplColor}
                onChange={e => setNewUserTplColor(e.target.value)}
                className="h-8 w-12 rounded border border-white/20 bg-transparent cursor-pointer shrink-0"
                aria-label="Couleur du gabarit"
              />
              <code className="text-[10px] text-gray-400 font-mono">{newUserTplColor}</code>
            </label>
            <label className="flex items-start gap-3 text-xs text-gray-300 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={newUserTplLockPositionDefault}
                onChange={e => setNewUserTplLockPositionDefault(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border border-white/20 bg-white/5"
              />
              <span>
                Verrouiller la position par défaut pour les annotations créées avec ce gabarit (modifiable ensuite dans
                l&apos;éditeur).
              </span>
            </label>
            <div className="space-y-2">
              <p className="text-[11px] font-medium text-gray-400">Caractéristiques standard (optionnel)</p>
              <p className="text-[10px] text-gray-500 leading-snug">
                Reprend les champs techniques des gabarits intégrés ; valeur par défaut proposée à la création
                d&apos;annotation et dans l&apos;éditeur lors du choix du gabarit.
              </p>
              <div ref={newUserTplBuiltinPickerRef} className="relative z-40">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={newUserTplBuiltinRows.length >= ANNOTATION_SPEC_FIELD_ORDER.length}
                  onClick={e => {
                    e.stopPropagation()
                    setNewUserTplBuiltinPickerOpen(o => !o)
                  }}
                >
                  {newUserTplBuiltinPickerOpen ? 'Fermer la liste' : '+ Ajouter une caractéristique standard'}
                </button>
                {newUserTplBuiltinPickerOpen && (
                  <ul
                    className="absolute left-0 top-full z-[400] mt-1 min-w-[min(100%,280px)] max-h-56 overflow-y-auto rounded-lg border border-slate-600 py-1 text-gray-100 shadow-2xl ring-1 ring-black/50"
                    style={{ backgroundColor: '#0f172a' }}
                    role="listbox"
                    aria-label="Choisir une caractéristique standard"
                  >
                    {ANNOTATION_SPEC_FIELD_ORDER.filter(k => !newUserTplBuiltinRows.some(r => r.key === k)).length ===
                    0 ? (
                      <li className="px-3 py-2 text-xs text-gray-500">
                        Toutes les caractéristiques standard sont déjà ajoutées.
                      </li>
                    ) : (
                      ANNOTATION_SPEC_FIELD_ORDER.filter(k => !newUserTplBuiltinRows.some(r => r.key === k)).map(k => (
                        <li key={k}>
                          <button
                            type="button"
                            role="option"
                            className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-white/10"
                            onClick={e => {
                              e.stopPropagation()
                              setNewUserTplBuiltinRows(rows => (rows.some(r => r.key === k) ? rows : [...rows, { key: k, defaultValue: '' }]))
                              setNewUserTplBuiltinPickerOpen(false)
                            }}
                          >
                            {ANNOTATION_SPEC_FIELD_LABELS[k]}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
              {newUserTplBuiltinRows.length > 0 ? (
                <ul className="space-y-2">
                  {ANNOTATION_SPEC_FIELD_ORDER.filter(k => newUserTplBuiltinRows.some(r => r.key === k)).map(k => {
                    const row = newUserTplBuiltinRows.find(r => r.key === k)
                    if (!row) return null
                    return (
                      <li
                        key={k}
                        className="flex flex-wrap gap-2 items-end rounded-md border border-white/10 bg-white/[0.04] p-2"
                      >
                        <span className="text-[11px] text-gray-300 font-medium min-w-[8rem] pt-2">
                          {ANNOTATION_SPEC_FIELD_LABELS[k]}
                        </span>
                        <label className="flex-1 min-w-[140px] text-[10px] text-gray-500">
                          Valeur par défaut
                          <input
                            type="text"
                            value={row.defaultValue}
                            onChange={e => {
                              const v = e.target.value
                              setNewUserTplBuiltinRows(rows =>
                                rows.map(r => (r.key === k ? { ...r, defaultValue: v } : r))
                              )
                            }}
                            className="mt-0.5 w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm"
                            placeholder="optionnel"
                          />
                        </label>
                        <button
                          type="button"
                          className="px-2 py-1.5 text-xs text-red-300 hover:bg-red-500/15 rounded border border-red-500/30 shrink-0"
                          onClick={() => setNewUserTplBuiltinRows(rows => rows.filter(r => r.key !== k))}
                        >
                          Retirer
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-medium text-gray-400">Caractéristiques libres</p>
              {newUserTplRows.map((row, i) => (
                <div key={i} className="flex flex-wrap gap-2 items-end">
                  <label className="flex-1 min-w-[120px] text-[11px] text-gray-400">
                    Libellé
                    <input
                      type="text"
                      value={row.label}
                      onChange={e => {
                        const next = [...newUserTplRows]
                        next[i] = { ...next[i], label: e.target.value }
                        setNewUserTplRows(next)
                      }}
                      className="mt-0.5 w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm"
                      placeholder="ex. Référence fabricant"
                    />
                  </label>
                  <label className="flex-1 min-w-[120px] text-[11px] text-gray-400">
                    Valeur par défaut
                    <input
                      type="text"
                      value={row.defaultValue}
                      onChange={e => {
                        const next = [...newUserTplRows]
                        next[i] = { ...next[i], defaultValue: e.target.value }
                        setNewUserTplRows(next)
                      }}
                      className="mt-0.5 w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm"
                      placeholder="optionnel"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={newUserTplRows.length <= 1}
                    onClick={() => setNewUserTplRows(rows => rows.filter((_, j) => j !== i))}
                    className="px-2 py-1.5 text-xs text-red-300 hover:bg-red-500/15 rounded border border-red-500/30 disabled:opacity-40 shrink-0"
                    title="Retirer la ligne"
                  >
                    Retirer
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setNewUserTplRows(rows => [...rows, { label: '', defaultValue: '' }])}
                className="btn-secondary btn-sm"
              >
                + Ajouter une ligne libre
              </button>
              <button type="button" onClick={saveNewUserTemplate} className="btn-primary btn-sm">
                {editingUserTemplateId ? 'Mettre à jour le gabarit' : 'Enregistrer le gabarit'}
              </button>
              {editingUserTemplateId ? (
                <button type="button" onClick={() => resetNewUserTplForm()} className="btn-secondary btn-sm">
                  Annuler l&apos;édition
                </button>
              ) : null}
            </div>
            <div className="pt-2 border-t border-white/10">
              <p className="text-[10px] font-medium text-gray-500 mb-1.5">
                Tous les gabarits — double-clic pour charger le formulaire d’édition (intégré ou perso)
              </p>
              <ul className="space-y-1.5 text-xs text-gray-300 max-h-[220px] overflow-y-auto pr-1">
                {ANNOTATION_TEMPLATE_LIST.map(def => {
                  const eff = effectiveIntegratedTemplateDef(def.id, userTemplates)
                  const hasOv = !!integratedTemplateOverride(def.id, userTemplates)
                  return (
                    <li
                      key={`builtin-${def.id}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-950/40 px-2 py-1.5"
                      onDoubleClick={e => {
                        e.preventDefault()
                        beginEditIntegratedTemplate(def)
                      }}
                      title="Double-clic pour modifier ce gabarit (sauvegarde locale)"
                    >
                      <span className="flex items-center gap-2 min-w-0 cursor-pointer select-none">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0 border border-white/20"
                          style={{ backgroundColor: eff.color }}
                          aria-hidden
                        />
                        <span className="truncate font-medium">{eff.label}</span>
                        <span className="text-[10px] text-slate-500 shrink-0">intégré</span>
                        {hasOv ? (
                          <span className="text-[10px] text-amber-300/90 shrink-0">personnalisé</span>
                        ) : null}
                        <span className="text-[10px] text-gray-500 shrink-0">
                          {eff.specKeys.length} champ{eff.specKeys.length !== 1 ? 's' : ''} standard
                        </span>
                      </span>
                      {hasOv ? (
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation()
                            removeUserTemplateById(def.id)
                          }}
                          className="shrink-0 px-2 py-1 text-amber-200/95 hover:bg-amber-500/15 rounded text-[11px] border border-amber-500/35"
                        >
                          Réinitialiser
                        </button>
                      ) : null}
                    </li>
                  )
                })}
                {userTemplates.filter(ut => !isIntegratedTemplateOverrideId(ut.id)).map(ut => {
                  const nStd = ut.builtinSpecKeys?.length ?? 0
                  const isEditing = editingUserTemplateId === ut.id
                  return (
                    <li
                      key={ut.id}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 ${
                        isEditing
                          ? 'border-amber-400/50 bg-amber-500/10'
                          : 'border-white/10 bg-white/[0.03]'
                      }`}
                      onDoubleClick={e => {
                        e.preventDefault()
                        beginEditUserTemplate(ut)
                      }}
                      title="Double-clic pour modifier ce gabarit"
                    >
                      <span className="flex items-center gap-2 min-w-0 cursor-pointer select-none">
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0 border border-white/20"
                          style={{ backgroundColor: ut.color }}
                          aria-hidden
                        />
                        <span className="truncate font-medium">{ut.name}</span>
                        <span className="text-[10px] text-cyan-400/90 shrink-0">perso</span>
                        <span className="text-[10px] text-gray-500 shrink-0">
                          {ut.characteristics.length} libre{ut.characteristics.length !== 1 ? 's' : ''}
                          {nStd > 0 ? ` · ${nStd} standard` : ''}
                          {ut.positionLockedDefault ? ' · pos. verrouillée' : ''}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          removeUserTemplateById(ut.id)
                        }}
                        className="shrink-0 px-2 py-1 text-red-300 hover:bg-red-500/10 rounded text-[11px]"
                      >
                        Supprimer
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
            </div>
          ) : null}
          </div>
            </div>
            {clientMode ? (
              <aside className="order-first flex w-full shrink-0 flex-col gap-3 rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-4 text-gray-100 lg:order-none lg:sticky lg:top-4 lg:z-10 lg:w-[min(100%,22rem)] lg:max-h-[min(calc(100dvh-2rem),920px)] lg:overflow-y-auto">
                <h3 className="text-sm font-semibold text-emerald-100/95">Annotations (panorama courant)</h3>
                <div className="min-h-[10rem] max-h-[min(28rem,52vh)] space-y-2 overflow-y-auto overscroll-y-contain pr-1">
                  {currentAnnotations.length === 0 ? (
                    <p className="text-xs text-gray-400">Aucune annotation sur ce panorama.</p>
                  ) : (
                    currentAnnotations.map(annotation => (
                      <button
                        key={annotation.id}
                        type="button"
                        onClick={() => {
                          setSelectedAnnotationId(annotation.id)
                          const focus = annotationFocusYawPitch(annotation)
                          viewerRef.current?.focusYawPitch(focus.yaw, focus.pitch)
                          const t = annotation.pointCloudTarget
                          if (t && Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z)) {
                            e57ViewerRef.current?.focusOnWorldPoint(t.x, t.y, t.z)
                          }
                        }}
                        className={`w-full rounded-lg border px-2 py-2 text-left text-xs transition-colors ${
                          annotation.id === selectedAnnotationId
                            ? 'border-emerald-400/60 bg-emerald-900/45 text-white'
                            : 'border-white/10 bg-black/30 text-gray-200 hover:border-white/25'
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          <div className="min-w-0 flex-1 truncate font-medium">
                            {annotation.identifier || annotation.label || annotation.id}
                          </div>
                          {annotationOrigin(annotation) === 'client_remark' ? (
                            <span
                              className="shrink-0 rounded border border-emerald-400/35 bg-emerald-900/50 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-100/90"
                              title="Annotation créée en mode client"
                            >
                              Client
                            </span>
                          ) : null}
                        </div>
                        {annotation.clientRemark ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-gray-400">
                            <span
                              className={`shrink-0 rounded px-1 py-0.5 ${
                                annotation.clientRemark.status === 'confirmé'
                                  ? 'bg-teal-600/45 text-teal-50'
                                  : annotation.clientRemark.status === 'lu'
                                    ? 'bg-sky-600/40 text-sky-50'
                                    : 'bg-slate-600/55 text-slate-100'
                              }`}
                            >
                              {annotation.clientRemark.status === 'confirmé'
                                ? 'Confirmé'
                                : annotation.clientRemark.status === 'lu'
                                  ? 'Lu'
                                  : 'Non lu'}
                            </span>
                            {annotation.clientRemark.text ? (
                              <span className="line-clamp-2 text-gray-400">{annotation.clientRemark.text}</span>
                            ) : null}
                          </div>
                        ) : (
                          <div className="mt-1 text-[10px] text-gray-500">Pas de remarque</div>
                        )}
                      </button>
                    ))
                  )}
                </div>
                <div className="mt-auto space-y-2 border-t border-white/10 pt-3">
                  <h4 className="text-xs font-semibold text-gray-200">Remarque client</h4>
                  {!selectedAnnotationId ? (
                    <p className="text-[11px] text-gray-500">
                      Sélectionnez une annotation dans la liste ou sur le panorama.
                    </p>
                  ) : (
                    <>
                      <label className="block text-[11px] text-gray-400">
                        Texte
                        <textarea
                          rows={4}
                          value={clientRemarkDraft.text}
                          onChange={e => setClientRemarkDraft(d => ({ ...d, text: e.target.value }))}
                          className="mt-1 w-full rounded-lg border border-white/15 bg-black/35 px-2 py-2 text-sm text-white placeholder:text-gray-600"
                          placeholder="Votre remarque…"
                        />
                      </label>
                      <label className="block text-[11px] text-gray-400">
                        Statut
                        <select
                          value={clientRemarkDraft.status}
                          onChange={e =>
                            setClientRemarkDraft(d => ({
                              ...d,
                              status: parseAnnotationClientRemarkStatus(e.target.value),
                            }))
                          }
                          className={`mt-1 w-full px-2 py-2 text-sm ${ETL360_SELECT_BASE}`}
                        >
                          <option value="non-lu">Non lu</option>
                          <option value="lu">Lu</option>
                          <option value="confirmé">Confirmé</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={persistClientRemarkForSelectedAnnotation}
                        className="btn-primary btn-sm w-full"
                      >
                        Enregistrer la remarque
                      </button>
                    </>
                  )}
                </div>
              </aside>
            ) : null}
          </div>
        ) : null}

        {currentPano && !clientMode && (
          <details
            className="glass-panel p-3 rounded-xl border border-white/10 open:border-white/15 group [overflow-anchor:none]"
            onToggle={restorePageScrollAfterDetailsToggle}
          >
            <summary className="cursor-pointer list-none pr-1 [&::-webkit-details-marker]:hidden flex items-center justify-between gap-2 select-none -m-0.5 rounded-lg px-1.5 py-1.5 hover:bg-white/[0.04] transition-colors">
              <span className="text-sm font-semibold text-gray-200">Options de panorama</span>
              <span
                className="inline-block text-gray-500 text-lg leading-none shrink-0 transition-transform group-open:rotate-90"
                aria-hidden
              >
                ›
              </span>
            </summary>
            <div className="pt-2 mt-2 border-t border-white/10 space-y-3">
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={renameDraft}
                onChange={e => setRenameDraft(e.target.value)}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm"
                placeholder="Nom affiche"
              />
              <button type="button" onClick={applyRename} className="btn-secondary btn-sm w-full">
                Appliquer le nom
              </button>
            </div>
            <div className="rounded-lg border border-cyan-500/25 bg-cyan-950/15 p-3 space-y-2">
              <p className="text-[11px] font-medium text-cyan-100/90">Comparaison avant / après (ce panorama)</p>
              <p className="text-[10px] text-gray-400 leading-relaxed">
                Liez ce panorama à une <strong className="text-gray-200">autre prise de vue</strong> du projet (liste
                ci-dessous) ou importez une image locale « après ». Puis activez « Avant / après » au-dessus de la vue 360.
              </p>
              <label className="block text-[11px] text-gray-300">
                2e panorama (projet)
                <select
                  value={compareOtherPanoIdDraft}
                  onChange={e => setCompareOtherPanoIdDraft(e.target.value)}
                  className={`mt-1 w-full px-2 py-1.5 text-xs ${ETL360_SELECT_BASE}`}
                >
                  <option value="">— Aucun —</option>
                  {panos
                    .filter(p => p.id !== currentPano.id)
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {panoDisplay(p)} — {p.id}
                      </option>
                    ))}
                </select>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="block text-[11px] text-gray-300">
                  Libellé panneau gauche
                  <input
                    value={compareLabelBeforeDraft}
                    onChange={e => setCompareLabelBeforeDraft(e.target.value)}
                    className="mt-1 w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white text-xs"
                    placeholder="Avant (défaut)"
                  />
                </label>
                <label className="block text-[11px] text-gray-300">
                  Libellé panneau droit
                  <input
                    value={compareLabelAfterDraft}
                    onChange={e => setCompareLabelAfterDraft(e.target.value)}
                    className="mt-1 w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white text-xs"
                    placeholder="Après (défaut)"
                  />
                </label>
              </div>
              <button type="button" onClick={applyPanoComparePairFromPanel} className="btn-secondary btn-sm w-full text-xs">
                Enregistrer la paire
              </button>
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-cyan-500/20">
                <label className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-900/30 px-3 py-1.5 text-[11px] font-medium text-cyan-50 hover:bg-cyan-800/40 cursor-pointer">
                  <input
                    type="file"
                    accept="image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tiff"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0] ?? null
                      e.currentTarget.value = ''
                      void importLocalAfterPanoForCompare(f)
                    }}
                  />
                  Importer une image « après » (fichier local)
                </label>
              </div>
            </div>
            {(() => {
              const assigned = (panoFloorAssignments[currentPano.id] || '').trim()
              const baseList = lowCostMode
                ? floorMapAssetsEffective.map(a => a.floorLabel)
                : floorLabels
              const floorOptions =
                assigned && !baseList.includes(assigned) ? [assigned, ...baseList] : baseList
              return (
                <div className="space-y-1">
                  <label className="block text-[11px] text-gray-400">Étage assigné à ce panorama</label>
                  <select
                    value={assigned}
                    onChange={e => assignPanoFloorForCurrentPano(e.target.value)}
                    className={`${ETL360_SELECT_BASE} w-full px-2 py-1.5 text-xs`}
                  >
                    {!lowCostMode && <option value="">Non assigné</option>}
                    {floorOptions.map(label => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              )
            })()}
            <div className="rounded-lg border border-white/10 bg-black/20 p-2 space-y-2">
              <p className="text-[11px] text-gray-400">Renommer un étage (applique aux panoramas, plans et remplacements).</p>
              <select
                value={floorRenameFrom}
                onChange={e => {
                  setFloorRenameFrom(e.target.value)
                  if (!floorRenameTo.trim()) setFloorRenameTo(e.target.value)
                }}
                className={`${ETL360_SELECT_BASE} w-full px-2 py-1.5 text-xs`}
              >
                <option value="">Choisir un étage</option>
                {floorRenameCandidates.map(label => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={floorRenameTo}
                onChange={e => setFloorRenameTo(e.target.value)}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm"
                placeholder="Nouveau nom d'étage"
              />
              <button type="button" onClick={applyFloorRename} className="btn-secondary btn-sm w-full">
                Renommer l'étage
              </button>
            </div>
            <details
              className="group rounded-lg border border-white/5 bg-black/20 text-[11px] text-gray-400 [overflow-anchor:none]"
              onToggle={restorePageScrollAfterDetailsToggle}
            >
              <summary className="cursor-pointer select-none list-none px-2 py-1.5 hover:text-gray-300 [&::-webkit-details-marker]:hidden flex items-center gap-1">
                <span className="inline-block text-gray-600 transition-transform group-open:rotate-90" aria-hidden>
                  ›
                </span>
                Orientation pano (encodage)
              </summary>
              <div className="border-t border-white/5 px-2 pb-2 pt-1.5 space-y-2">
                <p className="text-[10px] text-gray-500 leading-snug">
                  Si le nord ou l&apos;est semble inversé sur ce panorama uniquement, cochez les options puis enregistrez.
                </p>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border border-white/25 bg-white/5 accent-slate-400"
                    checked={panoOrientDraftFlipX}
                    onChange={e => setPanoOrientDraftFlipX(e.target.checked)}
                  />
                  <span>Inverser l&apos;axe X (est / ouest)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border border-white/25 bg-white/5 accent-slate-400"
                    checked={panoOrientDraftFlipY}
                    onChange={e => setPanoOrientDraftFlipY(e.target.checked)}
                  />
                  <span>Inverser l&apos;axe Y (nord / sud)</span>
                </label>
                <button type="button" onClick={savePanoViewAxisFlips} className="btn-secondary btn-sm w-full text-xs py-1">
                  Enregistrer
                </button>
              </div>
            </details>

            <div className="pt-1 border-t border-white/5">
            <h4 className="text-xs font-semibold text-gray-400 mb-2">Ajouter une annotation</h4>
            <div
              id="etl-manual-annotation-form"
              className="space-y-3"
            >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-300">
              <label className="space-y-1">
                <span className="text-gray-500">Yaw (rad)</span>
                <input
                  readOnly
                  value={syntheticYawPitch.yaw.toFixed(6)}
                  className="w-full px-2 py-1.5 bg-black/30 border border-white/10 rounded text-gray-200 text-xs"
                />
              </label>
              <label className="space-y-1">
                <span className="text-gray-500">Pitch (rad)</span>
                <input
                  readOnly
                  value={syntheticYawPitch.pitch.toFixed(6)}
                  className="w-full px-2 py-1.5 bg-black/30 border border-white/10 rounded text-gray-200 text-xs"
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-gray-500">Gabarit (optionnel)</span>
                <Etl360TemplateChoice
                  className="mt-0.5"
                  valueKey={
                    manualUserTemplateId
                      ? `u:${manualUserTemplateId}`
                      : manualTemplateId
                        ? `t:${manualTemplateId}`
                        : ''
                  }
                  onChangeKey={v => {
                    if (!v) {
                      setManualTemplateId('')
                      setManualUserTemplateId('')
                      return
                    }
                    if (v.startsWith('u:')) {
                      const id = v.slice(2)
                      setManualUserTemplateId(id)
                      setManualTemplateId('')
                      const ut = userTemplates.find(u => u.id === id)
                      if (ut) setManualColor(ut.color)
                      return
                    }
                    if (v.startsWith('t:')) {
                      const tid = v.slice(2) as AnnotationTemplateId
                      setManualTemplateId(tid)
                      setManualUserTemplateId('')
                      setManualColor(effectiveIntegratedTemplateDef(tid, userTemplates).color)
                    }
                  }}
                  userTemplates={userTemplates}
                  recentKeys={recentTemplateChoiceKeys}
                  onAfterPick={bumpRecentTemplateChoice}
                  includeEmpty
                  emptyLabel="Aucun"
                  userSuffix="(perso)"
                />
              </label>
              <div className="sm:col-span-2 space-y-2">
                {(() => {
                  const manualUt = manualUserTemplateId
                    ? userTemplates.find(u => u.id === manualUserTemplateId)
                    : undefined
                  const manualIntegOv =
                    manualTemplateId && !manualUserTemplateId
                      ? integratedTemplateOverride(manualTemplateId, userTemplates)
                      : undefined
                  const manualCustomTpl =
                    manualUt ??
                    (manualIntegOv?.characteristics?.length ? manualIntegOv : undefined)
                  const manualBuiltinKeys =
                    manualUserTemplateId && manualUt
                      ? manualUt.builtinSpecKeys ?? []
                      : manualTemplateId
                        ? effectiveIntegratedTemplateDef(manualTemplateId, userTemplates).specKeys
                        : []
                  return (
                    <>
                      {renderAnnCreationBuiltinBlock(
                        manualBuiltinKeys,
                        manualCreationSpec,
                        setManualCreationSpec
                      )}
                      {renderAnnCreationCustomBlock(manualCustomTpl, manualCreationCustom, setManualCreationCustom)}
                      {renderAnnCreationSurfaceMatiereBlock(
                        manualTemplateId,
                        manualCreationCustom,
                        setManualCreationCustom
                      )}
                    </>
                  )
                })()}
              </div>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-gray-500">Identifiant</span>
                <input
                  value={manualIdentifier}
                  onChange={e => setManualIdentifier(e.target.value)}
                  className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm"
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-gray-500">Description</span>
                <textarea
                  rows={2}
                  value={manualDescription}
                  onChange={e => setManualDescription(e.target.value)}
                  className="w-full px-2 py-1.5 bg-white/5 border border-white/10 rounded text-white text-sm"
                />
              </label>
              <label className="space-y-1 sm:col-span-2 flex flex-wrap items-center gap-3">
                <span className="text-gray-500 w-full">Couleur du marqueur</span>
                <input
                  type="color"
                  value={manualColor}
                  onChange={e => setManualColor(e.target.value)}
                  className="h-9 w-14 rounded border border-white/20 bg-transparent cursor-pointer shrink-0"
                  aria-label="Couleur du marqueur"
                />
                <code className="text-[11px] text-gray-400 font-mono">{manualColor}</code>
                <span className="text-[10px] text-gray-500">
                  défaut <code className="text-gray-400">{ETL360_DEFAULT_ANNOTATION_COLOR}</code>
                </span>
              </label>
            </div>
            <button type="button" onClick={submitManualAnnotation} className="btn-primary btn-sm w-full sm:w-auto">
              Ajouter depuis la direction courante
            </button>
            </div>
            </div>
            </div>
          </details>
        )}

        {panos.length > 0 ? (
          <div className="glass-panel p-4 rounded-xl border border-white/10 space-y-3">
            <h3 className="text-sm font-semibold text-white">Exporter le rapport de synthèse</h3>
            <p className="text-[11px] text-gray-400">
              Ouvre un <strong className="text-gray-300">rapport HTML</strong> dans un nouvel onglet (texte lisible, vues
              générées). Impression ou enregistrement en PDF possible via le navigateur (Fichier &rarr; Imprimer).
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={exportAnnotationsReportHtml} className="btn-primary btn-sm">
                Ouvrir le rapport HTML
              </button>
            </div>
          </div>
        ) : null}

        {developerMode ? (
          <div className="glass-panel p-4 rounded-xl border border-white/10 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">Visualisation E57 (nuage de points)</h3>
            {e57Stats && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void toggleE57Fullscreen()}
                  className="btn-secondary btn-sm shrink-0"
                  title={e57FsActive ? 'Quitter le plein ecran (Echap)' : 'Afficher le nuage en plein ecran (API navigateur)'}
                >
                  {e57FsActive ? 'Quitter plein ecran' : 'Plein ecran'}
                </button>
              </div>
            )}
          </div>
          <p className="text-[10px] text-gray-400">
            Les fichiers E57 / ZIP E57 se chargent depuis la zone <span className="text-cyan-200/90">Importer</span> en
            haut de page. Le nuage principal est colorisé par altitude (<span className="text-blue-200">bleu</span> en
            bas → <span className="text-rose-200">rouge</span> en haut) par défaut ; si le fichier comporte des couleurs
            RGB par point, activez l&apos;option « Couleurs d&apos;origine ». Même palette altitude dans
            l&apos;aperçu 3D du panorama. Fond 3D réglable ci-dessous ; le plein écran du nuage utilise
            l&apos;API du navigateur (comme le panorama, Échap pour quitter).
            Les <span className="text-gray-200">marqueurs de position caméra</span> (un voxel par prise de vue) gardent
            leur code couleur de la liste et de la carte. Le bouton <span className="text-gray-200">Repère XZY</span>{' '}
            permute uniquement Y et Z pour ces marqueurs et pour les plans d&apos;étage (TIFF / coupes) dans le nuage ;
            le nuage de points et les cibles d&apos;annotations ne sont pas transformés (cibles en couleur gabarit, double
            taille). Les plans d&apos;étage (coupes nuage ou GeoTIFF avec géoréférencement) peuvent être superposés dans
            le nuage, alignés en XY et à l&apos;altitude du plan. Navigation
            3D : rotation clic gauche, panoramique clic molette maintenu, zoom molette. En cas d&apos;erreur de lecture,
            utilisez un dossier 100 % local (pas OneDrive « en ligne uniquement »).
          </p>
          <div className="text-[11px] text-gray-500 min-h-[1.25rem] space-y-0.5">
            {e57Stats
              ? `${e57Stats.fileName} — ${e57Stats.displayedPointCount.toLocaleString()} / ${e57Stats.sourcePointCount.toLocaleString()} points affiches`
              : 'Aucun fichier E57 charge.'}
            {e57Stats?.spatialReference ? (
              <div className="font-mono text-[10px] text-emerald-200/90">
                SCR nuage : {e57Stats.spatialReference}
              </div>
            ) : e57Stats ? (
              <div className="text-[10px] text-amber-200/75">
                SCR nuage : non indiqué dans le manifeste (champs spatialReference / epsg).
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-300">
            <label htmlFor="etl-viewer-e57-voxel-slider" className="min-w-[130px]">
              Voxel affichage
            </label>
            <input
              id="etl-viewer-e57-voxel-slider"
              type="range"
              min={0}
              max={e57DisplayVoxelMax}
              step={Math.max(e57DisplayVoxelMax / 200, 0.001)}
              value={Math.min(e57DisplayVoxelSize, e57DisplayVoxelMax)}
              onChange={event => setE57DisplayVoxelSize(Number(event.currentTarget.value))}
              className="w-56"
              disabled={e57Loading || !e57Stats}
            />
            <span className="text-gray-400">
              {e57DisplayVoxelSize <= 0 ? 'aucun filtre supplementaire' : `${e57DisplayVoxelSize.toFixed(3)} m`}
            </span>
            <label className="inline-flex items-center gap-2 min-w-0" htmlFor="etl-viewer-e57-bg">
              <span className="text-gray-500 shrink-0">Fond 3D</span>
              <input
                id="etl-viewer-e57-bg"
                type="color"
                value={e57ViewerBgHex}
                onChange={e => setE57ViewerBgHex(e.target.value)}
                className="h-8 w-10 rounded border border-white/20 bg-transparent cursor-pointer shrink-0"
                title="Couleur de fond de la scène 3D"
                disabled={!e57Stats}
                aria-label="Couleur de fond du nuage 3D"
              />
            </label>
            <label
              className={`inline-flex items-center gap-2 cursor-pointer select-none ${!e57FileHasPointColors ? 'opacity-50' : ''}`}
              title={
                e57FileHasPointColors
                  ? 'Coloriser selon le fichier (RGB) ou revenir à la colormap par altitude'
                  : 'Aucun canal couleur par point dans ce nuage (colorisé par altitude)'
              }
            >
              <input
                type="checkbox"
                checked={e57UseSourcePointColors}
                onChange={e => setE57UseSourcePointColors(e.target.checked)}
                disabled={!e57Stats || !e57FileHasPointColors}
                className="h-4 w-4 rounded border border-white/20 bg-white/5"
              />
              <span>Couleurs d&apos;origine (fichier)</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={e57ShowFloorPlansInCloud}
                onChange={e => setE57ShowFloorPlansInCloud(e.target.checked)}
                disabled={!e57Stats || floorMapAssetsEffective.length === 0}
                className="h-4 w-4 rounded border border-white/20 bg-white/5"
              />
              <span>Plans dans le nuage</span>
            </label>
            <button
              type="button"
              onClick={() => setE57DevViewerAxesXzy(v => !v)}
              disabled={!e57Stats}
              className={`shrink-0 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                e57DevViewerAxesXzy
                  ? 'border-cyan-500/55 bg-cyan-600/20 text-cyan-100 hover:bg-cyan-600/30'
                  : 'border-white/15 bg-white/[0.06] text-gray-200 hover:bg-white/10'
              }`}
              title="Permute Y et Z uniquement pour les positions des panoramas (marqueurs) et les plans TIFF / coupes dans le nuage. Le nuage de points et les annotations ne bougent pas ; la caméra n’est pas recentrée."
            >
              Repère :{' '}
              <span className="font-mono tabular-nums">{e57DevViewerAxesXzy ? 'XZY' : 'XYZ'}</span>
            </button>
          </div>
          <div
            ref={e57FsRootRef}
            className={`relative z-0 w-full overflow-hidden border border-slate-300/50 ${
              e57FsActive
                ? 'h-screen max-h-[100dvh] rounded-none border-0'
                : 'h-[420px] rounded-xl'
            }`}
            style={{ backgroundColor: e57ViewerBgHex }}
          >
            {e57FsActive && (
              <div className="absolute top-3 right-3 z-20 flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setE57DevViewerAxesXzy(v => !v)}
                  disabled={!e57Stats}
                  className={`btn-secondary btn-sm shadow-lg shrink-0 ${
                    e57DevViewerAxesXzy ? 'border-cyan-500/50 bg-cyan-600/25 text-cyan-50' : ''
                  }`}
                  title="Permute Y et Z pour les marqueurs panoramas et les plans dans le nuage uniquement (nuage et annotations inchangés)."
                >
                  Repère :{' '}
                  <span className="font-mono tabular-nums">{e57DevViewerAxesXzy ? 'XZY' : 'XYZ'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void toggleE57Fullscreen()}
                  className="btn-secondary btn-sm shadow-lg shrink-0"
                  title="Quitter le plein ecran (Echap)"
                >
                  Quitter plein ecran
                </button>
              </div>
            )}
            <div ref={e57ContainerRef} className="w-full h-full" />
            {!e57Stats && (
              <div className="absolute inset-0 grid place-items-center text-sm text-gray-500 px-4 text-center pointer-events-none">
                Utilisez la zone Importer en haut : fichier E57 ou package ZIP E57.
              </div>
            )}
          </div>
          </div>
        ) : null}

      </div>}

      {/* ──── LOW-COST WIZARD ──── */}
      {lowCostMode && (
        <div className="glass-panel mt-4 p-4 rounded-xl border border-amber-500/20 space-y-4">
          <h3 className="text-sm font-semibold text-amber-200">Mode low-cost — Construction du projet</h3>
          <p className="text-[10px] text-gray-500 leading-relaxed">
            Flux en 7 étapes : 1) nombre d&apos;étages, 2) panoramas, 3) nuage optionnel, 4) coupes interactives (si nuage), 5) plan par étage (tracé / import / vide), 6) pastilles panoramas, 7) visualisation. Aucun nuage n&apos;est obligatoire ; un étage peut rester sans visuel (fond noir). À l&apos;étape 7, l&apos;étape 6 (pastilles, liste, plan) reste affichée et modifiable ; pour les autres étapes, utilisez les pastilles ci-dessous. Après toute modification de pastilles ou de plans, recliquez sur « Appliquer au viewer ».
          </p>
          {/* Step indicator — pastilles cliquables pour revenir à n'importe quelle étape (y compris depuis l'étape 7) */}
          <div className="flex flex-wrap gap-1 text-[10px]">
            {([
              ['floors', '1. Étages'],
              ['panos', '2. Panoramas'],
              ['cloud', '3. Nuage'],
              ['plans', '5. Plans'],
              ['pinning', '6. Pastilles'],
              ['ready', '7. Visualisation'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setLowCostStep(k)}
                className={`px-2 py-0.5 rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 ${
                  lowCostStep === k
                    ? 'bg-amber-500/25 border-amber-500/60 text-amber-100 font-semibold'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <>
              {/* ─── STEP 1 : Nombre d'étages ─── */}
              {lowCostStep === 'floors' && (
              <div className="space-y-2 border-b border-white/10 pb-3">
                <h4 className="text-xs font-medium text-gray-300">Étape 1 — Nombre d&apos;étages</h4>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={lowCostFloorCount}
                    onChange={e => setLowCostFloorCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                    className="w-20 rounded border border-white/15 bg-black/25 px-2 py-1 text-sm text-gray-100"
                  />
                  <span className="text-[11px] text-gray-400">étage(s)</span>
                  <button
                    type="button"
                    className="btn-primary btn-xs"
                    onClick={async () => {
                      await applyLowCostToRuntime({ rebuildFloors: 'blank-black' })
                      setFloorPlanReplaceTargetLabel('N1')
                      setLowCostStep('panos')
                    }}
                  >
                    Continuer vers les panoramas
                  </button>
                </div>
                <p className="text-[10px] text-gray-500">
                  Les étages sont créés avec un fond noir. Vous pourrez tracer / importer / régénérer leurs plans à l&apos;étape 5.
                </p>
              </div>
              )}

              {/* ─── STEP 2 : Import panoramas ─── */}
              {lowCostStep === 'panos' && (
                <div className="space-y-2 border-b border-white/10 pb-3">
                  <h4 className="text-xs font-medium text-gray-300">Étape 2 — Importer les panoramas (images)</h4>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,image/*"
                      multiple
                      onChange={async (e) => {
                        const files = e.target.files
                        if (!files || files.length === 0) return
                        const newPanos: LowCostPanoEntry[] = []
                        for (let i = 0; i < files.length; i++) {
                          const file = files[i]
                          const dataUrl = await new Promise<string>((resolve) => {
                            const reader = new FileReader()
                            reader.onload = () => resolve(reader.result as string)
                            reader.readAsDataURL(file)
                          })
                          const id = `lc-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`
                          const floor = floorMapAssets[0]?.floorLabel ?? 'N1'
                          const floorAsset = floorMapAssets.find(a => a.floorLabel === floor)
                          const alt = floorAsset?.floorAltitude ?? 0
                          newPanos.push({
                            id,
                            filename: file.name,
                            displayLabel: file.name.replace(/\.[^.]+$/, ''),
                            imageDataUrl: dataUrl,
                            positionWorld: { x: 0, y: 0, z: alt },
                            orientationYawRad: 0,
                            assignedFloorLabel: floor,
                          })
                        }
                        setLowCostPanos(prev => [...prev, ...newPanos])
                        e.currentTarget.value = ''
                      }}
                      className="text-xs text-gray-300"
                    />
                    <span className="text-[10px] text-gray-500">{lowCostPanos.length} panorama(s) importé(s)</span>
                  </div>
                  <p className="text-[10px] text-gray-500">
                    Dès qu&apos;un panorama est ajouté, la vue panorama et toutes ses fonctionnalités (annotations, mini-carte…) s&apos;activent automatiquement plus bas dans la page.
                  </p>
                  <div className="flex gap-2 flex-wrap pt-1">
                    <button
                      type="button"
                      className="btn-primary btn-xs"
                      onClick={() => setLowCostStep('cloud')}
                    >
                      Continuer vers le nuage (optionnel)
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-xs"
                      onClick={() => setLowCostStep('floors')}
                    >
                      ← Retour étages
                    </button>
                  </div>
                </div>
              )}

              {/* ─── STEP 3 : Nuage de points (optionnel) + outil de coupe ─── */}
              {lowCostStep === 'cloud' && (
                <div className="space-y-3 border-b border-white/10 pb-3">
                  <h4 className="text-xs font-medium text-gray-300">Étape 3 — Nuage de points (optionnel)</h4>
                  <p className="text-[10px] text-gray-500">
                    Importez un fichier <code className="text-amber-200/90">.e57</code> ou un package compressé{' '}
                    <code className="text-amber-200/90">.zip</code> (chunks <code>.bin</code> + <code>.json</code>). Si vous chargez un nuage, vous pourrez en dériver des plans de coupe à l&apos;étape suivante.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      accept=".e57,.zip,application/zip"
                      onChange={ev => {
                        const f = ev.target.files?.[0] ?? null
                        if (!f) return
                        const isZip = /\.zip$/i.test(f.name)
                        if (isZip) void handleLoadE57PackageZipFile(f)
                        else void handleLoadE57File(f)
                        ev.currentTarget.value = ''
                      }}
                      className="text-xs text-gray-300"
                      disabled={e57Loading}
                    />
                    {e57Loading && <span className="text-[10px] text-amber-300">Chargement…</span>}
                    {e57Stats && (
                      <span className="text-[10px] text-emerald-300">
                        ✓ {e57Stats.fileName} — {e57Stats.displayedPointCount.toLocaleString()} pts
                      </span>
                    )}
                  </div>

                  {/* Sub: interactive slice tool when cloud is loaded */}
                  {e57Stats && lowCostSideProfile && (
                    <div className="space-y-2 rounded-lg border border-amber-500/20 bg-amber-900/5 p-3 mt-2">
                      <h5 className="text-[11px] font-medium text-amber-200">Étape 4 — Coupes sur le profil latéral</h5>
                      <p className="text-[10px] text-gray-500">
                        Cliquez sur le profil pour placer la ligne de coupe active. Chaque coupe fait 30 cm d&apos;épaisseur.
                      </p>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex flex-wrap gap-1.5">
                          {Array.from({ length: lowCostFloorCount }, (_, i) => {
                            const center = lowCostSliceCenters[i]
                            const isActive = lowCostPlacingSliceIdx === i
                            return (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setLowCostPlacingSliceIdx(i)}
                                className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                                  isActive
                                    ? 'bg-amber-500/25 border-amber-500/60 text-amber-200 font-semibold'
                                    : 'bg-white/5 border-white/15 text-gray-300 hover:bg-white/10'
                                }`}
                              >
                                N{i + 1}
                                {center !== undefined ? (
                                  <span className="ml-1 text-gray-400">{center.toFixed(2)}m</span>
                                ) : (
                                  <span className="ml-1 text-gray-600">—</span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-gray-500 shrink-0">
                          <span>Aperçu</span>
                          {([1, 2, 3] as const).map(s => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setLowCostSlicePreviewScale(s)}
                              className={`px-1.5 py-0.5 rounded border text-[9px] transition-colors ${
                                lowCostSlicePreviewScale === s
                                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                                  : 'bg-white/5 border-white/10 text-gray-500 hover:text-gray-300'
                              }`}
                            >
                              {s}×
                            </button>
                          ))}
                        </div>
                      </div>

                      <div
                        className="relative w-full select-none rounded-lg overflow-hidden border border-white/15"
                        style={{ cursor: 'crosshair' }}
                        onClick={(ev) => {
                          const rect = ev.currentTarget.getBoundingClientRect()
                          const relY = (ev.clientY - rect.top) / rect.height
                          const { minAlt, maxAlt } = lowCostSideProfile
                          const alt = maxAlt - relY * (maxAlt - minAlt)
                          setLowCostSliceCenters(prev => {
                            const next = [...prev]
                            while (next.length <= lowCostPlacingSliceIdx) next.push(0)
                            next[lowCostPlacingSliceIdx] = alt
                            return next
                          })
                        }}
                        onMouseMove={(ev) => {
                          const rect = ev.currentTarget.getBoundingClientRect()
                          const relY = (ev.clientY - rect.top) / rect.height
                          const { minAlt, maxAlt } = lowCostSideProfile
                          setLowCostHoverAlt(maxAlt - relY * (maxAlt - minAlt))
                        }}
                        onMouseLeave={() => setLowCostHoverAlt(null)}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={lowCostSideProfile.dataUrl}
                          alt="Profil latéral du nuage"
                          className="w-full block"
                          draggable={false}
                        />
                        <svg
                          className="absolute inset-0 w-full h-full"
                          style={{ pointerEvents: 'none' }}
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          {lowCostSliceCenters.map((center, idx) => {
                            const { minAlt, maxAlt } = lowCostSideProfile
                            const span = Math.max(maxAlt - minAlt, 1e-6)
                            const yPct = (1 - (center - minAlt) / span) * 100
                            const topYPct = (1 - (center + 0.15 - minAlt) / span) * 100
                            const botYPct = (1 - (center - 0.15 - minAlt) / span) * 100
                            const isActive = idx === lowCostPlacingSliceIdx
                            const color = isActive ? '#f59e0b' : '#94a3b8'
                            return (
                              <g key={idx}>
                                <line x1="0" y1={`${topYPct}%`} x2="100%" y2={`${topYPct}%`}
                                  stroke={color} strokeWidth="0.5" strokeDasharray="3 4" opacity="0.45" />
                                <line x1="0" y1={`${botYPct}%`} x2="100%" y2={`${botYPct}%`}
                                  stroke={color} strokeWidth="0.5" strokeDasharray="3 4" opacity="0.45" />
                                <line x1="0" y1={`${yPct}%`} x2="100%" y2={`${yPct}%`}
                                  stroke={color} strokeWidth={isActive ? 2 : 1}
                                  strokeDasharray={isActive ? undefined : '5 3'} />
                                <rect x="4" y={`${yPct}%`} width="52" height="13"
                                  fill="rgba(0,0,0,0.55)" rx="2" transform="translate(0,-13)" />
                                <text x="6" y={`${yPct}%`} dy="-3"
                                  fill={isActive ? '#fde68a' : '#cbd5e1'}
                                  fontSize="9" fontFamily="monospace">
                                  N{idx + 1} {center.toFixed(2)}m
                                </text>
                              </g>
                            )
                          })}
                          {lowCostHoverAlt !== null && (() => {
                            const { minAlt, maxAlt } = lowCostSideProfile
                            const yPct = (1 - (lowCostHoverAlt - minAlt) / Math.max(maxAlt - minAlt, 1e-6)) * 100
                            return (
                              <g>
                                <line x1="0" y1={`${yPct}%`} x2="100%" y2={`${yPct}%`}
                                  stroke="#60a5fa" strokeWidth="1" strokeDasharray="4 3" opacity="0.55" />
                                <text x="55%" y={`${yPct}%`} dy="-3"
                                  fill="#93c5fd" fontSize="9" fontFamily="monospace" textAnchor="middle">
                                  {lowCostHoverAlt.toFixed(2)}m
                                </text>
                              </g>
                            )
                          })()}
                        </svg>

                        {lowCostSlicePreview && (
                          <div
                            className="absolute bottom-2 right-2 rounded border border-amber-500/40 overflow-hidden shadow-xl"
                            style={{ pointerEvents: 'none', width: lowCostSlicePreviewScale === 1 ? 128 : lowCostSlicePreviewScale === 2 ? 220 : 320 }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={lowCostSlicePreview.dataUrl} alt="Aperçu coupe" className="block w-full" />
                            <div className="text-[8px] text-amber-300 text-center bg-black/75 py-0.5 px-1">
                              N{lowCostPlacingSliceIdx + 1} · {lowCostSlicePreview.alt.toFixed(2)} m · {lowCostSlicePreviewScale}×
                            </div>
                          </div>
                        )}

                        {(() => {
                          const { minAlt, maxAlt } = lowCostSideProfile
                          return (
                            <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
                              {[0, 25, 50, 75, 100].map(pct => {
                                const alt = maxAlt - (pct / 100) * (maxAlt - minAlt)
                                return (
                                  <text key={pct} x="4" y={`${pct}%`} dy="4"
                                    fill="#64748b" fontSize="8" fontFamily="monospace">
                                    {alt.toFixed(1)}m
                                  </text>
                                )
                              })}
                            </svg>
                          )
                        })()}
                      </div>

                      {/* Fine-tune inputs */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {lowCostSliceCenters.map((center, idx) => (
                          <label key={`edit-slice-${idx}`} className="inline-flex items-center gap-1 text-[11px] text-gray-300">
                            <span className={idx === lowCostPlacingSliceIdx ? 'text-amber-300 font-medium' : ''}>N{idx + 1}</span>
                            <input
                              type="number"
                              step={0.05}
                              value={Math.round(center * 100) / 100}
                              onChange={e => {
                                const n = Number(e.target.value)
                                if (!Number.isFinite(n)) return
                                setLowCostSliceCenters(prev => prev.map((v, i) => (i === idx ? n : v)))
                              }}
                              onFocus={() => setLowCostPlacingSliceIdx(idx)}
                              className="w-20 rounded border border-white/15 bg-black/25 px-1.5 py-0.5 text-[11px] text-gray-100"
                            />
                            <span className="text-[10px] text-gray-500">m</span>
                          </label>
                        ))}
                      </div>

                      <div className="flex gap-2 flex-wrap pt-1">
                        <button
                          type="button"
                          className="btn-primary btn-xs"
                          onClick={async () => {
                            await applyLowCostToRuntime({ rebuildFloors: 'cloud-slice' })
                            setLowCostStep('plans')
                          }}
                        >
                          Générer les plans de coupe (30 cm) et continuer
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Skip cloud button (always available) */}
                  <div className="flex gap-2 flex-wrap pt-1">
                    <button
                      type="button"
                      className="btn-secondary btn-xs"
                      onClick={() => setLowCostStep('plans')}
                    >
                      Continuer sans nuage →
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-xs"
                      onClick={() => setLowCostStep('panos')}
                    >
                      ← Retour panoramas
                    </button>
                  </div>
                </div>
              )}

              {/* ─── STEP 5 : Plans par étage ─── */}
              {lowCostStep === 'plans' && (
                <div className="space-y-3 border-b border-white/10 pb-3">
                  <h4 className="text-xs font-medium text-gray-300">Étape 5 — Plan par étage</h4>
                  <p className="text-[10px] text-gray-500 leading-relaxed">
                    Pour chaque étage : tracez le plan, importez un PDF / image, régénérez depuis le nuage (si chargé) ou laissez vide (fond noir). Un étage sans plan reste valable.
                  </p>
                  {floorMapAssets.length === 0 ? (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-900/10 px-3 py-2 text-[11px] text-amber-100/90">
                      Préparation des plans pour {lowCostFloorCount} étage(s)… Si rien n&apos;apparaît, repassez par l&apos;étape 1 puis « Continuer vers les panoramas ».
                    </div>
                  ) : null}
                  <ul className="space-y-2">
                    {floorMapAssets.map(asset => {
                      const rep = floorPlanReplacements[asset.floorLabel]
                      const visual = lowCostFloorVisuals[asset.floorLabel] ?? (rep?.imageDataUrl ? (rep.mode === 'drawn' ? 'drawn' : 'imported') : 'blank')
                      const statusLabel =
                        visual === 'drawn' ? 'Tracé'
                          : visual === 'imported' ? 'Importé'
                          : visual === 'cloud-slice' ? 'Coupe nuage'
                          : 'Vierge (fond noir)'
                      const statusColor =
                        visual === 'blank' ? 'text-gray-400' : 'text-emerald-400'
                      return (
                        <li
                          key={asset.floorLabel}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                        >
                          <div className="text-[11px] text-gray-200">
                            <span className="font-medium text-amber-200/95">{asset.floorLabel}</span>
                            <span className={`ml-2 ${statusColor}`}>{statusLabel}</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              className="btn-secondary btn-xs"
                              onClick={() => {
                                setFloorPlanReplaceTargetLabel(asset.floorLabel)
                                openFloorPlanDrawEditor()
                              }}
                            >
                              Tracer
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-xs"
                              onClick={() => {
                                setFloorPlanReplaceTargetLabel(asset.floorLabel)
                                openFloorPlanImportEditor()
                              }}
                            >
                              Importer PDF / image
                            </button>
                            {e57Stats && (
                              <button
                                type="button"
                                className="btn-secondary btn-xs"
                                title="Recrée tous les plans depuis les coupes du nuage"
                                onClick={async () => {
                                  await applyLowCostToRuntime({ rebuildFloors: 'cloud-slice' })
                                }}
                              >
                                Régénérer (nuage)
                              </button>
                            )}
                            {(visual !== 'blank') && (
                              <button
                                type="button"
                                className="btn-secondary btn-xs text-gray-400"
                                title="Restaure le fond noir pour cet étage"
                                onClick={() => {
                                  setFloorPlanReplaceTargetLabel(asset.floorLabel)
                                  resetFloorPlanReplacementForTarget()
                                  setLowCostFloorVisuals(prev => ({ ...prev, [asset.floorLabel]: 'blank' }))
                                }}
                              >
                                Laisser vide
                              </button>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                  <p className="text-[10px] text-amber-200/70">
                    Astuce : un étage « Vierge » s&apos;affichera avec un fond noir dans la mini-carte et la vue panorama.
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      disabled={floorMapAssets.length === 0}
                      onClick={() => {
                        if (lowCostPanos.length > 0 && lowCostPlacingPanoIdx === null) setLowCostPlacingPanoIdx(0)
                        setLowCostPinningListFilter(LOW_COST_PINNING_LIST_ALL)
                        const firstFloor = floorMapAssetsEffective[0]?.floorLabel
                        if (firstFloor) setLowCostPinningMapFloor(firstFloor)
                        setLowCostStep('pinning')
                      }}
                    >
                      Continuer vers les pastilles
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setLowCostStep('cloud')}
                    >
                      ← Retour nuage
                    </button>
                  </div>
                </div>
              )}

              {lowCostStep === 'ready' && (
                <div className="rounded bg-emerald-900/20 border border-emerald-500/30 p-2 space-y-1 mb-3">
                  <p className="text-xs text-emerald-300">
                    Projet low-cost actif — {panos.length} panorama(s), {floorMapAssets.length} plan(s).
                    Utilisez les outils ci-dessous pour annoter, renommer et remplacer les plans.
                  </p>
                  <p className="text-[10px] text-gray-400">
                    Les pastilles et la liste des panoramas restent éditables ci-dessous. Après modification, cliquez de nouveau sur « Appliquer au viewer ». Pour le reste du parcours, utilisez les pastilles d&apos;étape (1 à 7) au-dessus.
                  </p>
                </div>
              )}

              {/* ─── STEP 6 : Pastilles panoramas par étage (également à l'étape 7) ─── */}
              {lowCostPastillesEditableStep && (
                <div className="space-y-2 border-b border-white/10 pb-3">
                  <h4 className="text-xs font-medium text-gray-300">
                    Étape 6 — Pastilles panoramas par étage
                    {lowCostStep === 'ready' ? (
                      <span className="ml-2 font-normal text-emerald-400/90">(modifiable à l&apos;étape 7)</span>
                    ) : null}
                  </h4>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,image/*"
                      multiple
                      onChange={async (e) => {
                        const files = e.target.files
                        if (!files || files.length === 0) return
                        const newPanos: LowCostPanoEntry[] = []
                        const labels = floorMapAssetsEffective.map(a => a.floorLabel)
                        const targetFloor =
                          lowCostPinningMapFloor && labels.includes(lowCostPinningMapFloor)
                            ? lowCostPinningMapFloor
                            : (labels[0] ?? 'N1')
                        const targetAsset = floorMapAssetsEffective.find(a => a.floorLabel === targetFloor)
                        const alt = targetAsset?.floorAltitude ?? 0
                        for (let i = 0; i < files.length; i++) {
                          const file = files[i]
                          const dataUrl = await new Promise<string>((resolve) => {
                            const reader = new FileReader()
                            reader.onload = () => resolve(reader.result as string)
                            reader.readAsDataURL(file)
                          })
                          const id = `lc-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`
                          newPanos.push({
                            id,
                            filename: file.name,
                            displayLabel: file.name.replace(/\.[^.]+$/, ''),
                            imageDataUrl: dataUrl,
                            positionWorld: { x: 0, y: 0, z: alt },
                            orientationYawRad: 0,
                            assignedFloorLabel: targetFloor,
                          })
                        }
                        setLowCostPanos(prev => {
                          const merged = [...prev, ...newPanos]
                          if (lowCostPlacingPanoIdx === null && newPanos.length > 0) setLowCostPlacingPanoIdx(merged.length - newPanos.length)
                          return merged
                        })
                        e.currentTarget.value = ''
                      }}
                      className="text-xs text-gray-300"
                    />
                    <span className="text-[10px] text-gray-500">
                      Ajout sur le plan affiché (
                      {lowCostPinningMapFloor && floorMapAssetsEffective.some(a => a.floorLabel === lowCostPinningMapFloor)
                        ? lowCostPinningMapFloor
                        : (floorMapAssetsEffective[0]?.floorLabel ?? '…')}
                      )
                    </span>
                  </div>
                </div>
              )}

              {/* STEP 6 (suite) : placement map per floor */}
              {lowCostPastillesEditableStep && floorMapAssetsEffective.length > 0 && (() => {
                /** Même source que la mini-carte panorama : inclut plans tracés / importés (sinon l'img reste sur un blob placeholder parfois révoqué). */
                const assetsForPinning = floorMapAssetsEffective
                const activePano = lowCostPlacingPanoIdx !== null ? lowCostPanos[lowCostPlacingPanoIdx] : null
                const mapFloorLabel = (() => {
                  const m = lowCostPinningMapFloor
                  if (m && assetsForPinning.some(a => a.floorLabel === m)) return m
                  return assetsForPinning[0]?.floorLabel ?? ''
                })()
                const mapFloorAsset = assetsForPinning.find(a => a.floorLabel === mapFloorLabel)
                const panosForList =
                  lowCostPinningListFilter === LOW_COST_PINNING_LIST_ALL
                    ? lowCostPanos
                    : lowCostPanos.filter(p => p.assignedFloorLabel === lowCostPinningListFilter)
                const panosOnMapFloor = lowCostPanos.filter(p => p.assignedFloorLabel === mapFloorLabel)
                const activePanoInFilteredList = Boolean(activePano && panosForList.some(p => p.id === activePano.id))
                const listIndices = panosForList.map(p => lowCostPanos.findIndex(x => x.id === p.id))
                const curListPos = activePano && lowCostPlacingPanoIdx !== null ? listIndices.indexOf(lowCostPlacingPanoIdx) : -1
                return (
                  <div className="space-y-2 border-b border-white/10 pb-3">
                    <h4 className="text-xs font-medium text-gray-300">Placer les panoramas sur le plan</h4>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-400">
                      <label className="inline-flex items-center gap-1.5">
                        <span className="text-gray-500 shrink-0">Liste</span>
                        <select
                          value={lowCostPinningListFilter}
                          onChange={e => setLowCostPinningListFilter(e.target.value)}
                          className="rounded border border-white/15 bg-black/25 px-2 py-0.5 text-[10px] text-gray-100 max-w-[11rem]"
                        >
                          <option value={LOW_COST_PINNING_LIST_ALL}>Tous les étages</option>
                          {assetsForPinning.map(a => (
                            <option key={a.floorLabel} value={a.floorLabel}>{a.floorLabel} uniquement</option>
                          ))}
                        </select>
                      </label>
                      <label className="inline-flex items-center gap-1.5">
                        <span className="text-gray-500 shrink-0">Plan affiché</span>
                        <select
                          value={mapFloorLabel}
                          onChange={e => setLowCostPinningMapFloor(e.target.value)}
                          className="rounded border border-white/15 bg-black/25 px-2 py-0.5 text-[10px] text-gray-100 max-w-[8rem]"
                          title={'Uniquement ce select change le plan sous les pastilles (pas le filtre liste, ni la sélection d\u2019un panorama).'}
                        >
                          {assetsForPinning.map(a => (
                            <option key={a.floorLabel} value={a.floorLabel}>{a.floorLabel}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {/* Liste filtrée (tous les étages ou un étage) — ne modifie jamais le filtre automatiquement */}
                    {panosForList.length > 0 && (
                      <div className="space-y-1 max-h-36 overflow-y-auto">
                        {panosForList.map(lp => {
                          const idx = lowCostPanos.indexOf(lp)
                          const isSelected = lowCostPlacingPanoIdx === idx
                          const hasPosition = lp.positionWorld.x !== 0 || lp.positionWorld.y !== 0
                          return (
                            <div
                              key={lp.id}
                              className={`flex items-center gap-2 rounded px-2 py-1 text-[11px] cursor-pointer ${isSelected ? 'bg-amber-900/30 border border-amber-500/40' : 'bg-black/20 hover:bg-white/5'}`}
                              onClick={() => setLowCostPlacingPanoIdx(idx)}
                            >
                              <span className={`w-2 h-2 rounded-full shrink-0 ${hasPosition ? 'bg-emerald-400' : 'bg-gray-600'}`} title={hasPosition ? 'Placé' : 'Non placé'} />
                              {lowCostPinningListFilter === LOW_COST_PINNING_LIST_ALL ? (
                                <span className="shrink-0 rounded bg-white/10 px-1 py-0 text-[9px] text-gray-400 tabular-nums" title="Étage assigné">
                                  {lp.assignedFloorLabel}
                                </span>
                              ) : null}
                              <span className="font-medium text-gray-100 flex-1 truncate">{lp.displayLabel || lp.filename}</span>
                              <select
                                value={lp.assignedFloorLabel}
                                onClick={e => e.stopPropagation()}
                                onChange={e => {
                                  e.stopPropagation()
                                  const floor = e.target.value
                                  const fa = assetsForPinning.find(a => a.floorLabel === floor)
                                  const alt = fa?.floorAltitude ?? 0
                                  setLowCostPanos(prev => prev.map((p, i) =>
                                    i === idx ? { ...p, assignedFloorLabel: floor, positionWorld: { ...p.positionWorld, z: alt } } : p
                                  ))
                                }}
                                className="rounded border border-white/15 bg-black/25 px-1.5 py-0.5 text-[10px] text-gray-100"
                              >
                                {assetsForPinning.map(a => (
                                  <option key={a.floorLabel} value={a.floorLabel}>{a.floorLabel}</option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="text-red-400 hover:text-red-300 text-[10px] shrink-0"
                                onClick={e => {
                                  e.stopPropagation()
                                  const next = lowCostPanos.filter((_, i) => i !== idx)
                                  if (lowCostPlacingPanoIdx === idx) setLowCostPlacingPanoIdx(null)
                                  else if (lowCostPlacingPanoIdx !== null && lowCostPlacingPanoIdx > idx) {
                                    setLowCostPlacingPanoIdx(lowCostPlacingPanoIdx - 1)
                                  }
                                  setLowCostPanos(next)
                                  void applyLowCostToRuntime({ rebuildFloors: false, suppressToast: true, panosOverride: next })
                                }}
                              >
                                ✕
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {activePano && !activePanoInFilteredList ? (
                      <p className="text-[10px] text-amber-200/90">
                        Panorama actif hors du filtre de liste affiché — il reste sélectionné ; passez la liste sur « Tous les étages » ou sur{' '}
                        <strong>{activePano.assignedFloorLabel}</strong> pour le voir dans la liste.
                      </p>
                    ) : null}
                    {activePano ? (
                      <p className="text-[10px] text-amber-300">
                        Placement actif : <strong>{activePano.displayLabel || activePano.filename}</strong> — plan{' '}
                        <strong>{mapFloorLabel}</strong> : cliquez pour positionner (l&apos;étage du panorama sera aligné sur ce plan).
                      </p>
                    ) : (
                      <p className="text-[10px] text-gray-500">
                        {lowCostPanos.length === 0
                          ? 'Aucun panorama importé. Utilisez l&apos;import ci-dessus.'
                          : panosForList.length === 0
                            ? 'Aucun panorama pour ce filtre d&apos;étage. Choisissez « Tous les étages » ou un autre filtre.'
                            : 'Sélectionnez un panorama dans la liste ci-dessus pour le placer.'}
                      </p>
                    )}
                    {mapFloorAsset ? (
                      <div
                        className="relative w-full rounded-lg overflow-hidden border border-white/15 bg-black/30"
                        style={{ cursor: activePano ? 'crosshair' : 'default', aspectRatio: mapFloorAsset.worldToPixel ? `${mapFloorAsset.worldToPixel.width} / ${mapFloorAsset.worldToPixel.height}` : undefined }}
                        onClick={(ev) => {
                          if (!activePano || !mapFloorAsset.worldToPixel) return
                          const rect = ev.currentTarget.getBoundingClientRect()
                          const xPct = ((ev.clientX - rect.left) / rect.width) * 100
                          const yPct = ((ev.clientY - rect.top) / rect.height) * 100
                          const geo = mapFloorAsset.worldToPixel
                          const u = (xPct / 100) * (geo.width - 1)
                          const v = (yPct / 100) * (geo.height - 1)
                          const world = pixelToWorldXY(geo, u, v)
                          if (world) {
                            const alt = mapFloorAsset.floorAltitude ?? 0
                            const idx = lowCostPlacingPanoIdx!
                            const nextPanos = lowCostPanos.map((p, i) =>
                              i === idx
                                ? {
                                    ...p,
                                    assignedFloorLabel: mapFloorLabel,
                                    positionWorld: { x: world.x, y: world.y, z: alt },
                                  }
                                : p
                            )
                            setLowCostPanos(nextPanos)
                            const posInFiltered = panosForList.findIndex(p => nextPanos.findIndex(x => x.id === p.id) === idx)
                            const tail = posInFiltered >= 0 ? panosForList.slice(posInFiltered + 1) : []
                            const nextLp = tail.find(p => {
                              const j = nextPanos.findIndex(x => x.id === p.id)
                              const q = nextPanos[j]
                              return (
                                q.assignedFloorLabel === mapFloorLabel &&
                                q.positionWorld.x === 0 &&
                                q.positionWorld.y === 0
                              )
                            })
                            if (nextLp) {
                              setLowCostPlacingPanoIdx(nextPanos.findIndex(x => x.id === nextLp.id))
                            } else {
                              const nextUnplaced = nextPanos.findIndex((p, i) =>
                                i > idx && p.assignedFloorLabel === mapFloorLabel && p.positionWorld.x === 0 && p.positionWorld.y === 0
                              )
                              if (nextUnplaced >= 0) setLowCostPlacingPanoIdx(nextUnplaced)
                            }
                          }
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={mapFloorAsset.imageUrl}
                          alt={mapFloorAsset.floorLabel}
                          className="w-full h-full object-fill select-none pointer-events-none"
                          draggable={false}
                        />
                        {/* Panorama dots (étage du plan affiché uniquement) */}
                        {panosOnMapFloor.map(p => {
                          const geo = mapFloorAsset.worldToPixel
                          if (!geo) return null
                          const pu = geo.m00 * p.positionWorld.x + geo.m01 * p.positionWorld.y + geo.m02
                          const pv = geo.m10 * p.positionWorld.x + geo.m11 * p.positionWorld.y + geo.m12
                          const pxPct = (pu / (geo.width - 1)) * 100
                          const pyPct = (pv / (geo.height - 1)) * 100
                          if (pxPct < -5 || pxPct > 105 || pyPct < -5 || pyPct > 105) return null
                          const isActive = p.id === activePano?.id
                          const yawDeg = (p.orientationYawRad * 180) / Math.PI
                          const pIdx = lowCostPanos.indexOf(p)
                          const coneLen = isActive ? 44 : 30
                          const halfAngRad = (80 / 2) * (Math.PI / 180)
                          const cx = Math.sin(halfAngRad) * coneLen
                          const cy = Math.cos(halfAngRad) * coneLen
                          const dotColor = isActive ? '#f59e0b' : '#06b6d4'
                          const dotBorder = isActive ? '#fde68a' : '#a5f3fc'
                          const coneFill = isActive ? 'rgba(245,158,11,0.18)' : 'rgba(6,182,212,0.14)'
                          const coneStroke = isActive ? 'rgba(245,158,11,0.8)' : 'rgba(6,182,212,0.65)'

                          return (
                            <React.Fragment key={p.id}>
                              {/* FOV cone + dot — single SVG, overflow:visible, pointer-events:none */}
                              <svg
                                className="absolute pointer-events-none"
                                width="0"
                                height="0"
                                style={{
                                  left: `${pxPct}%`,
                                  top: `${pyPct}%`,
                                  overflow: 'visible',
                                  zIndex: isActive ? 18 : 11,
                                }}
                              >
                                {/* Cone group — rotated around origin (= dot center) */}
                                <g transform={`rotate(${yawDeg - 90})`}>
                                  {/* FOV sector */}
                                  <path
                                    d={`M 0 0 L ${-cx} ${-cy} A ${coneLen} ${coneLen} 0 0 1 ${cx} ${-cy} Z`}
                                    fill={coneFill}
                                    stroke={coneStroke}
                                    strokeWidth="1.2"
                                    strokeLinejoin="round"
                                  />
                                  {/* Centre direction line */}
                                  <line
                                    x1="0" y1="0" x2="0" y2={-(coneLen + 4)}
                                    stroke={dotColor}
                                    strokeWidth={isActive ? 2 : 1.5}
                                    strokeLinecap="round"
                                  />
                                  {/* Arrowhead */}
                                  <polygon
                                    points={`0,${-(coneLen + 10)} ${-4},${-(coneLen)} ${4},${-(coneLen)}`}
                                    fill={dotColor}
                                  />
                                </g>
                                {/* Dot circle (drawn last = on top) */}
                                <circle
                                  cx="0" cy="0"
                                  r={isActive ? 7 : 5}
                                  fill={dotColor}
                                  stroke={dotBorder}
                                  strokeWidth="2"
                                />
                              </svg>

                              {/* Clickable hit area on the dot */}
                              <span
                                className="absolute rounded-full -translate-x-1/2 -translate-y-1/2"
                                style={{
                                  left: `${pxPct}%`,
                                  top: `${pyPct}%`,
                                  width: isActive ? '18px' : '14px',
                                  height: isActive ? '18px' : '14px',
                                  cursor: 'pointer',
                                  zIndex: isActive ? 22 : 13,
                                }}
                                title={p.displayLabel || p.filename}
                                onClick={ev => { ev.stopPropagation(); setLowCostPlacingPanoIdx(pIdx) }}
                              />

                              {/* Label */}
                              <span
                                className="absolute text-[9px] font-semibold pointer-events-none select-none whitespace-nowrap px-1 py-0.5 rounded"
                                style={{
                                  left: `${pxPct}%`,
                                  top: `${pyPct}%`,
                                  transform: 'translate(8px, -50%)',
                                  color: isActive ? '#fde68a' : '#a5f3fc',
                                  textShadow: '0 1px 4px rgba(0,0,0,1), 0 0 8px rgba(0,0,0,0.8)',
                                  zIndex: 23,
                                }}
                              >
                                {p.displayLabel || p.filename}
                              </span>
                            </React.Fragment>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-[10px] text-red-400">Plan introuvable pour l&apos;étage {mapFloorLabel} — regenerez les plans.</p>
                    )}
                    {/* Yaw control for active pano */}
                    {activePano && (
                      <div className="flex items-center gap-3 text-[11px] text-gray-300">
                        <span>Orientation (yaw) :</span>
                        <input
                          type="range"
                          min={-180}
                          max={180}
                          step={5}
                          value={Math.round((activePano.orientationYawRad * 180) / Math.PI)}
                          onChange={e => {
                            const deg = Number(e.target.value)
                            const idx = lowCostPlacingPanoIdx!
                            setLowCostPanos(prev => prev.map((p, i) =>
                              i === idx ? { ...p, orientationYawRad: (deg * Math.PI) / 180 } : p
                            ))
                          }}
                          className="w-28 accent-amber-400"
                        />
                        <input
                          type="number"
                          step={5}
                          value={Math.round((activePano.orientationYawRad * 180) / Math.PI)}
                          onChange={e => {
                            const deg = Number(e.target.value)
                            if (!Number.isFinite(deg)) return
                            const idx = lowCostPlacingPanoIdx!
                            setLowCostPanos(prev => prev.map((p, i) =>
                              i === idx ? { ...p, orientationYawRad: (deg * Math.PI) / 180 } : p
                            ))
                          }}
                          className="w-16 rounded border border-white/15 bg-black/25 px-1.5 py-0.5 text-[11px] text-gray-100"
                        />
                        <span className="text-gray-500">°</span>
                      </div>
                    )}
                    {/* Navigation dans la liste filtrée (sans changer le filtre ni le plan affiché) */}
                    <div className="flex gap-2 flex-wrap">
                      {curListPos > 0 && listIndices[curListPos - 1] >= 0 && (
                        <button
                          type="button"
                          className="btn-secondary btn-xs"
                          onClick={() => setLowCostPlacingPanoIdx(listIndices[curListPos - 1])}
                        >
                          ← Précédent
                        </button>
                      )}
                      {curListPos >= 0 && curListPos < listIndices.length - 1 && listIndices[curListPos + 1] >= 0 && (
                        <button
                          type="button"
                          className="btn-secondary btn-xs"
                          onClick={() => setLowCostPlacingPanoIdx(listIndices[curListPos + 1])}
                        >
                          Suivant →
                        </button>
                      )}
                    </div>
                  </div>
                )
              })()}

              {/* STEP 6 (suite) : apply to viewer + go to ready (réapplication possible à l'étape 7) */}
              {lowCostPastillesEditableStep && (
                <div className="space-y-2 pt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    onClick={async () => {
                      const alreadyReady = lowCostStep === 'ready'
                      await applyLowCostToRuntime({ rebuildFloors: false })
                      setLowCostStep('ready')
                      addToast({
                        type: 'success',
                        title: 'Low-cost',
                        message: alreadyReady
                          ? 'Modifications des pastilles / panoramas appliquées au viewer.'
                          : 'Projet appliqué — le viewer standard est maintenant actif.',
                        duration: 3500,
                      })
                    }}
                  >
                    Appliquer au viewer
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setLowCostStep('plans')}
                  >
                    ← Retour plans
                  </button>
                </div>
              )}
            </>
        </div>
      )}

      {showFloorPlanReplacementPanel ? (
      <div className="glass-panel mt-4 p-4 rounded-xl border border-white/10 space-y-3">
        <h3 className="text-sm font-semibold text-white">Remplacement de plan d&apos;étage</h3>
        <p className="text-[11px] text-gray-400">
          Remplace le visuel du plan pour la visualisation et le rapport, en conservant le géoréférencement de l&apos;étage.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <label className="text-xs text-gray-300 space-y-1">
            <span>Étage cible</span>
            <select
              value={floorPlanReplaceTargetLabel}
              onChange={e => setFloorPlanReplaceTargetLabel(e.target.value)}
              className={`${ETL360_SELECT_BASE} w-full px-2 py-1.5 text-xs`}
              disabled={floorMapAssets.length === 0}
            >
              {floorMapAssets.length === 0 ? (
                <option value="">Aucun plan</option>
              ) : (
                floorMapAssets.map(asset => (
                  <option key={asset.floorLabel} value={asset.floorLabel}>
                    {asset.floorLabel}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="text-xs text-gray-300 space-y-1">
            <span>Mode</span>
            <select
              value={floorPlanReplaceMode}
              onChange={e => setFloorPlanReplaceMode(e.target.value === 'drawn' ? 'drawn' : 'imported')}
              className={`${ETL360_SELECT_BASE} w-full px-2 py-1.5 text-xs`}
              disabled={!floorPlanReplaceTargetLabel}
            >
              <option value="drawn">Tracer soi-même</option>
              <option value="imported">Remplacer par plan existant</option>
            </select>
          </label>
          <div className="text-xs text-gray-300 space-y-1">
            <span className="block">État courant</span>
            <div className="rounded border border-white/10 bg-black/20 px-2 py-1.5 text-[11px] text-gray-400">
              {floorPlanReplacements[floorPlanReplaceTargetLabel]
                ? `Plan remplacé (${floorPlanReplacements[floorPlanReplaceTargetLabel]?.mode === 'drawn' ? 'tracé' : 'import'})`
                : 'Plan original'}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={!floorPlanReplaceTargetLabel}
            onClick={() => {
              if (floorPlanReplaceMode === 'drawn') openFloorPlanDrawEditor()
              else openFloorPlanImportEditor()
            }}
          >
            Prévisualiser
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={!floorPlanReplaceTargetLabel}
            onClick={() => {
              if (floorPlanReplaceMode === 'imported') {
                if (floorPlanAlignedPreviewDataUrl) applyImportedFloorPlanReplacement()
                else openFloorPlanImportEditor()
                return
              }
              openFloorPlanDrawEditor()
            }}
          >
            Appliquer
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={!floorPlanReplaceTargetLabel || !floorPlanReplacements[floorPlanReplaceTargetLabel]}
            onClick={resetFloorPlanReplacementForTarget}
          >
            Réinitialiser remplacement
          </button>
        </div>
      </div>
      ) : null}

      {(!lowCostHidesViewer || lowCostStep === 'plans') && floorPlanImportModalOpen && floorPlanTargetAsset && (
        <div className={`${panoModalOverlayClass} z-[110] flex items-center justify-center bg-black/75 p-4`} role="presentation">
          <div className="glass-panel w-full max-w-6xl max-h-[90vh] overflow-y-auto p-4 border border-white/20 rounded-2xl shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-white">Remplacer par plan existant — {floorPlanTargetAsset.floorLabel}</h3>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded border tabular-nums ${
                    floorPlanImportInteractionMode === 'crop'
                      ? 'border-amber-500/50 bg-amber-900/25 text-amber-200'
                      : 'border-cyan-500/40 bg-cyan-900/20 text-cyan-200'
                  }`}
                >
                  {floorPlanImportInteractionMode === 'crop' ? 'Mode rogner' : 'Mode ajuster'}
                </span>
              </div>
              <button type="button" className="btn-secondary btn-sm" onClick={() => { setFloorPlanImportModalOpen(false); clearFloorPlanImportDraft() }}>
                Fermer
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mb-3">
              {floorPlanImportCalageUi ? (
                <>
                  Importez un fichier (image ou PDF). Alignez le plan importé sur les pastilles panoramas.
                  <br />
                  <span className="text-gray-500 text-[10px]">
                    <strong>Coins</strong> = rotation · <strong>Bords (milieu)</strong> = étirer Scale X / Scale Y · <strong>Drag</strong> = déplacer ·{' '}
                    <strong>Double-clic sur l&apos;image</strong> = mode rogner (bords uniquement)
                  </span>
                </>
              ) : (
                <>
                  Import sans nuage de points : pas de calage sur le plan de fond. Ajustez rotation et taille, ou basculez en <strong>mode rogner</strong> par{' '}
                  <strong>double-clic sur l&apos;image</strong>.
                  <br />
                  <span className="text-gray-500 text-[10px]">
                    <strong>Mode ajuster</strong> : coins = rotation, bords = redimensionner · <strong>Mode rogner</strong> : bords = rogner le contenu (double-clic sur l’image
                    pour revenir en mode ajuster)
                  </span>
                </>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,application/pdf,image/*"
                onChange={e => {
                  void handleFloorPlanImportFile(e.target.files?.[0] ?? null)
                  e.currentTarget.value = ''
                }}
                className="text-xs text-gray-300"
              />
              {floorPlanImportCalageUi ? (
                <>
                  <button type="button" className="btn-secondary btn-sm" onClick={resetFloorPlanImportAlignment}>
                    Réinitialiser calage
                  </button>
                  <label className="inline-flex items-center gap-2 text-[11px] text-gray-300">
                    Fond original {Math.round(floorPlanImportBaseOverlayOpacity)}%
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={floorPlanImportBaseOverlayOpacity}
                      onChange={e => setFloorPlanImportBaseOverlayOpacity(Number(e.target.value))}
                      className="w-24 accent-cyan-400"
                    />
                  </label>
                </>
              ) : (
                <button type="button" className="btn-secondary btn-sm" onClick={resetFloorPlanImportAlignment}>
                  Réinitialiser image
                </button>
              )}
            </div>
            <div className="mt-2 space-y-1">
              <h4 className="text-xs font-medium text-gray-300">
                {floorPlanImportCalageUi ? 'Zone de calage interactive' : 'Aperçu et rognage'}
              </h4>
              {floorPlanImportedDataUrl ? (
                <div className="overflow-auto rounded border border-white/15 bg-black p-1 max-h-[60vh]">
                  {/*
                    Couches (bas → haut) :
                    1. Canvas Fabric (#111 bg) : plan importé manipulable
                    2. img HTML : plan original semi-transparent (pointer-events:none)
                    3. spans HTML : pastilles panoramas (pointer-events:none)
                  */}
                  <div
                    className="relative mx-auto"
                    style={
                      floorPlanImportCanvasDisplaySize
                        ? { width: floorPlanImportCanvasDisplaySize.w, height: floorPlanImportCanvasDisplaySize.h }
                        : { minWidth: 200, minHeight: 150 }
                    }
                  >
                    {/* Couche 1: canvas Fabric */}
                    <div
                      ref={floorPlanImportFabricContainerRef}
                      className="absolute inset-0"
                    />
                    {/* Couche 2: plan original semi-transparent (uniquement si nuage / calage) */}
                    {floorPlanImportCalageUi && floorPlanTargetAsset?.imageUrl && floorPlanImportCanvasDisplaySize && (
                      <img
                        src={floorPlanTargetAsset.imageUrl}
                        alt="overlay plan original"
                        className="pointer-events-none absolute inset-0 w-full h-full"
                        style={{ opacity: floorPlanImportBaseOverlayOpacity / 100, objectFit: 'fill' }}
                        draggable={false}
                      />
                    )}
                    {/* Couche 3: pastilles panoramas (calage sur nuage uniquement) */}
                    {floorPlanImportCalageUi && floorPlanImportCanvasDisplaySize && floorPlanImportTargetPanoDots.map(dot => (
                      <span
                        key={`import-dot-${dot.panoId}`}
                        className="pointer-events-none absolute z-20 rounded-full border-2 border-white shadow-md"
                        style={{
                          left: `${dot.xPct}%`,
                          top: `${dot.yPct}%`,
                          width: 14,
                          height: 14,
                          transform: 'translate(-50%, -50%)',
                          backgroundColor: dot.colorHex ?? '#22d3ee',
                        }}
                        title={`Panorama ${dot.panoId}`}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-28 rounded border border-dashed border-white/15 grid place-items-center text-xs text-gray-500">
                  {floorPlanImportCalageUi
                    ? 'Chargement du calage ou importez un autre fichier'
                    : 'Chargement de l\u2019aperçu ou importez un autre fichier'}
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary btn-sm" onClick={() => { setFloorPlanImportModalOpen(false); clearFloorPlanImportDraft() }}>
                Annuler
              </button>
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={!floorPlanAlignedPreviewDataUrl}
                onClick={applyImportedFloorPlanReplacement}
              >
                Appliquer ce plan
              </button>
            </div>
          </div>
        </div>
      )}

      {(!lowCostHidesViewer || lowCostStep === 'plans') && floorPlanDrawModalOpen && floorPlanTargetAsset && (
        <div className={`${panoModalOverlayClass} z-[110] flex items-center justify-center bg-black/75 p-4`} role="presentation">
          <div className="glass-panel w-full max-w-6xl max-h-[90vh] overflow-y-auto p-4 border border-white/20 rounded-2xl shadow-xl">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h3 className="text-base font-semibold text-white">Tracer soi-même — {floorPlanTargetAsset.floorLabel}</h3>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setFloorPlanDrawModalOpen(false)}>
                Fermer
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mb-3">
              Le plan original reste visible en fond semi-transparent. Tracez par-dessus puis validez.
            </p>
            <style>{`
              #plan-draw-container {
                background: transparent !important;
                background-color: transparent !important;
              }
              #plan-draw-container .canvas-container {
                background: transparent !important;
                background-color: transparent !important;
              }
              #plan-draw-container [data-fabric="wrapper"],
              #plan-draw-container .lower-canvas,
              #plan-draw-container .upper-canvas {
                background: transparent !important;
                background-color: transparent !important;
              }
              #plan-draw-toolbar button.active {
                outline: 2px solid rgba(34, 211, 238, 0.9);
                outline-offset: 1px;
                background: rgba(8, 145, 178, 0.35);
                border-color: rgba(34, 211, 238, 0.6);
                color: #ecfeff;
              }
            `}</style>
            <div
              id="plan-draw-toolbar"
              className="sticky top-0 z-30 flex flex-wrap gap-1.5 p-2 rounded-xl border border-white/10 bg-black/80 backdrop-blur-sm mb-3 text-[11px]"
            >
              <button type="button" id="btnDraw" className="btn-secondary btn-xs">Dessin</button>
              <button type="button" id="btnDrawByPoints" className="btn-secondary btn-xs">Dessin pts</button>
              <button type="button" id="btnSelect" className="btn-secondary btn-xs">Sélection</button>
              <button type="button" id="btnLineByPoints" className="btn-secondary btn-xs">Ligne pts</button>
              <button type="button" id="btnShapes" className="btn-secondary btn-xs">Formes</button>
              <select id="shapeType" className={`${ETL360_SELECT_BASE} px-2 py-1 text-[11px]`}>
                <option value="square">Carré</option>
                <option value="circle">Cercle</option>
                <option value="semicircle">Demi-cercle</option>
                <option value="porte">Porte</option>
              </select>
              <button type="button" id="btnText" className="btn-secondary btn-xs">Texte</button>
              <button
                type="button"
                id="btnBackwards"
                className="btn-secondary btn-xs"
                onClick={() => {
                  window.setTimeout(() => setFloorPlanDrawCanvasReadyTick(v => v + 1), 0)
                }}
              >
                Annuler
              </button>
              <button type="button" id="btnDelete" className="btn-secondary btn-xs">Suppr.</button>
              <button type="button" id="btnMergePoints" className="btn-secondary btn-xs">Fusion pts</button>
              <button type="button" id="btnExportPdf" className="btn-secondary btn-xs">PDF</button>
              <label className="inline-flex items-center gap-1 text-[10px] text-gray-400">
                Snap D <input type="number" id="freehandSnap" defaultValue={25} className="w-10 px-1 py-0.5 rounded bg-black/20 border border-white/15" />
              </label>
              <label className="inline-flex items-center gap-1 text-[10px] text-gray-400">
                Snap T <input type="number" id="traceSnap" defaultValue={10} className="w-10 px-1 py-0.5 rounded bg-black/20 border border-white/15" />
              </label>
              <label className="inline-flex items-center gap-1 text-[10px] text-gray-400">
                Ligne{' '}
                <input
                  type="color"
                  id="lineStrokeColor"
                  value={floorPlanDrawStrokeColor}
                  onChange={e => setFloorPlanDrawStrokeColor(e.target.value)}
                  className="h-7 w-8 p-0 border border-white/15 rounded"
                />
              </label>
              <label className="inline-flex items-center gap-1 text-[10px] text-gray-400">
                Trait{' '}
                <input
                  type="number"
                  id="strokeWidth"
                  min={1}
                  max={20}
                  value={floorPlanDrawStrokeWidth}
                  onChange={e => {
                    const n = Number(e.target.value)
                    setFloorPlanDrawStrokeWidth(Number.isFinite(n) ? Math.max(1, Math.min(20, n)) : 2)
                  }}
                  className="w-10 px-1 py-0.5 rounded bg-black/20 border border-white/15"
                />
              </label>
              <label className="inline-flex items-center gap-1 text-[10px] text-gray-400">
                Grille <input type="number" id="gridIntensity" min={0} max={100} defaultValue={50} className="w-10 px-1 py-0.5 rounded bg-black/20 border border-white/15" />
              </label>
              <label className="inline-flex items-center gap-1 text-[10px] text-gray-400 ml-auto">
                <input
                  type="checkbox"
                  checked={floorPlanDrawFinalPreview}
                  onChange={e => setFloorPlanDrawFinalPreview(e.target.checked)}
                  className="h-3 w-3 rounded border border-white/25 bg-white/5 accent-cyan-400"
                />
                Rendu final
              </label>
              <label className="inline-flex items-center gap-1 text-[10px] text-gray-400">
                Fond {floorPlanDrawBaseOpacity}%{" "}
                <input
                  type="range"
                  min={15}
                  max={85}
                  step={1}
                  value={floorPlanDrawBaseOpacity}
                  onChange={e => setFloorPlanDrawBaseOpacity(Number(e.target.value))}
                  className="w-24 accent-cyan-400"
                  disabled={floorPlanDrawFinalPreview}
                />
              </label>
            </div>
            <div className="relative rounded-xl border border-white/10 bg-transparent overflow-auto min-h-[420px]">
              <div id="plan-draw-container" ref={floorPlanDrawContainerRef} className="relative z-10 min-h-[420px]" />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary btn-sm" onClick={() => setFloorPlanDrawModalOpen(false)}>
                Annuler
              </button>
              <button type="button" className="btn-primary btn-sm" onClick={() => void applyDrawnFloorPlanReplacement()}>
                Appliquer ce tracé
              </button>
            </div>
          </div>
        </div>
      )}

      {!lowCostHidesViewer && editAnnotationOpen &&
        createPortal(
          <div
            className={`${panoModalOverlayClass} z-[100] flex items-center justify-center bg-black/70 p-4`}
            role="presentation"
            onClick={() => {
              setEditSpecPickerOpen(false)
              setEditAnnotationOpen(false)
              setEditingAnnotationId(null)
            }}
          >
            <div
              className="glass-panel max-w-2xl w-full max-h-[min(90vh,720px)] overflow-y-auto p-6 border border-white/20 rounded-2xl shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="etl-edit-ann-title"
              onClick={e => e.stopPropagation()}
            >
              <h2 id="etl-edit-ann-title" className="text-lg font-bold text-white mb-3">
                Modifier l annotation
              </h2>
              <p className="text-xs text-gray-400 mb-3">
                {isEditingTextAnnotation
                  ? 'Annotation textuelle : texte, taille et couleur du texte (la zone reste plate, sans deformation perspective).'
                  : 'Identifiant, description et couleur (la direction sur le panorama ne change pas). Ajoutez les caractéristiques utiles via le bouton ci-dessous (rapport HTML de synthèse).'}
              </p>
              <div className="space-y-3 text-sm">
                <label className="block text-gray-300">
                Identifiant
                <input
                  autoFocus
                  value={editIdentifier}
                  onChange={e => setEditIdentifier(e.target.value)}
                  className="mt-1 w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white"
                />
              </label>
              <label className="block text-gray-300">
                Description
                <textarea
                  rows={3}
                  value={editDescription}
                  onChange={e => setEditDescription(e.target.value)}
                  className="mt-1 w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white"
                />
              </label>
              {(editKind === 'zone' || editKind === 'text') && (
                <label className="block text-gray-300">
                  Opacité du remplissage de la zone
                  <input
                    type="range"
                    min={5}
                    max={45}
                    step={1}
                    value={Math.round(editZoneFillOpacity * 100)}
                    onChange={e => setEditZoneFillOpacity(Number(e.target.value) / 100)}
                    className="mt-1 w-full h-2 accent-slate-500"
                    title="Transparence du rectangle coloré sur le panorama (cette annotation uniquement)"
                  />
                  <span className="mt-0.5 block text-[11px] text-gray-500 tabular-nums">
                    {Math.round(editZoneFillOpacity * 100)} %
                  </span>
                </label>
              )}
              {isEditingTextAnnotation ? (
                <>
                  <label className="block text-gray-300">
                    Texte affiche
                    <textarea
                      rows={2}
                      value={editTextContent}
                      onChange={e => setEditTextContent(e.target.value)}
                      className="mt-1 w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white"
                      placeholder="Ex: SORTIE DE SECOURS"
                    />
                  </label>
                  <label className="block text-gray-300">
                    Taille du texte ({editTextSizePx}px)
                    <input
                      type="range"
                      min={10}
                      max={56}
                      step={1}
                      value={editTextSizePx}
                      onChange={e => setEditTextSizePx(Number(e.target.value))}
                      className="mt-1 w-full accent-violet-400"
                    />
                  </label>
                  <label className="block text-gray-300">
                    Couleur du texte
                    <select
                      value={editTextTone}
                      onChange={e => setEditTextTone(e.target.value === 'lightGray' ? 'lightGray' : 'black')}
                      className={`mt-1 w-full px-3 py-2 ${ETL360_SELECT_BASE}`}
                    >
                      <option value="black">Noir</option>
                      <option value="lightGray">Gris clair</option>
                    </select>
                  </label>
                </>
              ) : null}
              {!isEditingTextAnnotation ? (
              <label className="block text-gray-300">
                Gabarit
                <Etl360TemplateChoice
                  className="mt-1"
                  valueKey={
                    editUserTemplateId ? `u:${editUserTemplateId}` : editTemplateId ? `t:${editTemplateId}` : ''
                  }
                  onChangeKey={v => {
                    if (!v) {
                      setEditUserTemplateId('')
                      setEditTemplateId('')
                      setEditCustomTemplateValues({})
                      const cleared = emptyAnnCreationSpecForm()
                      setEditSpecForm(cleared)
                      setEditSpecSlots(mergeSpecSlotsForEditor('', cleared, [], userTemplates))
                      return
                    }
                    if (v.startsWith('u:')) {
                      const id = v.slice(2)
                      setEditUserTemplateId(id)
                      setEditTemplateId('')
                      const ut = userTemplates.find(t => t.id === id)
                      const vals: Record<string, string> = {}
                      if (ut) {
                        for (const c of ut.characteristics) vals[c.key] = c.defaultValue
                        setEditColor(ut.color)
                      }
                      setEditCustomTemplateValues(vals)
                      const nextForm = creationSpecFormFromPartialDefaults(ut?.builtinSpecDefaults)
                      setEditSpecForm(nextForm)
                      setEditSpecSlots(mergeSpecSlotsForEditor('', nextForm, ut?.builtinSpecKeys ?? [], userTemplates))
                      return
                    }
                    if (v.startsWith('t:')) {
                      const tid = v.slice(2) as AnnotationTemplateId
                      setEditTemplateId(tid)
                      setEditUserTemplateId('')
                      const eff = effectiveIntegratedTemplateDef(tid, userTemplates)
                      const iov = integratedTemplateOverride(tid, userTemplates)
                      setEditColor(eff.color)
                      const vals: Record<string, string> = {}
                      if (iov?.characteristics?.length) {
                        for (const c of iov.characteristics) vals[c.key] = c.defaultValue
                      }
                      const smEd = integratedSurfaceMatiereTemplateId(tid)
                      if (smEd) Object.assign(vals, defaultIntegratedSurfaceMatiereCustom(smEd))
                      setEditCustomTemplateValues(vals)
                      const nextForm = creationSpecFormFromPartialDefaults(eff.builtinSpecDefaults)
                      setEditSpecForm(nextForm)
                      setEditSpecSlots(mergeSpecSlotsForEditor(tid, nextForm, [], userTemplates))
                    }
                  }}
                  userTemplates={userTemplates}
                  recentKeys={recentTemplateChoiceKeys}
                  onAfterPick={bumpRecentTemplateChoice}
                  includeEmpty
                  emptyLabel="Aucun (personnalisé)"
                  userSuffix="(gabarit perso)"
                />
              </label>
              ) : null}
              {!isEditingTextAnnotation ? (
                <p className="text-[11px] text-gray-500 -mt-1">
                  Gabarits intégrés et perso : champs standard et champs libres selon la configuration du gabarit (y compris
                  les surcharges locales des gabarits intégrés).
                </p>
              ) : null}
              {!isEditingTextAnnotation && editUserTemplateId ? (
                (() => {
                  const ut = userTemplates.find(t => t.id === editUserTemplateId)
                  if (!ut) {
                    return (
                      <p className="text-xs text-amber-200/90 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2">
                        Ce gabarit personnalisé n&apos;existe plus. Choisissez un autre gabarit ou enregistrez pour le
                        retirer.
                      </p>
                    )
                  }
                  return (
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
                      <p className="text-xs font-semibold text-gray-400">Champs du gabarit « {ut.name} »</p>
                      {ut.characteristics.length > 0 ? (
                        ut.characteristics.map(c => (
                          <label key={c.key} className="block text-gray-300 text-sm">
                            {c.label}
                            <input
                              value={editCustomTemplateValues[c.key] ?? ''}
                              onChange={e =>
                                setEditCustomTemplateValues(prev => ({ ...prev, [c.key]: e.target.value }))
                              }
                              className="mt-1 w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500"
                              placeholder={c.defaultValue ? `défaut : ${c.defaultValue}` : undefined}
                            />
                          </label>
                        ))
                      ) : (
                        <p className="text-xs text-gray-500">
                          Aucun champ libre sur ce gabarit (uniquement des caractéristiques standard dans la section
                          ci-dessous).
                        </p>
                      )}
                    </div>
                  )
                })()
              ) : !isEditingTextAnnotation &&
                editTemplateId &&
                integratedTemplateOverride(editTemplateId, userTemplates)?.characteristics?.length ? (
                (() => {
                  const iov = integratedTemplateOverride(editTemplateId, userTemplates)!
                  return (
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
                      <p className="text-xs font-semibold text-gray-400">
                        Champs du gabarit « {effectiveIntegratedTemplateDef(editTemplateId, userTemplates).label} »
                      </p>
                      {iov.characteristics.map(c => (
                        <label key={c.key} className="block text-gray-300 text-sm">
                          {c.label}
                          <input
                            value={editCustomTemplateValues[c.key] ?? ''}
                            onChange={e =>
                              setEditCustomTemplateValues(prev => ({ ...prev, [c.key]: e.target.value }))
                            }
                            className="mt-1 w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500"
                            placeholder={c.defaultValue ? `défaut : ${c.defaultValue}` : undefined}
                          />
                        </label>
                      ))}
                    </div>
                  )
                })()
              ) : null}
              {!isEditingTextAnnotation && integratedSurfaceMatiereTemplateId(editTemplateId) ? (
                <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-400">
                    Gabarit «
                    {effectiveIntegratedTemplateDef(
                      editTemplateId as AnnotationTemplateId,
                      userTemplates
                    ).label}
                    »
                  </p>
                  {renderAnnCreationSurfaceMatiereBlock(
                    editTemplateId as AnnotationTemplateId,
                    editCustomTemplateValues,
                    setEditCustomTemplateValues
                  )}
                </div>
              ) : null}
              {!isEditingTextAnnotation ? (
                <label className="block text-gray-300">
                  Couleur du marqueur
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    <input
                      type="color"
                      value={editColor}
                      onChange={e => setEditColor(e.target.value)}
                      className="h-10 w-16 rounded border border-white/20 bg-transparent cursor-pointer"
                      aria-label="Couleur du marqueur"
                    />
                    <code className="text-xs text-gray-400 font-mono">{editColor}</code>
                  </div>
                </label>
              ) : null}
              <label className="flex items-center gap-3 text-gray-300 select-none">
                <input
                  type="checkbox"
                  checked={editPositionLocked}
                  onChange={e => setEditPositionLocked(e.target.checked)}
                  className="h-4 w-4 rounded border border-white/20 bg-white/5"
                />
                <span>Position verrouillee</span>
              </label>
                {!isEditingTextAnnotation ? (
                <div className="pt-2 border-t border-white/10">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                    Caractéristiques (optionnel)
                  </p>
                  <div ref={editSpecPickerRef} className="relative z-40 mb-3">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={editSpecSlots.length >= ANNOTATION_SPEC_FIELD_ORDER.length}
                      onClick={e => {
                        e.stopPropagation()
                        setEditSpecPickerOpen(o => !o)
                      }}
                    >
                      {editSpecPickerOpen ? 'Fermer la liste' : '+ Ajouter une caractéristique'}
                    </button>
                    {editSpecPickerOpen && (
                      <ul
                        className="absolute left-0 top-full z-[400] mt-1 min-w-[min(100%,280px)] max-h-56 overflow-y-auto rounded-lg border border-slate-600 py-1 text-gray-100 shadow-2xl ring-1 ring-black/50"
                        style={{ backgroundColor: '#0f172a' }}
                        role="listbox"
                        aria-label="Choisir une caractéristique à ajouter"
                      >
                        {ANNOTATION_SPEC_FIELD_ORDER.filter(k => !editSpecSlots.includes(k)).length === 0 ? (
                          <li className="px-3 py-2 text-xs text-gray-500">Toutes les caractéristiques sont déjà ajoutées.</li>
                        ) : (
                          ANNOTATION_SPEC_FIELD_ORDER.filter(k => !editSpecSlots.includes(k)).map(k => (
                            <li key={k}>
                              <button
                                type="button"
                                role="option"
                                className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-white/10"
                                onClick={e => {
                                  e.stopPropagation()
                                  setEditSpecSlots(s => (s.includes(k) ? s : [...s, k]))
                                  setEditSpecPickerOpen(false)
                                }}
                              >
                                {ANNOTATION_SPEC_FIELD_LABELS[k]}
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                  <div className="space-y-3">
                    {ANNOTATION_SPEC_FIELD_ORDER.filter(k => editSpecSlots.includes(k)).map(k => {
                      const meta = ANNOTATION_SPEC_FIELD_BY_KEY[k]
                      return (
                        <div key={k}>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-sm text-gray-300">{meta.label}</span>
                            <button
                              type="button"
                              className="shrink-0 px-2 py-1 text-xs text-red-300 hover:bg-red-500/15 rounded border border-red-500/30"
                              title="Retirer cette caractéristique"
                              onClick={() => {
                                setEditSpecSlots(s => s.filter(x => x !== k))
                                setEditSpecForm(prev => ({ ...prev, [k]: '' }))
                              }}
                            >
                              Retirer
                            </button>
                          </div>
                          <input
                            value={editSpecForm[k]}
                            onChange={e => setEditSpecForm(prev => ({ ...prev, [k]: e.target.value }))}
                            placeholder={meta.placeholder}
                            {...(meta.inputMode ? { inputMode: meta.inputMode as 'decimal' } : {})}
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500"
                          />
                        </div>
                      )
                    })}
                    {editSpecSlots.length === 0 && (
                      <p className="text-xs text-gray-500">Aucune caractéristique ajoutée.</p>
                    )}
                  </div>
                </div>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2 mt-5 justify-end">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => {
                    setEditSpecPickerOpen(false)
                    setEditAnnotationOpen(false)
                    setEditingAnnotationId(null)
                  }}
                >
                  Annuler
                </button>
                <button type="button" className="btn-primary btn-sm" onClick={submitEditAnnotation}>
                  Enregistrer
                </button>
              </div>
            </div>
          </div>,
          panoModalMount
        )}

      {!lowCostHidesViewer && quickOpen &&
        createPortal(
          <div
            className={`${panoModalOverlayClass} z-[100] flex items-center justify-center bg-black/70 p-4`}
            role="presentation"
            onClick={() => {
              setQuickOpen(false)
              setPendingYawPitch(null)
              setQaTemplateId('')
              setQaUserTemplateId('')
              setQaCreationSpec(emptyAnnCreationSpecForm())
              setQaCreationCustom({})
              setQaTextContent('')
              setQaTextSizePx(20)
              setQaTextTone('black')
              setQaZoneFillOpacity(ETL360_DEFAULT_ZONE_OVERLAY_FILL_OPACITY)
            }}
          >
            <div
              className="glass-panel max-w-lg w-full max-h-[min(90vh,720px)] overflow-y-auto p-6 border border-white/20 rounded-2xl shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="etl-quick-ann-title"
              onClick={e => e.stopPropagation()}
            >
              <h2 id="etl-quick-ann-title" className="text-lg font-bold text-white mb-3">
                Annotation rapide (clic droit)
              </h2>
              <div className="space-y-3 text-sm">
              <label className="block text-gray-300">
                Type d&apos;annotation
                <div className="mt-1 grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setQaKind('point')}
                    className={`px-3 py-2 rounded-lg border text-sm ${
                      qaKind === 'point'
                        ? 'bg-blue-500/20 border-blue-400/60 text-blue-100'
                        : 'bg-white/5 border-white/10 text-gray-300'
                    }`}
                  >
                    Point
                  </button>
                  <button
                    type="button"
                    onClick={() => setQaKind('zone')}
                    className={`px-3 py-2 rounded-lg border text-sm ${
                      qaKind === 'zone'
                        ? 'bg-amber-500/20 border-amber-400/60 text-amber-100'
                        : 'bg-white/5 border-white/10 text-gray-300'
                    }`}
                  >
                    Zone
                  </button>
                  <button
                    type="button"
                    onClick={() => setQaKind('text')}
                    className={`px-3 py-2 rounded-lg border text-sm ${
                      qaKind === 'text'
                        ? 'bg-violet-500/20 border-violet-400/60 text-violet-100'
                        : 'bg-white/5 border-white/10 text-gray-300'
                    }`}
                  >
                    Texte
                  </button>
                </div>
              </label>
              {(qaKind === 'zone' || qaKind === 'text') && (
                <label className="block text-gray-300">
                  Opacité du remplissage de la zone
                  <input
                    type="range"
                    min={5}
                    max={45}
                    step={1}
                    value={Math.round(qaZoneFillOpacity * 100)}
                    onChange={e => setQaZoneFillOpacity(Number(e.target.value) / 100)}
                    className="mt-1 w-full h-2 accent-slate-500"
                    title="Transparence du rectangle coloré (après tracé, modifiable dans l’édition de l’annotation)"
                  />
                  <span className="mt-0.5 block text-[11px] text-gray-500 tabular-nums">
                    {Math.round(qaZoneFillOpacity * 100)} %
                  </span>
                </label>
              )}
                {qaKind !== 'text' ? (
                  <>
                    <label className="block text-gray-300">
                      Gabarit (optionnel)
                      <Etl360TemplateChoice
                        className="mt-1"
                        valueKey={
                          qaUserTemplateId ? `u:${qaUserTemplateId}` : qaTemplateId ? `t:${qaTemplateId}` : ''
                        }
                        onChangeKey={v => {
                          if (!v) {
                            setQaTemplateId('')
                            setQaUserTemplateId('')
                            return
                          }
                          if (v.startsWith('u:')) {
                            const id = v.slice(2)
                            setQaUserTemplateId(id)
                            setQaTemplateId('')
                            const ut = userTemplates.find(u => u.id === id)
                            if (ut) setQaColor(ut.color)
                            return
                          }
                          if (v.startsWith('t:')) {
                            const tid = v.slice(2) as AnnotationTemplateId
                            setQaTemplateId(tid)
                            setQaUserTemplateId('')
                            setQaColor(effectiveIntegratedTemplateDef(tid, userTemplates).color)
                          }
                        }}
                        userTemplates={userTemplates}
                        recentKeys={recentTemplateChoiceKeys}
                        onAfterPick={bumpRecentTemplateChoice}
                        includeEmpty
                        emptyLabel="Aucun"
                        userSuffix="(perso)"
                      />
                    </label>
                    {(() => {
                      const qaUt = qaUserTemplateId ? userTemplates.find(u => u.id === qaUserTemplateId) : undefined
                      const qaIntegOv =
                        qaTemplateId && !qaUserTemplateId
                          ? integratedTemplateOverride(qaTemplateId, userTemplates)
                          : undefined
                      const qaCustomTpl =
                        qaUt ?? (qaIntegOv?.characteristics?.length ? qaIntegOv : undefined)
                      const qaBuiltinKeys =
                        qaUserTemplateId && qaUt
                          ? qaUt.builtinSpecKeys ?? []
                          : qaTemplateId
                            ? effectiveIntegratedTemplateDef(qaTemplateId, userTemplates).specKeys
                            : []
                      return (
                        <>
                          {renderAnnCreationBuiltinBlock(qaBuiltinKeys, qaCreationSpec, setQaCreationSpec)}
                          {renderAnnCreationCustomBlock(qaCustomTpl, qaCreationCustom, setQaCreationCustom)}
                          {renderAnnCreationSurfaceMatiereBlock(
                            qaTemplateId,
                            qaCreationCustom,
                            setQaCreationCustom
                          )}
                        </>
                      )
                    })()}
                  </>
                ) : null}
                <label className="block text-gray-300">
                  Identifiant
                  <input
                    autoFocus
                    value={qaIdentifier}
                    onChange={e => setQaIdentifier(e.target.value)}
                    className="mt-1 w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white"
                  />
                </label>
                <label className="block text-gray-300">
                  Description
                  <textarea
                    rows={2}
                    value={qaDescription}
                    onChange={e => setQaDescription(e.target.value)}
                    className="mt-1 w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white"
                  />
                </label>
                {qaKind === 'text' ? (
                  <>
                    <label className="block text-gray-300">
                      Texte affiche
                      <textarea
                        rows={2}
                        value={qaTextContent}
                        onChange={e => setQaTextContent(e.target.value)}
                        className="mt-1 w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white"
                        placeholder="Ex: SORTIE DE SECOURS"
                      />
                    </label>
                    <label className="block text-gray-300">
                      Taille du texte ({qaTextSizePx}px)
                      <input
                        type="range"
                        min={10}
                        max={56}
                        step={1}
                        value={qaTextSizePx}
                        onChange={e => setQaTextSizePx(Number(e.target.value))}
                        className="mt-1 w-full accent-violet-400"
                      />
                    </label>
                    <label className="block text-gray-300">
                      Couleur du texte
                      <select
                        value={qaTextTone}
                        onChange={e => setQaTextTone(e.target.value === 'lightGray' ? 'lightGray' : 'black')}
                        className={`mt-1 w-full px-3 py-2 ${ETL360_SELECT_BASE}`}
                      >
                        <option value="black">Noir</option>
                        <option value="lightGray">Gris clair</option>
                      </select>
                    </label>
                  </>
                ) : (
                  <label className="block text-gray-300">
                    Couleur du marqueur
                    <div className="mt-1 flex flex-wrap items-center gap-3">
                      <input
                        type="color"
                        value={qaColor}
                        onChange={e => setQaColor(e.target.value)}
                        className="h-10 w-16 rounded border border-white/20 bg-transparent cursor-pointer"
                        aria-label="Couleur du marqueur"
                      />
                      <code className="text-xs text-gray-400 font-mono">{qaColor}</code>
                    </div>
                  </label>
                )}
              <p className="text-xs text-gray-400">
                {qaKind === 'point'
                  ? 'Point : comportement actuel, ajoute un repere ponctuel sur la direction visee.'
                  : qaKind === 'zone'
                    ? 'Zone : le clic droit memorise un coin; apres validation, maintenez le clic gauche sur le panorama pour tracer le rectangle.'
                    : 'Texte : tracez un rectangle comme une zone ; le texte reste plat (sans deformation perspective).'}
              </p>
              </div>
              <div className="flex flex-wrap gap-2 mt-5 justify-end">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => {
                    setQuickOpen(false)
                    setPendingYawPitch(null)
                    setQaTemplateId('')
                    setQaUserTemplateId('')
                    setQaCreationSpec(emptyAnnCreationSpecForm())
                    setQaCreationCustom({})
                    setQaTextContent('')
                    setQaTextSizePx(20)
                    setQaTextTone('black')
                  }}
                >
                  Annuler
                </button>
                <button type="button" className="btn-primary btn-sm" onClick={submitQuickAnnotation}>
                  {qaKind === 'point' ? 'Enregistrer' : qaKind === 'zone' ? 'Dessiner la zone' : 'Dessiner la zone texte'}
                </button>
              </div>
            </div>
          </div>,
          panoModalMount
        )}
    </div>
  )
}

