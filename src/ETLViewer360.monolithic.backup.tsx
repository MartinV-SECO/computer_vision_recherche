import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useUser } from '../contexts/UserContext'
import { canAccessETL, isDynamicsEtlProjectCode } from '../lib/etlChantierAccess'
import { isEtlViewer360LocalDevEnabled } from '../lib/etlLocalDev'
import * as THREE from 'three'
import JSZip from 'jszip'
import { useToast } from '../components/Toast'
import * as UTIF from 'utif'
import { jsPDF } from 'jspdf'
import ETLFloorMap from '../components/ETLFloorMap'
import { buildSpatialDatasetWithManualFloors, parseFlexibleCsvRows } from '../lib/etlSpatial'
import type { FloorMapAsset } from '../types/etlSpatial'

/** Schémas et préfixe de nom de fichier pour les annotations par panorama (export / import). */
const ETL360_ANNOTATIONS_SCHEMA_V1 = 'rapportoa-etl-viewer360-annotations/v1' as const
const ETL360_ANNOTATIONS_SCHEMA_V2 = 'rapportoa-etl-viewer360-annotations/v2' as const
const ETL360_ANNOTATIONS_SCHEMA_V3 = 'rapportoa-etl-viewer360-annotations/v3' as const
const ETL360_ANNOTATIONS_SCHEMA_V4 = 'rapportoa-etl-viewer360-annotations/v4' as const
const ETL360_ANNOTATIONS_SCHEMA = ETL360_ANNOTATIONS_SCHEMA_V4
const ETL360_ANNOTATIONS_FILE_PREFIX = 'etl360.annotations' as const
/**
 * Plafond du 1er passage (reservoir sur le texte XYZ) : limite mémoire / temps de parse.
 * Un 2e sous-échantillonnage ramène au nombre cible selon la taille du nuage source.
 */
const ETL360_E57_RESERVOIR_CAP = 400_000

type Vec3 = { x: number; y: number; z: number }
type Quaternion = { x: number; y: number; z: number; w: number }
type YawPitch = { yaw: number; pitch: number }
type AnnotationKind = 'point' | 'zone'
/** Gabarits d’annotation : couleur prédéfinie + champs techniques suggérés. */
type AnnotationTemplateId = 'lampe' | 'prise_courant' | 'alarme_incendie'
type AnnotationZone = { yawSpan: number; pitchSpan: number }
type ZoneHandleMode =
  | 'move'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
type ZoneBounds = { leftYaw: number; rightYaw: number; topPitch: number; bottomPitch: number }

type PanoRecord = {
  id: string
  filename: string
  /** Libellé affiché / renommable par l'utilisateur (sinon `filename`). */
  displayLabel?: string
  imageUrl: string
  imageExists: boolean
  position: Vec3
  orientation: Quaternion
}

type AnnotationRecord = {
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
  positionLocked?: boolean
  /** Gabarit (lampe, prise, alarme…) : couleur du type + caractéristiques proposées. */
  templateId?: AnnotationTemplateId
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
}

/** Caractéristiques techniques optionnelles (ajoutées une à une dans l’éditeur). */
type AnnotationSpecFieldKey =
  | 'lifespan'
  | 'electricConsumption'
  | 'lightOutputLux'
  | 'material'
  | 'weightKg'
  | 'purchasePrice'

const ANNOTATION_SPEC_FIELD_ORDER: AnnotationSpecFieldKey[] = [
  'lifespan',
  'electricConsumption',
  'lightOutputLux',
  'material',
  'weightKg',
  'purchasePrice',
]

const ANNOTATION_SPEC_FIELD_LABELS: Record<AnnotationSpecFieldKey, string> = {
  lifespan: 'Durée de vie',
  electricConsumption: 'Consommation électrique',
  lightOutputLux: 'Éclairement (lux)',
  material: 'Matière',
  weightKg: 'Poids (kg)',
  purchasePrice: "Prix d'achat",
}

/** Listes déroulantes : fond sombre + color-scheme pour éviter texte clair sur fond clair (ex. Windows). */
const ETL360_SELECT_BASE =
  'rounded-lg border border-white/20 bg-slate-950 text-gray-100 shadow-sm [color-scheme:dark] [&>option]:bg-slate-900 [&>option]:text-gray-100'

type AnnotationTemplateDef = {
  id: AnnotationTemplateId
  label: string
  color: string
  specKeys: AnnotationSpecFieldKey[]
}

const ANNOTATION_TEMPLATES: Record<AnnotationTemplateId, AnnotationTemplateDef> = {
  lampe: {
    id: 'lampe',
    label: 'Lampe',
    color: '#d97706',
    specKeys: [
      'lifespan',
      'electricConsumption',
      'lightOutputLux',
      'material',
      'weightKg',
      'purchasePrice',
    ],
  },
  prise_courant: {
    id: 'prise_courant',
    label: 'Prise de courant',
    color: '#7c3aed',
    specKeys: ['electricConsumption', 'material', 'weightKg', 'purchasePrice'],
  },
  alarme_incendie: {
    id: 'alarme_incendie',
    label: 'Alarme incendie',
    color: '#dc2626',
    specKeys: ['lifespan', 'electricConsumption', 'material', 'weightKg', 'purchasePrice'],
  },
}

const ANNOTATION_TEMPLATE_LIST: AnnotationTemplateDef[] = [
  ANNOTATION_TEMPLATES.lampe,
  ANNOTATION_TEMPLATES.prise_courant,
  ANNOTATION_TEMPLATES.alarme_incendie,
]

type UserAnnotationTemplateCharacteristic = {
  key: string
  label: string
  defaultValue: string
}

type UserAnnotationTemplate = {
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

const ETL360_USER_TEMPLATES_SCHEMA = 'etl360.userTemplates.v1' as const

function userTemplatesStorageKey(projectCode: string): string {
  return `etl360.userTemplates.v1:${projectCode.trim() || 'local'}`
}

function parseCustomTemplateValues(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k).trim()
    if (!key) continue
    out[key] = String(v ?? '').trim()
  }
  return Object.keys(out).length ? out : undefined
}

function buildCharacteristicsWithKeys(
  rows: Array<{ label: string; defaultValue: string }>
): UserAnnotationTemplateCharacteristic[] {
  return buildCharacteristicsFromEditorRows(rows.map(r => ({ label: r.label, defaultValue: r.defaultValue })))
}

/** Édition : conserve les clés existantes ; nouvelles lignes sans clé en reçoivent une dérivée du libellé. */
function buildCharacteristicsFromEditorRows(
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

function compactStringRecord(r: Record<string, string>): Record<string, string> | undefined {
  const o: Record<string, string> = {}
  for (const [k, v] of Object.entries(r)) {
    const t = String(v).trim()
    if (t) o[k] = t
  }
  return Object.keys(o).length ? o : undefined
}

function userTemplateDefaultsRecord(t: UserAnnotationTemplate): Record<string, string> {
  const o: Record<string, string> = {}
  for (const c of t.characteristics) o[c.key] = c.defaultValue
  return o
}

function parseBuiltinSpecKeysFromRaw(raw: unknown): AnnotationSpecFieldKey[] {
  if (!Array.isArray(raw)) return []
  const set = new Set<AnnotationSpecFieldKey>()
  for (const x of raw) {
    const k = String(x ?? '').trim() as AnnotationSpecFieldKey
    if (ANNOTATION_SPEC_FIELD_ORDER.includes(k)) set.add(k)
  }
  return ANNOTATION_SPEC_FIELD_ORDER.filter(key => set.has(key))
}

function parseBuiltinSpecDefaultsFromRaw(
  raw: unknown,
  allowedKeys: AnnotationSpecFieldKey[]
): Partial<Record<AnnotationSpecFieldKey, string>> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || allowedKeys.length === 0) return undefined
  const o: Partial<Record<AnnotationSpecFieldKey, string>> = {}
  const rec = raw as Record<string, unknown>
  for (const k of allowedKeys) {
    const v = rec[k]
    if (v === undefined || v === null) continue
    const s = String(v).trim()
    if (s) o[k] = s
  }
  return Object.keys(o).length ? o : undefined
}

