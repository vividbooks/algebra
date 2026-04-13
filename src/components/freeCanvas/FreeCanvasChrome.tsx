import type { FC } from 'react'
import { clampFreeZoom, FREE_ZOOM_MAX, FREE_ZOOM_MIN } from '../../constants'

/** Ikony jako ve FreeGeometryEditor (lucide-like), bez externí závislosti. */

function IconZoomOut({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3M8 11h6" />
    </svg>
  )
}

function IconZoomIn({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3M11 8v6M8 11h6" />
    </svg>
  )
}

function IconMoon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  )
}

function IconSun({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  )
}

function IconGrid({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  )
}

function IconUndo({ className }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
    </svg>
  )
}

function IconRedo({ className }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 15-6.7L21 13" />
    </svg>
  )
}

function IconFileText({ className }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8" />
    </svg>
  )
}

export type FreeSessionLogEntry = { t: number; msg: string }

type TopBarProps = {
  zoom: number
  onZoomChange: (z: number) => void
  darkMode: boolean
  onDarkModeChange: (v: boolean) => void
  showGrid: boolean
  onShowGridChange: (v: boolean) => void
  /** Rovnice — prostřední sloupec mřížky + rozdělený zápis. */
  equalsMode: boolean
  onEqualsModeChange: (v: boolean) => void
}

