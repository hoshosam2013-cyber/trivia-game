import { createClient } from '@supabase/supabase-js';
import { Category, Question } from '../types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL!;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * يسحب لوحة الأسئلة مع منع التكرار حسب الإيميل
 */
export async function fetchBoardFromStock(
  categories: Category[],
  onProgress?: (percent: number) => void
): Promise<{ questions: Record<string, Question>; errors: string[] }> {

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user?.email) {
    throw new Error('المستخدم غير مسجّل دخول');
  }

  const userEmail = user.email; // ← هذا المهم

  const questions: Record<string, Question> = {};
  const errors: string[] = [];

  let completed = 0;
  const total = categories.length * 5;

  for (const cat of categories) {
    for (const points of [100, 200, 300, 400, 500]) {

      // 1️⃣ جيب سؤال ما انستخدم لهالإيميل
      const { data, error } = await supabase
        .rpc('get_random_question_for_user', {
          p_category: cat.name,
          p_points: points,
          p_user_email: userEmail, // ← الإيميل نفسه
        });

      if (error || !data) {
        errors.push(`نفد مخزون ${cat.name} (${points})`);
        questions[`${cat.id}-${points}`] = {
          id: `${cat.id}-${points}`,
          category: cat.name,
          points,
          questionText: `عذراً، نفد مخزون الأسئلة لهذه الفئة (${points})`,
          answerText: '',
          status: 'answered-incorrect',
        };
      } else {
        questions[`${cat.id}-${points}`] = {
          id: data.id,
          category: cat.name,
          points,
          questionText: data.question,
          answerText: data.answer,
          status: 'unplayed',
        };

        // 2️⃣ سجل الاستخدام بالإيميل
        await supabase.from('question_usage').insert({
          user_id: userEmail, // ← ينحفظ الإيميل هون
          question_id: data.id,
          category: cat.name,
        });
      }

      completed++;
      onProgress?.(Math.round((completed / total) * 100));
    }
  }

  return { questions, errors };
}


// ✅ يرجّع عدد الجولات المتبقية لكل فئة (حسب الإيميل)
export async function fetchRemainingRounds(categoryName: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    // إذا ما في مستخدم، اعتبر 0 أو رجّع قيمة افتراضية حسب لعبتك
    return 0;
  }

  const userEmail = user.email;

  // إذا عندك RPC جاهز اسمه get_remaining_rounds_per_category
  // عدّل أسماء البراميترات بالضبط حسب اللي عاملها عندك في Supabase
  const { data, error } = await supabase.rpc("get_remaining_rounds_per_category", {
    p_user_id: userEmail,         // عمود user_id عندك صار ايميل
    p_category_name: categoryName // اسم الفئة
  });

  if (error) {
    console.error("fetchRemainingRounds error:", error);
    return 0;
  }

  // حسب تصميم RPC:
  // ممكن يرجع رقم مباشر، أو object، أو array
  // خلينا نتعامل مع أغلب الحالات:
  if (typeof data === "number") return data;
  if (Array.isArray(data) && data[0]?.remaining !== undefined) return data[0].remaining;
  if (data?.remaining !== undefined) return data.remaining;

  return 0;
}
