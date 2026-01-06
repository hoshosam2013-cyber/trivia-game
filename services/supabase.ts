import { createClient } from "@supabase/supabase-js";
import { Category, Question, GroundingSource } from "../types";

// إعدادات الاتصال بمشروع Supabase
const metaEnv = (import.meta as any).env || {};
const SUPABASE_URL = metaEnv.VITE_SUPABASE_URL || "https://jzroawrljghtzveqsour.supabase.co";
const SUPABASE_KEY = metaEnv.VITE_SUPABASE_ANON_KEY || "sb_publishable_3nZDKySjVLnpQgrWSAwfFQ_yVc47sm9";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export function getPlayerName(): string {
  return localStorage.getItem("PLAYER_NAME") || "Guest";
}

/**
 * 1. جلب الجولات المتبقية (RPC)
 */
export async function fetchRemainingRounds(playerName: string): Promise<Record<string, number>> {
  try {
    if (!playerName) return {};
    const { data, error } = await supabase.rpc('get_remaining_rounds_per_category', { 
      p_user_id: playerName 
    });
    
    if (error) {
      console.error("خطأ في جلب الجولات:", error.message);
      return {};
    }

    const roundsMap: Record<string, number> = {};
    if (data && Array.isArray(data)) {
      data.forEach((item: any) => {
        const catName = item.category;
        const rounds = item.remaining_rounds;
        if (catName !== undefined) roundsMap[catName] = Math.max(0, Number(rounds) || 0);
      });
    }
    return roundsMap;
  } catch (err) {
    return {};
  }
}

/**
 * دالة مساعدة لربط بيانات الصف بكائن Question
 */
function mapQuestionData(row: any, category: Category, points: number): Question {
  const q: Question = {
    id: `${category.id}-${points}`,
    categoryId: category.id,
    points: points,
    questionText: row.question_text || row.question || "سؤال مفقود",
    answerText: row.answer_text || row.answer || "إجابة مفقودة",
    status: 'unplayed',
    isEnumeration: category.id.includes('list') || (row.question_text && row.question_text.includes('عدد')),
    sources: row.sources as GroundingSource[] | undefined
  };

  const mediaUrl = row.media_url || row.image_url; 
  const mediaType = (row.media_type || "").toLowerCase().trim();

  if (mediaUrl) {
    if (mediaType === 'audio' || mediaType === 'صوت') {
      q.audioUrl = mediaUrl;
      q.mediaType = 'صوت';
    } else if (mediaType === 'video' || mediaType === 'فيديو') {
      q.videoUrl = mediaUrl;
      q.mediaType = 'فيديو';
    } else {
      q.imageUrl = mediaUrl;
      q.mediaType = 'صورة';
    }
  }

  return q;
}

/**
 * 2. جلب سؤال واحد (RPC)
 */
async function fetchSingleQuestion(playerId: string, category: Category, points: number): Promise<Question | null> {
  try {
    const { data, error } = await supabase.rpc("get_next_question_for_points", {
      p_user_id: playerId,
      p_category: category.name,
      p_points: points
    });
    if (error || !data || data.length === 0) return null;
    return mapQuestionData(data[0], category, points);
  } catch (err) {
    return null;
  }
}

/**
 * 3. جلب لوحة اللعبة بالكامل
 */
export async function fetchBoardFromStock(
  categories: Category[],
  onProgress?: (percent: number) => void
): Promise<{ questions: Record<string, Question>, errors: string[] }> {
  
  const playerId = getPlayerName();
  const questions: Record<string, Question> = {};
  const errors: string[] = [];
  const pointsLevels = [100, 200, 300, 400, 500];
  const categoryNames = categories.map(c => c.name);
  
  if (onProgress) onProgress(5);

  try {
    // تسجيل البيانات المرسلة للـ RPC للتأكد منها
    console.log("--- استدعاء get_game_board ---");
    console.log("p_user_id:", playerId);
    console.log("p_categories (selectedCategories):", categoryNames);

    // محاولة استدعاء الدالة الجماعية
    const { data, error } = await supabase.rpc("get_game_board", {
      p_user_id: playerId,
      p_categories: categoryNames
    });

    if (error) {
      console.group("❌ فشل استدعاء get_game_board");
      console.error("الرسالة (Message):", error.message);
      console.error("التفاصيل (Details):", error.details);
      console.error("تلميح (Hint):", error.hint);
      console.error("الكود (Code):", error.code);
      console.groupEnd();
      throw error; 
    }

    console.log("✅ تم استلام بيانات اللوحة بنجاح من Batch RPC");
    if (onProgress) onProgress(50);

    const fetchedQuestionsMap = new Map<string, any>();
    if (data && Array.isArray(data)) {
      data.forEach((row: any) => {
        const matchingCat = categories.find(c => c.name === row.category);
        if (matchingCat) {
            const key = `${matchingCat.id}-${row.points}`;
            fetchedQuestionsMap.set(key, row);
        }
      });
    }

    // تعبئة البيانات
    categories.forEach(cat => {
      pointsLevels.forEach(points => {
        const id = `${cat.id}-${points}`;
        const row = fetchedQuestionsMap.get(id);
        if (row) {
          questions[id] = mapQuestionData(row, cat, points);
        } else {
          errors.push(`نقص: ${cat.name} (${points})`);
        }
      });
    });

  } catch (batchError: any) {
    console.info("⚠️ سيتم استخدام نظام الجلب الفردي (Fallback) لضمان استمرار اللعب...");
    let completed = 0;
    const total = categories.length * pointsLevels.length;
    
    const promises = categories.flatMap(cat => 
      pointsLevels.map(async (points) => {
        const q = await fetchSingleQuestion(playerId, cat, points);
        completed++;
        if (onProgress) onProgress(10 + Math.floor((completed / total) * 85));
        
        const id = `${cat.id}-${points}`;
        if (q) {
          questions[id] = q;
        } else {
          questions[id] = {
            id: id, categoryId: cat.id, points: points,
            questionText: `عذراً، نفد مخزون الأسئلة لهذه الفئة (${points})`,
            answerText: "تجاوز", status: 'answered-incorrect'
          };
          errors.push(`نقص: ${cat.name} (${points})`);
        }
      })
    );
    await Promise.all(promises);
  }

  if (onProgress) onProgress(100);
  return { questions, errors };
}

export async function getUsedQuestionsTexts(categoryName: string): Promise<string[]> { return []; }
export async function saveUsedQuestions(categoryName: string, questions: { text: string; points: number }[]): Promise<void> {}