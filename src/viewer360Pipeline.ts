import * as THREE from 'three'
import { buildSpatialDatasetWithManualFloors } from '@shared/core/lib/etlSpatial'
import type { FloorMapAsset } from '@shared/core/types/etlSpatial'
import {
  type AnnotationRecord,
  type AnnotationsDocument,
  type E57ParseResult,
  type ExtractedDataset,
  type PanoRecord,
  type Vec3,
  type YawPitch,
  ETL360_E57_LARGE_FILE_BYTES,
  annotationZoneBounds,
  applyZipImportAutoPanoNames,
  assignPanosToFloorsAutomatically,
  buildFloorMapAssetsFromPointCloudSlices,
  buildFloorOrderByAltitude,
  ensurePanoViewerColors,
  extractDatasetFromZip,
  extractE57PointCloudPackageFromZip,
  filterFloorAssignmentsToKnownPlans,
  localStorageKeyForPano,
  normalizeImportedAnnotation,
  parseAnnotationsDocument,
  readUserFileAsArrayBuffer,
  resolvedPointCloudSpatialReference,
  zoneCornerYawPitch,
  decodeE57ChunkPositionsBuffer,
  parseChunkAxesOrderFromManifest,
  parseChunkTranslationFromManifest,
} from './etlViewer360Core'
import type { EmbeddedE57PointCloudViewer } from './etlViewer360Core'

export type Viewer360PointCloudSource = {
  positions: Float32Array
  colors: Float32Array | null
  bounds: E57ParseResult['bounds']
  meta: {
    fileName: string
    sourcePointCount: number
    spatialReference?: string
  }
  displayVoxelMax: number
}

export type Viewer360ZipPipelineResult = {
  pointCloud: Viewer360PointCloudSource
  objectUrls: string[]
  panos: PanoRecord[]
  annotations: AnnotationRecord[]
  floorMapAssets: FloorMapAsset[]
  panoFloorAssignments: Record<string, string>
  currentPanoId: string | null
  warnings: string[]
  spatialWarnings: string[]
  floorPlansFromE57Slices: boolean
}

export type Viewer360RemapFloorsResult = {
  floorMapAssets: FloorMapAsset[]
  panoFloorAssignments: Record<string, string>
  panos: PanoRecord[]
  warnings: string[]
  spatialWarnings: string[]
  replacedPlanUrls: string[]
  newPlanUrls: string[]
}

export type Viewer360DirectE57WorkerResult = Viewer360PointCloudSource & {
  displayedPointCount: number
}

export function concatFloat32Arrays(arrays: Float32Array[]): Float32Array {
  const totalLength = arrays.reduce((sum, item) => sum + item.length, 0)
  const out = new Float32Array(totalLength)
  let offset = 0
  for (const item of arrays) {
    out.set(item, offset)
    offset += item.length
  }
  return out
}

export function computeE57DisplayVoxelMax(bounds: E57ParseResult['bounds']): number {
  const dx = bounds.maxX - bounds.minX
  const dy = bounds.maxY - bounds.minY
  const dz = bounds.maxZ - bounds.minZ
  const diag = Math.max(Math.hypot(dx, dy, dz), 1e-6)
  return Math.max(diag / 40, 0.05)
}

export function buildAltitudeColors(
  positions: Float32Array,
  bounds: E57ParseResult['bounds']
): Float32Array | null {
  if (positions.length < 3) return null
  const minAlt = Number.isFinite(bounds.minY) ? bounds.minY : 0
  const maxAlt = Number.isFinite(bounds.maxY) ? bounds.maxY : minAlt + 1
  const span = Math.max(maxAlt - minAlt, 1e-6)
  const colors = new Float32Array(positions.length)
  const color = new THREE.Color()
  for (let i = 0; i < positions.length; i += 3) {
    const alt = positions[i + 1]
    const t = THREE.MathUtils.clamp((alt - minAlt) / span, 0, 1)
    color.setHSL(THREE.MathUtils.lerp(2 / 3, 0, t), 0.95, 0.55)
    colors[i] = color.r
    colors[i + 1] = color.g
    colors[i + 2] = color.b
  }
  return colors
}