/** Horní lišta — zoom, slider, tmavý režim, přepínač mřížky. */
export const FreeCanvasTopBar: FC<TopBarProps> = ({
  zoom,
  onZoomChange,
  darkMode,
  onDarkModeChange,
  showGrid,
  onShowGridChange,
  equalsMode,
  onEqualsModeChange,
}) => {
  const zoomToCenter = (z: number) => onZoomChange(clampFreeZoom(z))

  return (
    <div
      className={`geo-topbar${darkMode ? ' geo-topbar--dark' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`geo-topbar__btn${equalsMode ? ' geo-topbar__btn--active' : ''}`}
        onClick={() => onEqualsModeChange(!equalsMode)}
        title={
          equalsMode
            ? 'Vypnout rovnici (jedna strana)'
            : 'Zapnout rovnici — rozdělit plochu rovnítkem'
        }
        aria-pressed={equalsMode}
        aria-label="Rovnice — rozdělení plochy rovnítkem"
      >
        <span className="geo-topbar__eq-icon" aria-hidden>
          =
        </span>
      </button>
      <div className="geo-topbar__sep" aria-hidden />
      <button
        type="button"
        className="geo-topbar__btn"
        onClick={() => zoomToCenter(zoom - 0.08)}
        aria-label="Oddálit"
      >
        <IconZoomOut className="geo-topbar__icon" />
      </button>
      <div className="geo-topbar__slider-wrap">
        <input
          type="range"
          className="geo-topbar__slider"
          min={Math.round(FREE_ZOOM_MIN * 100)}
          max={Math.round(FREE_ZOOM_MAX * 100)}
          step={5}
          value={Math.round(clampFreeZoom(zoom) * 100)}
          onChange={(e) => zoomToCenter(Number(e.target.value) / 100)}
          aria-label="Úroveň přiblížení"
        />
      </div>
      <button
        type="button"
        className="geo-topbar__btn"
        onClick={() => zoomToCenter(zoom + 0.08)}
        aria-label="Přiblížit"
      >
        <IconZoomIn className="geo-topbar__icon" />
      </button>
      <div className="geo-topbar__sep" aria-hidden />
      <button
        type="button"
        className="geo-topbar__btn"
        onClick={() => onDarkModeChange(!darkMode)}
        title={darkMode ? 'Světlý režim' : 'Tmavý režim'}
        aria-label={darkMode ? 'Světlý režim' : 'Tmavý režim'}
      >
        {darkMode ? <IconSun className="geo-topbar__icon" /> : <IconMoon className="geo-topbar__icon" />}
      </button>
      <div className="geo-topbar__sep" aria-hidden />
      <button
        type="button"
        className={`geo-topbar__btn${showGrid ? ' geo-topbar__btn--active' : ''}`}
        onClick={() => onShowGridChange(!showGrid)}
        title={showGrid ? 'Skrýt mřížku' : 'Zobrazit mřížku'}
        aria-pressed={showGrid}
      >
        <IconGrid className="geo-topbar__icon" />
      </button>
    </div>
  )
}

type RightBarProps = {
  darkMode: boolean
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  isRecording: boolean
  onToggleRecording: () => void
  notesOpen: boolean
  onToggleNotes: () => void
  notesBadgeCount: number
}

/** Pravý horní roh — Undo, Redo, nahrávání, zápis (jako ve FreeGeometryEditor). */
export const FreeCanvasRightBar: FC<RightBarProps> = ({
  darkMode,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  isRecording,
  onToggleRecording,
  notesOpen,
  onToggleNotes,
  notesBadgeCount,
}) => (
  <div
    className={`geo-rightbar${darkMode ? ' geo-rightbar--dark' : ''}`}
    onPointerDown={(e) => e.stopPropagation()}
  >
    <button
      type="button"
      className="geo-rightbar__btn"
      disabled={!canUndo}
      onClick={onUndo}
      title="Zpět (Ctrl+Z)"
    >
      <IconUndo className="geo-rightbar__icon" />
    </button>
    <button
      type="button"
      className="geo-rightbar__btn"
      disabled={!canRedo}
      onClick={onRedo}
      title="Vpřed (Ctrl+Y)"
    >
      <IconRedo className="geo-rightbar__icon" />
    </button>
    <div className="geo-rightbar__btn--record-wrap">
      <button
        type="button"
        className={`geo-rightbar__btn geo-rightbar__btn--record${isRecording ? ' geo-rightbar__btn--recording' : ''}`}
        onClick={onToggleRecording}
        title={isRecording ? 'Zastavit nahrávání' : 'Začít nahrávání'}
      >
        {isRecording ? (
          <>
            <span className="geo-rightbar__rec-square" />
            <span className="geo-rightbar__rec-ping" aria-hidden />
          </>
        ) : (
          <span className="geo-rightbar__rec-idle" aria-hidden />
        )}
      </button>
      {!isRecording ? (
        <span className="geo-rightbar__rec-tooltip">Nahrávat postup</span>
      ) : null}
    </div>
    <button
      type="button"
      className={`geo-rightbar__btn${notesOpen ? ' geo-rightbar__btn--active' : ''}`}
      onClick={onToggleNotes}
      title="Zápis konstrukce"
    >
      <IconFileText className="geo-rightbar__icon" />
      {notesBadgeCount > 0 && !notesOpen ? (
        <span className="geo-rightbar__badge">{notesBadgeCount}</span>
      ) : null}
    </button>
  </div>
)

type NotesPanelProps = {
  open: boolean
  onClose: () => void
  darkMode: boolean
  notes: string
  onNotesChange: (v: string) => void
  sessionLog: FreeSessionLogEntry[]
  isRecording: boolean
}

/** Panel zápisu + živý log při nahrávání (zjednodušená varianta ConstructionProtocol). */
export const FreeCanvasNotesPanel: FC<NotesPanelProps> = ({
  open,
  onClose,
  darkMode,
  notes,
  onNotesChange,
  sessionLog,
  isRecording,
}) => {
  if (!open) return null
  return (
    <div
      className={`geo-notes-backdrop${darkMode ? ' geo-notes-backdrop--dark' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Zápis"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="geo-notes-panel">
        <div className="geo-notes-panel__head">
          <h2 className="geo-notes-panel__title">Zápis</h2>
          <button type="button" className="geo-notes-panel__close" onClick={onClose} aria-label="Zavřít">
            ×
          </button>
        </div>
        <label className="geo-notes-panel__label" htmlFor="free-canvas-notes-ta">
          Poznámky k plátnu
        </label>
        <textarea
          id="free-canvas-notes-ta"
          className="geo-notes-panel__textarea"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Pište si průběh výuky, očekávané kroky žáků…"
          rows={8}
        />
        <div className="geo-notes-panel__log-head">
          {isRecording ? (
            <span className="geo-notes-panel__rec-live">● Nahrávání — události</span>
          ) : (
            <span className="geo-notes-panel__rec-off">Poslední zaznamenané události</span>
          )}
        </div>
        <ul className="geo-notes-panel__log">
          {sessionLog.length === 0 ? (
            <li className="geo-notes-panel__log-empty">Zatím žádné záznamy.</li>
          ) : (
            [...sessionLog].reverse().map((e) => (
              <li key={e.t} className="geo-notes-panel__log-item">
                <time className="geo-notes-panel__log-time">
                  {new Date(e.t).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </time>
                <span>{e.msg}</span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}
