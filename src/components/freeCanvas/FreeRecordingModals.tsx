import type { FC } from 'react'
import { useMemo } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Circle,
  Move,
  Pencil,
  Plus,
  RotateCw,
  Share2,
  Trash2,
  X,
} from 'lucide-react'
import { FREE_GRID_CELL_PX } from '../../constants'
import type {
  FreeRecordingActionType,
  FreeRecordingStep,
} from '../../lib/freeRecording'
import { partitionTilesByEqualsColumn } from '../../lib/tiles'
import { MergedColoredPolyExpr } from '../MergedColoredPolyExpr'

function RecordingActionIcon({ type }: { type: FreeRecordingActionType }) {
  const cl = 'free-rec-icon'
  switch (type) {
    case 'place':
      return <Plus className={cl} size={18} strokeWidth={2.2} aria-hidden />
    case 'remove':
    case 'clear':
      return <Trash2 className={cl} size={18} strokeWidth={2.2} aria-hidden />
    case 'zero-pair':
      return <Circle className={cl} size={18} strokeWidth={2.2} aria-hidden />
    case 'move':
      return <Move className={cl} size={18} strokeWidth={2.2} aria-hidden />
    case 'flip':
      return <span className={`${cl} free-rec-icon--text`}>±</span>
    case 'rotate':
      return <RotateCw className={cl} size={18} strokeWidth={2.2} aria-hidden />
    case 'duplicate-group':
      return <Plus className={cl} size={18} strokeWidth={2.2} aria-hidden />
    case 'multi':
    case 'other':
    default:
      return <Circle className={cl} size={18} strokeWidth={2.2} aria-hidden />
  }
}

export type FreeRecordingStepEditorProps = {
  open: boolean
  darkMode: boolean
  steps: FreeRecordingStep[]
  recordingName: string
  onRecordingNameChange: (v: string) => void
  onStepNotationChange: (index: number, notation: string) => void
  onStepDescriptionChange: (index: number, description: string) => void
  onDone: () => void
  onRequestClose: () => void
}

