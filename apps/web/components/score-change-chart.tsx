'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Activity } from 'lucide-react';
import type { ReactNode } from 'react';

import type { AnalysisResult, EmotionClassification } from '@damdai/contracts';

import { formatClassification, formatProbability } from '../lib/analysis-result';

type EmotionScores = Record<EmotionClassification, number>;
type Trace = AnalysisResult['technicalTrace'];
type ReplayStep = {
  cue: string;
  ruleId: string;
  source: 'baseline' | 'linguistic' | 'acoustic' | 'system';
  scores: EmotionScores;
  adjustment?: Trace['scoreAdjustments'][number];
};
type ScaleMode = 'full' | 'zoom';

const classificationKeys = ['happiness', 'sadness', 'anger', 'neutrality'] as const;

/** Line, dot and bar colors, one per emotion. */
const emotionFill: Record<EmotionClassification, string> = {
  happiness: '#f5b700',
  sadness: '#4a7df0',
  anger: '#e5392b',
  neutrality: '#9aa0a6',
};

/** Darker versions for text on white. */
const emotionInk: Record<EmotionClassification, string> = {
  happiness: '#a26e00',
  sadness: '#2f5fc4',
  anger: '#c0271b',
  neutrality: '#575d62',
};

const emotionResultGradient: Record<EmotionClassification, [string, string]> = {
  happiness: ['#f4c542', '#fd5113'],
  sadness: ['#5b8def', '#0b0088'],
  anger: ['#e76f51', '#ff0000'],
  neutrality: ['#9e9e9e', '#2a2a2a'],
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function formatPoints(delta: number): string {
  const points = delta * 100;
  if (Math.abs(points) < 0.05) return '0.0 pts';
  return `${points > 0 ? '+' : '−'}${Math.abs(points).toFixed(1)} pts`;
}

function formatShort(delta: number): string {
  const points = delta * 100;
  if (Math.abs(points) < 0.05) return '0.0';
  return `${points > 0 ? '+' : '−'}${Math.abs(points).toFixed(1)}`;
}

function topEmotion(scores: EmotionScores): EmotionClassification {
  return classificationKeys.reduce((best, key) => (scores[key] > scores[best] ? key : best));
}

/** Build an illustrative replay from the neural scores and reported rule evidence. */
function buildScoreJourney(trace: Trace, transcript: string): ReplayStep[] {
  const baseline = trace.probabilities.before;
  const logits: EmotionScores = Object.fromEntries(
    classificationKeys.map((emotion) => [emotion, Math.log(baseline[emotion])]),
  ) as EmotionScores;
  const steps: ReplayStep[] = [
    { cue: 'Neural baseline', ruleId: 'BASELINE', source: 'baseline', scores: { ...baseline } },
  ];
  const transcriptLower = transcript.toLocaleLowerCase();
  const adjustments = trace.scoreAdjustments
    .map((adjustment, index) => {
      const ruleId = adjustment.reason.split(' ')[0] ?? '';
      const detected = adjustment.reason.match(/detected ['"](.+?)['"]/i)?.[1];
      const cuePosition = detected ? transcriptLower.indexOf(detected.toLocaleLowerCase()) : -1;
      const source: ReplayStep['source'] = ruleId === 'PROSODIC_ENERGY_RATE'
        ? 'acoustic'
        : ruleId === 'NEURAL_RULE_AGREEMENT' || ruleId === 'CONTRADICTION_RECALIBRATION'
          ? 'system'
          : 'linguistic';
      const order = source === 'system'
        ? transcript.length + (ruleId === 'CONTRADICTION_RECALIBRATION' ? 1 : 2)
        : source === 'acoustic'
          ? transcript.length
          : cuePosition >= 0
            ? cuePosition
            : transcript.length - 1;
      const cue = detected ?? (
        source === 'acoustic'
          ? 'energy and speaking rate'
          : ruleId === 'NEURAL_RULE_AGREEMENT'
            ? 'Agreement'
            : ruleId === 'CONTRADICTION_RECALIBRATION'
              ? 'neural-symbolic disagreement'
              : formatClassification(adjustment.emotionClassification)
      );
      return { adjustment, index, ruleId, source, order, cue };
    })
    .filter(({ ruleId }) => !['LEXICAL_MODIFIER', 'LEXICAL_NEGATION'].includes(ruleId))
    .sort((a, b) => a.order - b.order || a.index - b.index);

  for (const item of adjustments) {
    logits[item.adjustment.emotionClassification] += item.adjustment.delta;
    const maxLogit = Math.max(...classificationKeys.map((emotion) => logits[emotion]));
    const exponentials = Object.fromEntries(
      classificationKeys.map((emotion) => [emotion, Math.exp(logits[emotion] - maxLogit)]),
    ) as EmotionScores;
    const total = classificationKeys.reduce((sum, emotion) => sum + exponentials[emotion], 0);
    const scores = Object.fromEntries(
      classificationKeys.map((emotion) => [emotion, exponentials[emotion] / total]),
    ) as EmotionScores;
    steps.push({
      cue: item.cue,
      ruleId: item.ruleId,
      source: item.source,
      scores,
      adjustment: item.adjustment,
    });
  }

  return steps;
}

function getDomain(values: number[], mode: ScaleMode): [number, number] {
  if (mode === 'full') return [0, 1];
  let lo = Math.max(0, Math.floor((Math.min(...values) - 0.05) * 10) / 10);
  let hi = Math.min(1, Math.ceil((Math.max(...values) + 0.05) * 10) / 10);
  if (hi - lo < 0.2) {
    hi = Math.min(1, lo + 0.2);
    lo = Math.max(0, hi - 0.2);
  }
  return [lo, hi];
}

export function ScoreChangeChart({
  trace,
  transcript,
  classification,
  finalScores,
  children,
}: {
  trace: Trace;
  transcript: string;
  classification?: EmotionClassification;
  finalScores: EmotionScores;
  children?: ReactNode;
}) {
  const journey = buildScoreJourney(trace, transcript);
  const lastIndex = journey.length - 1;

  // The line starts from whatever the neural model thought was strongest.
  const [tracked, setTracked] = useState<EmotionClassification>(
    () => classification ?? topEmotion(trace.probabilities.before),
  );
  const [mode, setMode] = useState<ScaleMode>('full');
  const [open, setOpen] = useState<number | null>(null);
  const [boxWidth, setBoxWidth] = useState(640);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const isOpen = open !== null;

  // Draw the SVG 1:1 with the card width so text stays at its real size.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setBoxWidth(Math.max(320, Math.floor(el.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Modal behavior: focus, Esc to close, arrows to move, Tab stays inside.
  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    const opener = openerRef.current as HTMLElement | null;
    dialog?.querySelector<HTMLElement>('[data-autofocus]')?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(null);
      } else if (event.key === 'ArrowRight') {
        setOpen((current) => (current === null ? current : Math.min(lastIndex, current + 1)));
      } else if (event.key === 'ArrowLeft') {
        setOpen((current) => (current === null ? current : Math.max(0, current - 1)));
      } else if (event.key === 'Tab' && dialog) {
        const items = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled)'));
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [isOpen, lastIndex]);

  // If a disabled Previous/Next button loses focus, move it back into the dialog.
  useEffect(() => {
    if (open === null) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
  }, [open]);

  const trackedLabel = formatClassification(tracked);
  const finalGradient = emotionResultGradient[tracked];
  const rootStyle = {
    '--sjc-color': emotionFill[tracked],
    '--sjc-ink': emotionInk[tracked],
    '--sjc-result-top': finalGradient[0],
    '--sjc-result-bottom': finalGradient[1],
  } as CSSProperties;

  const header = (
    <header className="analysis-result-section-heading sjc-header">
      <div>
        <p className="dashboard-card-kicker">
          <Activity size={14} aria-hidden="true" />
          Illustrative score replay
        </p>
        <h2 id="score-changes-heading">How each clue shifts the neural score</h2>
      </div>
    </header>
  );

  if (journey.length < 2) {
    return (
      <section className="sjc" style={rootStyle} aria-labelledby="score-changes-heading">
        {header}
        <p className="sjc-empty">
          {journey.length === 1
            ? 'No score-affecting clues were returned for this analysis.'
            : 'This saved analysis does not include step-by-step symbolic scores. New analyses will show the change after each score-affecting clue.'}
        </p>
        {children}
      </section>
    );
  }

  const values = journey.map((step) => step.scores[tracked]);
  const count = values.length;
  const startValue = values[0];
  const endValue = values[lastIndex];
  const netChange = endValue - startValue;

  /* ---------- chart geometry (1 unit = 1px) ---------- */
  const [domainLo, domainHi] = getDomain(values, mode);
  const chartWidth = Math.max(boxWidth, count * 104);
  const height = 256;
  const left = 38;
  const right = chartWidth - 12;
  const top = 50;
  const bottom = 218;
  const padX = 46;
  const xAt = (index: number) =>
    left + padX + ((right - left - padX * 2) * index) / Math.max(count - 1, 1);
  const yAt = (value: number) =>
    bottom - ((clamp01(value) - domainLo) / (domainHi - domainLo)) * (bottom - top);
  const points = values.map((value, index) => ({ x: xAt(index), y: yAt(value), value }));
  const ticks = [domainLo, (domainLo + domainHi) / 2, domainHi];

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
  const areaPath = `${linePath} L${points[lastIndex].x} ${bottom} L${points[0].x} ${bottom} Z`;
  function openAt(index: number, element: Element) {
    openerRef.current = element;
    setOpen(index);
  }

  function handlePointKey(event: ReactKeyboardEvent<SVGGElement>, index: number) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openAt(index, event.currentTarget);
    }
  }

  /* ---------- modal content ---------- */
  function getStep(index: number) {
    const isStart = index === 0;
    const journeyStep = journey[index];
    const from = isStart ? values[0] : values[index - 1];
    const to = values[index];
    const change = to - from;
    const color = emotionFill[tracked];
    const ink = emotionInk[tracked];

    const title = isStart ? 'Neural baseline' : journeyStep.cue;
    const evidence = journeyStep.adjustment?.delta ?? 0;
    const body = isStart
      ? `The neural model's starting ${trackedLabel} score was ${formatProbability(to)}.`
      : `${journeyStep.cue} contributes ${formatPoints(evidence)} weighted rule evidence toward ${formatClassification(journeyStep.adjustment?.emotionClassification ?? tracked)}. In this illustrative replay, ${trackedLabel} moves from ${formatProbability(from)} to ${formatProbability(to)} (${formatPoints(change)}).`;

    return {
      isStart,
      source: journeyStep.source,
      from,
      to,
      change,
      color,
      ink,
      title,
      body,
      adjustment: journeyStep.adjustment,
      layer: journeyStep.source === 'baseline' ? 'Neural baseline' : journeyStep.source === 'acoustic' ? 'Acoustic clue' : journeyStep.source === 'system' ? 'System adjustment' : 'Linguistic clue',
    };
  }

  const step = open !== null ? getStep(open) : null;

  const modal = step ? (
    <div className="sjc-backdrop" onClick={() => setOpen(null)}>
      <div
        ref={dialogRef}
        className="sjc-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sjc-modal-title"
        style={{ '--m-color': step.color, '--m-ink': step.ink } as CSSProperties}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sjc-modal-head">
          <span className="sjc-modal-chip">{step.layer}</span>
          <button
            type="button"
            className="sjc-modal-close"
            aria-label="Close explanation"
            data-autofocus
            onClick={() => setOpen(null)}
          >
            ×
          </button>
        </div>

        <h4 id="sjc-modal-title">{step.title}</h4>

        <div className="sjc-modal-score">
          {step.isStart ? (
            <strong>{formatProbability(step.to)}</strong>
          ) : (
            <>
              <span>{formatProbability(step.from)}</span>
              <span aria-hidden="true">→</span>
              <strong>{formatProbability(step.to)}</strong>
              <em className={step.change >= 0 ? 'is-up' : 'is-down'}>
                {step.change >= 0 ? '▲' : '▼'} {formatPoints(step.change)}
              </em>
            </>
          )}
          <small>Tracked emotion: {trackedLabel}</small>
        </div>

        <div className="sjc-modal-range" role="img" aria-label={`${trackedLabel} score`}>
          {step.isStart ? null : (
            <span
              className="sjc-modal-range-move"
              style={{
                left: `${Math.min(step.from, step.to) * 100}%`,
                width: `${Math.max(Math.abs(step.change) * 100, 1)}%`,
              }}
            />
          )}
          <span className="sjc-modal-range-dot" style={{ left: `${step.to * 100}%` }} />
        </div>

        <p className="sjc-modal-body">{step.body}</p>

        <div className="sjc-modal-nav">
          <button type="button" disabled={open === 0} onClick={() => setOpen((open ?? 0) - 1)}>
            ‹ Previous
          </button>
          <span>
            {(open ?? 0) + 1} of {count}
          </span>
          <button
            type="button"
            disabled={open === lastIndex}
            onClick={() => setOpen((open ?? 0) + 1)}
          >
            Next ›
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <section className="sjc" style={rootStyle} aria-labelledby="score-changes-heading">
      {header}

      <div className="sjc-toolbar">
        <label className="sjc-emotion-select">
          <span>Viewing score for</span>
          <select
            value={tracked}
            onChange={(event) => {
              const selected = classificationKeys.find((emotion) => emotion === event.target.value);
              if (selected) {
                setTracked(selected);
                setOpen(null);
              }
            }}
          >
            {classificationKeys.map((emotion) => (
              <option key={emotion} value={emotion}>
                {formatClassification(emotion)}
              </option>
            ))}
          </select>
        </label>
        <div className="sjc-scale" role="group" aria-label="Chart scale">
          <button
            type="button"
            className={mode === 'full' ? 'is-on' : ''}
            aria-pressed={mode === 'full'}
            onClick={() => setMode('full')}
          >
            0–100%
          </button>
          <button
            type="button"
            className={mode === 'zoom' ? 'is-on' : ''}
            aria-pressed={mode === 'zoom'}
            onClick={() => setMode('zoom')}
          >
            Zoom
          </button>
        </div>
      </div>

      <div className="sjc-summary" aria-label="Score change summary">
        <div className="sjc-summary-stat">
          <span>Neural starting score</span>
          <b>{formatProbability(startValue)}</b>
        </div>
        <div className="sjc-summary-stat">
          <span>After rule replay</span>
          <b>{formatProbability(endValue)}</b>
        </div>
        <div className="sjc-summary-stat sjc-summary-stat--change">
          <span>Illustrative net change</span>
          <b className={`sjc-summary-net ${netChange >= 0 ? 'is-up' : 'is-down'}`}>
            <span aria-hidden="true">{netChange >= 0 ? '▲' : '▼'}</span> {formatPoints(netChange)}
          </b>
        </div>
        <div className="sjc-summary-stat sjc-summary-stat--final">
          <span>Final {trackedLabel}</span>
          <b>{formatProbability(finalScores[tracked])}</b>
        </div>
      </div>
      <p className="sjc-empty">
        Illustrative replay of weighted rule evidence over the neural scores. It does not change the
        reported symbolic or final scores.
      </p>

      <div className="sjc-plot">
        <div className="sjc-scroll" ref={scrollRef} tabIndex={0} aria-label="Score changes chart">
          <svg
            key={`${tracked}-${mode}`}
            className="sjc-chart"
            width={chartWidth}
            height={height}
            viewBox={`0 0 ${chartWidth} ${height}`}
            role="group"
            aria-labelledby="score-chart-title score-chart-description"
          >
            <title id="score-chart-title">{trackedLabel} score at each step</title>
            <desc id="score-chart-description">
              {`Neural layer starts at ${formatProbability(startValue)}. ` +
                journey
                  .slice(1)
                  .map((item, index) => `${item.cue} moves it to ${formatProbability(values[index + 1])}.`)
                  .join(' ')}
            </desc>
            <defs>
              <linearGradient id="sjc-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={emotionFill[tracked]} stopOpacity="0.16" />
                <stop offset="100%" stopColor={emotionFill[tracked]} stopOpacity="0" />
              </linearGradient>
            </defs>

            {ticks.map((tick, i) => (
              <g key={i}>
                <line className="sjc-grid" x1={left} x2={right} y1={yAt(tick)} y2={yAt(tick)} />
                <text className="sjc-axis-label" x={left - 8} y={yAt(tick) + 3} textAnchor="end">
                  {Math.round(tick * 100)}%
                </text>
              </g>
            ))}

            <path className="sjc-area" d={areaPath} fill="url(#sjc-area)" />

            {journey.slice(1).map((_, index) => (
              <path
                key={`segment-${index}`}
                className="sjc-segment"
                d={`M${points[index].x} ${points[index].y} L${points[index + 1].x} ${points[index + 1].y}`}
                pathLength={1}
                stroke={emotionFill[tracked]}
                style={{ '--i': index } as CSSProperties}
              />
            ))}

            {points.map((point, index) => {
              const isStart = index === 0;
              const isFinal = index === lastIndex;
              const color = emotionFill[tracked];
              const ink = emotionInk[tracked];
              const delta = isStart ? undefined : point.value - points[index - 1].value;
              const journeyStep = journey[index];
              const full = isStart ? 'Neural baseline' : journeyStep.cue;
              const shown = full.length > 13 ? `${full.slice(0, 12)}…` : full;
              const isActive = index === open;
              return (
                <g
                  key={`point-${index}`}
                  className={`sjc-point-group${isActive ? ' is-active' : ''}`}
                  style={{ '--i': index } as CSSProperties}
                  role="button"
                  tabIndex={0}
                  aria-haspopup="dialog"
                  aria-label={`${isStart ? `Neural baseline, ${trackedLabel}` : full}: ${formatProbability(point.value)}${
                    delta === undefined ? '' : `, ${formatPoints(delta)}`
                  }. Show explanation.`}
                  onClick={(event) => openAt(index, event.currentTarget)}
                  onKeyDown={(event) => handlePointKey(event, index)}
                >
                  <line className="sjc-drop" x1={point.x} x2={point.x} y1={point.y} y2={bottom} />
                  {isFinal ? (
                    <circle className="sjc-pulse" cx={point.x} cy={point.y} r="5" stroke={color} />
                  ) : null}
                  <circle className="sjc-halo" cx={point.x} cy={point.y} r="9" fill={color} />
                  <circle
                    className="sjc-point"
                    cx={point.x}
                    cy={point.y}
                    r="4.5"
                    stroke={color}
                    fill={isActive || isStart ? color : '#fff'}
                  />
                  <circle className="sjc-hit" cx={point.x} cy={point.y} r="16" />
                  <text className="sjc-name" x={point.x} y={point.y - 21} textAnchor="middle">
                    <title>{full}</title>
                    {shown}
                  </text>
                  <text className="sjc-value" x={point.x} y={point.y - 9} textAnchor="middle">
                    {formatProbability(point.value)}
                    {delta !== undefined ? (
                      <tspan className="sjc-delta" dx="4" fill={ink}>
                        {formatShort(delta)}
                      </tspan>
                    ) : null}
                  </text>
                  <text className="sjc-x-label" x={point.x} y={bottom + 18} textAnchor="middle">
                    {isStart
                      ? 'Baseline'
                      : journeyStep.source === 'acoustic'
                        ? 'Audio'
                        : journeyStep.source === 'system'
                          ? 'System'
                          : `Text ${index}`}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <ul className="sjc-legend" aria-label="Line color key">
        <li>
          <i style={{ background: emotionFill[tracked] }} aria-hidden="true" />
          {trackedLabel} score
        </li>
        <li className="sjc-legend-note">Small number next to each score = change in points</li>
      </ul>

      {children}
      {modal && typeof document !== 'undefined' ? createPortal(modal, document.body) : null}
    </section>
  );
}
