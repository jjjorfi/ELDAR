"use client";

export function GrainOverlay({ opacity = 0.035 }: { opacity?: number }): JSX.Element {
  return (
    <>
      <style>{`
        @keyframes grain {
          0%, 100% { transform: translate(0, 0); }
          10% { transform: translate(-2%, -3%); }
          20% { transform: translate(3%, 2%); }
          30% { transform: translate(-1%, 4%); }
          40% { transform: translate(4%, -1%); }
          50% { transform: translate(-3%, 3%); }
          60% { transform: translate(2%, -4%); }
          70% { transform: translate(-4%, 1%); }
          80% { transform: translate(1%, -2%); }
          90% { transform: translate(3%, 4%); }
        }

        .grain-layer {
          position: fixed;
          inset: -30%;
          width: 160%;
          height: 160%;
          pointer-events: none;
          z-index: 9999;
          animation: grain 8s steps(10) infinite;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
          background-size: 180px 180px;
        }
      `}</style>
      <div className="grain-layer" style={{ opacity }} aria-hidden="true" />
    </>
  );
}