/** Step editor after recording stops — same flow as FreeGeometryEditor. */
export const FreeRecordingStepEditor: FC<FreeRecordingStepEditorProps> = ({
  open,
  darkMode,
  steps,
  recordingName,
  onRecordingNameChange,
  onStepNotationChange,
  onStepDescriptionChange,
  onDone,
  onRequestClose,
}) => {
  if (!open) return null
  return (
    <div
      className={`free-rec-backdrop${darkMode ? ' free-rec-backdrop--dark' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Úprava kroků nahrávání"
    >
      <div className="free-rec-editor">
        <button
          type="button"
          className="free-rec-editor__close"
          onClick={onRequestClose}
          title="Zavřít"
          aria-label="Zavřít"
        >
          <X size={20} strokeWidth={2} aria-hidden />
        </button>
        <h2 className="free-rec-editor__title">Úprava kroků</h2>
        <p className="free-rec-editor__lead">
          Nahráno {steps.length} kroků. Můžete upravit zápis i popis jednotlivých
          kroků.
        </p>
        <div className="free-rec-editor__field">
          <label className="free-rec-editor__label" htmlFor="free-rec-name">
            Název záznamu
          </label>
          <input
            id="free-rec-name"
            type="text"
            className="free-rec-editor__input"
            value={recordingName}
            onChange={(e) => onRecordingNameChange(e.target.value)}
            placeholder="Např. Sčítání výrazů na plátně…"
            autoComplete="off"
          />
        </div>
        <div className="free-rec-editor__steps">
          {steps.map((step, index) => (
            <div key={step.id} className="free-rec-editor__step">
              <div className="free-rec-editor__step-head">
                <div className="free-rec-editor__step-num">{index + 1}</div>
                <div className="free-rec-editor__step-ic">
                  <RecordingActionIcon type={step.actionType} />
                </div>
                <div className="free-rec-editor__step-notation-wrap">
                  <label className="free-rec-editor__sublabel">
                    Zápis (LaTeX)
                  </label>
                  <input
                    type="text"
                    className="free-rec-editor__input free-rec-editor__input--mono"
                    value={step.notation ?? ''}
                    onChange={(e) =>
                      onStepNotationChange(index, e.target.value)
                    }
                    placeholder="Např. x^2 + 2x"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="free-rec-editor__step-desc">
                <label className="free-rec-editor__sublabel">Popis kroku</label>
                <input
                  type="text"
                  className="free-rec-editor__input"
                  value={step.description}
                  onChange={(e) =>
                    onStepDescriptionChange(index, e.target.value)
                  }
                  placeholder="Popis kroku…"
                  autoComplete="off"
                />
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="free-rec-editor__done" onClick={onDone}>
          <Check size={18} strokeWidth={2.4} aria-hidden />
          Hotovo
        </button>
      </div>
    </div>
  )
}

export type FreeRecordingPlayerProps = {
  open: boolean
  darkMode: boolean
  /** Stejné jako na plátně — rozdělení zápisu rovnítkem. */
  equalsMode: boolean
  /** Levý okraj sloupce rovnítka (px), jako `freeEqBandLeft` v App. */
  eqBandLeft: number
  steps: FreeRecordingStep[]
  recordingName: string
  currentStepIndex: number
  onPrev: () => void
  onNext: () => void
  onExit: () => void
  onEditSteps: () => void
  onCopyShareJson: () => void
}

/** Přehrávač kroků — úvodní obrazovka a navigace jako ve FreeGeometryEditor (bez Supabase). */
export const FreeRecordingPlayer: FC<FreeRecordingPlayerProps> = ({
  open,
  darkMode,
  equalsMode,
  eqBandLeft,
  steps,
  recordingName,
  currentStepIndex,
  onPrev,
  onNext,
  onExit,
  onEditSteps,
  onCopyShareJson,
}) => {
  const title = recordingName.trim() || 'Záznam z plátna'
  const atEnd = currentStepIndex >= steps.length - 1
  const atStart = currentStepIndex < 0

  const recStep = useMemo(() => {
    if (!open || atStart) return null
    if (currentStepIndex < 0 || currentStepIndex >= steps.length) return null
    return steps[currentStepIndex]!
  }, [open, atStart, currentStepIndex, steps])

  /** U kroku „nulový pár“ odpovídá zápis stavu těsně před odstraněním (jako plátno). */
  const snapshotForExpr = useMemo(() => {
    if (!open || !recStep) return null
    if (recStep.actionType === 'zero-pair' && currentStepIndex > 0) {
      return steps[currentStepIndex - 1]!.snapshot
    }
    return recStep.snapshot
  }, [open, recStep, currentStepIndex, steps])

  const eqPartition = useMemo(() => {
    if (!snapshotForExpr || !equalsMode) return null
    return partitionTilesByEqualsColumn(
      snapshotForExpr,
      eqBandLeft,
      FREE_GRID_CELL_PX,
      'freeGrid'
    )
  }, [snapshotForExpr, equalsMode, eqBandLeft])

  if (!open) return null

  return (
    <div
      className={`free-rec-player${darkMode ? ' free-rec-player--dark' : ''}`}
      role="region"
      aria-label="Přehrávání záznamu"
    >
      {atStart ? (
        <div className="free-rec-player__intro">
          <div className="free-rec-player__intro-pill">Postup na plátně:</div>
          <h1 className="free-rec-player__intro-title">{title}</h1>
          <button
            type="button"
            className="free-rec-player__share"
            onClick={onCopyShareJson}
          >
            <Share2 size={18} strokeWidth={2.2} aria-hidden />
            Kopírovat záznam (JSON)
          </button>
          <p className="free-rec-player__hint">
            Uložte si zkopírovaný soubor nebo text.
            <br />
            Automaticky se neukládá na server.
          </p>
        </div>
      ) : null}

      {recStep && snapshotForExpr ? (
        <div className="free-rec-player__top-strip">
          <div
            className={`free-poly-expr free-poly-expr--rec-top${darkMode ? ' free-poly-expr--dark' : ''}${equalsMode ? ' free-poly-expr--equation' : ''}`}
            aria-live="polite"
          >
            {eqPartition ? (
              <div className="free-poly-expr__equation">
                <span className="free-poly-expr__side">
                  <MergedColoredPolyExpr tiles={eqPartition.left} />
                </span>
                <span className="free-poly-expr__eq" aria-hidden>
                  {' '}
                  ={' '}
                </span>
                <span className="free-poly-expr__side">
                  <MergedColoredPolyExpr tiles={eqPartition.right} />
                </span>
              </div>
            ) : (
              <MergedColoredPolyExpr tiles={snapshotForExpr} />
            )}
            {recStep.description.trim() ? (
              <p className="free-rec-player__top-comment">{recStep.description}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="free-rec-player__bar">
        <button
          type="button"
          className="free-rec-player__icon-btn"
          onClick={onExit}
          title="Zavřít přehrávač"
          aria-label="Zavřít přehrávač"
        >
          <X size={22} strokeWidth={2} aria-hidden />
        </button>
        <button
          type="button"
          className="free-rec-player__icon-btn"
          onClick={onEditSteps}
          title="Upravit kroky a název"
          aria-label="Upravit kroky"
        >
          <Pencil size={20} strokeWidth={2} aria-hidden />
        </button>
        <div className="free-rec-player__bar-sep" aria-hidden />
        <button
          type="button"
          className="free-rec-player__nav free-rec-player__nav--back"
          onClick={onPrev}
          disabled={atStart}
        >
          <ArrowLeft size={20} strokeWidth={2.2} aria-hidden />
          Zpět
        </button>
        <button
          type="button"
          className="free-rec-player__nav free-rec-player__nav--fwd"
          onClick={onNext}
          disabled={atEnd}
        >
          Další
          <ArrowRight size={20} strokeWidth={2.2} aria-hidden />
        </button>
      </div>
    </div>
  )
}