export function voxelDownsampleWithOptionalColors(
  positions: Float32Array,
  colors: Float32Array | null,
  voxelSize: number
): { positions: Float32Array; colors: Float32Array | null } {
  const colorsOk = colors !== null && colors.length === positions.length
  if (voxelSize <= 0 || positions.length <= 3) {
    return { positions, colors: colorsOk ? colors : null }
  }
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i])
    minY = Math.min(minY, positions[i + 1])
    minZ = Math.min(minZ, positions[i + 2])
  }
  const kept: number[] = []
  const keptRgb: number[] = []
  const seen = new Set<string>()
  for (let i = 0; i < positions.length; i += 3) {
    const ix = Math.floor((positions[i] - minX) / voxelSize)
    const iy = Math.floor((positions[i + 1] - minY) / voxelSize)
    const iz = Math.floor((positions[i + 2] - minZ) / voxelSize)
    const key = `${ix}|${iy}|${iz}`
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(positions[i], positions[i + 1], positions[i + 2])
    if (colorsOk && colors) {
      keptRgb.push(colors[i], colors[i + 1], colors[i + 2])
    }
  }
  return {
    positions: new Float32Array(kept),
    colors: colorsOk ? new Float32Array(keptRgb) : null,
  }
}

export function buildRenderedPointCloudBuffers(
  positions: Float32Array,
  colors: Float32Array | null,
  voxelSize: number
): { positions: Float32Array; colors: Float32Array | null } {
  return voxelDownsampleWithOptionalColors(positions, colors, voxelSize)
}

export function buildPanosWithFloorContext(
  panos: PanoRecord[],
  panoFloorAssignments: Record<string, string>,
  floorMapAssets: FloorMapAsset[]
): PanoRecord[] {
  const colored = ensurePanoViewerColors(panos)
  const floorOrderByLabel = buildFloorOrderByAltitude(floorMapAssets)
  return colored.map(pano => {
    const floorLabel = (panoFloorAssignments[pano.id] || '').trim() || undefined
    const floorOrder =
      floorLabel && Object.prototype.hasOwnProperty.call(floorOrderByLabel, floorLabel)
        ? floorOrderByLabel[floorLabel]
        : undefined
    return {
      ...pano,
      ...(floorLabel ? { floorLabel } : {}),
      ...(floorOrder !== undefined ? { floorOrder } : {}),
    }
  })
}

export function projectAnnotationsToPointCloudViaViewer(params: {
  annotations: AnnotationRecord[]
  panos: PanoRecord[]
  viewer: EmbeddedE57PointCloudViewer | null
  pointCloudBounds: E57ParseResult['bounds'] | null
  hasPointCloud: boolean
}): AnnotationRecord[] {
  const { annotations, panos, viewer, pointCloudBounds, hasPointCloud } = params
  if (!viewer || !hasPointCloud) return annotations
  const diag = pointCloudBounds
    ? Math.max(
        Math.hypot(
          pointCloudBounds.maxX - pointCloudBounds.minX,
          pointCloudBounds.maxY - pointCloudBounds.minY,
          pointCloudBounds.maxZ - pointCloudBounds.minZ
        ),
        1e-6
      )
    : 1
  const sepScale = Math.min(0.15, Math.max(1e-4, diag * 4e-5))
  const panoById = new Map(panos.map(p => [p.id, p] as const))
  let changed = false
  const next = annotations.map(annotation => {
    if (
      annotation.pointCloudTargetLocked &&
      annotation.pointCloudTarget &&
      Number.isFinite(annotation.pointCloudTarget.x) &&
      Number.isFinite(annotation.pointCloudTarget.y) &&
      Number.isFinite(annotation.pointCloudTarget.z)
    ) {
      return annotation
    }
    const pano = panoById.get(annotation.panoId)
    if (!pano) return annotation

    const zb = annotationZoneBounds(annotation)
    const samples: YawPitch[] = zb
      ? [
          zoneCornerYawPitch(zb, 0),
          zoneCornerYawPitch(zb, 1),
          zoneCornerYawPitch(zb, 2),
          zoneCornerYawPitch(zb, 3),
          annotation.yawPitch,
        ]
      : [annotation.yawPitch]

    const raw = viewer.projectPanoramaSamplesToPointCloud(pano, samples)
    if (!raw) return annotation
    const delta = separationDeltaForAnnotationId(annotation.id, sepScale)
    const projected: Vec3 = { x: raw.x + delta.x, y: raw.y + delta.y, z: raw.z + delta.z }
    if (sameVec3(annotation.pointCloudTarget, projected)) return annotation
    changed = true
    return { ...annotation, pointCloudTarget: projected }
  })
  return changed ? next : annotations
}

