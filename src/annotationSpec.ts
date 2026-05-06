/**
 * Schéma procédural des champs techniques des annotations (gabarits).
 * Source unique : ordre, libellés, import CSV/JSON, formulaires, ligne récap.
 * Aucun import depuis etlViewer360Core (évite les cycles).
 */

export type AnnotationSpecFieldKey =
  | 'lifespan'
  | 'electricConsumption'
  | 'lightOutputLux'
  | 'material'
  | 'weightKg'
  | 'purchasePrice'
  | 'crackLengthCm'
  | 'crackWidthCm'

export type AnnotationSpecKind = 'trimmedString' | 'nonNegativeNumber'

type BuiltinSpecRegistryEntry = {
  key: AnnotationSpecFieldKey
  /** Libellé formulaire */
  label: string
  /** Titre court dans la ligne récap (PDF, infobulle) */
  lineLabel: string
  kind: AnnotationSpecKind
  /** Suffixe après une valeur numérique affichée dans la ligne récap */
  lineNumberSuffix: string
  placeholder: string
  /** Attribut input (champs numériques) */
  inputMode?: 'decimal'
  /** Clés CSV normalisées (minuscules) pour getRowValue */
  csvKeys: string[]
  /** Extraction depuis un objet JSON brut à l’import */
  readImportJson: (raw: Record<string, unknown>) => unknown
}

function trimOpt(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  return s || undefined
}

/** Nombre ≥ 0 ; accepte virgule décimale. */
export function parseOptionalNonNegativeNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(String(value).trim().replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return undefined
  return n
}

const REGISTRY: BuiltinSpecRegistryEntry[] = [
  {
    key: 'lifespan',
    label: 'Durée de vie',
    lineLabel: 'Durée de vie',
    kind: 'trimmedString',
    lineNumberSuffix: '',
    placeholder: 'ex. 50 000 h, 5 ans',
    csvKeys: ['lifespan', 'dureevie', 'duree_vie', 'lifetime'],
    readImportJson: raw =>
      trimOpt(raw.lifespan ?? raw.dureeVie ?? raw.duree_vie ?? raw.lifetime),
  },
  {
    key: 'electricConsumption',
    label: 'Consommation électrique',
    lineLabel: 'Conso électrique',
    kind: 'trimmedString',
    lineNumberSuffix: '',
    placeholder: 'ex. 12 W, 8 kWh/an',
    csvKeys: ['electricconsumption', 'consommation_electrique', 'conso_electrique', 'conso'],
    readImportJson: raw =>
      trimOpt(
        raw.electricConsumption ??
          raw.consommationElectrique ??
          raw.consommation_electrique ??
          raw.conso_electrique
      ),
  },
  {
    key: 'lightOutputLux',
    label: 'Éclairement (lux)',
    lineLabel: 'Éclairement',
    kind: 'nonNegativeNumber',
    lineNumberSuffix: ' lx',
    placeholder: 'ex. 500',
    inputMode: 'decimal',
    csvKeys: ['lightoutputlux', 'lux', 'production_lumineuse'],
    readImportJson: raw =>
      raw.lightOutputLux ?? raw.lux ?? raw.productionLumineuseLux ?? raw.production_lumineuse_lux,
  },
  {
    key: 'material',
    label: 'Matière',
    lineLabel: 'Matière',
    kind: 'trimmedString',
    lineNumberSuffix: '',
    placeholder: 'ex. polycarbonate, verre',
    csvKeys: ['material', 'matiere'],
    readImportJson: raw => trimOpt(raw.material ?? raw.matiere ?? raw['matière']),
  },
  {
    key: 'weightKg',
    label: 'Poids (kg)',
    lineLabel: 'Poids',
    kind: 'nonNegativeNumber',
    lineNumberSuffix: ' kg',
    placeholder: 'ex. 2.5',
    inputMode: 'decimal',
    csvKeys: ['weightkg', 'poids_kg', 'poids'],
    readImportJson: raw => raw.weightKg ?? raw.poidsKg ?? raw.poids_kg ?? raw.poids,
  },
  {
    key: 'purchasePrice',
    label: "Prix d'achat",
    lineLabel: 'Prix achat',
    kind: 'nonNegativeNumber',
    lineNumberSuffix: '',
    placeholder: 'nombre (devise libre)',
    inputMode: 'decimal',
    csvKeys: ['purchaseprice', 'prix_achete', 'prix'],
    readImportJson: raw => raw.purchasePrice ?? raw.prixAchete ?? raw.prix_achete ?? raw.prix,
  },
  {
    key: 'crackLengthCm',
    label: 'Longueur (cm)',
    lineLabel: 'Longueur fissure',
    kind: 'nonNegativeNumber',
    lineNumberSuffix: ' cm',
    placeholder: 'ex. 10',
    inputMode: 'decimal',
    csvKeys: ['cracklengthcm', 'fissure_longueur_cm', 'longueur_cm', 'longueurcm'],
    readImportJson: raw =>
      raw.crackLengthCm ?? raw.fissureLongueurCm ?? raw.fissure_longueur_cm ?? raw.longueur_cm,
  },
  {
    key: 'crackWidthCm',
    label: 'Largeur (cm)',
    lineLabel: 'Largeur fissure',
    kind: 'nonNegativeNumber',
    lineNumberSuffix: ' cm',
    placeholder: 'ex. 1',
    inputMode: 'decimal',
    csvKeys: ['crackwidthcm', 'fissure_largeur_cm', 'largeur_cm', 'largeurcm'],
    readImportJson: raw =>
      raw.crackWidthCm ?? raw.fissureLargeurCm ?? raw.fissure_largeur_cm ?? raw.largeur_cm,
  },
]

