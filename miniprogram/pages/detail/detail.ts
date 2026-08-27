import { getMealAnalysisResult } from '../../services/mealService';
import { confidenceLabel } from '../../utils/confidence';
import { formatDateTime, mealTypeLabel } from '../../utils/format';
import { resolveMeal, matchTypeLabel, summarizeTexture } from '../../utils/texture';
import { candidateCookingText } from '../../services/textureMatch';
import {
  MetricRow,
  metricRows,
  hardnessLabel,
  hardnessPercent,
  chewinessLabel,
  adhesivenessLabel,
} from '../../data/textureDb';

interface ItemView {
  queryName: string;
  matched: boolean;
  title: string;
  cookingText: string;
  source: string;
  hardnessText: string;
  hardnessPercent: number;
  chewinessText: string;
  adhesivenessText: string;
  edited: boolean;
  /** 九项完整指标，详情页展开查看 */
  metrics: MetricRow[];
}

interface DishView {
  dishName: string;
  cookingMethod: string;
  matchTypeText: string;
  confidenceText: string;
  items: ItemView[];
}

Page({
  data: {
    imageUrl: '',
    dateText: '',
    mealTypeText: '',
    textureSummary: '',
    dishViews: [] as DishView[],
  },

  onLoad(query: Record<string, string | undefined>) {
    const analysisId = query.analysisId || '';
    if (!analysisId) {
      wx.showToast({ title: '缺少记录', icon: 'none' });
      return;
    }
    getMealAnalysisResult(analysisId)
      .then((meal) => {
        const resolved = resolveMeal(meal.dishes, meal.selections);
        const dishViews: DishView[] = resolved.map((rd, i) => ({
          dishName: rd.dishName,
          cookingMethod: rd.cookingMethod,
          matchTypeText: matchTypeLabel(rd.matchType),
          confidenceText: confidenceLabel(
            meal.dishes[i] ? meal.dishes[i].recognitionConfidence : 'medium',
          ),
          items: rd.items.map((item) => {
            const rec = item.record;
            return {
              queryName: item.queryName,
              matched: !!rec,
              title: rec
                ? rec.dish === rec.ingredient
                  ? rec.dish
                  : `${rec.dish} · ${rec.ingredient}`
                : '未匹配到质构数据',
              cookingText: rec ? candidateCookingText(rec.method, rec.minutes) : '',
              source: rec ? rec.source : '',
              hardnessText: rec ? hardnessLabel(rec.metrics.hardness) : '—',
              hardnessPercent: rec ? hardnessPercent(rec.metrics.hardness) : 0,
              chewinessText: rec ? chewinessLabel(rec.metrics.chewiness) : '—',
              adhesivenessText: rec ? adhesivenessLabel(rec.metrics.adhesiveness) : '—',
              edited: item.edited,
              metrics: rec ? metricRows(rec.metrics) : [],
            };
          }),
        }));
        this.setData({
          imageUrl: meal.imageUrl,
          dateText: formatDateTime(meal.createdAt),
          mealTypeText: mealTypeLabel(meal.mealType),
          textureSummary: summarizeTexture(resolved),
          dishViews,
        });
      })
      .catch((err) => {
        console.error('[detail] load failed', err);
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
  },
});
