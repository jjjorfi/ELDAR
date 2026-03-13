"use client";

interface EnterAppLoaderProps {
  name?: string;
  durationMs?: number;
}

export function EnterAppLoader({
  name = "ELDAR",
  durationMs = 1_050
}: EnterAppLoaderProps): JSX.Element {
  return (
    <>
      <style>{`
        @keyframes eldar-enter-char {
          0% { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }

        @keyframes eldar-enter-bar {
          0% { width: 0%; opacity: 1; }
          84% { width: 88%; opacity: 1; }
          100% { width: 100%; opacity: 0; }
        }

        @keyframes eldar-enter-fade {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
      `}</style>
      <div
        className="fixed inset-0 z-[160] flex flex-col items-center justify-center gap-8 bg-[#09090b]"
        style={{ animation: "eldar-enter-fade 180ms ease forwards" }}
      >
        <div className="flex gap-[0.05em]">
          {name.split("").map((char, index) => (
            <span
              key={`loader-char-${index}`}
              className="text-[clamp(2rem,6vw,3.5rem)] font-semibold tracking-[0.2em] text-white"
              style={{
                opacity: 0,
                animation: "eldar-enter-char 400ms cubic-bezier(0.34,1.56,0.64,1) forwards",
                animationDelay: `${index * 60}ms`
              }}
            >
              {char}
            </span>
          ))}
        </div>
        <div className="relative h-px w-[120px] overflow-hidden rounded-full bg-white/8">
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-[#B38728] via-[#FCF6BA] to-[#DBB863]"
            style={{
              animation: `eldar-enter-bar ${Math.max(durationMs - 300, 400)}ms cubic-bezier(0.4,0,0.2,1) forwards`,
              animationDelay: "160ms"
            }}
          />
        </div>
        <p className="text-[0.7rem] uppercase tracking-[0.25em] text-white/20">Initializing</p>
      </div>
    </>
  );
}