export const ANNOTATION_SPEC_FIELD_ORDER: AnnotationSpecFieldKey[] = REGISTRY.map(r => r.key)

export const ANNOTATION_SPEC_FIELD_LABELS: Record<AnnotationSpecFieldKey, string> = REGISTRY.reduce(
  (acc, r) => {
    acc[r.key] = r.label
    return acc
  },
  {} as Record<AnnotationSpecFieldKey, string>
)

export const ANNOTATION_SPEC_REGISTRY = REGISTRY as readonly BuiltinSpecRegistryEntry[]

export const ANNOTATION_SPEC_FIELD_BY_KEY: Record<AnnotationSpecFieldKey, BuiltinSpecRegistryEntry> =
  REGISTRY.reduce(
    (acc, r) => {
      acc[r.key] = r
      return acc
    },
    {} as Record<AnnotationSpecFieldKey, BuiltinSpecRegistryEntry>
  )

/** Sous-ensemble d’AnnotationRecord lisible pour les specs (évite import circulaire). */
export type AnnotationSpecReadable = {
  lifespan?: string
  electricConsumption?: string
  lightOutputLux?: number
  material?: string
  weightKg?: number
  purchasePrice?: number
  crackLengthCm?: number
  crackWidthCm?: number
}

export type AnnCreationSpecForm = Record<AnnotationSpecFieldKey, string>

export type AnnotationSpecRecordPatch = Partial<{
  lifespan: string
  electricConsumption: string
  lightOutputLux: number
  material: string
  weightKg: number
  purchasePrice: number
  crackLengthCm: number
  crackWidthCm: number
}>

export function emptyAnnCreationSpecForm(): AnnCreationSpecForm {
  const o = {} as AnnCreationSpecForm
  for (const k of ANNOTATION_SPEC_FIELD_ORDER) o[k] = ''
  return o
}

/** Remplit le formulaire à partir d’un map partiel (ex. builtinSpecDefaults du gabarit). */
export function creationSpecFormFromPartialDefaults(
  defaults: Partial<Record<AnnotationSpecFieldKey, string>> | undefined
): AnnCreationSpecForm {
  const f = emptyAnnCreationSpecForm()
  if (!defaults) return f
  for (const k of ANNOTATION_SPEC_FIELD_ORDER) {
    const v = defaults[k]
    if (v === undefined || !String(v).trim()) continue
    f[k] = String(v).trim()
  }
  return f
}

export function annotationHasSpecValue(ann: AnnotationSpecReadable, k: AnnotationSpecFieldKey): boolean {
  const e = ANNOTATION_SPEC_FIELD_BY_KEY[k]
  const v = ann[k]
  if (e.kind === 'trimmedString') return typeof v === 'string' && !!v.trim()
  return typeof v === 'number' && Number.isFinite(v)
}

/** Segments texte pour la ligne récap (sans gabarit utilisateur). */
export function annotationBuiltinSpecLineParts(ann: AnnotationSpecReadable): string[] {
  const parts: string[] = []
  for (const e of REGISTRY) {
    const v = ann[e.key]
    if (e.kind === 'trimmedString') {
      if (typeof v === 'string' && v.trim()) parts.push(`${e.lineLabel}: ${v.trim()}`)
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      parts.push(`${e.lineLabel}: ${v}${e.lineNumberSuffix}`)
    }
  }
  return parts
}