/**
 * Charge un nuage de points depuis un viewer index blob (manifest + chunks binaires).
 * Télécharge le manifest JSON, puis chaque chunk .bin, décode les positions et construit
 * la source de nuage de points prête à passer à `applyPointCloudSource`.
 *
 * Retourne `null` si le manifest est absent ou les chunks vides.
 */
export async function loadPointCloudFromBlobPaths(
  manifestBlobPath: string | null,
  chunkBlobPaths: string[],
  downloadFn: (blobPath: string) => Promise<Blob>,
): Promise<Viewer360PointCloudSource | null> {
  if (!chunkBlobPaths || chunkBlobPaths.length === 0) return null

  let manifest: import('./etlViewer360Core').E57PointCloudManifest | null = null
  if (manifestBlobPath) {
    try {
      const blob = await downloadFn(manifestBlobPath)
      const text = await blob.text()
      manifest = JSON.parse(text) as import('./etlViewer360Core').E57PointCloudManifest
    } catch {
      /* manifest optionnel, on continue sans remappage d'axes */
    }
  }

  const allPositions: Float32Array[] = []
  for (const chunkPath of chunkBlobPaths) {
    try {
      const blob = await downloadFn(chunkPath)
      const buffer = await blob.arrayBuffer()
      if (buffer.byteLength === 0 || buffer.byteLength % 12 !== 0) continue
      const raw = new Float32Array(buffer)
      allPositions.push(decodeE57ChunkPositionsBuffer(raw, manifest ?? undefined))
    } catch {
      /* chunk optionnel, on continue */
    }
  }

  if (allPositions.length === 0) return null

  const positions = concatFloat32Arrays(allPositions)
  if (positions.length < 3) return null

  const bounds = computeBoundsFromPositions(positions, manifest)
  const colors = buildAltitudeColors(positions, bounds)

  return {
    positions,
    colors,
    bounds,
    meta: {
      fileName: 'viewer-index',
      sourcePointCount: manifest?.sourcePointCount ?? positions.length / 3,
      ...(manifest ? { spatialReference: resolvedPointCloudSpatialReference({ manifest }) } : {}),
    },
    displayVoxelMax: computeE57DisplayVoxelMax(bounds),
  }
}

