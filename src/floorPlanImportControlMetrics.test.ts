/**
 * Exécution depuis la racine du dépôt :
 *   npx tsx countries/lu/frontend/routes/etlViewer360/floorPlanImportControlMetrics.test.ts
 */
import assert from 'node:assert/strict'
import {
  floorPlanImportControlMetrics,
  floorPlanImportMissingLayers,
} from './etlViewer360Core'

assert.equal(
  floorPlanImportMissingLayers({
    importedDataUrl: 'data:image/png;base64,xx',
    originalPlanImageUrl: 'https://example.com/plan.tif',
  }).length,
  0,
  'raster importé et URL du plan d’origine → aucun calque manquant',
)

assert.deepEqual(
  floorPlanImportMissingLayers({ importedDataUrl: '', originalPlanImageUrl: 'https://x' }),
  ['importedRaster'],
)

assert.deepEqual(
  floorPlanImportMissingLayers({ importedDataUrl: 'data:image/png;base64,x', originalPlanImageUrl: '' }),
  ['originalPlan'],
)

assert.deepEqual(
  floorPlanImportMissingLayers({ importedDataUrl: 'data:,', originalPlanImageUrl: 'https://x' }),
  ['importedRaster'],
)

assert.deepEqual(
  floorPlanImportMissingLayers({
    importedDataUrl: 'data:image/png;base64,QQ==',
    originalPlanImageUrl: 'blob:abc',
  }),
  [],
)

const a = floorPlanImportControlMetrics({ importSrcW: 2480, importSrcH: 3508, canvasCssScale: 1 })
assert.ok(a.edgeBar >= 16 && a.edgeBar <= 200)
assert.ok(a.depthBar >= a.edgeBar)
assert.ok(a.strokePx >= 2.25)
assert.ok(a.touchCornerSize >= a.cornerSize)

const b = floorPlanImportControlMetrics({ importSrcW: 2480, importSrcH: 3508, canvasCssScale: 0.2 })
assert.ok(
  b.edgeBar >= a.edgeBar - 1e-6,
  'canvasCssScale plus petit → poignées plus grosses en px canvas',
)

const small = floorPlanImportControlMetrics({ importSrcW: 400, importSrcH: 300, canvasCssScale: 1 })
const large = floorPlanImportControlMetrics({ importSrcW: 8000, importSrcH: 6000, canvasCssScale: 1 })
assert.ok(large.edgeBar >= small.edgeBar, 'raster plus grand → barres au moins aussi larges')

console.log('floorPlanImportControlMetrics.test.ts OK')