export function annotationSpecFormValueNonEmpty(values: AnnCreationSpecForm, k: AnnotationSpecFieldKey): boolean {
  const e = ANNOTATION_SPEC_FIELD_BY_KEY[k]
  const v = values[k] ?? ''
  if (e.kind === 'trimmedString') return !!v.trim()
  return parseOptionalNonNegativeNumber(v) !== undefined
}

export function annotationSpecEditorSlotsWithValues(values: AnnCreationSpecForm): AnnotationSpecFieldKey[] {
  return ANNOTATION_SPEC_FIELD_ORDER.filter(k => annotationSpecFormValueNonEmpty(values, k))
}

export function annCreationSpecFormFromBuiltinDefaults(
  keys: AnnotationSpecFieldKey[] | undefined,
  defaults: Partial<Record<AnnotationSpecFieldKey, string>> | undefined
): AnnCreationSpecForm {
  const f = emptyAnnCreationSpecForm()
  for (const k of keys ?? []) {
    const v = defaults?.[k]
    if (v === undefined || !String(v).trim()) continue
    f[k] = String(v).trim()
  }
  return f
}

export function buildAnnotationSpecPatchFromCreationForm(
  keys: AnnotationSpecFieldKey[],
  form: AnnCreationSpecForm
): AnnotationSpecRecordPatch {
  if (keys.length === 0) return {}
  const out: AnnotationSpecRecordPatch = {}
  for (const k of keys) {
    const e = ANNOTATION_SPEC_FIELD_BY_KEY[k]
    const raw = form[k] ?? ''
    if (e.kind === 'trimmedString') {
      const t = raw.trim()
      if (t) {
        if (k === 'lifespan') out.lifespan = t
        else if (k === 'electricConsumption') out.electricConsumption = t
        else if (k === 'material') out.material = t
      }
    } else {
      const n = parseOptionalNonNegativeNumber(raw)
      if (n === undefined) continue
      if (k === 'lightOutputLux') out.lightOutputLux = n
      else if (k === 'weightKg') out.weightKg = n
      else if (k === 'purchasePrice') out.purchasePrice = n
      else if (k === 'crackLengthCm') out.crackLengthCm = n
      else if (k === 'crackWidthCm') out.crackWidthCm = n
    }
  }
  return out
}

export function annotationToCreationSpecForm(ann: AnnotationSpecReadable): AnnCreationSpecForm {
  const f = emptyAnnCreationSpecForm()
  for (const e of REGISTRY) {
    const v = ann[e.key]
    if (e.kind === 'trimmedString') {
      f[e.key] = typeof v === 'string' ? v : ''
    } else {
      f[e.key] = typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
    }
  }
  return f
}

export function parseAnnotationSpecFromImportJsonRaw(raw: unknown): AnnotationSpecReadable {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  const out: AnnotationSpecReadable = {}
  for (const e of REGISTRY) {
    const picked = e.readImportJson(o)
    if (e.kind === 'trimmedString') {
      const t = trimOpt(picked)
      if (t) (out as Record<string, unknown>)[e.key] = t
    } else {
      const n = parseOptionalNonNegativeNumber(picked)
      if (n !== undefined) (out as Record<string, unknown>)[e.key] = n
    }
  }
  return out
}

export function parseAnnotationSpecFromCsvRow(
  row: Record<string, string>,
  getRowValue: (row: Record<string, string>, keys: string[]) => string
): AnnotationSpecReadable {
  const out: AnnotationSpecReadable = {}
  for (const e of REGISTRY) {
    const cell = getRowValue(row, e.csvKeys)
    if (!cell) continue
    if (e.kind === 'trimmedString') {
      const t = trimOpt(cell)
      if (t) (out as Record<string, unknown>)[e.key] = t
    } else {
      const n = parseOptionalNonNegativeNumber(cell)
      if (n !== undefined) (out as Record<string, unknown>)[e.key] = n
    }
  }
  return out
}

export function parseBuiltinSpecKeysFromRaw(raw: unknown): AnnotationSpecFieldKey[] {
  if (!Array.isArray(raw)) return []
  const set = new Set<AnnotationSpecFieldKey>()
  for (const x of raw) {
    const k = String(x ?? '').trim() as AnnotationSpecFieldKey
    if (ANNOTATION_SPEC_FIELD_ORDER.includes(k)) set.add(k)
  }
  return ANNOTATION_SPEC_FIELD_ORDER.filter(key => set.has(key))
}

export function parseBuiltinSpecDefaultsFromRaw(
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