/** Calcule les bornes XYZ depuis un Float32Array de positions (stride 3). */
function computeBoundsFromPositions(
  positions: Float32Array,
  manifest?: import('./etlViewer360Core').E57PointCloudManifest | null,
): E57ParseResult['bounds'] {
  if (manifest?.bounds) {
    const b = manifest.bounds
    // Si le manifest a les bornes ET que les axes ne sont pas remappés, utiliser les bornes du manifest
    const axesOrder = parseChunkAxesOrderFromManifest(manifest)
    const [tx, ty, tz] = parseChunkTranslationFromManifest(manifest)
    if (axesOrder === 'xyz' && tx === 0 && ty === 0 && tz === 0) {
      return b
    }
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  return {
    minX: Number.isFinite(minX) ? minX : 0, maxX: Number.isFinite(maxX) ? maxX : 0,
    minY: Number.isFinite(minY) ? minY : 0, maxY: Number.isFinite(maxY) ? maxY : 0,
    minZ: Number.isFinite(minZ) ? minZ : 0, maxZ: Number.isFinite(maxZ) ? maxZ : 0,
  }
}

export async function readZipDataset(
  file: File,
  options?: { geotiffFloorSliceHalfMeters?: number }
): Promise<ExtractedDataset> {
  return extractDatasetFromZip(file, options)
}

export function assemblePointCloudFromPackage(params: {
  fileName: string
  packaged: NonNullable<ExtractedDataset['e57Package']>
}): Viewer360PointCloudSource {
  const combinedPositions = concatFloat32Arrays(params.packaged.chunks.map(chunk => chunk.positions))
  return {
    positions: combinedPositions,
    colors: buildAltitudeColors(combinedPositions, params.packaged.manifest.bounds),
    bounds: params.packaged.manifest.bounds,
    meta: {
      fileName: params.fileName,
      sourcePointCount: params.packaged.manifest.sourcePointCount,
      spatialReference: resolvedPointCloudSpatialReference({ manifest: params.packaged.manifest }),
    },
    displayVoxelMax: computeE57DisplayVoxelMax(params.packaged.manifest.bounds),
  }
}

export async function buildUnifiedZipPipelineResult(params: {
  file: File
  projectCode: string
  floorGroupingToleranceM: number
  floorSliceHeightM: number
}): Promise<Viewer360ZipPipelineResult> {
  const dataset = await readZipDataset(params.file, {
    geotiffFloorSliceHalfMeters: params.floorSliceHeightM / 2,
  })
  const packaged = dataset.e57Package ?? (await extractE57PointCloudPackageFromZip(params.file))
  const pointCloud = assemblePointCloudFromPackage({ fileName: params.file.name, packaged })

  const resolvedAnnotations = resolveAnnotationsState({
    loadedPanos: dataset.panos,
    loadedAnnotations: dataset.annotations,
    perPanoAnnotationDocs: dataset.perPanoAnnotationDocs,
    projectCode: params.projectCode,
    controlPointAnnotations: dataset.controlPointAnnotations,
  })

  const resolvedFloors = await resolveFloorGrouping({
    panos: resolvedAnnotations.panos,
    initialFloorAssignments: resolvedAnnotations.floorAssignments,
    floorMapAssets: dataset.floorMapAssets,
    objectUrls: dataset.objectUrls,
    positions: pointCloud.positions,
    floorGroupingToleranceM: params.floorGroupingToleranceM,
    floorSliceHeightM: params.floorSliceHeightM,
  })

  const spatial = buildSpatialDatasetWithManualFloors(
    resolvedFloors.panos.map(pano => ({
      id: pano.id,
      filename: pano.filename,
      displayLabel: pano.displayLabel,
      viewerColor: pano.viewerColor,
      position: pano.position,
    })),
    resolvedFloors.panoFloorAssignments,
    resolvedFloors.floorMapAssets
  )

  return {
    pointCloud,
    objectUrls: resolvedFloors.objectUrls,
    panos: resolvedFloors.panos,
    annotations: resolvedAnnotations.annotations,
    floorMapAssets: resolvedFloors.floorMapAssets,
    panoFloorAssignments: resolvedFloors.panoFloorAssignments,
    currentPanoId: resolvedFloors.panos[0]?.id ?? null,
    warnings: [...dataset.importWarnings.map(w => `${params.file.name}: ${w}`), ...resolvedFloors.warnings],
    spatialWarnings: spatial.warnings,
    floorPlansFromE57Slices: resolvedFloors.floorPlansFromE57Slices,
  }
}

export async function buildE57PackagePipelineResult(file: File): Promise<Viewer360PointCloudSource> {
  const packaged = await extractE57PointCloudPackageFromZip(file)
  return assemblePointCloudFromPackage({ fileName: file.name, packaged })
}

/**
 * Variante de `importDirectE57InWorker` qui prend un `ArrayBuffer` déjà chargé
 * (typiquement issu du proxy de téléchargement Azure) et un nom logique de fichier.
 * Pas de garde de taille ici : l'appelant est responsable d'avertir/limiter en amont.
 */
export async function importE57FromArrayBufferInWorker(
  arrayBuffer: ArrayBuffer,
  fileName: string,
  reservoirCap = 260_000
): Promise<Viewer360DirectE57WorkerResult> {
  const result = await runE57ConversionWorker(arrayBuffer, reservoirCap)
  return {
    positions: result.positions,
    colors: buildAltitudeColors(result.positions, result.bounds),
    bounds: result.bounds,
    meta: {
      fileName,
      sourcePointCount: result.sourcePointCount,
      ...(result.spatialReference ? { spatialReference: result.spatialReference } : {}),
    },
    displayVoxelMax: computeE57DisplayVoxelMax(result.bounds),
    displayedPointCount: result.displayedPointCount,
  }
}

type E57WorkerRawResult = {
  positions: Float32Array
  sourcePointCount: number
  displayedPointCount: number
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
  spatialReference?: string
}

function runE57ConversionWorker(arrayBuffer: ArrayBuffer, reservoirCap: number): Promise<E57WorkerRawResult> {
  return new Promise<E57WorkerRawResult>((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/e57ImportWorker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = e => {
      const msg = e.data as
        | { type: 'progress'; step: string; percent: number }
        | {
            type: 'result'
            positionsBuffer: ArrayBuffer
            sourcePointCount: number
            displayedPointCount: number
            bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
            spatialReference?: string
          }
        | { type: 'error'; message: string }
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'result') {
        worker.terminate()
        resolve({
          positions: new Float32Array(msg.positionsBuffer),
          sourcePointCount: msg.sourcePointCount,
          displayedPointCount: msg.displayedPointCount,
          bounds: msg.bounds,
          ...(msg.spatialReference ? { spatialReference: msg.spatialReference } : {}),
        })
      } else if (msg.type === 'error') {
        worker.terminate()
        reject(new Error(msg.message || 'Conversion E57 worker echouee.'))
      }
    }
    worker.onerror = err => {
      worker.terminate()
      reject(new Error(err.message || 'Erreur interne du worker E57.'))
    }
    worker.postMessage(
      {
        type: 'convert',
        arrayBuffer,
        reservoirCap,
      },
      [arrayBuffer]
    )
  })
}

