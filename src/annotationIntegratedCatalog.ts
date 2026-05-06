/**
 * Charge le catalogue des gabarits intégrés depuis {@link ./annotationIntegratedCatalog.json}.
 * Les types runtime (AnnotationRecord, etc.) restent dans etlViewer360Core.ts.
 */

import annotationIntegratedCatalogJson from './annotationIntegratedCatalog.json'
import type { AnnotationSpecFieldKey } from './annotationSpec'

type RawCatalog = typeof annotationIntegratedCatalogJson

export type AnnotationTemplateId = keyof RawCatalog['templates']

export type AnnotationTemplateDef = {
  id: AnnotationTemplateId
  label: string
  color: string
  specKeys: AnnotationSpecFieldKey[]
  builtinSpecDefaults?: Partial<Record<AnnotationSpecFieldKey, string>>
}

export type MatiereWidgetProfile = {
  templateId: AnnotationTemplateId
  /** Préfixe dans la ligne récap (PDF), ex. « Matière » ou « Revêtement ». */
  detailLineLabel: string
  presetKey: string
  autreKey: string
  choices: ReadonlyArray<{ value: string; label: string }>
  checkboxFields?: ReadonlyArray<{ key: string; label: string }>
  /** Titre du bloc repliable (création / édition). */
  checkboxBlockTitle?: string
  /** Préfixe avant la liste des cases cochées dans la ligne récap. */
  checkboxLinePrefix?: string
}

const raw = annotationIntegratedCatalogJson as RawCatalog

function buildAnnotationTemplates(): Record<AnnotationTemplateId, AnnotationTemplateDef> {
  const out = {} as Record<AnnotationTemplateId, AnnotationTemplateDef>
  for (const tid of Object.keys(raw.templates) as AnnotationTemplateId[]) {
    const t = raw.templates[tid] as {
      label: string
      color: string
      specKeys: string[]
      builtinSpecDefaults?: Partial<Record<AnnotationSpecFieldKey, string>>
      importAliases?: string[]
    }
    out[tid] = {
      id: tid,
      label: t.label,
      color: t.color,
      specKeys: (t.specKeys ?? []) as AnnotationSpecFieldKey[],
      ...(t.builtinSpecDefaults && Object.keys(t.builtinSpecDefaults).length > 0
        ? { builtinSpecDefaults: t.builtinSpecDefaults }
        : {}),
    }
  }
  return out
}

export const ANNOTATION_TEMPLATES: Record<AnnotationTemplateId, AnnotationTemplateDef> =
  buildAnnotationTemplates()

export const ANNOTATION_TEMPLATE_LIST: AnnotationTemplateDef[] = raw.templatePickerOrder.map(pid => {
  const id = pid as AnnotationTemplateId
  const def = ANNOTATION_TEMPLATES[id]
  if (!def) {
    throw new Error(
      `[annotationIntegratedCatalog] templatePickerOrder contient un id inconnu: « ${String(pid)} »`
    )
  }
  return def
})

const isurf = raw.integratedSurface as {
  autreValue: string
  matiereWidgetProfiles: MatiereWidgetProfile[]
}

export const INTEGRATED_SURFACE_AUTRE_VALUE = isurf.autreValue

const profilesRaw = isurf.matiereWidgetProfiles ?? []
const seen = new Set<string>()
for (const p of profilesRaw) {
  const id = String(p.templateId ?? '')
  if (!id || seen.has(id)) {
    throw new Error(
      `[annotationIntegratedCatalog] matiereWidgetProfiles: id manquant ou doublon « ${id} »`
    )
  }
  seen.add(id)
  if (!Object.prototype.hasOwnProperty.call(ANNOTATION_TEMPLATES, id)) {
    throw new Error(
      `[annotationIntegratedCatalog] matiereWidgetProfiles: template inconnu « ${id} »`
    )
  }
}

export const MATIERE_WIDGET_PROFILES: readonly MatiereWidgetProfile[] = profilesRaw.map(p => ({
  ...p,
  templateId: p.templateId as AnnotationTemplateId,
}))

export function matiereWidgetProfileFor(
  id: AnnotationTemplateId | '' | undefined
): MatiereWidgetProfile | undefined {
  if (!id) return undefined
  return MATIERE_WIDGET_PROFILES.find(p => p.templateId === id)
}

export const SURFACE_MATIERE_TEMPLATE_IDS = MATIERE_WIDGET_PROFILES.map(
  p => p.templateId
) as readonly AnnotationTemplateId[]

function profileOrThrow(id: AnnotationTemplateId, label: string): MatiereWidgetProfile {
  const p = matiereWidgetProfileFor(id)
  if (!p) {
    throw new Error(`[annotationIntegratedCatalog] profil matière manquant pour ${label} (${id})`)
  }
  return p
}

const murP = profileOrThrow('defaut_mur', 'mur')
const solP = profileOrThrow('sol', 'sol')

export const ETL360_MUR_MATIERE_PRESET_KEY = murP.presetKey
export const ETL360_MUR_MATIERE_AUTRE_KEY = murP.autreKey
export const ETL360_SOL_MATIERE_PRESET_KEY = solP.presetKey
export const ETL360_SOL_MATIERE_AUTRE_KEY = solP.autreKey

export const DEFAUT_MUR_MATIERE_CHOICES = murP.choices
export const SOL_MATIERE_CHOICES = solP.choices
export const SOL_TEMPLATE_CHECKBOX_FIELDS = (solP.checkboxFields ?? []) as ReadonlyArray<{
  key: string
  label: string
}>

function normalizeAlias(s: string): string {
  return s.trim().toLowerCase().replace(/-/g, '_')
}

export function parseAnnotationTemplateId(rawId: unknown): AnnotationTemplateId | undefined {
  const s = normalizeAlias(String(rawId ?? ''))
  if (!s) return undefined
  for (const tid of Object.keys(ANNOTATION_TEMPLATES) as AnnotationTemplateId[]) {
    if (tid === s) return tid
    const t = raw.templates[tid] as { importAliases?: string[] }
    const aliases = t.importAliases
    if (Array.isArray(aliases) && aliases.some(a => normalizeAlias(a) === s)) return tid
  }
  return undefined
}

export function isIntegratedTemplateOverrideId(id: string): id is AnnotationTemplateId {
  return Object.prototype.hasOwnProperty.call(ANNOTATION_TEMPLATES, id)
}

export function integratedSurfaceMatiereTemplateId(
  id: AnnotationTemplateId | '' | undefined
): AnnotationTemplateId | null {
  if (!id) return null
  return matiereWidgetProfileFor(id) ? id : null
}

export function defaultIntegratedSurfaceMatiereCustom(id: AnnotationTemplateId): Record<string, string> {
  const p = matiereWidgetProfileFor(id)
  if (!p) return {}
  const o: Record<string, string> = { [p.presetKey]: '', [p.autreKey]: '' }
  for (const row of p.checkboxFields ?? []) o[row.key] = ''
  return o
}

export function parseSolTemplateCheckboxStored(value: unknown): boolean {
  const s = String(value ?? '')
    .trim()
    .toLowerCase()
  return s === '1' || s === 'true' || s === 'oui' || s === 'yes'
}