function parseUserTemplatesFromStorage(json: string): UserAnnotationTemplate[] {
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

function resolvedTemplateLabel(ann: AnnotationRecord, userTemplates: UserAnnotationTemplate[]): string | null {
  if (ann.templateId) return annotationTemplateLabel(ann.templateId)
  if (ann.userTemplateId) {
    const u = userTemplates.find(t => t.id === ann.userTemplateId)
    return u?.name ?? null
  }
  return null
}

function parseAnnotationTemplateId(raw: unknown): AnnotationTemplateId | undefined {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_')
  if (s === 'lampe' || s === 'lamp' || s === 'light') return 'lampe'
  if (s === 'prise_courant' || s === 'prise' || s === 'outlet' || s === 'socket') return 'prise_courant'
  if (
    s === 'alarme_incendie' ||
    s === 'alarme' ||
    s === 'fire_alarm' ||
    s === 'firealarm' ||
    s === 'detecteur_incendie'
  ) {
    return 'alarme_incendie'
  }
  return undefined
}

function annotationTemplateLabel(id: AnnotationTemplateId | undefined): string | null {
  if (!id || !ANNOTATION_TEMPLATES[id]) return null
  return ANNOTATION_TEMPLATES[id].label
}

function annotationHasSpecValue(ann: AnnotationRecord, k: AnnotationSpecFieldKey): boolean {
  switch (k) {
    case 'lifespan':
      return !!(ann.lifespan && ann.lifespan.trim())
    case 'electricConsumption':
      return !!(ann.electricConsumption && ann.electricConsumption.trim())
    case 'lightOutputLux':
      return ann.lightOutputLux !== undefined && Number.isFinite(ann.lightOutputLux)
    case 'material':
      return !!(ann.material && ann.material.trim())
    case 'weightKg':
      return ann.weightKg !== undefined && Number.isFinite(ann.weightKg)
    case 'purchasePrice':
      return ann.purchasePrice !== undefined && Number.isFinite(ann.purchasePrice)
    default:
      return false
  }
}

/** Champs affichés : union des champs du gabarit et des champs déjà renseignés. */
function annotationSpecSlotsFromRecord(
  ann: AnnotationRecord,
  userTemplates?: UserAnnotationTemplate[]
): AnnotationSpecFieldKey[] {
  const withValues = ANNOTATION_SPEC_FIELD_ORDER.filter(k => annotationHasSpecValue(ann, k))
  const fromIntegratedTemplate =
    ann.templateId && ANNOTATION_TEMPLATES[ann.templateId]
      ? ANNOTATION_TEMPLATES[ann.templateId].specKeys
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

type E57ParseResult = {
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

type E57ViewerStats = {
  fileName: string
  sourcePointCount: number
  displayedPointCount: number
}

/** Couleur par défaut des marqueurs d’annotation sur le panorama (#rrggbb). */
const ETL360_DEFAULT_ANNOTATION_COLOR = '#2563eb'

function tryParseAnnotationColorHex(input: unknown): string | undefined {
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

function annotationRecordColor(ann: AnnotationRecord, userTemplates?: UserAnnotationTemplate[]): string {
  const c = tryParseAnnotationColorHex(ann.color)
  if (c) return c
  if (ann.templateId && ANNOTATION_TEMPLATES[ann.templateId]) {
    return ANNOTATION_TEMPLATES[ann.templateId].color
  }
  if (ann.userTemplateId && userTemplates?.length) {
    const u = userTemplates.find(t => t.id === ann.userTemplateId)
    if (u) return u.color
  }
  return ETL360_DEFAULT_ANNOTATION_COLOR
}

function annotationKind(annotation: AnnotationRecord): AnnotationKind {
  return annotation.kind === 'zone' || annotation.zone ? 'zone' : 'point'
}

function annotationPositionLocked(annotation: AnnotationRecord): boolean {
  return annotation.positionLocked === true
}

function normalizeYawRad(value: number): number {
  const twoPi = Math.PI * 2
  let v = value % twoPi
  if (v <= -Math.PI) v += twoPi
  if (v > Math.PI) v -= twoPi
  return v
}

function shortestYawDelta(from: number, to: number): number {
  return normalizeYawRad(to - from)
}

function buildZoneFromCorners(a: YawPitch, b: YawPitch): { center: YawPitch; zone: AnnotationZone } {
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

function annotationFocusYawPitch(annotation: AnnotationRecord): YawPitch {
  return annotation.yawPitch
}

function annotationZoneBounds(annotation: AnnotationRecord): ZoneBounds | null {
  if (annotationKind(annotation) !== 'zone' || !annotation.zone) return null
  return {
    leftYaw: annotation.yawPitch.yaw - annotation.zone.yawSpan / 2,
    rightYaw: annotation.yawPitch.yaw + annotation.zone.yawSpan / 2,
    topPitch: annotation.yawPitch.pitch + annotation.zone.pitchSpan / 2,
    bottomPitch: annotation.yawPitch.pitch - annotation.zone.pitchSpan / 2,
  }
}

function zoneBoundsToAnnotationPatch(bounds: ZoneBounds): Pick<AnnotationRecord, 'yawPitch' | 'zone' | 'kind'> {
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

function unwrapYawNear(reference: number, yaw: number): number {
  return reference + shortestYawDelta(reference, yaw)
}

/** Coins de la zone en espace (leftYaw/rightYaw × topPitch/bottomPitch), ordre NW, NE, SE, SW. */
type ZoneCornerIndex = 0 | 1 | 2 | 3

function zoneCornerYawPitch(bounds: ZoneBounds, corner: ZoneCornerIndex): YawPitch {
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
function zoneDiagonalCornerIndex(corner: ZoneCornerIndex): ZoneCornerIndex {
  return (corner ^ 2) as ZoneCornerIndex
}

function zoneBoundsFromCenterAndZone(center: YawPitch, zone: AnnotationZone): ZoneBounds {
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

function clampMovedZoneBoundsPitch(bounds: ZoneBounds): ZoneBounds {
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
function annotationHexToRgb255(hex: string): [number, number, number] {
  const c = tryParseAnnotationColorHex(hex) ?? ETL360_DEFAULT_ANNOTATION_COLOR
  const m = /^#([0-9a-f]{6})$/i.exec(c)
  if (!m) return [37, 99, 235]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Niveau de gris du texte (0 ou 255) pour rester lisible sur fond coloré (WCAG luminance). */
function textGrayForAnnotationBackground(hex: string): number {
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
async function renderAnnotationViewThumbnail(
  imageUrl: string,
  annotation: AnnotationRecord,
  userTemplates: UserAnnotationTemplate[] | undefined = undefined,
  sizePx = 160,
  fovDeg = 68
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

        const D = new THREE.Vector3(
          Math.sin(annotation.yawPitch.yaw) * Math.cos(annotation.yawPitch.pitch),
          Math.sin(annotation.yawPitch.pitch),
          Math.cos(annotation.yawPitch.yaw) * Math.cos(annotation.yawPitch.pitch)
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
            const uTex = yawS / (2 * Math.PI) + 0.5
            const vTex = 0.5 - pitchS / Math.PI
            const [rr, gg, bb, aa] = sample(uTex, vTex)
            const o = (j * sizePx + i) * 4
            od[o] = rr
            od[o + 1] = gg
            od[o + 2] = bb
            od[o + 3] = aa > 0 ? aa : 255
          }
        }
        octx.putImageData(outImg, 0, 0)
        const stroke = annotationRecordColor(annotation, userTemplates)
        const projectToView = (yaw: number, pitch: number): { x: number; y: number; visible: boolean } => {
          const ray = new THREE.Vector3(
            Math.sin(yaw) * Math.cos(pitch),
            Math.sin(pitch),
            Math.cos(yaw) * Math.cos(pitch)
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
        octx.strokeStyle = stroke
        octx.fillStyle = `${stroke}33`
        octx.lineWidth = Math.max(2, sizePx * 0.018)
        if (annotationKind(annotation) === 'zone' && annotation.zone) {
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
            octx.fillRect(left, top, Math.max(width, 2), Math.max(height, 2))
            octx.strokeRect(left, top, Math.max(width, 2), Math.max(height, 2))
          }
        } else {
          const pt = projectToView(annotation.yawPitch.yaw, annotation.yawPitch.pitch)
          if (pt.visible) {
            const r = Math.max(4, sizePx * 0.055)
            octx.beginPath()
            octx.arc(pt.x, pt.y, r, 0, Math.PI * 2)
            octx.fill()
            octx.stroke()
          }
        }
        resolve(outCanvas.toDataURL('image/jpeg', 0.88))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = imageUrl
  })
}

/** Stocke une couleur seulement si elle diffère du défaut (JSON plus léger). */
function annotationColorForRecord(hexFromPicker: string): string | undefined {
  const c = tryParseAnnotationColorHex(hexFromPicker)
  if (!c || c === ETL360_DEFAULT_ANNOTATION_COLOR) return undefined
  return c
}

type AnnotationsDocument = {
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

type ExtractedDataset = {
  panos: PanoRecord[]
  annotations: AnnotationRecord[]
  objectUrls: string[]
  floorMapAssets: FloorMapAsset[]
  importWarnings: string[]
  /** Fichiers etl360.annotations.*.json trouvés dans le ZIP. */
  perPanoAnnotationDocs: AnnotationsDocument[]
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase().trim()
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function parseOptionalTrimmedString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const s = String(value).trim()
  return s || undefined
}

/** Nombre ≥ 0 pour lux, poids, prix ; accepte virgule décimale. */
function parseOptionalNonNegativeNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return undefined
  return n
}

/** Fusionne champs du gabarit et champs dont les champs de formulaire ont une valeur (éditeur). */
function mergeSpecSlotsForEditor(
  templateId: AnnotationTemplateId | '',
  values: {
    lifespan: string
    electricConsumption: string
    lightOutputLux: string
    material: string
    weightKg: string
    purchasePrice: string
  },
  userTemplateBuiltinKeys: AnnotationSpecFieldKey[] = []
): AnnotationSpecFieldKey[] {
  const tplKeys =
    templateId && ANNOTATION_TEMPLATES[templateId] ? ANNOTATION_TEMPLATES[templateId].specKeys : []
  const withValue = ANNOTATION_SPEC_FIELD_ORDER.filter(k => {
    switch (k) {
      case 'lifespan':
        return !!values.lifespan.trim()
      case 'electricConsumption':
        return !!values.electricConsumption.trim()
      case 'lightOutputLux':
        return parseOptionalNonNegativeNumber(values.lightOutputLux) !== undefined
      case 'material':
        return !!values.material.trim()
      case 'weightKg':
        return parseOptionalNonNegativeNumber(values.weightKg) !== undefined
      case 'purchasePrice':
        return parseOptionalNonNegativeNumber(values.purchasePrice) !== undefined
      default:
        return false
    }
  })
  const merged = new Set<AnnotationSpecFieldKey>([...tplKeys, ...userTemplateBuiltinKeys, ...withValue])
  return ANNOTATION_SPEC_FIELD_ORDER.filter(k => merged.has(k))
}

/** Formulaire de création d’annotation : champs techniques (même logique que l’éditeur). */
type AnnCreationSpecForm = {
  lifespan: string
  electricConsumption: string
  lightOutputLux: string
  material: string
  weightKg: string
  purchasePrice: string
}

function emptyAnnCreationSpecForm(): AnnCreationSpecForm {
  return {
    lifespan: '',
    electricConsumption: '',
    lightOutputLux: '',
    material: '',
    weightKg: '',
    purchasePrice: '',
  }
}

function annCreationSpecFormFromBuiltinDefaults(
  keys: AnnotationSpecFieldKey[] | undefined,
  defaults: Partial<Record<AnnotationSpecFieldKey, string>> | undefined
): AnnCreationSpecForm {
  const f = emptyAnnCreationSpecForm()
  for (const k of keys ?? []) {
    const v = defaults?.[k]
    if (v === undefined || !String(v).trim()) continue
    const s = String(v).trim()
    switch (k) {
      case 'lifespan':
        f.lifespan = s
        break
      case 'electricConsumption':
        f.electricConsumption = s
        break
      case 'lightOutputLux':
        f.lightOutputLux = s
        break
      case 'material':
        f.material = s
        break
      case 'weightKg':
        f.weightKg = s
        break
      case 'purchasePrice':
        f.purchasePrice = s
        break
      default:
        break
    }
  }
  return f
}

function buildAnnotationSpecPatchFromCreationForm(
  keys: AnnotationSpecFieldKey[],
  form: AnnCreationSpecForm
): Partial<
  Pick<
    AnnotationRecord,
    'lifespan' | 'electricConsumption' | 'lightOutputLux' | 'material' | 'weightKg' | 'purchasePrice'
  >
> {
  if (keys.length === 0) return {}
  const lux = parseOptionalNonNegativeNumber(form.lightOutputLux)
  const kg = parseOptionalNonNegativeNumber(form.weightKg)
  const price = parseOptionalNonNegativeNumber(form.purchasePrice)
  const out: Partial<
    Pick<
      AnnotationRecord,
      'lifespan' | 'electricConsumption' | 'lightOutputLux' | 'material' | 'weightKg' | 'purchasePrice'
    >
  > = {}
  if (keys.includes('lifespan') && form.lifespan.trim()) out.lifespan = form.lifespan.trim()
  if (keys.includes('electricConsumption') && form.electricConsumption.trim())
    out.electricConsumption = form.electricConsumption.trim()
  if (keys.includes('lightOutputLux') && lux !== undefined) out.lightOutputLux = lux
  if (keys.includes('material') && form.material.trim()) out.material = form.material.trim()
  if (keys.includes('weightKg') && kg !== undefined) out.weightKg = kg
  if (keys.includes('purchasePrice') && price !== undefined) out.purchasePrice = price
  return out
}

function parseCsvRows(csvText: string): Array<Record<string, string>> {
  return parseFlexibleCsvRows(csvText)
}

function getRowValue(row: Record<string, string>, keys: string[]): string {
  for (const [rawKey, value] of Object.entries(row)) {
    const normalizedKey = rawKey.trim().toLowerCase()
    if (keys.includes(normalizedKey)) {
      const v = String(value || '').trim()
      if (v) return v
    }
  }
  return ''
}

function basename(path: string): string {
  const p = normalizePath(path)
  const parts = p.split('/')
  return parts[parts.length - 1] || p
}

function findBestImageEntry(
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

async function parsePanosFromJsonFile(
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
      const blob = await imageEntry.async('blob')
      imageUrl = URL.createObjectURL(blob)
      objectUrls.push(imageUrl)
      imageExists = true
    } else {
      warnings.push(`Image introuvable pour pano ${id} (${filename}).`)
    }
    panos.push({
      id,
      filename,
      imageUrl,
      imageExists,
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

async function parsePanosFromCsvFile(
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
      const blob = await imageEntry.async('blob')
      imageUrl = URL.createObjectURL(blob)
      objectUrls.push(imageUrl)
      imageExists = true
    } else {
      warnings.push(`Image introuvable pour pano ${id} (${filename}).`)
    }
    panos.push({
      id,
      filename,
      imageUrl,
      imageExists,
      position: {
        x: toFiniteNumber(
          getRowValue(row, ['x', 'pos_x', 'pano_pos_x', 'position_x', 'easting']),
          Number.NaN
        ),
        y: toFiniteNumber(
          getRowValue(row, ['y', 'pos_y', 'pano_pos_y', 'position_y', 'northing']),
          Number.NaN
        ),
        z: toFiniteNumber(getRowValue(row, ['z', 'pos_z', 'pano_pos_z', 'position_z', 'altitude']), Number.NaN),
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

/** Normalise une annotation importée (v1/v2 avec xyz ignoré, ou v3). */
function normalizeImportedAnnotation(raw: any, fallbackId: string): AnnotationRecord | null {
  const panoId = String(raw?.panoId ?? raw?.pano_id ?? '').trim()
  if (!panoId) return null
  const id = String(raw?.id ?? fallbackId).trim() || fallbackId
  const rawUserTemplateId = parseOptionalTrimmedString(raw?.userTemplateId ?? raw?.user_template_id)
  const templateId = rawUserTemplateId
    ? undefined
    : parseAnnotationTemplateId(raw?.templateId ?? raw?.template ?? raw?.gabarit)
  const parsedColor = tryParseAnnotationColorHex(raw?.color ?? raw?.markerColor)
  const templateFallbackColor =
    templateId && ANNOTATION_TEMPLATES[templateId] ? ANNOTATION_TEMPLATES[templateId].color : undefined
  const effectiveParsed = parsedColor ?? tryParseAnnotationColorHex(templateFallbackColor)
  const color =
    effectiveParsed && effectiveParsed !== ETL360_DEFAULT_ANNOTATION_COLOR ? effectiveParsed : undefined
  const rawKind = String(raw?.kind ?? raw?.type ?? raw?.annotationType ?? '').trim().toLowerCase()
  const zoneYawSpan = toFiniteNumber(raw?.zone?.yawSpan ?? raw?.zoneYawSpan, Number.NaN)
  const zonePitchSpan = toFiniteNumber(raw?.zone?.pitchSpan ?? raw?.zonePitchSpan, Number.NaN)
  const isZone = rawKind === 'zone' && zoneYawSpan > 0 && zonePitchSpan > 0
  return {
    id,
    panoId,
    label: String(raw?.label ?? raw?.identifier ?? id ?? '').trim(),
    identifier: String(raw?.identifier ?? '').trim() || undefined,
    description: String(raw?.description ?? '').trim() || undefined,
    ...(color ? { color } : {}),
    yawPitch: {
      yaw: toFiniteNumber(raw?.yawPitch?.yaw ?? raw?.yaw),
      pitch: toFiniteNumber(raw?.yawPitch?.pitch ?? raw?.pitch),
    },
    ...(isZone
      ? {
          kind: 'zone' as const,
          zone: {
            yawSpan: zoneYawSpan,
            pitchSpan: zonePitchSpan,
          },
        }
      : { kind: 'point' as const }),
    ...(raw?.positionLocked === true || raw?.position_locked === true || raw?.lockedPosition === true
      ? { positionLocked: true }
      : {}),
    ...(templateId ? { templateId } : {}),
    ...(rawUserTemplateId ? { userTemplateId: rawUserTemplateId } : {}),
    ...(() => {
      const cv = parseCustomTemplateValues(raw?.customTemplateValues ?? raw?.custom_template_values)
      return cv ? { customTemplateValues: cv } : {}
    })(),
    ...(() => {
      const lifespan = parseOptionalTrimmedString(
        raw?.lifespan ?? raw?.dureeVie ?? raw?.duree_vie ?? raw?.lifetime
      )
      const electricConsumption = parseOptionalTrimmedString(
        raw?.electricConsumption ??
          raw?.consommationElectrique ??
          raw?.consommation_electrique ??
          raw?.conso_electrique
      )
      const lightOutputLux = parseOptionalNonNegativeNumber(
        raw?.lightOutputLux ?? raw?.lux ?? raw?.productionLumineuseLux ?? raw?.production_lumineuse_lux
      )
      const material = parseOptionalTrimmedString(raw?.material ?? raw?.matiere ?? raw?.['matière'])
      const weightKg = parseOptionalNonNegativeNumber(raw?.weightKg ?? raw?.poidsKg ?? raw?.poids_kg ?? raw?.poids)
      const purchasePrice = parseOptionalNonNegativeNumber(
        raw?.purchasePrice ?? raw?.prixAchete ?? raw?.prix_achete ?? raw?.prix
      )
      return {
        ...(lifespan ? { lifespan } : {}),
        ...(electricConsumption ? { electricConsumption } : {}),
        ...(lightOutputLux !== undefined ? { lightOutputLux } : {}),
        ...(material ? { material } : {}),
        ...(weightKg !== undefined ? { weightKg } : {}),
        ...(purchasePrice !== undefined ? { purchasePrice } : {}),
      }
    })(),
  }
}

function parseAnnotationsFromRows(rows: Array<Record<string, string>>): AnnotationRecord[] {
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
          lifespan: getRowValue(row, ['lifespan', 'dureevie', 'duree_vie', 'lifetime']),
          electricConsumption: getRowValue(row, [
            'electricconsumption',
            'consommation_electrique',
            'conso_electrique',
            'conso',
          ]),
          lightOutputLux: getRowValue(row, ['lightoutputlux', 'lux', 'production_lumineuse']),
          material: getRowValue(row, ['material', 'matiere']),
          weightKg: getRowValue(row, ['weightkg', 'poids_kg', 'poids']),
          purchasePrice: getRowValue(row, ['purchaseprice', 'prix_achete', 'prix']),
          templateId: getRowValue(row, ['templateid', 'template', 'gabarit']),
        },
        id
      )
    })
    .filter(Boolean) as AnnotationRecord[]
}

function parseAnnotationsFromJson(jsonText: string): AnnotationRecord[] {
  const raw = JSON.parse(jsonText)
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.annotations) ? raw.annotations : []
  return list
    .map((item, index) => normalizeImportedAnnotation(item, `ann-${index + 1}`))
    .filter(Boolean) as AnnotationRecord[]
}

function sanitizePanoIdForFilename(panoId: string): string {
  return panoId.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'pano'
}

/** Nomenclature fichier : etl360.annotations.<panoId_sanitized>.json */
function buildAnnotationsFilename(panoId: string): string {
  return `${ETL360_ANNOTATIONS_FILE_PREFIX}.${sanitizePanoIdForFilename(panoId)}.json`
}

function matchesAnnotationsFilename(name: string): boolean {
  const n = normalizePath(name)
  return n.startsWith(`${ETL360_ANNOTATIONS_FILE_PREFIX.toLowerCase()}.`) && n.endsWith('.json')
}

function inferFloorLabelFromPath(name: string): string | null {
  const n = normalizePath(name)
  const match = n.match(
    /(?:^|\/)(n-?\d+|r\+?\d+|floor[_-]?\d+|level[_-]?\d+|floor[_-]?(?:minus[_-]?one|zero|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth))(?:\.[^.]+)?$/i
  )
  if (match?.[1]) return match[1].toUpperCase().replace(/_/g, '')
  const etageMatch = n.match(/(?:^|\/).*?(?:etage|étage)[_-]?(-?\d+)(?:\.[^.]+)?$/i)
  if (etageMatch?.[1]) return `N${Number(etageMatch[1])}`
  const inFloorsFolder = /(^|\/)(floors?|plans?|floor[_-]?plans?(?:[_-][^/]+)?)(\/|$)/i.test(n)
  if (!inFloorsFolder) return null
  const base = basename(n).replace(/\.[^.]+$/, '').trim()
  return base ? base.toUpperCase() : null
}

type GeoTiffSpatialMeta = {
  floorAltitude?: number
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

function parseGeoTiffSpatialMeta(buffer: ArrayBuffer): GeoTiffSpatialMeta {
  try {
    const ifds = UTIF.decode(buffer)
    if (!ifds || ifds.length === 0) return {}
    const ifd: any = ifds[0]
    const t34264: number[] | undefined = Array.isArray(ifd?.t34264) ? ifd.t34264 : undefined
    if (!t34264 || t34264.length < 12) return {}

    const width = Number(ifd?.t256 || ifd?.width || 0)
    const height = Number(ifd?.t257 || ifd?.height || 0)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 1 || height <= 1) {
      return {}
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
      return Number.isFinite(floorAltitude) ? { floorAltitude } : {}
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

function assignPanosToFloorsAutomatically(panos: PanoRecord[], floorMapAssets: FloorMapAsset[]): Record<string, string> {
  const assets = floorMapAssets.filter(a => !!a.floorLabel)
  if (!assets.length) return {}
  const result: Record<string, string> = {}

  for (const pano of panos) {
    const x = pano.position.x
    const y = pano.position.y
    const z = pano.position.z
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue

    const insideCandidates: Array<{ score: number; floorLabel: string }> = []
    const altitudeFallback: Array<{ score: number; floorLabel: string }> = []

    for (const asset of assets) {
      const wp = asset.worldToPixel
      const floorZ = Number.isFinite(asset.floorAltitude) ? Number(asset.floorAltitude) : Number.NaN
      const dz = Number.isFinite(z) && Number.isFinite(floorZ) ? Math.abs(z - floorZ) : 1e9

      if (!wp) {
        altitudeFallback.push({ score: dz, floorLabel: asset.floorLabel })
        continue
      }

      const u = wp.m00 * x + wp.m01 * y + wp.m02
      const v = wp.m10 * x + wp.m11 * y + wp.m12
      const inside = u >= 0 && u < wp.width && v >= 0 && v < wp.height
      if (inside) {
        // Priorité à l'altitude; petite pénalité pour éloignement du centre plan
        const du = u - wp.width / 2
        const dv = v - wp.height / 2
        const centerPenalty = Math.sqrt(du * du + dv * dv) / Math.max(wp.width, wp.height)
        insideCandidates.push({ score: dz + centerPenalty * 0.01, floorLabel: asset.floorLabel })
      } else {
        altitudeFallback.push({ score: dz + 10, floorLabel: asset.floorLabel })
      }
    }

    const list = insideCandidates.length > 0 ? insideCandidates : altitudeFallback
    if (list.length === 0) continue
    list.sort((a, b) => a.score - b.score)
    result[pano.id] = list[0].floorLabel
  }
  return result
}

function buildFloorOrderByAltitude(floorMapAssets: FloorMapAsset[]): Record<string, number> {
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
function extensionFromFilename(filename: string): string {
  const m = /\.[a-zA-Z0-9]{1,8}$/i.exec(filename.trim())
  return m ? m[0].toLowerCase() : '.jpg'
}

/**
 * Numéro d'étage affiché 1..N (bas → haut) par libellé de plan, pour le pattern etage_*_pano_*.
 */
function etageDisplayNumberByFloorLabel(
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
function applyZipImportAutoPanoNames(
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

async function convertTiffBlobToJpegBlob(tiffBlob: Blob, debugLabel: string): Promise<Blob | null> {
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

function buildAnnotationsDocument(
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
    ...(annotationKind(ann) === 'zone' && ann.zone ? { zone: ann.zone } : {}),
    ...(ann.lifespan ? { lifespan: ann.lifespan } : {}),
    ...(ann.electricConsumption ? { electricConsumption: ann.electricConsumption } : {}),
    ...(ann.lightOutputLux !== undefined ? { lightOutputLux: ann.lightOutputLux } : {}),
    ...(ann.material ? { material: ann.material } : {}),
    ...(ann.weightKg !== undefined ? { weightKg: ann.weightKg } : {}),
    ...(ann.purchasePrice !== undefined ? { purchasePrice: ann.purchasePrice } : {}),
    ...(ann.templateId ? { templateId: ann.templateId } : {}),
    ...(ann.userTemplateId ? { userTemplateId: ann.userTemplateId } : {}),
    ...(ann.customTemplateValues && Object.keys(ann.customTemplateValues).length
      ? { customTemplateValues: ann.customTemplateValues }
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

function parseAnnotationsDocument(text: string): AnnotationsDocument | null {
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

function downloadJsonFile(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function newAnnotationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Ligne récapitulative des champs techniques (PDF, infobulle). */
function formatAnnotationSpecsLine(
  ann: AnnotationRecord,
  userTemplates: UserAnnotationTemplate[] = []
): string {
  const parts: string[] = []
  if (ann.lifespan) parts.push(`Durée de vie: ${ann.lifespan}`)
  if (ann.electricConsumption) parts.push(`Conso électrique: ${ann.electricConsumption}`)
  if (ann.lightOutputLux !== undefined) parts.push(`Éclairement: ${ann.lightOutputLux} lx`)
  if (ann.material) parts.push(`Matière: ${ann.material}`)
  if (ann.weightKg !== undefined) parts.push(`Poids: ${ann.weightKg} kg`)
  if (ann.purchasePrice !== undefined) parts.push(`Prix achat: ${ann.purchasePrice}`)
  const ut = ann.userTemplateId ? userTemplates.find(t => t.id === ann.userTemplateId) : undefined
  if (ut && ann.customTemplateValues) {
    for (const c of ut.characteristics) {
      const v = ann.customTemplateValues[c.key]
      if (v !== undefined && String(v).trim()) parts.push(`${c.label}: ${v}`)
    }
  }
  return parts.join(' · ')
}

/** Texte d’infobulle : identifiant — description (ou seulement l’identifiant). */
function annotationHoverTitle(
  annotation: AnnotationRecord,
  userTemplates: UserAnnotationTemplate[] = []
): string {
  const ident = annotation.identifier || annotation.label || annotation.id
  const desc = (annotation.description || '').trim()
  const tpl = resolvedTemplateLabel(annotation, userTemplates)
  const tplPrefix = tpl ? `[${tpl}] ` : ''
  const prefix = annotationKind(annotation) === 'zone' ? '[Zone] ' : '[Point] '
  const lockSuffix = annotationPositionLocked(annotation) ? ' [position verrouillee]' : ''
  const specs = formatAnnotationSpecsLine(annotation, userTemplates)
  const base = desc
    ? `${tplPrefix}${prefix}${ident}${lockSuffix} — ${desc}`
    : `${tplPrefix}${prefix}${ident}${lockSuffix}`
  return specs ? `${base} · ${specs}` : base
}

function localStorageKeyForPano(projectCode: string, panoId: string): string {
  const p = projectCode.trim() || 'local'
  return `etl360.v1.annotations:${p}:${panoId}`
}

async function extractDatasetFromZip(file: File): Promise<ExtractedDataset> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const allEntries = Object.values(zip.files).filter(entry => !entry.dir)
  const importWarnings: string[] = []
  const imageEntries = allEntries.filter(entry => /\.(jpe?g|png|webp)$/i.test(entry.name)).map(entry => ({
    key: entry.name,
    file: entry,
  }))
  const floorMapAssets: FloorMapAsset[] = []

  let panos: PanoRecord[] = []
  const objectUrls: string[] = []

  const panoJsonEntry = allEntries.find(entry => /(pano|pose)/i.test(entry.name) && /\.json$/i.test(entry.name))
  if (panoJsonEntry) {
    try {
      const text = await panoJsonEntry.async('text')
      const parsed = await parsePanosFromJsonFile(text, imageEntries)
      panos = parsed.panos
      objectUrls.push(...parsed.objectUrls)
      importWarnings.push(...parsed.warnings)
    } catch {
      panos = []
    }
  }

  if (panos.length === 0) {
    const panoCsvEntry = allEntries.find(entry => /(pano|pose)/i.test(entry.name) && /\.csv$/i.test(entry.name))
    if (panoCsvEntry) {
      try {
        const text = await panoCsvEntry.async('text')
        const parsed = await parsePanosFromCsvFile(text, imageEntries)
        panos = parsed.panos
        objectUrls.push(...parsed.objectUrls)
        importWarnings.push(...parsed.warnings)
      } catch {
        panos = []
      }
    }
  }

  if (panos.length === 0) {
    for (const [index, imageEntry] of imageEntries.entries()) {
      const blob = await imageEntry.file.async('blob')
      const imageUrl = URL.createObjectURL(blob)
      objectUrls.push(imageUrl)
      const name = basename(imageEntry.key)
      panos.push({
        id: `${index + 1}`,
        filename: name,
        imageUrl,
        imageExists: true,
        position: { x: 0, y: 0, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      })
    }
  }

  let annotations: AnnotationRecord[] = []
  const annJsonEntry = allEntries.find(
    entry =>
      /annot/i.test(entry.name) && /\.json$/i.test(entry.name) && !matchesAnnotationsFilename(entry.name)
  )
  if (annJsonEntry) {
    try {
      annotations = parseAnnotationsFromJson(await annJsonEntry.async('text'))
    } catch {
      annotations = []
    }
  }
  if (annotations.length === 0) {
    const annCsvEntry = allEntries.find(
      entry => /annot/i.test(entry.name) && /\.csv$/i.test(entry.name)
    )
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
    if (!matchesAnnotationsFilename(entry.name)) continue
    try {
      const text = await entry.async('text')
      const doc = parseAnnotationsDocument(text)
      if (doc) perPanoAnnotationDocs.push(doc)
    } catch {
      /* ignore fichier JSON invalide */
    }
  }

  for (const entry of allEntries) {
    if (!/\.(png|jpe?g|webp|tiff?)$/i.test(entry.name)) continue
    const floorLabel = inferFloorLabelFromPath(entry.name)
    if (!floorLabel) continue
    const blob = await entry.async('blob')
    const isTiff = /\.tiff?$/i.test(entry.name)
    let geoMeta: GeoTiffSpatialMeta = {}
    let displayBlob: Blob = blob
    if (isTiff) {
      console.log('[ETL360][TIFF]', 'ZIP plan entry', entry.name, 'taille blob=', blob.size)
      try {
        const buffer = await blob.arrayBuffer()
        geoMeta = parseGeoTiffSpatialMeta(buffer)
      } catch {
        geoMeta = {}
      }
      const converted = await convertTiffBlobToJpegBlob(blob, entry.name)
      if (converted) {
        displayBlob = converted
      } else {
        console.warn('[ETL360][TIFF]', 'ZIP: conversion echouee, objectURL utilisera le TIFF brut', entry.name)
        importWarnings.push(`Conversion TIFF vers JPG impossible pour ${entry.name}.`)
      }
    }
    const imageUrl = URL.createObjectURL(displayBlob)
    objectUrls.push(imageUrl)
    floorMapAssets.push({
      floorLabel,
      imageUrl,
      sourcePath: entry.name,
      ...(Number.isFinite(geoMeta.floorAltitude) ? { floorAltitude: Number(geoMeta.floorAltitude) } : {}),
      ...(geoMeta.worldToPixel ? { worldToPixel: geoMeta.worldToPixel } : {}),
    })
  }

  return { panos, annotations, objectUrls, floorMapAssets, importWarnings, perPanoAnnotationDocs }
}

function parseXyzWithReservoirDownsample(xyzText: string, maxPoints: number): E57ParseResult {
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
    const x = Number(parts[0])
    const y = Number(parts[1])
    const z = Number(parts[2])
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
function computeTargetDisplayPointCount(sourcePointCount: number): number {
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
function subsamplePositionsUniform(src: Float32Array, pointCount: number, target: number): Float32Array {
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

function parseXyzWithAdaptiveDownsample(xyzText: string): E57ParseResult {
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
const ETL360_E57_LARGE_FILE_BYTES = 120 * 1024 * 1024

/**
 * Lit le contenu d’un fichier choisi par l’utilisateur.
 * `arrayBuffer()` échoue souvent avec NotReadableError sur OneDrive / « en ligne uniquement » ;
 * on retente avec FileReader dans ce cas.
 */
async function readUserFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
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

function formatE57LoadError(error: unknown): string {
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
  if (/memory|out of memory|allocation|wasm/i.test(msg)) {
    return (
      'Memoire ou conversion insuffisante : ce nuage est probablement trop gros pour etre converti en XYZ dans le navigateur. ' +
      'Exportez un echantillon plus petit (outil externe) ou un E57 allege, puis reessayez.'
    )
  }
  return msg || 'Impossible de lire ce fichier E57.'
}

class EmbeddedE57PointCloudViewer {
  private container: HTMLDivElement
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null
  private resizeObserver: ResizeObserver | null = null
  private animationFrame = 0
  private target = new THREE.Vector3()
  private yaw = 0
  private pitch = 0.35
  private distance = 20
  private dragging = false
  private dragStart = { x: 0, y: 0, yaw: 0, pitch: 0 }

  constructor(container: HTMLDivElement) {
    this.container = container
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x020617)
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

  private bindEvents(): void {
    this.container.addEventListener('pointerdown', this.onPointerDown)
    this.container.addEventListener('pointermove', this.onPointerMove)
    this.container.addEventListener('pointerup', this.onPointerUp)
    this.container.addEventListener('pointerleave', this.onPointerUp)
    this.container.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('resize', this.onResize)
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return
    this.dragging = true
    this.dragStart = { x: event.clientX, y: event.clientY, yaw: this.yaw, pitch: this.pitch }
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging || event.buttons !== 1) return
    const dx = event.clientX - this.dragStart.x
    const dy = event.clientY - this.dragStart.y
    this.yaw = this.dragStart.yaw - dx * 0.005
    this.pitch = THREE.MathUtils.clamp(this.dragStart.pitch + dy * 0.005, -1.45, 1.45)
  }

  private onPointerUp = (): void => {
    this.dragging = false
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

  setPointCloud(positions: Float32Array, bounds: E57ParseResult['bounds']): void {
    if (this.points) {
      this.scene.remove(this.points)
      this.points.geometry.dispose()
      this.points.material.dispose()
      this.points = null
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.computeBoundingSphere()

    const dx = bounds.maxX - bounds.minX
    const dy = bounds.maxY - bounds.minY
    const dz = bounds.maxZ - bounds.minZ
    const diag = Math.max(Math.hypot(dx, dy, dz), 1e-6)
    const nPts = positions.length / 3
    const densityBoost = THREE.MathUtils.clamp(120_000 / Math.max(nPts, 1), 1, 10)
    const pointSize = THREE.MathUtils.clamp((diag / 900) * densityBoost, 0.008, 4)
    const material = new THREE.PointsMaterial({ size: pointSize, color: 0x7dd3fc, sizeAttenuation: true })
    this.points = new THREE.Points(geometry, material)
    this.scene.add(this.points)

    this.target.set(
      (bounds.minX + bounds.maxX) * 0.5,
      (bounds.minY + bounds.maxY) * 0.5,
      (bounds.minZ + bounds.maxZ) * 0.5
    )
    this.distance = THREE.MathUtils.clamp(diag * 1.25, 0.2, 5_000_000)
    this.yaw = 0
    this.pitch = 0.35
  }

  clear(): void {
    if (!this.points) return
    this.scene.remove(this.points)
    this.points.geometry.dispose()
    this.points.material.dispose()
    this.points = null
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

  dispose(): void {
    window.cancelAnimationFrame(this.animationFrame)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.container.removeEventListener('pointerdown', this.onPointerDown)
    this.container.removeEventListener('pointermove', this.onPointerMove)
    this.container.removeEventListener('pointerup', this.onPointerUp)
    this.container.removeEventListener('pointerleave', this.onPointerUp)
    this.container.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('resize', this.onResize)
    this.clear()
    this.renderer.dispose()
    this.container.innerHTML = ''
  }
}

type ETL360ViewerCallbacks = {
  onMarkerSelect: (annotation: AnnotationRecord) => void
  onMarkerClick: (annotation: AnnotationRecord) => void
  onMarkerDoubleClick: (annotation: AnnotationRecord) => void
  onPointChange: (annotationId: string, yawPitch: YawPitch) => void
  onZoneChange: (annotationId: string, patch: Pick<AnnotationRecord, 'yawPitch' | 'zone' | 'kind'>) => void
  onRightClick: (yawPitch: YawPitch) => void
  onLeftSphereClick: (yawPitch: YawPitch) => void
  onZoneDrawComplete: (zone: { center: YawPitch; zone: AnnotationZone } | null) => void
}

/** Au-delà de ce déplacement (px), on considère un glissement : sinon on laisse le navigateur émettre click / dblclick. */
const ETL360_MARKER_DRAG_THRESHOLD_PX = 6

class EmbeddedSphereViewer {
  private container: HTMLDivElement
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private sphereMesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  private markerLayer: HTMLDivElement
  private markers: AnnotationRecord[] = []
  private selectedAnnotationId: string | null = null
  private userTemplates: UserAnnotationTemplate[] = []
  private zonePreviewEl: HTMLDivElement
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
  private isPointerDown = false
  private pointerStart = { x: 0, y: 0, lon: 0, lat: 0 }
  private animationFrame = 0
  private callbacksRef: React.MutableRefObject<ETL360ViewerCallbacks>
  private textureLoader = new THREE.TextureLoader()
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private resizeObserver: ResizeObserver | null = null
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

  constructor(container: HTMLDivElement, callbacksRef: React.MutableRefObject<ETL360ViewerCallbacks>) {
    this.container = container
    this.callbacksRef = callbacksRef
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(75, 1, 1, 2000)
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight)
    this.renderer.domElement.style.display = 'block'
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.container.appendChild(this.renderer.domElement)

    this.markerLayer = document.createElement('div')
    this.markerLayer.className = 'absolute inset-0 pointer-events-none'
    this.container.appendChild(this.markerLayer)
    this.zonePreviewEl = document.createElement('div')
    this.zonePreviewEl.className = 'absolute pointer-events-none hidden border-2 border-dashed border-amber-300 bg-amber-300/20'
    this.markerLayer.appendChild(this.zonePreviewEl)

    const geometry = new THREE.SphereGeometry(this.radius, 96, 64)
    geometry.scale(-1, 1, 1)
    const material = new THREE.MeshBasicMaterial({ color: 0x202020, toneMapped: false })
    this.sphereMesh = new THREE.Mesh(geometry, material)
    this.scene.add(this.sphereMesh)

    this.bindEvents()
    this.resizeObserver = new ResizeObserver(() => {
      this.onResize()
    })
    this.resizeObserver.observe(this.container)
    this.animate()
  }

  private bindEvents(): void {
    this.container.addEventListener('pointerdown', this.onPointerDown)
    this.container.addEventListener('pointermove', this.onPointerMove)
    this.container.addEventListener('pointerup', this.onPointerUp)
    this.container.addEventListener('pointerleave', this.onPointerUp)
    this.container.addEventListener('wheel', this.onWheel, { passive: false })
    this.renderer.domElement.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('resize', this.onResize)
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
    const pitch = Math.asin(point.y)
    return { yaw, pitch }
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
  }

  private onResize = (): void => {
    const width = this.container.clientWidth
    const height = this.container.clientHeight
    this.camera.aspect = width / Math.max(height, 1)
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  async loadPanorama(imageUrl: string): Promise<void> {
    const texture = await this.textureLoader.loadAsync(imageUrl)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.generateMipmaps = true
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    const mat = this.sphereMesh.material
    mat.map = texture
    mat.color.setHex(0xffffff)
    mat.toneMapped = false
    mat.needsUpdate = true
    this.lon = 0
    this.lat = 0
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
    userTemplates: UserAnnotationTemplate[] = []
  ): void {
    this.clearAllPendingMarkerGestures()
    this.markers = annotations
    this.selectedAnnotationId = selectedAnnotationId
    this.userTemplates = userTemplates
    this.markerLayer.innerHTML = ''
    this.markerLayer.appendChild(this.zonePreviewEl)
    for (const annotation of annotations) {
      const node = document.createElement(annotationKind(annotation) === 'zone' ? 'div' : 'button')
      if (node instanceof HTMLButtonElement) {
        node.type = 'button'
        node.className =
          'absolute pointer-events-auto select-none text-white text-[10px] w-5 h-5 rounded-full border-2 border-white/75 shadow-md z-[1]'
        node.textContent = '•'
        if (annotationPositionLocked(annotation)) {
          node.style.cursor = 'not-allowed'
          node.style.opacity = '0.88'
        }
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
      } else {
        node.className =
          'absolute pointer-events-auto select-none rounded-sm border-2 border-white/80 bg-white/10 shadow-md z-[1] min-w-[10px] min-h-[10px]'
        if (annotationPositionLocked(annotation)) {
          node.style.cursor = 'not-allowed'
          node.style.opacity = '0.92'
        }
      }
      ;(node as HTMLElement).style.backgroundColor =
        annotationKind(annotation) === 'zone'
          ? `${annotationRecordColor(annotation, this.userTemplates)}33`
          : annotationRecordColor(annotation, this.userTemplates)
      node.title = annotationHoverTitle(annotation, this.userTemplates)
      if (!(node instanceof HTMLButtonElement) && annotation.zone) {
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
          el.title = handle.label
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
      node.addEventListener('dblclick', event => {
        event.stopPropagation()
        event.preventDefault()
        this.callbacksRef.current.onMarkerDoubleClick(annotation)
      })
      this.markerLayer.appendChild(node)
    }
    this.updateMarkerPositions()
  }

  focusYawPitch(yaw: number, pitch: number): void {
    this.lon = THREE.MathUtils.radToDeg(yaw)
    this.lat = THREE.MathUtils.radToDeg(pitch)
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
    const vector = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch)
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
    const nodes = Array.from(this.markerLayer.children).filter(node => node !== this.zonePreviewEl) as HTMLElement[]
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
      if (annotationKind(ann) === 'zone' && ann.zone) {
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
  }

  dispose(): void {
    this.clearAllPendingMarkerGestures()
    window.cancelAnimationFrame(this.animationFrame)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.container.removeEventListener('pointerdown', this.onPointerDown)
    this.container.removeEventListener('pointermove', this.onPointerMove)
    this.container.removeEventListener('pointerup', this.onPointerUp)
    this.container.removeEventListener('pointerleave', this.onPointerUp)
    this.container.removeEventListener('wheel', this.onWheel)
    this.renderer.domElement.removeEventListener('contextmenu', this.onContextMenu)
    window.removeEventListener('resize', this.onResize)
    this.renderer.dispose()
    this.sphereMesh.geometry.dispose()
    this.sphereMesh.material.dispose()
    this.container.innerHTML = ''
  }
}

function isLocalHostHostname(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1'
}

function getDomFullscreenElement(): Element | null {
  const d = document as Document & { webkitFullscreenElement?: Element | null }
  return document.fullscreenElement ?? d.webkitFullscreenElement ?? null
}

async function enterDomFullscreen(el: HTMLElement): Promise<void> {
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

async function exitDomFullscreen(): Promise<void> {
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

export default function ETLViewer360() {
  const navigate = useNavigate()
  const { user } = useUser()
  const { addToast } = useToast()
  const [searchParams] = useSearchParams()
  const projectCode = searchParams.get('code') || ''
  const projectName = searchParams.get('name') || ''
  const projectCodeForStorage = projectCode.trim() || 'local'

  const [loading, setLoading] = useState(false)
  const [panos, setPanos] = useState<PanoRecord[]>([])
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([])
  const [currentPanoId, setCurrentPanoId] = useState<string | null>(null)
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const [objectUrls, setObjectUrls] = useState<string[]>([])
  const [floorMapAssets, setFloorMapAssets] = useState<FloorMapAsset[]>([])
  const [selectedFloor, setSelectedFloor] = useState('ALL')
  /** Libellé d'étage / plan (ex. N3) assigné manuellement par id de panorama. */
  const [panoFloorAssignments, setPanoFloorAssignments] = useState<Record<string, string>>({})

  const [syntheticYawPitch, setSyntheticYawPitch] = useState<YawPitch>({ yaw: 0, pitch: 0 })
  const [manualIdentifier, setManualIdentifier] = useState('')
  const [manualDescription, setManualDescription] = useState('')
  const [manualColor, setManualColor] = useState(ETL360_DEFAULT_ANNOTATION_COLOR)
  const [manualTemplateId, setManualTemplateId] = useState<AnnotationTemplateId | ''>('')
  const [manualUserTemplateId, setManualUserTemplateId] = useState('')
  const [manualCreationSpec, setManualCreationSpec] = useState<AnnCreationSpecForm>(() => emptyAnnCreationSpecForm())
  const [manualCreationCustom, setManualCreationCustom] = useState<Record<string, string>>({})

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

  const [renameDraft, setRenameDraft] = useState('')

  const [editAnnotationOpen, setEditAnnotationOpen] = useState(false)
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null)
  const [editIdentifier, setEditIdentifier] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editColor, setEditColor] = useState(ETL360_DEFAULT_ANNOTATION_COLOR)
  const [editPositionLocked, setEditPositionLocked] = useState(false)
  const [editLifespan, setEditLifespan] = useState('')
  const [editElectricConsumption, setEditElectricConsumption] = useState('')
  const [editLightOutputLux, setEditLightOutputLux] = useState('')
  const [editMaterial, setEditMaterial] = useState('')
  const [editWeightKg, setEditWeightKg] = useState('')
  const [editPurchasePrice, setEditPurchasePrice] = useState('')
  const [editTemplateId, setEditTemplateId] = useState<AnnotationTemplateId | ''>('')
  const [editUserTemplateId, setEditUserTemplateId] = useState('')
  const [editCustomTemplateValues, setEditCustomTemplateValues] = useState<Record<string, string>>({})
  const [editSpecSlots, setEditSpecSlots] = useState<AnnotationSpecFieldKey[]>([])
  const [editSpecPickerOpen, setEditSpecPickerOpen] = useState(false)
  const editSpecPickerRef = useRef<HTMLDivElement | null>(null)
  const [e57Loading, setE57Loading] = useState(false)

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
    const ut = qaUserTemplateId ? userTemplates.find(u => u.id === qaUserTemplateId) : null
    const tpl = !ut && qaTemplateId ? ANNOTATION_TEMPLATES[qaTemplateId] : null
    if (ut) {
      const custom: Record<string, string> = {}
      for (const c of ut.characteristics) custom[c.key] = c.defaultValue
      setQaCreationCustom(custom)
      setQaCreationSpec(annCreationSpecFormFromBuiltinDefaults(ut.builtinSpecKeys, ut.builtinSpecDefaults))
    } else if (tpl) {
      setQaCreationCustom({})
      setQaCreationSpec(emptyAnnCreationSpecForm())
    } else {
      setQaCreationCustom({})
      setQaCreationSpec(emptyAnnCreationSpecForm())
    }
  }, [qaUserTemplateId, qaTemplateId, userTemplates])

  useEffect(() => {
    const ut = manualUserTemplateId ? userTemplates.find(u => u.id === manualUserTemplateId) : null
    const tpl = !ut && manualTemplateId ? ANNOTATION_TEMPLATES[manualTemplateId] : null
    if (ut) {
      const custom: Record<string, string> = {}
      for (const c of ut.characteristics) custom[c.key] = c.defaultValue
      setManualCreationCustom(custom)
      setManualCreationSpec(annCreationSpecFormFromBuiltinDefaults(ut.builtinSpecKeys, ut.builtinSpecDefaults))
    } else if (tpl) {
      setManualCreationCustom({})
      setManualCreationSpec(emptyAnnCreationSpecForm())
    } else {
      setManualCreationCustom({})
      setManualCreationSpec(emptyAnnCreationSpecForm())
    }
  }, [manualUserTemplateId, manualTemplateId, userTemplates])

  const [e57Stats, setE57Stats] = useState<E57ViewerStats | null>(null)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const e57ContainerRef = useRef<HTMLDivElement | null>(null)
  const panoFsRootRef = useRef<HTMLDivElement | null>(null)
  const [panoFsActive, setPanoFsActive] = useState(false)
  const viewerRef = useRef<EmbeddedSphereViewer | null>(null)
  const e57ViewerRef = useRef<EmbeddedE57PointCloudViewer | null>(null)
  const viewerCallbacksRef = useRef<ETL360ViewerCallbacks>({
    onMarkerSelect: () => {},
    onMarkerClick: () => {},
    onMarkerDoubleClick: () => {},
    onPointChange: () => {},
    onZoneChange: () => {},
    onRightClick: () => {},
    onLeftSphereClick: () => {},
    onZoneDrawComplete: () => {},
  })
  const saveLsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingZoneDraftRef = useRef<{
    panoId: string
    identifier: string
    description?: string
    color?: string
    templateId?: AnnotationTemplateId
    userTemplateId?: string
    customTemplateValues?: Record<string, string>
    positionLocked?: boolean
    creationBuiltinKeys?: AnnotationSpecFieldKey[]
    creationSpecForm?: AnnCreationSpecForm
    creationCustomValues?: Record<string, string>
  } | null>(null)

  useEffect(() => {
    const sync = () => setPanoFsActive(getDomFullscreenElement() === panoFsRootRef.current)
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync as EventListener)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync as EventListener)
    }
  }, [])

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

  const panoModalMount = panoFsActive && panoFsRootRef.current ? panoFsRootRef.current : document.body
  const panoModalOverlayClass = panoFsActive && panoFsRootRef.current ? 'absolute inset-0' : 'fixed inset-0'

  const currentPano = useMemo(
    () => panos.find(p => p.id === currentPanoId) ?? null,
    [panos, currentPanoId]
  )

  const currentAnnotations = useMemo(
    () => annotations.filter(ann => ann.panoId === currentPanoId),
    [annotations, currentPanoId]
  )
  const filteredPanos = useMemo(() => {
    if (selectedFloor === 'ALL') return panos
    return panos.filter(pano => (panoFloorAssignments[pano.id] || '').trim() === selectedFloor)
  }, [panos, panoFloorAssignments, selectedFloor])

  const spatialDataset = useMemo(
    () =>
      buildSpatialDatasetWithManualFloors(
        panos.map(pano => ({
          id: pano.id,
          filename: pano.filename,
          displayLabel: pano.displayLabel,
          position: pano.position,
        })),
        panoFloorAssignments,
        floorMapAssets
      ),
    [panos, floorMapAssets, panoFloorAssignments]
  )

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

  useEffect(() => {
    if (selectedFloor === 'ALL') return
    if (!floorLabels.includes(selectedFloor)) {
      setSelectedFloor('ALL')
    }
  }, [floorLabels, selectedFloor])

  // Synchroniser l'étage affiché uniquement quand le panorama actif change (pas quand l'utilisateur change le plan manuellement).
  useEffect(() => {
    if (!currentPanoId) return
    const fl = (panoFloorAssignments[currentPanoId] || '').trim()
    if (!fl) return
    setSelectedFloor(fl)
  }, [currentPanoId, panoFloorAssignments])

  const panoDisplay = (p: PanoRecord) => p.displayLabel?.trim() || p.filename

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
      setUserTemplates(prev =>
        prev.map(x => (x.id === editingUserTemplateId ? { ...common, id: editingUserTemplateId } : x))
      )
      addToast({ type: 'success', title: 'Gabarit mis à jour', duration: 2200 })
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
    addToast({ type: 'info', title: 'Gabarit supprimé', duration: 2000 })
  }

  useEffect(() => {
    if (!editingUserTemplateId) return
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
      setSelectedAnnotationId(annotation.id)
      const focus = annotationFocusYawPitch(annotation)
      viewerRef.current?.focusYawPitch(focus.yaw, focus.pitch)
      setEditingAnnotationId(annotation.id)
      setEditIdentifier(annotation.identifier || annotation.label || '')
      setEditDescription(annotation.description || '')
      setEditColor(annotationRecordColor(annotation, userTemplates))
      setEditPositionLocked(annotationPositionLocked(annotation))
      setEditLifespan(annotation.lifespan ?? '')
      setEditElectricConsumption(annotation.electricConsumption ?? '')
      setEditLightOutputLux(
        annotation.lightOutputLux !== undefined && Number.isFinite(annotation.lightOutputLux)
          ? String(annotation.lightOutputLux)
          : ''
      )
      setEditMaterial(annotation.material ?? '')
      setEditWeightKg(
        annotation.weightKg !== undefined && Number.isFinite(annotation.weightKg) ? String(annotation.weightKg) : ''
      )
      setEditPurchasePrice(
        annotation.purchasePrice !== undefined && Number.isFinite(annotation.purchasePrice)
          ? String(annotation.purchasePrice)
          : ''
      )
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
      } else {
        setEditCustomTemplateValues({})
      }
      setEditSpecSlots(annotationSpecSlotsFromRecord(annotation, userTemplates))
      setEditSpecPickerOpen(false)
      setEditAnnotationOpen(true)
    },
    [userTemplates]
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
      },
      onMarkerDoubleClick: openAnnotationEditor,
      onPointChange: (annotationId, yawPitch) => {
        setAnnotations(prev => prev.map(a => (a.id === annotationId ? { ...a, yawPitch } : a)))
      },
      onZoneChange: (annotationId, patch) => {
        setAnnotations(prev => prev.map(a => (a.id === annotationId ? { ...a, ...patch } : a)))
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
        setQuickOpen(true)
      },
      onLeftSphereClick: yp => {
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
        const customZ =
          draft.userTemplateId && draft.creationCustomValues
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
          kind: 'zone',
          yawPitch: result.center,
          zone: result.zone,
        }
        setAnnotations(prev => [...prev, ann])
        addToast({ type: 'success', title: 'Zone annotee', duration: 2200 })
      },
    }
  }, [currentPanoId, addToast, openAnnotationEditor])

  useEffect(() => {
    if (!containerRef.current) return
    const viewer = new EmbeddedSphereViewer(containerRef.current, viewerCallbacksRef)
    viewerRef.current = viewer
    return () => {
      viewer.dispose()
      viewerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!e57ContainerRef.current) return
    const viewer = new EmbeddedE57PointCloudViewer(e57ContainerRef.current)
    e57ViewerRef.current = viewer
    return () => {
      viewer.dispose()
      e57ViewerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!currentPano) {
      setRenameDraft('')
      return
    }
    pendingZoneDraftRef.current = null
    viewerRef.current?.cancelZonePlacement()
    setRenameDraft(currentPano.displayLabel?.trim() || currentPano.filename)
  }, [currentPano])

  useEffect(() => {
    if (!currentPano || !viewerRef.current) return
    if (!currentPano.imageExists || !currentPano.imageUrl) {
      return
    }
    viewerRef.current.loadPanorama(currentPano.imageUrl).catch(() => {
      addToast({
        type: 'error',
        title: 'Erreur image',
        message: `Impossible de charger le panorama ${currentPano.filename}.`,
        duration: 3500,
      })
    })
  }, [currentPano, addToast])

  useEffect(() => {
    viewerRef.current?.setMarkers(currentAnnotations, selectedAnnotationId, userTemplates)
  }, [currentAnnotations, selectedAnnotationId, userTemplates])

  const persistPanoToLocal = useCallback(
    (panoId: string, list: AnnotationRecord[]) => {
      const pano = panos.find(p => p.id === panoId)
      if (!pano) return
      const assigned = (panoFloorAssignments[panoId] || '').trim()
      const doc = buildAnnotationsDocument(pano, list, projectCode, assigned)
      try {
        localStorage.setItem(localStorageKeyForPano(projectCodeForStorage, panoId), JSON.stringify(doc))
      } catch {
        /* quota */
      }
    },
    [panos, projectCode, projectCodeForStorage, panoFloorAssignments]
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

  const exportCurrentAnnotations = () => {
    if (!currentPano) return
    const assigned = (panoFloorAssignments[currentPano.id] || '').trim()
    const doc = buildAnnotationsDocument(currentPano, currentAnnotations, projectCode, assigned)
    downloadJsonFile(buildAnnotationsFilename(currentPano.id), doc)
    addToast({
      type: 'success',
      title: 'Export JSON',
      message: buildAnnotationsFilename(currentPano.id),
      duration: 2800,
    })
  }

  const exportPdfAnnotationsReport = async () => {
    if (annotations.length === 0) {
      addToast({
        type: 'warning',
        title: 'Rapport PDF',
        message: 'Aucune annotation a exporter.',
        duration: 2600,
      })
      return
    }

    const panoById = new Map(panos.map(p => [p.id, p] as const))
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
        ident: `${tplPdf ? `[${tplPdf}] ` : ''}${annotationKind(ann) === 'zone' ? '[Zone] ' : '[Point] '}${ann.identifier || ann.label || ann.id}`,
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

    addToast({
      type: 'info',
      title: 'Rapport PDF',
      message: 'Generation des vues et du PDF…',
      duration: 4000,
    })

    const thumbs = await Promise.all(
      rows.map(r => {
        const pano = panoById.get(r.ann.panoId)
        if (!pano?.imageUrl || !pano.imageExists) return Promise.resolve<string | null>(null)
        return renderAnnotationViewThumbnail(pano.imageUrl, r.ann, userTemplates)
      })
    )

    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const margin = 12
    let y = 14
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const contentW = pageW - margin * 2
    const thumbMm = 20
    const cols = {
      n: 8,
      floor: 18,
      pano: 28,
      ident: 20,
      vue: 22,
      desc: Math.max(18, contentW - (8 + 18 + 28 + 20 + 22)),
    }

    const addHeader = () => {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(14)
      doc.setTextColor(0)
      doc.text('Rapport annotations ETL 360', margin, y)
      y += 7
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      const project = projectCode
        ? `${projectCode}${projectName ? ` - ${projectName}` : ''}`
        : 'Projet non specifie'
      doc.text(`Projet: ${project}`, margin, y)
      y += 5
      doc.text(`Genere le: ${new Date().toLocaleString()}`, margin, y)
      y += 7
      doc.setLineWidth(0.25)
      doc.setDrawColor(40)
      doc.line(margin, y, margin + contentW, y)
      y += 5
    }

    const addTableHeader = () => {
      doc.setFillColor(245, 245, 245)
      doc.rect(margin, y - 4, contentW, 7, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(0)
      let x = margin
      doc.text('#', x, y)
      x += cols.n
      doc.text('Etage', x, y)
      x += cols.floor
      doc.text('Panorama', x, y)
      x += cols.pano
      doc.text('Identifiant', x, y)
      x += cols.ident
      doc.text('Description', x, y)
      x += cols.desc
      doc.text('Vue', x, y)
      y += 2
      doc.setDrawColor(120)
      doc.line(margin, y, margin + contentW, y)
      y += 5
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
    }

    const ensurePageSpace = (needed: number) => {
      if (y + needed <= pageH - margin) return
      doc.addPage()
      y = margin
      addHeader()
      addTableHeader()
    }

    addHeader()
    addTableHeader()

    rows.forEach((row, ri) => {
      const split = {
        floor: doc.splitTextToSize(row.floor, cols.floor - 1),
        pano: doc.splitTextToSize(row.pano, cols.pano - 1),
        ident: doc.splitTextToSize(row.ident, cols.ident - 1),
        desc: doc.splitTextToSize(row.desc, cols.desc - 1),
      }
      const lineCount = Math.max(split.floor.length, split.pano.length, split.ident.length, split.desc.length, 1)
      const textBlockH = lineCount * 4.1
      const rowH = Math.max(textBlockH + 5, thumbMm + 6)
      ensurePageSpace(rowH + 4)

      const rowTop = y - 3
      const [br, bg, bb] = annotationHexToRgb255(row.colorHex)
      doc.setFillColor(br, bg, bb)
      doc.rect(margin, rowTop, contentW, rowH, 'F')

      const txtGray = textGrayForAnnotationBackground(row.colorHex)
      doc.setTextColor(txtGray, txtGray, txtGray)

      let x = margin + 1
      doc.text(row.n, x, rowTop + 5)
      x += cols.n
      doc.text(split.floor, x, rowTop + 5)
      x += cols.floor
      doc.text(split.pano, x, rowTop + 5)
      x += cols.pano
      doc.text(split.ident, x, rowTop + 5)
      x += cols.ident
      doc.text(split.desc, x, rowTop + 5)

      const vueX = margin + cols.n + cols.floor + cols.pano + cols.ident + cols.desc + 1
      const vueY = rowTop + (rowH - thumbMm) / 2
      const thumb = thumbs[ri]
      if (thumb) {
        try {
          doc.addImage(thumb, 'JPEG', vueX, vueY, thumbMm, thumbMm)
          doc.setDrawColor(txtGray, txtGray, txtGray)
          doc.setLineWidth(0.2)
          doc.rect(vueX, vueY, thumbMm, thumbMm, 'S')
        } catch {
          doc.setFontSize(7)
          doc.text('(vue)', vueX, rowTop + rowH / 2)
        }
      } else {
        doc.setFontSize(7)
        doc.text('—', vueX + 6, rowTop + rowH / 2)
      }

      y = rowTop + rowH + 1
      doc.setDrawColor(Math.min(255, br + 50), Math.min(255, bg + 50), Math.min(255, bb + 50))
      doc.setLineWidth(0.15)
      doc.line(margin, y, margin + contentW, y)
      doc.setDrawColor(0)
      doc.setTextColor(0)
    })

    const filenameBase = (projectCode || 'local').replace(/[^a-zA-Z0-9._-]+/g, '_')
    doc.save(`etl360.annotations.report.${filenameBase}.pdf`)
    addToast({
      type: 'success',
      title: 'Rapport PDF',
      message: `${rows.length} annotation(s) exportee(s).`,
      duration: 2800,
    })
  }

  const importAnnotationsFile = async (file: File | null) => {
    if (!file || !currentPano) return
    const text = await file.text()
    const doc = parseAnnotationsDocument(text)
    if (!doc) {
      addToast({
        type: 'error',
        title: 'JSON invalide',
        message: `Schema attendu: ${ETL360_ANNOTATIONS_SCHEMA_V1} … ${ETL360_ANNOTATIONS_SCHEMA_V4}`,
        duration: 4500,
      })
      return
    }
    if (doc.panoId !== currentPano.id) {
      addToast({
        type: 'error',
        title: 'panoId incompatible',
        message: `Fichier: ${doc.panoId} — panorama actif: ${currentPano.id}`,
        duration: 5000,
      })
      return
    }
    setAnnotations(prev => [...prev.filter(a => a.panoId !== currentPano.id), ...doc.annotations])
    if (doc.panoDisplayName?.trim()) {
      setPanos(prev =>
        prev.map(p => (p.id === currentPano.id ? { ...p, displayLabel: doc.panoDisplayName!.trim() } : p))
      )
    }
    if (doc.assignedFloorLabel?.trim()) {
      setPanoFloorAssignments(prev => ({ ...prev, [currentPano.id]: doc.assignedFloorLabel!.trim() }))
    }
    addToast({ type: 'success', title: 'Annotations importees', duration: 2500 })
  }

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
    const col = annotationColorForRecord(editColor)
    const lux = parseOptionalNonNegativeNumber(editLightOutputLux)
    const kg = parseOptionalNonNegativeNumber(editWeightKg)
    const price = parseOptionalNonNegativeNumber(editPurchasePrice)
    const utEdit = editUserTemplateId ? userTemplates.find(t => t.id === editUserTemplateId) : undefined
    if (editUserTemplateId && !utEdit) {
      addToast({
        type: 'warning',
        title: 'Gabarit introuvable',
        message: 'Ce gabarit personnalisé a été supprimé. Choisissez un autre gabarit ou « Aucun » avant d’enregistrer.',
        duration: 4000,
      })
      return
    }
    const customSave = utEdit ? compactStringRecord(editCustomTemplateValues) : undefined
    setAnnotations(prev =>
      prev.map(a => {
        if (a.id !== editingAnnotationId) return a
        const {
          color: _dropColor,
          positionLocked: _dropLock,
          templateId: _templ,
          userTemplateId: _ut,
          customTemplateValues: _ctv,
          lifespan: _ls,
          electricConsumption: _ec,
          lightOutputLux: _lx,
          material: _mt,
          weightKg: _wk,
          purchasePrice: _pp,
          ...rest
        } = a
        return {
          ...rest,
          identifier,
          label: identifier,
          description: desc || undefined,
          ...(col ? { color: col } : {}),
          ...(editPositionLocked ? { positionLocked: true } : {}),
          ...(editUserTemplateId && utEdit
            ? {
                userTemplateId: editUserTemplateId,
                ...(customSave ? { customTemplateValues: customSave } : {}),
              }
            : {}),
          ...(editTemplateId && !editUserTemplateId ? { templateId: editTemplateId } : {}),
          ...(editSpecSlots.includes('lifespan') && editLifespan.trim() ? { lifespan: editLifespan.trim() } : {}),
          ...(editSpecSlots.includes('electricConsumption') && editElectricConsumption.trim()
            ? { electricConsumption: editElectricConsumption.trim() }
            : {}),
          ...(editSpecSlots.includes('lightOutputLux') && lux !== undefined ? { lightOutputLux: lux } : {}),
          ...(editSpecSlots.includes('material') && editMaterial.trim() ? { material: editMaterial.trim() } : {}),
          ...(editSpecSlots.includes('weightKg') && kg !== undefined ? { weightKg: kg } : {}),
          ...(editSpecSlots.includes('purchasePrice') && price !== undefined ? { purchasePrice: price } : {}),
        }
      })
    )
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
    const utQ = qaUserTemplateId ? userTemplates.find(u => u.id === qaUserTemplateId) : null
    const tpl = !utQ && qaTemplateId ? ANNOTATION_TEMPLATES[qaTemplateId] : null
    const resolvedColor = utQ
      ? utQ.color
      : tpl
        ? tpl.color
        : annotationColorForRecord(qaColor) ?? ETL360_DEFAULT_ANNOTATION_COLOR
    const colorPatch =
      utQ || tpl || resolvedColor !== ETL360_DEFAULT_ANNOTATION_COLOR ? { color: resolvedColor } : {}
    const specKeysQ = utQ ? utQ.builtinSpecKeys ?? [] : tpl ? tpl.specKeys : []
    const specPatchQ = buildAnnotationSpecPatchFromCreationForm(specKeysQ, qaCreationSpec)
    const customFromUtQ = utQ ? compactStringRecord(qaCreationCustom) : undefined
    if (qaKind === 'zone') {
      pendingZoneDraftRef.current = {
        panoId: currentPanoId,
        identifier,
        description: qaDescription.trim() || undefined,
        ...colorPatch,
        ...(tpl ? { templateId: tpl.id } : {}),
        ...(utQ
          ? {
              userTemplateId: utQ.id,
              ...(utQ.positionLockedDefault ? { positionLocked: true } : {}),
              creationCustomValues: { ...qaCreationCustom },
            }
          : {}),
        creationBuiltinKeys: specKeysQ,
        creationSpecForm: { ...qaCreationSpec },
      }
      viewerRef.current?.startZonePlacement(pendingYawPitch)
      setQuickOpen(false)
      setPendingYawPitch(null)
      setQaTemplateId('')
      setQaUserTemplateId('')
      setQaCreationSpec(emptyAnnCreationSpecForm())
      setQaCreationCustom({})
      addToast({
        type: 'info',
        title: 'Dessiner la zone',
        message: 'Maintenez le clic gauche sur le panorama pour tracer le rectangle en surbrillance.',
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
      ...(tpl ? { templateId: tpl.id } : {}),
      ...(utQ
        ? {
            userTemplateId: utQ.id,
            ...(customFromUtQ ? { customTemplateValues: customFromUtQ } : {}),
            ...(utQ.positionLockedDefault ? { positionLocked: true } : {}),
          }
        : {}),
      kind: 'point',
      yawPitch: { yaw: pendingYawPitch.yaw, pitch: pendingYawPitch.pitch },
    }
    setAnnotations(prev => [...prev, ann])
    setQuickOpen(false)
    setPendingYawPitch(null)
    setQaTemplateId('')
    setQaUserTemplateId('')
    setQaCreationSpec(emptyAnnCreationSpecForm())
    setQaCreationCustom({})
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
    const tpl = !utM && manualTemplateId ? ANNOTATION_TEMPLATES[manualTemplateId] : null
    const resolvedColor = utM
      ? utM.color
      : tpl
        ? tpl.color
        : annotationColorForRecord(manualColor) ?? ETL360_DEFAULT_ANNOTATION_COLOR
    const colorPatch =
      utM || tpl || resolvedColor !== ETL360_DEFAULT_ANNOTATION_COLOR ? { color: resolvedColor } : {}
    const specKeysM = utM ? utM.builtinSpecKeys ?? [] : tpl ? tpl.specKeys : []
    const specPatchM = buildAnnotationSpecPatchFromCreationForm(specKeysM, manualCreationSpec)
    const customFromUtM = utM ? compactStringRecord(manualCreationCustom) : undefined
    const ann: AnnotationRecord = {
      id: newAnnotationId(),
      panoId: currentPanoId,
      label: identifier,
      identifier,
      description: manualDescription.trim() || undefined,
      ...colorPatch,
      ...specPatchM,
      ...(tpl ? { templateId: tpl.id } : {}),
      ...(utM
        ? {
            userTemplateId: utM.id,
            ...(customFromUtM ? { customTemplateValues: customFromUtM } : {}),
            ...(utM.positionLockedDefault ? { positionLocked: true } : {}),
          }
        : {}),
      kind: 'point',
      yawPitch: { yaw: syntheticYawPitch.yaw, pitch: syntheticYawPitch.pitch },
    }
    setAnnotations(prev => [...prev, ann])
    setManualIdentifier('')
    setManualDescription('')
    setManualTemplateId('')
    setManualUserTemplateId('')
    setManualCreationSpec(emptyAnnCreationSpecForm())
    setManualCreationCustom({})
    addToast({ type: 'success', title: 'Annotation ajoutee', duration: 2000 })
  }

  useEffect(() => {
    return () => {
      objectUrls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [objectUrls])

  if (!canAccessETL(user)) {
    return <Navigate to="/luxembourg/seco-geolux" replace />
  }
  if (
    !isLocalHostHostname() &&
    !isDynamicsEtlProjectCode(projectCode) &&
    !isEtlViewer360LocalDevEnabled()
  ) {
    return <Navigate to="/luxembourg/seco-geolux/etat-des-lieux/project-info" replace />
  }

  const handleLoadZipFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setLoading(true)
    setSelectedAnnotationId(null)

    const previousUrls = [...objectUrls]
    try {
      const mergedPanos: PanoRecord[] = []
      const mergedAnnotations: AnnotationRecord[] = []
      const mergedObjectUrls: string[] = []
      const mergedFloorMapAssets: FloorMapAsset[] = []
      const mergedWarnings: string[] = []
      const mergedFloorAssignments: Record<string, string> = {}

      for (const file of Array.from(files)) {
        const dataset = await extractDatasetFromZip(file)
        mergedObjectUrls.push(...dataset.objectUrls)
        mergedWarnings.push(...dataset.importWarnings.map(w => `${file.name}: ${w}`))
        const prefix = file.name.replace(/\.zip$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_')
        const idMap = new Map<string, string>()
        dataset.panos.forEach(pano => {
          const newId = `${prefix}:${pano.id}`
          idMap.set(pano.id, newId)
          mergedPanos.push({ ...pano, id: newId })
        })
        dataset.floorMapAssets.forEach(asset => {
          mergedFloorMapAssets.push({
            ...asset,
            floorLabel: asset.floorLabel,
          })
        })
        dataset.annotations.forEach(annotation => {
          const mappedPanoId = idMap.get(annotation.panoId)
          if (!mappedPanoId) return
          const rawId = String(annotation.id ?? '').trim() || newAnnotationId()
          const n = normalizeImportedAnnotation({ ...annotation, panoId: mappedPanoId }, rawId)
          if (!n) return
          mergedAnnotations.push({ ...n, id: `${prefix}:${rawId}`, panoId: mappedPanoId })
        })
        dataset.perPanoAnnotationDocs.forEach(doc => {
          const mappedPanoId = idMap.get(doc.panoId)
          if (!mappedPanoId) return
          doc.annotations.forEach((ann, annIdx) => {
            const rawId = String(ann?.id ?? `ann-${annIdx + 1}`).trim() || `ann-${annIdx + 1}`
            const n = normalizeImportedAnnotation({ ...ann, panoId: mappedPanoId }, rawId)
            if (!n) return
            mergedAnnotations.push({ ...n, id: `${prefix}:${rawId}`, panoId: mappedPanoId })
          })
          if (doc.panoDisplayName) {
            const idx = mergedPanos.findIndex(p => p.id === mappedPanoId)
            if (idx >= 0) {
              mergedPanos[idx] = { ...mergedPanos[idx], displayLabel: doc.panoDisplayName }
            }
          }
          if (doc.assignedFloorLabel?.trim()) {
            mergedFloorAssignments[mappedPanoId] = doc.assignedFloorLabel.trim()
          }
        })
      }

      if (mergedPanos.length === 0) {
        throw new Error('Aucun panorama image detecte dans le(s) ZIP.')
      }

      const storageKeyBase = projectCode.trim() || 'local'
      const panosAfterLocal: PanoRecord[] = mergedPanos.map(p => ({ ...p }))
      const lsByPano = new Map<string, AnnotationRecord[]>()
      for (let i = 0; i < panosAfterLocal.length; i += 1) {
        const p = panosAfterLocal[i]
        try {
          const raw = localStorage.getItem(localStorageKeyForPano(storageKeyBase, p.id))
          if (!raw) continue
          const doc = parseAnnotationsDocument(raw)
          if (!doc || doc.panoId !== p.id) continue
          if (doc.panoDisplayName?.trim()) {
            panosAfterLocal[i] = { ...p, displayLabel: doc.panoDisplayName.trim() }
          }
          if (doc.assignedFloorLabel?.trim()) {
            mergedFloorAssignments[p.id] = doc.assignedFloorLabel.trim()
          }
          lsByPano.set(p.id, doc.annotations)
        } catch {
          /* ignore */
        }
      }
      let mergedFinal = mergedAnnotations.filter(a => !lsByPano.has(a.panoId))
      lsByPano.forEach(list => {
        mergedFinal = mergedFinal.concat(list)
      })

      previousUrls.forEach(url => URL.revokeObjectURL(url))
      const autoFloorAssignments = assignPanosToFloorsAutomatically(panosAfterLocal, mergedFloorMapAssets)
      const effectiveFloorAssignments: Record<string, string> = {
        ...autoFloorAssignments,
        ...mergedFloorAssignments,
      }
      const floorOrder = buildFloorOrderByAltitude(mergedFloorMapAssets)
      const orderedFloorMapAssets = mergedFloorMapAssets.map(asset => ({
        ...asset,
        ...(floorOrder[asset.floorLabel] !== undefined ? { floorOrder: floorOrder[asset.floorLabel] } : {}),
      }))
      const panosAfterRename = applyZipImportAutoPanoNames(
        panosAfterLocal,
        effectiveFloorAssignments,
        orderedFloorMapAssets
      )
      const loadSpatial = buildSpatialDatasetWithManualFloors(
        panosAfterRename.map(pano => ({
          id: pano.id,
          filename: pano.filename,
          displayLabel: pano.displayLabel,
          position: pano.position,
        })),
        effectiveFloorAssignments,
        orderedFloorMapAssets
      )

      setObjectUrls(mergedObjectUrls)
      setPanos(panosAfterRename)
      setAnnotations(mergedFinal)
      setFloorMapAssets(orderedFloorMapAssets)
      setPanoFloorAssignments(effectiveFloorAssignments)
      setCurrentPanoId(panosAfterRename[0].id)
      setSelectedFloor('ALL')
      addToast({
        type: 'success',
        title: 'Viewer 360',
        message: `${mergedPanos.length} panorama(s) charges depuis ${files.length} ZIP.`,
        duration: 3000,
      })
      const allWarnings = [...mergedWarnings, ...loadSpatial.warnings]
      if (allWarnings.length > 0) {
        addToast({
          type: 'warning',
          title: 'Import partiel',
          message: allWarnings[0],
          duration: 4200,
        })
      }
    } catch (error: any) {
      addToast({
        type: 'error',
        title: 'Chargement ZIP impossible',
        message: error?.message || 'Verifiez la structure du ZIP (images + metadata pano).',
        duration: 4500,
      })
      previousUrls.forEach(url => URL.revokeObjectURL(url))
      setObjectUrls([])
      setPanos([])
      setAnnotations([])
      setFloorMapAssets([])
      setPanoFloorAssignments({})
      setCurrentPanoId(null)
      setSelectedFloor('ALL')
    } finally {
      setLoading(false)
    }
  }

  const handleLoadE57File = async (file: File | null) => {
    if (!file) return
    setE57Loading(true)
    try {
      if (file.size > ETL360_E57_LARGE_FILE_BYTES) {
        addToast({
          type: 'warning',
          title: 'Fichier E57 volumineux',
          message:
            'La conversion E57 → XYZ se fait entierement en memoire dans le navigateur : un gros fichier peut echouer ou figer l onglet. Si une erreur survient, reduisez le nuage hors navigateur.',
          duration: 5500,
        })
      }
      const { convertE57 } = await import('web-e57')
      const arrayBuffer = await readUserFileAsArrayBuffer(file)
      const xyzText = convertE57(new Uint8Array(arrayBuffer), 'XYZ')
      const parsed = parseXyzWithAdaptiveDownsample(xyzText)
      if (!e57ViewerRef.current) throw new Error('Viewer E57 non initialise.')
      e57ViewerRef.current.setPointCloud(parsed.positions, parsed.bounds)
      setE57Stats({
        fileName: file.name,
        sourcePointCount: parsed.sourcePointCount,
        displayedPointCount: parsed.displayedPointCount,
      })
      addToast({
        type: 'success',
        title: 'E57 charge',
        message:
          parsed.displayedPointCount < parsed.sourcePointCount
            ? `Downsample: ${parsed.displayedPointCount.toLocaleString()} / ${parsed.sourcePointCount.toLocaleString()} points affiches.`
            : `${parsed.displayedPointCount.toLocaleString()} points affiches.`,
        duration: 4200,
      })
    } catch (error: unknown) {
      e57ViewerRef.current?.clear()
      setE57Stats(null)
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
        {keys.map(k => (
          <label key={k} className="block text-gray-300 text-sm">
            {ANNOTATION_SPEC_FIELD_LABELS[k]}
            {k === 'lifespan' && (
              <input
                value={form.lifespan}
                onChange={e => p({ lifespan: e.target.value })}
                placeholder="ex. 50 000 h, 5 ans"
                className={creationSpecInputCls}
              />
            )}
            {k === 'electricConsumption' && (
              <input
                value={form.electricConsumption}
                onChange={e => p({ electricConsumption: e.target.value })}
                placeholder="ex. 12 W, 8 kWh/an"
                className={creationSpecInputCls}
              />
            )}
            {k === 'lightOutputLux' && (
              <input
                inputMode="decimal"
                value={form.lightOutputLux}
                onChange={e => p({ lightOutputLux: e.target.value })}
                placeholder="ex. 500"
                className={creationSpecInputCls}
              />
            )}
            {k === 'material' && (
              <input
                value={form.material}
                onChange={e => p({ material: e.target.value })}
                placeholder="ex. polycarbonate, verre"
                className={creationSpecInputCls}
              />
            )}
            {k === 'weightKg' && (
              <input
                inputMode="decimal"
                value={form.weightKg}
                onChange={e => p({ weightKg: e.target.value })}
                placeholder="ex. 2.5"
                className={creationSpecInputCls}
              />
            )}
            {k === 'purchasePrice' && (
              <input
                inputMode="decimal"
                value={form.purchasePrice}
                onChange={e => p({ purchasePrice: e.target.value })}
                placeholder="nombre (devise libre)"
                className={creationSpecInputCls}
              />
            )}
          </label>
        ))}
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

  return (
    <div className="space-y-6 relative z-0">
      <div className="glass-panel p-6 rounded-2xl border border-white/10 relative z-20">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Viewer 360 ETL (ZIP local)</h1>
            {isEtlViewer360LocalDevEnabled() && (
              <p className="text-xs text-amber-200/95 mt-2 rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-2">
                Mode dev local : garde Dynamics / code projet ETL desactive via{' '}
                <code className="text-amber-100">VITE_ETL_VIEWER360_DEV=true</code> (uniquement en{' '}
                <code className="text-amber-100">npm run dev</code>).
              </p>
            )}
            <p className="text-gray-300 mt-2">
              Chargez un ou plusieurs dossiers ZIP de panoramas pour visualiser les scenes directement dans RAPPORTOA.
            </p>
            {projectCode && (
              <p className="text-xs text-blue-300 mt-2">
                Projet actif: {projectCode}{projectName ? ` - ${projectName}` : ''}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => navigate('/luxembourg/seco-geolux/etat-des-lieux/project-info')}
            className="btn-secondary btn-sm"
          >
            Retour project-info
          </button>
        </div>
      </div>

      <div className="glass-panel p-6 rounded-xl border border-white/10 relative z-20">
        <div className="flex flex-wrap items-center gap-3">
          <input
            id="etl-viewer-zip-input"
            type="file"
            accept=".zip,application/zip"
            multiple
            onChange={event => {
              void handleLoadZipFiles(event.target.files)
              event.currentTarget.value = ''
            }}
            className="hidden"
            disabled={loading}
          />
          <label htmlFor="etl-viewer-zip-input" className="btn-primary btn-sm cursor-pointer">
            {loading ? 'Chargement ZIP...' : '+ Charger dossier(s) ZIP'}
          </label>
          <button type="button" onClick={exportPdfAnnotationsReport} className="btn-secondary btn-sm">
            Exporter rapport PDF annotations
          </button>
          <span className="text-xs text-gray-400">
            ZIP NavVis (pano/annot + images). Fichiers d annotations par panorama :{' '}
            <code className="text-cyan-300/90">
              {`${ETL360_ANNOTATIONS_FILE_PREFIX}.{id_pano_sanitized}.json`}
            </code>{' '}
            (schemas <code className="text-cyan-300/90">{ETL360_ANNOTATIONS_SCHEMA_V1}</code> …{' '}
            <code className="text-cyan-300/90">{ETL360_ANNOTATIONS_SCHEMA_V4}</code> — export actuel :{' '}
            <code className="text-cyan-300/90">{ETL360_ANNOTATIONS_SCHEMA}</code>).
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {spatialDataset.hasSpatialPoints ? (
          <ETLFloorMap
            points={spatialDataset.points}
            selectedPanoId={currentPanoId}
            onSelectPano={panoId => setCurrentPanoId(panoId)}
            floorLabels={floorLabels}
            selectedFloor={selectedFloor}
            onSelectFloor={setSelectedFloor}
            floorMapAssets={spatialDataset.floorMapAssets}
            mapViewportClassName="h-[min(620px,65vh)] min-h-[420px]"
          />
        ) : panos.length > 0 ? (
          <div className="glass-panel p-4 rounded-xl border border-white/10 text-xs text-amber-300/90">
            Carte indisponible: il faut des coordonnees XY exploitables dans le fichier de poses pano.
          </div>
        ) : null}

        <div className="glass-panel p-4 rounded-xl border border-white/10">
          <h2 className="text-lg font-semibold text-white mb-3">
            Panoramas ({filteredPanos.length}
            {selectedFloor !== 'ALL' ? ` / ${panos.length}` : ''})
          </h2>
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
                  onClick={() => setCurrentPanoId(pano.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                    pano.id === currentPanoId
                      ? 'bg-blue-500/20 border-blue-500/50 text-blue-100'
                      : 'bg-white/5 border-white/10 text-gray-200 hover:bg-white/10'
                  }`}
                >
                  <div className="text-sm font-semibold">{panoDisplay(pano)}</div>
                  <div className="text-[11px] text-gray-400">{pano.id}</div>
                  {!pano.imageExists && (
                    <div className="text-[10px] text-amber-300/90">Image absente (mode carte uniquement)</div>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="glass-panel p-3 rounded-xl border border-white/10 min-h-[720px] flex flex-col relative z-0 overflow-visible">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-2 px-1 gap-y-2">
            <p className="text-xs text-gray-400 min-w-0 flex-1">
              Clic gauche sur l&apos;image 360 : fixer la direction (yaw / pitch) pour une nouvelle annotation point.
              Clic droit : annotation rapide sur la direction visee, avec choix entre un point et une zone rectangulaire
              en surbrillance. Double-clic sur une ligne : édition (gabarits lampe / prise / alarme, caractéristiques).
            </p>
            <button
              type="button"
              onClick={() => void togglePanoFullscreen()}
              className="btn-secondary btn-sm shrink-0"
              disabled={!currentPano}
              title={panoFsActive ? 'Quitter le plein ecran (Echap)' : 'Afficher le panorama en plein ecran'}
            >
              {panoFsActive ? 'Quitter plein ecran' : 'Plein ecran'}
            </button>
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
            <div ref={containerRef} className="w-full h-full min-h-0 relative" />
            {!currentPano && (
              <div className="absolute inset-0 grid place-items-center text-gray-400 text-sm px-4 text-center pointer-events-none">
                Chargez un ZIP contenant des panoramas pour demarrer la visualisation.
              </div>
            )}
          </div>

          <h3 className="text-sm font-semibold text-gray-300 mt-5 mb-2">
            Annotations ({currentAnnotations.length})
          </h3>
          <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
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
                          : 'bg-blue-500/20 text-blue-200 border border-blue-400/40'
                      }`}
                    >
                      {annotationKind(annotation)}
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
                  {(() => {
                    const specs = formatAnnotationSpecsLine(annotation, userTemplates)
                    return specs ? (
                      <div className="text-[10px] text-gray-500 line-clamp-2 mt-0.5">{specs}</div>
                    ) : null
                  })()}
                </button>
                <button
                  type="button"
                  onClick={() => deleteAnnotation(annotation.id)}
                  className="px-2 text-xs text-red-400 hover:bg-red-500/10 shrink-0"
                  title="Supprimer"
                >
                  x
                </button>
              </div>
            ))}
          </div>

          <div id="etl360-gabarit-form" className="mt-4 pt-4 border-t border-white/10 space-y-3 scroll-mt-4">
            <h4 className="text-sm font-semibold text-gray-300">Gabarits</h4>
            <p className="text-[11px] text-gray-500 leading-snug">
              Créez ou modifiez des gabarits personnalisés (double-clic sur une ligne « perso » dans la liste
              ci-dessous). Les gabarits intégrés (lampe, prise, alarme) sont listés à titre informatif ; seuls les gabarits
              perso sont modifiables ici.
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
                Tous les gabarits — double-clic sur une ligne <span className="text-gray-400">perso</span> pour la
                charger dans le formulaire
              </p>
              <ul className="space-y-1.5 text-xs text-gray-300 max-h-[220px] overflow-y-auto pr-1">
                {ANNOTATION_TEMPLATE_LIST.map(def => (
                  <li
                    key={`builtin-${def.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-950/40 px-2 py-1.5"
                    onDoubleClick={e => {
                      e.preventDefault()
                      addToast({
                        type: 'info',
                        title: 'Gabarit intégré',
                        message: `${def.label} est fourni par l'application et ne peut pas être modifié ici.`,
                        duration: 3200,
                      })
                    }}
                    title="Double-clic : information (non modifiable)"
                  >
                    <span className="flex items-center gap-2 min-w-0 cursor-default">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0 border border-white/20"
                        style={{ backgroundColor: def.color }}
                        aria-hidden
                      />
                      <span className="truncate font-medium">{def.label}</span>
                      <span className="text-[10px] text-slate-500 shrink-0">intégré</span>
                      <span className="text-[10px] text-gray-500 shrink-0">
                        {def.specKeys.length} champ{def.specKeys.length !== 1 ? 's' : ''} standard
                      </span>
                    </span>
                  </li>
                ))}
                {userTemplates.map(ut => {
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
        </div>

        {currentPano && (
          <div className="glass-panel p-4 rounded-xl border border-white/10 space-y-3">
            <h3 className="text-sm font-semibold text-gray-300">Renommer le panorama</h3>
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
            <div
              className="rounded-lg border border-amber-400/35 bg-amber-500/10 px-3 py-2"
              role="status"
              aria-live="polite"
            >
              <p className="text-[11px] text-amber-100/95 leading-snug">
                <span className="font-semibold text-amber-50">Évolution prévue :</span> les boutons{' '}
                <span className="font-medium">Télécharger</span> et <span className="font-medium">Importer</span> JSON
                des annotations sont temporaires et <span className="font-medium">seront retirés</span> de cet écran
                dans une prochaine itération du produit.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={exportCurrentAnnotations} className="btn-primary btn-sm w-full">
                Telecharger JSON annotations
              </button>
              <p className="text-[10px] text-gray-500 break-all">
                Fichier : {currentPano ? buildAnnotationsFilename(currentPano.id) : ''}
              </p>
              <input
                id="etl-viewer-import-json"
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={e => {
                  void importAnnotationsFile(e.target.files?.[0] ?? null)
                  e.currentTarget.value = ''
                }}
              />
              <label htmlFor="etl-viewer-import-json" className="btn-secondary btn-sm w-full text-center cursor-pointer">
                Importer JSON (ce panorama)
              </label>
            </div>
          </div>
        )}

        {currentPano && (
          <div className="glass-panel mt-3 space-y-3 p-3 border border-white/10 rounded-xl bg-white/[0.03]">
            <h3 className="text-sm font-semibold text-white">Ajouter une annotation</h3>
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
                <select
                  value={
                    manualUserTemplateId
                      ? `u:${manualUserTemplateId}`
                      : manualTemplateId
                        ? `t:${manualTemplateId}`
                        : ''
                  }
                  onChange={e => {
                    const v = e.target.value
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
                      if (ANNOTATION_TEMPLATES[tid]) setManualColor(ANNOTATION_TEMPLATES[tid].color)
                    }
                  }}
                  className={`mt-0.5 w-full px-2 py-1.5 text-sm ${ETL360_SELECT_BASE}`}
                >
                  <option value="">Aucun</option>
                  {ANNOTATION_TEMPLATE_LIST.map(t => (
                    <option key={t.id} value={`t:${t.id}`}>
                      {t.label}
                    </option>
                  ))}
                  {userTemplates.map(ut => (
                    <option key={ut.id} value={`u:${ut.id}`}>
                      {ut.name} (perso)
                    </option>
                  ))}
                </select>
              </label>
              <div className="sm:col-span-2 space-y-2">
                {(() => {
                  const manualUt = manualUserTemplateId
                    ? userTemplates.find(u => u.id === manualUserTemplateId)
                    : undefined
                  const manualBuiltinKeys =
                    manualUserTemplateId && manualUt
                      ? manualUt.builtinSpecKeys ?? []
                      : manualTemplateId
                        ? ANNOTATION_TEMPLATES[manualTemplateId]?.specKeys ?? []
                        : []
                  return (
                    <>
                      {renderAnnCreationBuiltinBlock(
                        manualBuiltinKeys,
                        manualCreationSpec,
                        setManualCreationSpec
                      )}
                      {renderAnnCreationCustomBlock(manualUt, manualCreationCustom, setManualCreationCustom)}
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
        )}

        <div className="glass-panel p-4 rounded-xl border border-white/10 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-white">Visualisation E57 (nuage de points)</h3>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="etl-viewer-e57-input"
                type="file"
                accept=".e57,application/octet-stream"
                className="hidden"
                onChange={e => {
                  void handleLoadE57File(e.target.files?.[0] ?? null)
                  e.currentTarget.value = ''
                }}
                disabled={e57Loading}
              />
              <label htmlFor="etl-viewer-e57-input" className="btn-secondary btn-sm cursor-pointer">
                {e57Loading ? 'Chargement E57...' : 'Charger fichier E57'}
              </label>
            </div>
          </div>
          <p className="text-xs text-gray-400">
            Rendu 3D local (rotation: clic gauche + glisser, zoom: molette). Downsample adaptatif : plus le nuage
            source est gros, plus le nombre de points affiches est reduit (jusqu&apos;a environ 8k points pour les
            tres gros scans) pour garder une navigation fluide ; la taille des points a l&apos;ecran s&apos;ajuste
            pour rester lisible. Si l&apos;import echoue avec une erreur de lecture : placez le .e57 dans un dossier
            100 % local (pas OneDrive « en ligne uniquement ») ou synchronisez le fichier avant de le selectionner.
          </p>
          <div className="text-[11px] text-gray-500 min-h-[1.25rem]">
            {e57Stats
              ? `${e57Stats.fileName} — ${e57Stats.displayedPointCount.toLocaleString()} / ${e57Stats.sourcePointCount.toLocaleString()} points affiches`
              : 'Aucun fichier E57 charge.'}
          </div>
          <div className="relative w-full h-[420px] rounded-xl overflow-hidden border border-white/10 bg-slate-950">
            <div ref={e57ContainerRef} className="w-full h-full" />
            {!e57Stats && (
              <div className="absolute inset-0 grid place-items-center text-sm text-gray-500 px-4 text-center pointer-events-none">
                Importez un fichier E57 pour afficher son nuage de points.
              </div>
            )}
          </div>
        </div>
      </div>

      {editAnnotationOpen &&
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
                Identifiant, description et couleur (la direction sur le panorama ne change pas). Ajoutez les
                caractéristiques utiles via le bouton ci-dessous (export JSON v4 et rapport PDF).
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
              <label className="block text-gray-300">
                Gabarit
                <select
                  value={
                    editUserTemplateId ? `u:${editUserTemplateId}` : editTemplateId ? `t:${editTemplateId}` : ''
                  }
                  onChange={e => {
                    const v = e.target.value
                    const specVals = {
                      lifespan: editLifespan,
                      electricConsumption: editElectricConsumption,
                      lightOutputLux: editLightOutputLux,
                      material: editMaterial,
                      weightKg: editWeightKg,
                      purchasePrice: editPurchasePrice,
                    }
                    if (!v) {
                      setEditUserTemplateId('')
                      setEditTemplateId('')
                      setEditCustomTemplateValues({})
                      setEditLifespan('')
                      setEditElectricConsumption('')
                      setEditLightOutputLux('')
                      setEditMaterial('')
                      setEditWeightKg('')
                      setEditPurchasePrice('')
                      setEditSpecSlots(mergeSpecSlotsForEditor('', specVals))
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
                      const d = ut?.builtinSpecDefaults
                      setEditLifespan(d?.lifespan ?? '')
                      setEditElectricConsumption(d?.electricConsumption ?? '')
                      setEditLightOutputLux(d?.lightOutputLux?.trim() ? String(d.lightOutputLux).trim() : '')
                      setEditMaterial(d?.material ?? '')
                      setEditWeightKg(d?.weightKg?.trim() ? String(d.weightKg).trim() : '')
                      setEditPurchasePrice(d?.purchasePrice?.trim() ? String(d.purchasePrice).trim() : '')
                      setEditSpecSlots(mergeSpecSlotsForEditor('', specVals, ut?.builtinSpecKeys ?? []))
                      return
                    }
                    if (v.startsWith('t:')) {
                      const tid = v.slice(2) as AnnotationTemplateId
                      setEditTemplateId(tid)
                      setEditUserTemplateId('')
                      setEditCustomTemplateValues({})
                      setEditLifespan('')
                      setEditElectricConsumption('')
                      setEditLightOutputLux('')
                      setEditMaterial('')
                      setEditWeightKg('')
                      setEditPurchasePrice('')
                      if (ANNOTATION_TEMPLATES[tid]) setEditColor(ANNOTATION_TEMPLATES[tid].color)
                      setEditSpecSlots(mergeSpecSlotsForEditor(tid, specVals))
                    }
                  }}
                  className={`mt-1 w-full px-3 py-2 ${ETL360_SELECT_BASE}`}
                >
                  <option value="">Aucun (personnalisé)</option>
                  {ANNOTATION_TEMPLATE_LIST.map(t => (
                    <option key={t.id} value={`t:${t.id}`}>
                      {t.label}
                    </option>
                  ))}
                  {userTemplates.map(ut => (
                    <option key={ut.id} value={`u:${ut.id}`}>
                      {ut.name} (gabarit perso)
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-[11px] text-gray-500 -mt-1">
                Gabarits intégrés : couleur et champs techniques prédéfinis. Gabarits perso : caractéristiques libres
                définies ci-dessous dans la zone de création.
              </p>
              {editUserTemplateId ? (
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
              ) : null}
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
              <label className="flex items-center gap-3 text-gray-300 select-none">
                <input
                  type="checkbox"
                  checked={editPositionLocked}
                  onChange={e => setEditPositionLocked(e.target.checked)}
                  className="h-4 w-4 rounded border border-white/20 bg-white/5"
                />
                <span>Position verrouillee</span>
              </label>
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
                    {ANNOTATION_SPEC_FIELD_ORDER.filter(k => editSpecSlots.includes(k)).map(k => (
                      <div key={k}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-sm text-gray-300">{ANNOTATION_SPEC_FIELD_LABELS[k]}</span>
                          <button
                            type="button"
                            className="shrink-0 px-2 py-1 text-xs text-red-300 hover:bg-red-500/15 rounded border border-red-500/30"
                            title="Retirer cette caractéristique"
                            onClick={() => {
                              setEditSpecSlots(s => s.filter(x => x !== k))
                              if (k === 'lifespan') setEditLifespan('')
                              if (k === 'electricConsumption') setEditElectricConsumption('')
                              if (k === 'lightOutputLux') setEditLightOutputLux('')
                              if (k === 'material') setEditMaterial('')
                              if (k === 'weightKg') setEditWeightKg('')
                              if (k === 'purchasePrice') setEditPurchasePrice('')
                            }}
                          >
                            Retirer
                          </button>
                        </div>
                        {k === 'lifespan' && (
                          <input
                            value={editLifespan}
                            onChange={e => setEditLifespan(e.target.value)}
                            placeholder="ex. 50 000 h, 5 ans"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500"
                          />
                        )}
                        {k === 'electricConsumption' && (
                          <input
                            value={editElectricConsumption}
                            onChange={e => setEditElectricConsumption(e.target.value)}
                            placeholder="ex. 12 W, 8 kWh/an"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500"
                          />
                        )}
                        {k === 'lightOutputLux' && (
                          <input
                            inputMode="decimal"
                            value={editLightOutputLux}
                            onChange={e => setEditLightOutputLux(e.target.value)}
                            placeholder="ex. 500"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500"
                          />
                        )}
                        {k === 'material' && (
                          <input
                            value={editMaterial}
                            onChange={e => setEditMaterial(e.target.value)}
                            placeholder="ex. polycarbonate, verre"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500"
                          />
                        )}
                        {k === 'weightKg' && (
                          <input
                            inputMode="decimal"
                            value={editWeightKg}
                            onChange={e => setEditWeightKg(e.target.value)}
                            placeholder="ex. 2.5"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500"
                          />
                        )}
                        {k === 'purchasePrice' && (
                          <input
                            inputMode="decimal"
                            value={editPurchasePrice}
                            onChange={e => setEditPurchasePrice(e.target.value)}
                            placeholder="nombre (devise libre)"
                            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-gray-500"
                          />
                        )}
                      </div>
                    ))}
                    {editSpecSlots.length === 0 && (
                      <p className="text-xs text-gray-500">Aucune caractéristique ajoutée.</p>
                    )}
                  </div>
                </div>
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

      {quickOpen &&
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
                <div className="mt-1 grid grid-cols-2 gap-2">
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
                </div>
              </label>
                <label className="block text-gray-300">
                  Gabarit (optionnel)
                  <select
                    value={
                      qaUserTemplateId ? `u:${qaUserTemplateId}` : qaTemplateId ? `t:${qaTemplateId}` : ''
                    }
                    onChange={e => {
                      const v = e.target.value
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
                        if (ANNOTATION_TEMPLATES[tid]) setQaColor(ANNOTATION_TEMPLATES[tid].color)
                      }
                    }}
                    className={`mt-1 w-full px-3 py-2 ${ETL360_SELECT_BASE}`}
                  >
                    <option value="">Aucun</option>
                    {ANNOTATION_TEMPLATE_LIST.map(t => (
                      <option key={t.id} value={`t:${t.id}`}>
                        {t.label}
                      </option>
                    ))}
                    {userTemplates.map(ut => (
                      <option key={ut.id} value={`u:${ut.id}`}>
                        {ut.name} (perso)
                      </option>
                    ))}
                  </select>
                </label>
                {(() => {
                  const qaUt = qaUserTemplateId ? userTemplates.find(u => u.id === qaUserTemplateId) : undefined
                  const qaBuiltinKeys =
                    qaUserTemplateId && qaUt
                      ? qaUt.builtinSpecKeys ?? []
                      : qaTemplateId
                        ? ANNOTATION_TEMPLATES[qaTemplateId]?.specKeys ?? []
                        : []
                  return (
                    <>
                      {renderAnnCreationBuiltinBlock(qaBuiltinKeys, qaCreationSpec, setQaCreationSpec)}
                      {renderAnnCreationCustomBlock(qaUt, qaCreationCustom, setQaCreationCustom)}
                    </>
                  )
                })()}
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
              <p className="text-xs text-gray-400">
                {qaKind === 'point'
                  ? 'Point : comportement actuel, ajoute un repere ponctuel sur la direction visee.'
                  : 'Zone : le clic droit memorise un coin; apres validation, maintenez le clic gauche sur le panorama pour tracer le rectangle.'}
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
                  }}
                >
                  Annuler
                </button>
                <button type="button" className="btn-primary btn-sm" onClick={submitQuickAnnotation}>
                  {qaKind === 'zone' ? 'Dessiner la zone' : 'Enregistrer'}
                </button>
              </div>
            </div>
          </div>,
          panoModalMount
        )}
    </div>
  )
}