export async function importDirectE57InWorker(
  file: File,
  reservoirCap = 260_000
): Promise<Viewer360DirectE57WorkerResult> {
  if (file.size > ETL360_E57_LARGE_FILE_BYTES) {
    throw new Error(
      'Fichier E57 trop volumineux pour import direct. Utilisez le script `countries/lu/scripts/e57/split_e57_chunks.py` pour generer un ZIP viewer, puis chargez ce ZIP.'
    )
  }
  const arrayBuffer = await readUserFileAsArrayBuffer(file)
  const result = await new Promise<{
    positions: Float32Array
    sourcePointCount: number
    displayedPointCount: number
    bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
    spatialReference?: string
  }>((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/e57ImportWorker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = e => {
      const msg = e.data as
        | { type: 'progress'; step: string; percent: number }
        | {
            type: 'result'
            positionsBuffer: ArrayBuffer
            sourcePointCount: number
            displayedPointCount: number
            bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
            spatialReference?: string
          }
        | { type: 'error'; message: string }
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'result') {
        worker.terminate()
        resolve({
          positions: new Float32Array(msg.positionsBuffer),
          sourcePointCount: msg.sourcePointCount,
          displayedPointCount: msg.displayedPointCount,
          bounds: msg.bounds,
          ...(msg.spatialReference ? { spatialReference: msg.spatialReference } : {}),
        })
      } else if (msg.type === 'error') {
        worker.terminate()
        reject(new Error(msg.message || 'Conversion E57 worker echouee.'))
      }
    }
    worker.onerror = err => {
      worker.terminate()
      reject(new Error(err.message || 'Erreur interne du worker E57.'))
    }
    worker.postMessage(
      {
        type: 'convert',
        arrayBuffer,
        reservoirCap,
      },
      [arrayBuffer]
    )
  })
  return {
    positions: result.positions,
    colors: buildAltitudeColors(result.positions, result.bounds),
    bounds: result.bounds,
    meta: {
      fileName: file.name,
      sourcePointCount: result.sourcePointCount,
      ...(result.spatialReference ? { spatialReference: result.spatialReference } : {}),
    },
    displayVoxelMax: computeE57DisplayVoxelMax(result.bounds),
    displayedPointCount: result.displayedPointCount,
  }
}

