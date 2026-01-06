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
