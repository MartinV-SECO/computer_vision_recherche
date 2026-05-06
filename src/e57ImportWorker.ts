type WorkerRequest =
  | {
      type: 'convert'
      arrayBuffer: ArrayBuffer
      reservoirCap?: number
    }

type WorkerProgressMessage = {
  type: 'progress'
  step: 'converting-e57' | 'sampling-points' | 'done'
  percent: number
}

type WorkerSuccessMessage = {
  type: 'result'
  positionsBuffer: ArrayBufferLike
  sourcePointCount: number
  displayedPointCount: number
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
  /** SCR détecté dans l en-tête XML du fichier E57 (heuristique EPSG). */
  spatialReference?: string
}

type WorkerErrorMessage = {
  type: 'error'
  message: string
}

function parseXyzWithReservoirDownsample(
  xyzText: string,
  maxPoints: number
): {
  positions: Float32Array
  sourcePointCount: number
  displayedPointCount: number
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
} {
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

function parseXyzWithAdaptiveDownsample(xyzText: string, reservoirCap: number) {
  const first = parseXyzWithReservoirDownsample(xyzText, reservoirCap)
  const target = computeTargetDisplayPointCount(first.sourcePointCount)
  if (target <= 0 || first.displayedPointCount <= target) return first
  const positions = subsamplePositionsUniform(first.positions, first.displayedPointCount, target)
  return { ...first, positions, displayedPointCount: target }
}

const postWorkerMessage = (message: unknown, transfer?: Transferable[]) => {
  const p = self as unknown as { postMessage: (msg: unknown, transferList?: Transferable[]) => void }
  p.postMessage(message, transfer)
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data
  if (!msg || msg.type !== 'convert') return
  try {
    const notify = (step: WorkerProgressMessage['step'], percent: number) => {
      const progress: WorkerProgressMessage = { type: 'progress', step, percent }
      postWorkerMessage(progress)
    }

    notify('converting-e57', 15)
    const { spatialReferenceFromE57ArrayBuffer } = await import('../lib/e57SpatialRef')
    const spatialReference = spatialReferenceFromE57ArrayBuffer(msg.arrayBuffer)
    const { convertE57 } = await import('web-e57')
    const xyzText = convertE57(new Uint8Array(msg.arrayBuffer), 'XYZ')

    notify('sampling-points', 72)
    const parsed = parseXyzWithAdaptiveDownsample(xyzText, Math.max(60_000, msg.reservoirCap ?? 280_000))

    notify('done', 100)
    const ok: WorkerSuccessMessage = {
      type: 'result',
      positionsBuffer: parsed.positions.buffer,
      sourcePointCount: parsed.sourcePointCount,
      displayedPointCount: parsed.displayedPointCount,
      bounds: parsed.bounds,
      ...(spatialReference ? { spatialReference } : {}),
    }
    postWorkerMessage(ok, [ok.positionsBuffer as ArrayBuffer])
  } catch (error) {
    const ko: WorkerErrorMessage = {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    }
    postWorkerMessage(ko)
  }
}