export async function remapViewer360FloorGrouping(params: {
  panos: PanoRecord[]
  sourcePositions: Float32Array
  floorMapAssets: FloorMapAsset[]
  floorPlansFromE57Slices: boolean
  floorGroupingToleranceM: number
  floorSliceHeightM: number
}): Promise<Viewer360RemapFloorsResult> {
  const halfSlice = Math.max(0.025, params.floorSliceHeightM / 2)
  let orderedFloorMapAssets: FloorMapAsset[]
  let newPlanUrls: string[] = []
  let warnings: string[] = []
  if (params.floorPlansFromE57Slices) {
    const generatedPlans = await buildFloorMapAssetsFromPointCloudSlices({
      positions: params.sourcePositions,
      panos: params.panos,
      objectUrlsSink: newPlanUrls,
      mergeToleranceMeters: params.floorGroupingToleranceM,
      sliceHeightMeters: params.floorSliceHeightM,
    })
    if (generatedPlans.floorMapAssets.length === 0) {
      throw new Error('Impossible de regenerer les etages avec ces parametres.')
    }
    warnings = generatedPlans.warnings
    const floorOrder = buildFloorOrderByAltitude(generatedPlans.floorMapAssets)
    orderedFloorMapAssets = generatedPlans.floorMapAssets.map(asset => ({
      ...asset,
      ...(floorOrder[asset.floorLabel] !== undefined ? { floorOrder: floorOrder[asset.floorLabel] } : {}),
    }))
  } else {
    const floorOrder = buildFloorOrderByAltitude(params.floorMapAssets)
    orderedFloorMapAssets = params.floorMapAssets.map(asset => {
      const z = asset.floorAltitude
      const zOk = Number.isFinite(z)
      return {
        ...asset,
        ...(zOk ? { sliceMinZ: z - halfSlice, sliceMaxZ: z + halfSlice } : {}),
        ...(floorOrder[asset.floorLabel] !== undefined ? { floorOrder: floorOrder[asset.floorLabel] } : {}),
      }
    })
  }

  const autoAssignments = assignPanosToFloorsAutomatically(params.panos, orderedFloorMapAssets)
  const remappedPanos = applyZipImportAutoPanoNames(params.panos, autoAssignments, orderedFloorMapAssets)
  const coloredPanos = ensurePanoViewerColors(remappedPanos)
  const spatial = buildSpatialDatasetWithManualFloors(
    coloredPanos.map(p => ({
      id: p.id,
      filename: p.filename,
      displayLabel: p.displayLabel,
      viewerColor: p.viewerColor,
      position: p.position,
    })),
    autoAssignments,
    orderedFloorMapAssets
  )

  return {
    floorMapAssets: orderedFloorMapAssets,
    panoFloorAssignments: autoAssignments,
    panos: coloredPanos,
    warnings,
    spatialWarnings: spatial.warnings,
    replacedPlanUrls: params.floorPlansFromE57Slices ? params.floorMapAssets.map(a => a.imageUrl) : [],
    newPlanUrls,
  }
}

type ResolvedAnnotationsState = {
  panos: PanoRecord[]
  annotations: AnnotationRecord[]
  floorAssignments: Record<string, string>
}

