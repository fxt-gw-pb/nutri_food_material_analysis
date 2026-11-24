import { ConsumptionEvaluation, MealAnalysis, MealAuditSnapshot } from '../types/index';
import { resolveMeal } from './texture';
import { WEIGHT_ALGORITHM_VERSION } from './weight';
import { dishIntakeItems, storedIntake } from './intake';

export function buildAuditSnapshot(meal: MealAnalysis): MealAuditSnapshot {
  const resolved = resolveMeal(meal.dish, meal.selectedRecords, meal.plateDiameterCm);
  const excluded = meal.excludedIngredients || [];
  return {
    algorithmVersion: WEIGHT_ALGORITHM_VERSION,
    generatedAt: Date.now(),
    plateDiameterCm: resolved.plateDiameterCm,
    totalG: resolved.ingredients.filter((i) => excluded.indexOf(i.name) < 0).reduce((s, i) => s + i.grams, 0),
    ingredients: resolved.ingredients.map((i) => ({
      name: i.name, excluded: excluded.indexOf(i.name) >= 0,
      grams: i.grams, weightRange: i.weightRangeText, weightBasis: i.weightBasis,
      weightConfidence: i.weightConfidence, recordId: i.recordId,
      matchedDish: i.matchedDish, matchedIngredient: i.matchedIngredient,
      matchedCookingText: i.matchedCookingText, matchReason: i.reason,
      sources: i.readings.map((r) => ({ testMode: r.testMode, source: r.source })),
    })),
  };
}

export function buildConsumption(meal: MealAnalysis, percentages: Record<string, number>, complete: boolean): ConsumptionEvaluation {
  const resolved = resolveMeal(meal.dish, meal.selectedRecords, meal.plateDiameterCm, meal.excludedIngredients);
  const clean: Record<string, number> = {};
  const grams: Record<string, number> = {};
  resolved.ingredients.forEach((i) => {
    const value = percentages[i.name];
    if (value === undefined && !complete) return;
    if (typeof value !== 'number' || !isFinite(value) || value < 0 || value > 500) {
      throw new Error(`请确认「${i.name}」的食用比例（0%–500%）`);
    }
    clean[i.name] = Math.round(value);
    grams[i.name] = Math.round(i.grams * clean[i.name]) / 100;
  });
  const now = Date.now();
  return {
    analysisId: meal.analysisId,
    ...(meal.participantCode !== undefined ? { participantCode: meal.participantCode } : {}),
    percentages: clean, consumedGrams: grams,
    totalConsumedG: Math.round(Object.keys(grams).reduce((s, n) => s + grams[n], 0) * 100) / 100,
    updatedAt: now,
    ...(complete ? { completedAt: now, intake: storedIntake(dishIntakeItems(meal, grams)) } : {}),
  };
}

export function validateExcluded(meal: MealAnalysis, excluded: string[]): string[] {
  const names = resolveMeal(meal.dish, meal.selectedRecords, meal.plateDiameterCm).ingredients.map((i) => i.name);
  return Array.from(new Set(excluded.filter((name) => names.indexOf(name) >= 0)));
}
