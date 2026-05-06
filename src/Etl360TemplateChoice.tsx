/**
 * Choix de gabarit (intégré ou perso) avec filtre texte et priorité aux gabarits récents.
 * La liste se déploie sur demande et se referme après sélection ou clic extérieur.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ANNOTATION_TEMPLATE_LIST, type AnnotationTemplateId } from './annotationIntegratedCatalog'
import type { UserAnnotationTemplate } from './etlViewer360Core'
import {
  effectiveIntegratedTemplateDef,
  isIntegratedTemplateOverrideId,
  templatePickerRowMatchesSearch,
} from './etlViewer360Core'

export type Etl360TemplateChoiceProps = {
  /** Valeur contrôlée : `''`, `t:${AnnotationTemplateId}` ou `u:${id}`. */
  valueKey: string
  onChangeKey: (key: string) => void
  userTemplates: UserAnnotationTemplate[]
  /** Ordre du plus récent au plus ancien (clés `t:` / `u:`). */
  recentKeys: readonly string[]
  /** Après sélection d’un gabarit non vide (pas pour « Aucun »). */
  onAfterPick?: (key: string) => void
  includeEmpty: boolean
  emptyLabel: string
  /** Suffixe affiché pour les gabarits perso (ex. « (perso) »). */
  userSuffix: string
  searchPlaceholder?: string
  className?: string
}

type Opt = { key: string; label: string }

export function Etl360TemplateChoice(props: Etl360TemplateChoiceProps) {
  const {
    valueKey,
    onChangeKey,
    userTemplates,
    recentKeys,
    onAfterPick,
    includeEmpty,
    emptyLabel,
    userSuffix,
    searchPlaceholder = 'Rechercher un gabarit…',
    className,
  } = props

  const [query, setQuery] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const allOptions: Opt[] = useMemo(() => {
    const integ: Opt[] = ANNOTATION_TEMPLATE_LIST.map(t => ({
      key: `t:${t.id}`,
      label: effectiveIntegratedTemplateDef(t.id as AnnotationTemplateId, userTemplates).label,
    }))
    const user: Opt[] = userTemplates
      .filter(ut => !isIntegratedTemplateOverrideId(ut.id))
      .map(ut => ({
        key: `u:${ut.id}`,
        label: userSuffix ? `${ut.name} ${userSuffix}`.trim() : ut.name,
      }))
    return [...integ, ...user]
  }, [userTemplates, userSuffix])

  const ordered: Opt[] = useMemo(() => {
    const filtered = allOptions.filter(o => templatePickerRowMatchesSearch(o.label, o.key, query))
    const seen = new Set<string>()
    const out: Opt[] = []
    for (const k of recentKeys) {
      const hit = filtered.find(o => o.key === k)
      if (hit && !seen.has(hit.key)) {
        out.push(hit)
        seen.add(hit.key)
      }
    }
    for (const o of filtered) {
      if (!seen.has(o.key)) {
        out.push(o)
        seen.add(o.key)
      }
    }
    return out
  }, [allOptions, recentKeys, query])

  const displayLabel = useMemo(() => {
    if (!valueKey) return includeEmpty ? emptyLabel : '—'
    return allOptions.find(o => o.key === valueKey)?.label ?? valueKey
  }, [valueKey, allOptions, includeEmpty, emptyLabel])

  const closePanel = () => {
    setPanelOpen(false)
    setQuery('')
  }

  useEffect(() => {
    if (!panelOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      const el = containerRef.current
      if (!el || el.contains(e.target as Node)) return
      closePanel()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [panelOpen])

  useEffect(() => {
    if (!panelOpen) return
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [panelOpen])

  const rowCls = (active: boolean) =>
    `w-full text-left px-3 py-2 text-sm transition-colors border-b border-white/5 last:border-b-0 ` +
    (active
      ? 'bg-amber-500/15 text-amber-100'
      : 'text-gray-200 hover:bg-white/[0.06] hover:text-white')

  const summaryBtnCls =
    'w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border border-white/10 bg-black/30 text-left text-gray-100 shadow-sm hover:border-white/20 hover:bg-black/40'

  return (
    <div ref={containerRef} className={className ?? 'mt-1 space-y-1.5'}>
      <button
        type="button"
        className={summaryBtnCls}
        aria-expanded={panelOpen}
        aria-haspopup="listbox"
        onClick={() => {
          if (panelOpen) closePanel()
          else setPanelOpen(true)
        }}
      >
        <span className="min-w-0 truncate font-medium">{displayLabel}</span>
        <span className="shrink-0 text-gray-500 text-xs tabular-nums" aria-hidden>
          {panelOpen ? '▲' : '▼'}
        </span>
      </button>

      {panelOpen ? (
        <>
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            autoComplete="off"
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                closePanel()
              }
            }}
            className="w-full px-2 py-1.5 text-sm rounded-lg border border-white/10 bg-black/30 text-gray-100 placeholder:text-gray-500 shadow-sm [color-scheme:dark]"
          />
          <div
            role="listbox"
            aria-label="Gabarits disponibles"
            className="max-h-52 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/90 shadow-inner"
          >
            {includeEmpty ? (
              <button
                type="button"
                role="option"
                aria-selected={!valueKey}
                className={rowCls(!valueKey)}
                onClick={() => {
                  onChangeKey('')
                  closePanel()
                }}
              >
                {emptyLabel}
              </button>
            ) : null}
            {ordered.length === 0 ? (
              <p className="px-3 py-2.5 text-xs text-gray-500">Aucun gabarit ne correspond à la recherche.</p>
            ) : (
              ordered.map(opt => {
                const active = valueKey === opt.key
                return (
                  <button
                    key={opt.key}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={rowCls(active)}
                    onClick={() => {
                      onChangeKey(opt.key)
                      onAfterPick?.(opt.key)
                      closePanel()
                    }}
                  >
                    {opt.label}
                  </button>
                )
              })
            )}
          </div>
          {!query.trim() && recentKeys.length > 0 ? (
            <p className="text-[10px] text-gray-500 leading-snug">
              Les gabarits récemment utilisés ou choisis apparaissent en haut de la liste.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