async function resolveFloorGrouping(params: {
  panos: PanoRecord[]
  initialFloorAssignments: Record<string, string>
  floorMapAssets: FloorMapAsset[]
  objectUrls: string[]
  positions: Float32Array
  floorGroupingToleranceM: number
  floorSliceHeightM: number
}): Promise<{
  panos: PanoRecord[]
  floorMapAssets: FloorMapAsset[]
  panoFloorAssignments: Record<string, string>
  objectUrls: string[]
  warnings: string[]
  floorPlansFromE57Slices: boolean
}> {
  const objectUrls = [...params.objectUrls]
  const warnings: string[] = []
  const floorPlansFromE57Slices = params.floorMapAssets.length === 0
  let generatedPlans: { floorMapAssets: FloorMapAsset[]; warnings: string[] }
  if (params.floorMapAssets.length > 0) {
    generatedPlans = { floorMapAssets: params.floorMapAssets, warnings: [] }
    } else {
    generatedPlans = await buildFloorMapAssetsFromPointCloudSlices({
      positions: params.positions,
      panos: params.panos,
      objectUrlsSink: objectUrls,
      mergeToleranceMeters: params.floorGroupingToleranceM,
      sliceHeightMeters: params.floorSliceHeightM,
    })
    warnings.push(...generatedPlans.warnings)
  }
  if (generatedPlans.floorMapAssets.length === 0) {
    throw new Error('Aucun plan d etage genere depuis le nuage E57 (verifiez les altitudes/points).')
  }

  const sanitizedFloorAssignments = filterFloorAssignmentsToKnownPlans(
    params.initialFloorAssignments,
    generatedPlans.floorMapAssets
  )
  if (Object.keys(params.initialFloorAssignments).length > Object.keys(sanitizedFloorAssignments).length) {
    warnings.push(`Des assignations d'étage (navigateur ou ZIP) ne correspondaient à aucun plan du ZIP — ignorées, réaffectation automatique.`)
  }

  const autoFloorAssignments = assignPanosToFloorsAutomatically(params.panos, generatedPlans.floorMapAssets)
  const effectiveFloorAssignments: Record<string, string> = {
    ...autoFloorAssignments,
    ...sanitizedFloorAssignments,
  }
  const floorOrder = buildFloorOrderByAltitude(generatedPlans.floorMapAssets)
  const orderedFloorMapAssets = generatedPlans.floorMapAssets.map(asset => ({
    ...asset,
    ...(floorOrder[asset.floorLabel] !== undefined ? { floorOrder: floorOrder[asset.floorLabel] } : {}),
  }))
  const renamedPanos = applyZipImportAutoPanoNames(params.panos, effectiveFloorAssignments, orderedFloorMapAssets)
  const coloredPanos = ensurePanoViewerColors(renamedPanos)

  return {
    panos: coloredPanos,
    floorMapAssets: orderedFloorMapAssets,
    panoFloorAssignments: effectiveFloorAssignments,
    objectUrls,
    warnings,
    floorPlansFromE57Slices,
  }
}

function resolveAnnotationsState(params: {
  loadedPanos: PanoRecord[]
  loadedAnnotations: AnnotationRecord[]
  perPanoAnnotationDocs: AnnotationsDocument[]
  projectCode: string
  /** CSV *control_points* du ZIP : priorité sur toute autre annotation du même `id`. */
  controlPointAnnotations: AnnotationRecord[]
}): ResolvedAnnotationsState {
  const loadedFloorAssignments: Record<string, string> = {}
  const panosAfterDocs: PanoRecord[] = params.loadedPanos.map(p => ({ ...p }))
  const mergedAnnotations = [...params.loadedAnnotations]

  params.perPanoAnnotationDocs.forEach(doc => {
    const panoExists = panosAfterDocs.some(p => p.id === doc.panoId)
    if (!panoExists) return
    doc.annotations.forEach((ann, annIdx) => {
      const rawId = String(ann?.id ?? `ann-${annIdx + 1}`).trim() || `ann-${annIdx + 1}`
      const normalized = normalizeImportedAnnotation({ ...ann, panoId: doc.panoId }, rawId)
      if (normalized) mergedAnnotations.push(normalized)
    })
    if (doc.panoDisplayName?.trim()) {
      const idx = panosAfterDocs.findIndex(p => p.id === doc.panoId)
      if (idx >= 0) panosAfterDocs[idx] = { ...panosAfterDocs[idx], displayLabel: doc.panoDisplayName.trim() }
    }
    if (doc.assignedFloorLabel?.trim()) loadedFloorAssignments[doc.panoId] = doc.assignedFloorLabel.trim()
  })

  const storageKeyBase = params.projectCode.trim() || 'local'
  const panosAfterLocal: PanoRecord[] = panosAfterDocs.map(p => ({ ...p }))
  const lsByPano = new Map<string, AnnotationRecord[]>()
  for (let i = 0; i < panosAfterLocal.length; i += 1) {
    const pano = panosAfterLocal[i]
    try {
      const raw = localStorage.getItem(localStorageKeyForPano(storageKeyBase, pano.id))
      if (!raw) continue
      const doc = parseAnnotationsDocument(raw)
      if (!doc || doc.panoId !== pano.id) continue
      if (doc.panoDisplayName?.trim()) {
        panosAfterLocal[i] = { ...pano, displayLabel: doc.panoDisplayName.trim() }
      }
      if (doc.assignedFloorLabel?.trim()) {
        loadedFloorAssignments[pano.id] = doc.assignedFloorLabel.trim()
      }
      lsByPano.set(pano.id, doc.annotations)
    } catch {
      /* ignore */
    }
  }

  let annotations = mergedAnnotations.filter(a => !lsByPano.has(a.panoId))
  lsByPano.forEach(list => {
    annotations = annotations.concat(list)
  })

  const cp = params.controlPointAnnotations
  if (cp.length > 0) {
    const cpIds = new Set(cp.map(a => a.id))
    annotations = [...cp, ...annotations.filter(a => !cpIds.has(a.id))]
  }

  return {
    panos: panosAfterLocal,
    annotations,
    floorAssignments: loadedFloorAssignments,
  }
}

