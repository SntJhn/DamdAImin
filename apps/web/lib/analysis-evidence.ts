import type { AnalysisResult } from '@damdai/contracts';

type TechnicalTrace = AnalysisResult['technicalTrace'];
type ScoreAdjustment = TechnicalTrace['scoreAdjustments'][number];

export function normalizeRuleId(ruleId: string): string {
  return ruleId.replace(/-\d+$/, '').toUpperCase();
}

export function getAdjustmentAttribution(adjustment: ScoreAdjustment) {
  // Older stored results only identify the cue and rule in this engine-generated sentence.
  const legacy = adjustment.reason.match(
    /^([A-Z][A-Z0-9_-]*) detected (['"])([^\\]*?)\2 and reported an? (?:increase|decrease|support) adjustment\.$/i,
  );
  return {
    ruleId: adjustment.ruleId ?? legacy?.[1],
    cue: adjustment.cue ?? legacy?.[3],
  };
}

export function getCueScoreAdjustments(
  cue: string,
  ruleId: string,
  adjustments: TechnicalTrace['scoreAdjustments'],
) {
  return adjustments.filter((adjustment) => {
    const attribution = getAdjustmentAttribution(adjustment);
    return (
      attribution.ruleId !== undefined &&
      normalizeRuleId(attribution.ruleId) === normalizeRuleId(ruleId) &&
      attribution.cue?.toLowerCase() === cue.toLowerCase()
    );
  });
}

const scoreSignalRules = [
  {
    id: 'LEXICAL_EMOTION',
    label: 'Emotion words and phrases',
    explanation: 'Looks for words that carry emotion and the emotion linked to each word.',
  },
  {
    id: 'LEXICAL_MODIFIER',
    label: 'Emotion modifiers',
    explanation: 'Checks for words that strengthen or soften an emotion phrase.',
  },
  {
    id: 'LEXICAL_NEGATION',
    label: 'Negation cues',
    explanation: 'Checks whether negation changes the meaning of an emotion phrase.',
  },
  {
    id: 'LEXICAL_PROFANITY',
    label: 'Profanity',
    explanation: 'Flags profanity as contextual evidence; it does not determine emotion by itself.',
  },
  {
    id: 'LEXICAL_POLITENESS',
    label: 'Politeness cues',
    explanation: 'Checks for polite expressions that provide emotional context.',
  },
  {
    id: 'CODE_SWITCH_TOKEN_LID',
    label: 'Filipino-English code-switching',
    explanation: 'Checks for Filipino and English being used together in the transcript.',
  },
  {
    id: 'CONTRAST_POST_CLAUSE',
    label: 'Emotion after contrast',
    explanation: 'Checks for an emotional phrase after a contrast word such as “pero.”',
  },
  {
    id: 'PROSODIC_ENERGY_RATE',
    label: 'Speaking energy and rate',
    explanation: 'Uses speaking energy and rate as supplementary audio evidence.',
  },
  {
    id: 'CONTRADICTION_RECALIBRATION',
    label: 'Neural-symbolic disagreement',
    explanation: 'Adjusts evidence when the audio prediction and symbolic rules disagree.',
  },
  {
    id: 'NEURAL_RULE_AGREEMENT',
    label: 'Neural-rule agreement',
    explanation: 'Adds support when the audio prediction agrees with positive rule evidence.',
  },
];

export function getRuleSignals(trace: TechnicalTrace) {
  const reportedIds = new Set([
    ...trace.activatedRules.map((rule) => normalizeRuleId(rule.id)),
    ...trace.cueSpans
      .filter(
        (span) => !['ASR_TRANSCRIPT', 'USER_REVIEWED_TRANSCRIPT'].includes(span.cue.toUpperCase()),
      )
      .map((span) => normalizeRuleId(span.cue)),
    ...trace.scoreAdjustments.flatMap((adjustment) => {
      const { ruleId } = getAdjustmentAttribution(adjustment);
      return ruleId ? [normalizeRuleId(ruleId)] : [];
    }),
  ]);
  const knownIds = new Set(scoreSignalRules.map((signal) => signal.id));
  const additionalSignals = [...reportedIds]
    .filter((id) => !knownIds.has(id))
    .map((id) => ({
      id,
      label: id.replace(/[_-]+/g, ' ').toLowerCase(),
      explanation: 'Additional evidence reported by the analysis system.',
    }));

  return [...scoreSignalRules, ...additionalSignals].map((signal) => {
    const activeRules = trace.activatedRules.filter(
      (rule) => normalizeRuleId(rule.id) === signal.id,
    );
    const cues = trace.cueSpans.filter((span) => normalizeRuleId(span.cue) === signal.id);
    const adjustments = trace.scoreAdjustments.filter((adjustment) => {
      const { ruleId } = getAdjustmentAttribution(adjustment);
      return ruleId !== undefined && normalizeRuleId(ruleId) === signal.id;
    });
    return {
      ...signal,
      active: activeRules.length > 0 || cues.length > 0 || adjustments.length > 0,
      activeRules,
      cues,
      adjustments,
    };
  });
}
