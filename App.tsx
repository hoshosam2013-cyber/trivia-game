import React, { useEffect, useState } from "react";
import Setup from "./components/Setup";
import QuestionModal from "./components/QuestionModal";
import { GameState, Category, Question, GeminiModel } from "./types";
import { fetchBoardFromStock } from "./services/supabase";
import { audio } from "./services/audio";
import { supabase } from "./services/supabase";

const App: React.FC = () => {
  const initialState: GameState = {
    team1Name: "الفريق 1",
    team2Name: "الفريق 2",
    team1Score: 0,
    team2Score: 0,
    currentTeam: 1,
    selectedCategories: [],
    questions: {},
    phase: "setup",
    activeQuestionId: null,
    selectedModel: "gemini-3-flash-preview",
  };

  const [state, setState] = useState<GameState>(initialState);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState("");

  // 🔐 Supabase Auth state
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // 🔐 استماع لحالة تسجيل الدخول
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  // ⏳ أثناء تحميل حالة الدخول
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
        جاري التحقق من تسجيل الدخول...
      </div>
    );
  }

  // ❌ إذا ما في مستخدم → صفحة تسجيل الدخول
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="glass p-10 rounded-3xl space-y-6 text-center">
          <h1 className="text-3xl font-black text-white">تسجيل الدخول</h1>

          <button
            onClick={() =>
              supabase.auth.signInWithOAuth({ provider: "google" })
            }
            className="w-full py-4 bg-white text-slate-900 rounded-2xl font-black"
          >
            تسجيل الدخول عبر Google
          </button>
        </div>
      </div>
    );
  }

  // 🎮 بدء اللعبة
  const handleStart = async (
    t1: string,
    t2: string,
    cats: Category[],
    model: GeminiModel
  ) => {
    setState((prev) => ({
      ...prev,
      team1Name: t1,
      team2Name: t2,
      selectedCategories: cats,
      selectedModel: model,
      phase: "loading",
    }));

    setLoadingProgress(0);
    setLoadingMessage("جاري سحب الأسئلة...");

    try {
      const { questions } = await fetchBoardFromStock(
        cats,
        user.id,
        (p) => {
          setLoadingProgress(p);
          setLoadingMessage(`تحميل الأسئلة ${p}%`);
        }
      );

      audio.playSuccess();

      setTimeout(() => {
        setState((prev) => ({
          ...prev,
          questions,
          phase: "board",
        }));
      }, 600);
    } catch (e) {
      alert("خطأ في تحميل الأسئلة");
      setState((prev) => ({ ...prev, phase: "setup" }));
    }
  };

  // 🧩 Setup
  if (state.phase === "setup") {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Setup user={user} onStart={handleStart} />
      </main>
    );
  }

  // ⏳ Loading
  if (state.phase === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
        {loadingMessage} ({loadingProgress}%)
      </div>
    );
  }

  // 🧠 Board
  if (state.phase === "board") {
    return (
      <>
        {state.activeQuestionId && (
          <QuestionModal
            question={state.questions[state.activeQuestionId]}
            teamName={
              state.currentTeam === 1 ? state.team1Name : state.team2Name
            }
            onClose={() =>
              setState((prev) => ({
                ...prev,
                activeQuestionId: null,
              }))
            }
          />
        )}
      </>
    );
  }

  return null;
};

export default App;