function sameVec3(a?: Vec3, b?: Vec3): boolean {
  return !!a && !!b && Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.z - b.z) < 1e-4
}

function separationDeltaForAnnotationId(id: string, scale: number): Vec3 {
  let h = 2166136261 >>> 0
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  const u = (h & 0xfffffff) / 0xfffffff
  const h2 = Math.imul(h ^ 0x9e3779b9, 2246822519) >>> 0
  const v = (h2 & 0xfffffff) / 0xfffffff
  const h3 = Math.imul(h2 ^ 0x85ebca6b, 3266489917) >>> 0
  const w = (h3 & 0xfffffff) / 0xfffffff
  return {
    x: (u * 2 - 1) * scale,
    y: (v * 2 - 1) * scale,
    z: (w * 2 - 1) * scale,
  }
}

// ── Server-side lossless E57 streaming ────────────────────────

import type { ProcessedManifest, ProcessedChunkEntry, ProcessedChunkBounds } from '@shared/core/services/etlPointCloudBlobApi'
import { fetchE57ProcessedChunk } from '@shared/core/services/etlPointCloudBlobApi'

export type StreamProcessedE57Progress = {
  loadedChunks: number
  totalChunks: number
  loadedPoints: number
  totalPoints: number
}

/**
 * Télécharge les chunks binaires un par un depuis le cache serveur et les
 * ajoute incrémentalement au viewer Three.js via `appendPointCloudChunk`.
 *
 * Les couleurs arrivent en Uint8 (0-255) et sont converties en Float32 (0-1)
 * car Three.js attend des composantes normalisées dans les BufferAttributes.
 */
export async function streamProcessedE57IntoViewer({
  blobPath,
  manifest,
  viewer,
  onProgress,
  signal,
}: {
  blobPath: string
  manifest: ProcessedManifest
  viewer: EmbeddedE57PointCloudViewer
  onProgress?: (progress: StreamProcessedE57Progress) => void
  signal?: AbortSignal
}): Promise<void> {
  const { chunks, hasColors, bounds: globalBounds } = manifest
  let loadedChunks = 0
  let loadedPoints = 0
  const totalPoints = manifest.sourcePointCount

  for (const chunk of chunks) {
    signal?.throwIfAborted()

    const posBuf = await fetchE57ProcessedChunk(blobPath, chunk.posFile, signal)
    const positions = new Float32Array(posBuf)

    let colors: Float32Array | null = null
    if (hasColors && chunk.colFile) {
      const colBuf = await fetchE57ProcessedChunk(blobPath, chunk.colFile, signal)
      const rawColors = new Uint8Array(colBuf)
      const floatColors = new Float32Array(rawColors.length)
      for (let i = 0; i < rawColors.length; i++) {
        floatColors[i] = rawColors[i] / 255
      }
      colors = floatColors
    }

    const chunkBounds: E57ParseResult['bounds'] = chunk.bounds

    signal?.throwIfAborted()
    viewer.appendPointCloudChunk(positions, chunkBounds, colors)

    loadedChunks++
    loadedPoints += chunk.pointCount
    onProgress?.({ loadedChunks, totalChunks: chunks.length, loadedPoints, totalPoints })
  }

  viewer.fitCameraToBounds(globalBounds as E57ParseResult['bounds'])
}
